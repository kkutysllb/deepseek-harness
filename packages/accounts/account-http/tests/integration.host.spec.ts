import { connect } from 'node:net'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { Context } from '@deepseek-ai/cordis'
import HttpServer from '@qilin/host-webserver'
import * as Connection from '@qilin/client-connection'
import { afterEach, describe, expect, it } from 'vitest'
import * as AccountHttp from '../src/index.ts'

/**
 * REAL-composition coverage: a live node:http server (webServer + client
 * connection + account-http mounted on one cordis context) observed through
 * raw HTTP and raw upgrade sockets — the acceptance surface for the /api
 * authentication enforcement and the /api/v1/auth route family.
 */

/** The /api proxy stub: gate-passed business requests land here. */
const proxyStub = {
  fetch: async () => new Response('proxy-stub-404', { status: 404 }),
  events: {
    mux: async function* eventsMux(): AsyncGenerator<Uint8Array> {
      yield* [] as Uint8Array[]
    },
    host: async function* eventsHost(): AsyncGenerator<Uint8Array> {
      yield* [] as Uint8Array[]
    },
  },
}

interface Server {
  origin: string
  configPath: string
}

let cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
  const pending = cleanup
  cleanup = []
  for (const fn of pending) await fn()
})

/** Mount the real composition and wait for the OS-assigned port. */
async function mount(config: Partial<AccountHttp.Config> = {}): Promise<Server> {
  const root = await mkdtemp(join(tmpdir(), 'account-http-int-'))
  const configPath = join(root, 'auth-config.json')
  const ctx = new Context()
  ctx.provide('apiProxy', proxyStub)
  ctx.plugin(HttpServer, { host: '127.0.0.1', port: 0 })
  ctx.plugin({ inject: [...Connection.inject], apply: Connection.apply }, {})
  ctx.plugin({ inject: [...AccountHttp.inject], apply: AccountHttp.apply }, {
    dbPath: ':memory:',
    authConfigPath: configPath,
    ...config,
  })
  const deadline = Date.now() + 10_000
  while ((ctx.get('webServer')?.port ?? 0) === 0) {
    if (Date.now() > deadline) throw new Error('webServer never bound a port')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  const port = ctx.get('webServer')!.port
  cleanup.push(async () => {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  return { origin: 'http://127.0.0.1:' + String(port), configPath }
}

interface Call {
  status: number
  body: string
  cookies: string[]
  headers: Record<string, string>
}

async function call(origin: string, path: string, init: RequestInit = {}): Promise<Call> {
  const response = await fetch(origin + path, init)
  const headers: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    headers[key] = value
  })
  return {
    status: response.status,
    body: await response.text(),
    cookies: response.headers.getSetCookie(),
    headers,
  }
}

/** The cookie jar built from one login/register response. */
function jarOf(call: Call): string {
  return call.cookies.map(cookie => cookie.split(';')[0]).join('; ')
}

const post = (body: unknown, extra: Record<string, string> = {}): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...extra },
  body: JSON.stringify(body),
})

describe('unauthenticated /api enforcement (contract D)', () => {
  it('refuses business routes with 401 not_authenticated and serves public reads', async () => {
    const { origin } = await mount()
    for (const method of ['GET', 'POST']) {
      const business = await call(origin, '/api/session.list', { method })
      expect(business.status).toBe(401)
      expect((JSON.parse(business.body) as { error: { code: string } }).error.code).toBe('not_authenticated')
    }
    const setup = await call(origin, '/api/v1/auth/setup-status')
    expect(setup.status).toBe(200)
    expect(JSON.parse(setup.body)).toEqual({ needsSetup: true, registrationEnabled: true })
  })

  it('answers 403 csrf_missing for a cookie-authenticated write without the header', async () => {
    const { origin } = await mount()
    const init = await call(origin, '/api/v1/auth/initialize', post({ email: 'root@example.com', password: 'root-pass-123' }))
    expect(init.status).toBe(201)
    const write = await call(origin, '/api/session.list', {
      method: 'POST',
      headers: { cookie: jarOf(init) },
    })
    expect(write.status).toBe(403)
    expect((JSON.parse(write.body) as { error: { code: string } }).error.code).toBe('csrf_missing')
    // The double submit completes: the same write passes the gate and lands
    // in the API-proxy carrier (which rejects the missing JSON media type —
    // a 415 from behind the gate is the pass-through proof).
    const csrf = init.cookies.find(value => value.startsWith('csrf_token='))?.split(';')[0]?.split('=')[1] ?? ''
    const ok = await call(origin, '/api/session.list', {
      method: 'POST',
      headers: { cookie: jarOf(init), 'x-csrf-token': csrf },
    })
    expect(ok.status).toBe(415)
    expect(ok.body).toBe('content type must be application/json')
  })
})

describe('login → me → logout journey', () => {
  it('walks the full cookie journey and kills the session at logout', async () => {
    const { origin } = await mount()
    const init = await call(origin, '/api/v1/auth/initialize', post({ email: 'root@example.com', password: 'root-pass-123' }))
    expect(init.status).toBe(201)
    expect((JSON.parse(init.body) as { user: { systemRole: unknown } }).user.systemRole).toBe('admin')
    expect(init.cookies).toHaveLength(3)

    const bad = await call(origin, '/api/v1/auth/login/local', post({ email: 'root@example.com', password: 'wrong-pass-123' }))
    expect(bad.status).toBe(401)
    expect((JSON.parse(bad.body) as { error: { message: string } }).error.message).toBe('Incorrect email or password')
    // No enumeration signal: failed and unknown logins are indistinguishable.
    const unknown = await call(origin, '/api/v1/auth/login/local', post({ email: 'nobody@example.com', password: 'wrong-pass-123' }))
    expect(unknown.body).toBe(bad.body)

    const login = await call(origin, '/api/v1/auth/login/local', post({ email: 'root@example.com', password: 'root-pass-123' }))
    expect(login.status).toBe(200)
    expect(login.cookies).toHaveLength(3)
    const accessToken = (JSON.parse(login.body) as { accessToken: string }).accessToken
    const jar = jarOf(login)

    const me = await call(origin, '/api/v1/auth/me', { headers: { cookie: jar } })
    expect(me.status).toBe(200)
    expect(JSON.parse(me.body)).toMatchObject({ email: 'root@example.com', systemRole: 'admin' })
    expect((JSON.parse(me.body) as { passwordHash: string }).passwordHash).toBeUndefined()

    const bearer = await call(origin, '/api/v1/auth/me', { headers: { authorization: 'Bearer ' + accessToken } })
    expect(bearer.status).toBe(200)
    expect((JSON.parse(bearer.body) as { email: string }).email).toBe('root@example.com')

    // Gate-passed business request reaches the API-proxy carrier behind the
    // gate: its 415 for the missing JSON media type is the pass-through proof
    // (Bearer chains skip the CSRF judgment).
    const business = await call(origin, '/api/session.list', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + accessToken },
    })
    expect(business.status).toBe(415)
    expect(business.body).toBe('content type must be application/json')

    const out = await call(origin, '/api/v1/auth/logout', { method: 'POST', headers: { cookie: jar } })
    expect(out.status).toBe(200)
    expect(out.cookies.filter(cookie => cookie.startsWith('access_token=;'))).toHaveLength(1)
    const after = await call(origin, '/api/v1/auth/me', { headers: { cookie: jar } })
    expect(after.status).toBe(401)
    expect((JSON.parse(after.body) as { error: { code: string } }).error.code).toBe('token_invalid')
  })
})

describe('registration switch (D5, open by default, live edits)', () => {
  it('opens by default, closes on the file, and registers are always plain users', async () => {
    const { origin, configPath } = await mount()
    const open = await call(origin, '/api/v1/auth/register', post({ email: 'kid@example.com', password: 'kid-pass-123' }))
    expect(open.status).toBe(201)
    expect((JSON.parse(open.body) as { user: { systemRole: unknown } }).user.systemRole).toBe('user')
    const me = await call(origin, '/api/v1/auth/me', { headers: { cookie: jarOf(open) } })
    expect(me.status).toBe(200)

    // Flip the switch: closed on the very next request, no restart.
    await writeFile(configPath, '{"registrationEnabled": false}')
    const closed = await call(origin, '/api/v1/auth/register', post({ email: 'other@example.com', password: 'other-pass-123' }))
    expect(closed.status).toBe(403)
    expect((JSON.parse(closed.body) as { error: { code: string } }).error.code).toBe('registration_disabled')

    // Reopen: the same deployment accepts registrations again.
    await writeFile(configPath, '{"registrationEnabled": true}')
    const reopened = await call(origin, '/api/v1/auth/register', post({ email: 'other@example.com', password: 'other-pass-123' }))
    expect(reopened.status).toBe(201)
    expect((JSON.parse(reopened.body) as { user: { systemRole: unknown } }).user.systemRole).toBe('user')
  })
})

describe('cross-site auth POST defense (legacy Origin whitelist)', () => {
  it('denies cross-origin credential endpoints and passes same-origin ones', async () => {
    const { origin } = await mount()
    const evil = await call(origin, '/api/v1/auth/register', post({ email: 'x@example.com', password: 'x-pass-12345' }, { origin: 'https://evil.example' }))
    expect(evil.status).toBe(403)
    expect((JSON.parse(evil.body) as { error: { message: string } }).error.message).toBe('Cross-site auth request denied.')

    const same = await call(origin, '/api/v1/auth/register', post({ email: 'x@example.com', password: 'x-pass-12345' }, { origin }))
    expect(same.status).toBe(201)
  })
})

describe('initialize idempotence', () => {
  it('runs once on the empty store and refuses afterwards', async () => {
    const { origin } = await mount()
    const payload = post({ email: 'root@example.com', password: 'root-pass-123' })
    const first = await call(origin, '/api/v1/auth/initialize', payload)
    expect(first.status).toBe(201)
    const second = await call(origin, '/api/v1/auth/initialize', payload)
    expect(second.status).toBe(409)
    expect((JSON.parse(second.body) as { error: { code: string } }).error.code).toBe('system_already_initialized')
  })
})

describe('rate limiting (D5-c)', () => {
  it('answers 429 with Retry-After and reopens after the window', async () => {
    const { origin } = await mount({ rateLimitMaxAttempts: 2, rateLimitWindowMs: 150 })
    const attempt = (): Promise<Call> => call(origin, '/api/v1/auth/login/local', post({ email: 'nobody@example.com', password: 'whatever-pass' }))
    expect((await attempt()).status).toBe(401)
    expect((await attempt()).status).toBe(401)
    const limited = await attempt()
    expect(limited.status).toBe(429)
    expect((JSON.parse(limited.body) as { error: { code: string } }).error.code).toBe('rate_limited')
    expect(Number(limited.headers['retry-after'])).toBeGreaterThanOrEqual(1)
    await new Promise(resolve => setTimeout(resolve, 220))
    expect((await attempt()).status).toBe(401)
  })
})

/** One raw upgrade request; resolves with the first response bytes (empty on timeout). */
async function upgrade(port: number, host: string, headers: string[] = []): Promise<string> {
  const socket = connect(port, '127.0.0.1')
  await once(socket, 'connect')
  const data = once(socket, 'data')
  socket.write([
    'GET /api/events.mux HTTP/1.1',
    'Host: ' + host,
    'Connection: Upgrade',
    'Upgrade: websocket',
    'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
    'Sec-WebSocket-Version: 13',
    ...headers,
    '',
    '',
  ].join('\r\n'))
  const first = await Promise.race([
    data as Promise<[Buffer]>,
    new Promise<'timeout'>(resolve => setTimeout(() => {
      resolve('timeout')
    }, 4000)),
  ])
  const text = first === 'timeout' ? '' : String(first[0])
  socket.destroy()
  return text
}

describe('WebSocket upgrade fence', () => {
  it('refuses anonymous upgrades with 401 before negotiation', async () => {
    const { origin } = await mount()
    const response = await upgrade(Number(new URL(origin).port), '127.0.0.1:' + new URL(origin).port)
    expect(response).toContain('401 Unauthorized')
    expect(response).toContain('unauthorized')
  })

  it('keeps the untrusted-host fence at 403 ahead of authentication', async () => {
    const { origin } = await mount()
    const response = await upgrade(Number(new URL(origin).port), 'evil.example')
    expect(response).toContain('403 Forbidden')
    expect(response).toContain('forbidden')
  })

  it('passes a session-bearing upgrade into the protocol negotiation', async () => {
    const { origin } = await mount()
    const init = await call(origin, '/api/v1/auth/initialize', post({ email: 'root@example.com', password: 'root-pass-123' }))
    const response = await upgrade(Number(new URL(origin).port), '127.0.0.1:' + new URL(origin).port, ['Cookie: ' + jarOf(init)])
    expect(response).toContain('101 Switching Protocols')
  })
})

describe('auth-disabled escape valve (contract D5-a)', () => {
  it('serves the synthetic admin transparently and refuses password changes', async () => {
    const saved = {
      disabled: process.env.QILIN_AUTH_DISABLED,
      prod: process.env.QILIN_ENV,
      environment: process.env.ENVIRONMENT,
    }
    delete process.env.QILIN_ENV
    delete process.env.ENVIRONMENT
    process.env.QILIN_AUTH_DISABLED = '1'
    try {
      const { origin } = await mount()
      const me = await call(origin, '/api/v1/auth/me')
      expect(me.status).toBe(200)
      expect(JSON.parse(me.body)).toMatchObject({ id: 'default', systemRole: 'admin', needsSetup: false })

      // Writes pass without any CSRF/Origin ceremony: the carrier's 415 for
      // the missing JSON media type proves the write went through.
      const write = await call(origin, '/api/session.list', { method: 'POST' })
      expect(write.status).toBe(415)
      expect(write.body).toBe('content type must be application/json')
      // The connection's browser-trust fence is orthogonal layering: a
      // cross-site marker is still refused even under the valve.
      const crossSite = await call(origin, '/api/session.list', { method: 'POST', headers: { origin: 'https://evil.example' } })
      expect(crossSite.status).toBe(403)

      const change = await call(origin, '/api/v1/auth/change-password', post({ currentPassword: 'x', newPassword: 'long-enough-pass' }))
      expect(change.status).toBe(400)
      expect((JSON.parse(change.body) as { error: { message: string } }).error.message).toContain('QILIN_AUTH_DISABLED=1')
    } finally {
      if (saved.disabled === undefined) delete process.env.QILIN_AUTH_DISABLED
      else process.env.QILIN_AUTH_DISABLED = saved.disabled
      if (saved.prod === undefined) delete process.env.QILIN_ENV
      else process.env.QILIN_ENV = saved.prod
      if (saved.environment === undefined) delete process.env.ENVIRONMENT
      else process.env.ENVIRONMENT = saved.environment
    }
  })
})
