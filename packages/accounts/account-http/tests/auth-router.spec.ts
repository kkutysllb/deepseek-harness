import type { IncomingMessage, ServerResponse } from 'node:http'
import { EventEmitter, Readable } from 'node:stream'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionService } from '@qilin/account-auth'
import { AccountConflictError, hashPassword, SqliteAccountStore, type AccountStore, type User } from '@qilin/account-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAuthRouteHandler, type AuthRouterDeps } from '../src/auth-router.ts'
import { RateLimiter } from '../src/rate-limit.ts'

/** A request with the given method/url/headers/body, fully readable. */
function requestOf(method: string, url: string, headers: Record<string, string>, body?: unknown): IncomingMessage {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  const request = Readable.from(payload) as unknown as IncomingMessage
  Object.assign(request, { url, method, headers: { host: '127.0.0.1:3080', ...headers } })
  Object.defineProperty(request, 'socket', { value: { remoteAddress: '203.0.113.9' } })
  return request
}

/** A response recorder standing in for node:http's ServerResponse. */
type RecordedState = { status?: number | undefined; body?: string | undefined; cookies: string[]; destroyed: boolean }

type RecordedResponse = { response: ServerResponse; state: RecordedState; commitHeaders: () => void }

function responseRecorder(): RecordedResponse {
  const state = {
    cookies: [] as string[],
    destroyed: false,
    status: undefined as number | undefined,
    body: undefined as string | undefined,
  }
  let headersSent = false
  const response = Object.assign(new EventEmitter(), {
    headers: {},
    setHeader(name: string, value: string | string[]) {
      ;(response as unknown as { headers: Record<string, string | string[]> }).headers[name.toLowerCase()] = value
      if (name.toLowerCase() === 'set-cookie') state.cookies.push(...(Array.isArray(value) ? value : [value]))
      return response
    },
    writeHead(status: number, headers?: Record<string, string>) {
      state.status = status
      if (headers?.['content-type'] !== undefined) headersSent = true
      return response
    },
    getHeader(name: string) {
      return (response as unknown as { headers: Record<string, string | string[]> }).headers?.[name.toLowerCase()]
    },
    end(payload?: string | Uint8Array) {
      state.status = state.status ?? 200
      if (typeof payload === 'string' || payload instanceof Uint8Array) state.body = String(payload)
      headersSent = true
      return response
    },
    destroy() {
      state.destroyed = true
      return response
    },
  }) as unknown as ServerResponse
  Object.defineProperty(response, 'headersSent', { get: () => headersSent })
  return { response, state, commitHeaders: () => { headersSent = true } }
}

/** A request streaming one raw buffer (for malformed or oversized bodies). */
function rawRequestOf(method: string, url: string, headers: Record<string, string>, payload: Buffer): IncomingMessage {
  const request = Readable.from([payload]) as unknown as IncomingMessage
  Object.assign(request, { url, method, headers: { host: '127.0.0.1:3080', ...headers } })
  Object.defineProperty(request, 'socket', { value: { remoteAddress: '203.0.113.9' } })
  return request
}

interface DepsHarness {
  deps: AuthRouterDeps
  store: SqliteAccountStore
  user: User
  dispose: () => void
}

async function depsHarness(overrides: Partial<AccountStore> = {}): Promise<DepsHarness> {
  const store = new SqliteAccountStore({ path: ':memory:' })
  const patched = new Proxy(store, {
    get(target, property, receiver) {
      if (property in overrides) return overrides[property as keyof AccountStore]
      // never widens the reflective read back to the store's method type
      return Reflect.get(target, property, receiver) as never
    },
  }) as AccountStore
  const user = store.insertUser({
    email: 'existing@example.com',
    passwordHash: hashPassword('original-pass'),
    systemRole: 'user',
  })
  const deps: AuthRouterDeps = {
    store: patched,
    sessions: new SessionService({ store }),
    env: {},
    authDisabled: false,
    authConfigPath: join(mkdtempSync(join(tmpdir(), 'router-deps-')), 'auth-config.json'),
    limiter: new RateLimiter({ maxAttempts: 1000 }),
  }
  return { deps, store, user, dispose: () => { store.close() } }
}

let cleanup: Array<() => void> = []

afterEach(() => {
  for (const fn of cleanup) fn()
  cleanup = []
  vi.restoreAllMocks()
})

const POST_JSON = { 'content-type': 'application/json' }

describe('route dispatch shape', () => {
  it('answers 404 for unknown subpaths and the bare prefix, 405 for known paths with wrong methods', async () => {
    const { deps, dispose } = await depsHarness()
    cleanup.push(dispose)
    const handler = createAuthRouteHandler(deps)
    for (const url of ['/api/v1/auth/nonsense', '/api/v1/auth', '/api/v1/auth/login/local/extra']) {
      const { response, state } = responseRecorder()
      await handler(requestOf('GET', url, {}), response)
      expect(state.status).toBe(404)
    }
    const { response, state } = responseRecorder()
    await handler(requestOf('DELETE', '/api/v1/auth/me', {}), response)
    expect(state.status).toBe(405)
    expect((JSON.parse(state.body ?? '{}') as { error: { code: string } }).error.code).toBe('method_not_allowed')
  })

  it('normalizes trailing slashes like the legacy gateway', async () => {
    const { deps, dispose } = await depsHarness()
    cleanup.push(dispose)
    const handler = createAuthRouteHandler(deps)
    const { response, state } = responseRecorder()
    await handler(requestOf('GET', '/api/v1/auth/setup-status///', {}), response)
    expect(state.status).toBe(200)
  })
})

describe('body handling faults', () => {
  it('answers 415 for a non-JSON media type, 400 for broken JSON, 400 for non-object bodies', async () => {
    const { deps, dispose } = await depsHarness()
    cleanup.push(dispose)
    const handler = createAuthRouteHandler(deps)

    const media = responseRecorder()
    await handler(requestOf('POST', '/api/v1/auth/login/local', { 'content-type': 'application/x-www-form-urlencoded' }), media.response)
    expect(media.state.status).toBe(415)
    expect((JSON.parse(media.state.body ?? '{}') as { error: { code: string } }).error.code).toBe('unsupported_media_type')

    const broken = responseRecorder()
    await handler(rawRequestOf('POST', '/api/v1/auth/login/local', POST_JSON, Buffer.from('{oops')), broken.response)
    expect(broken.state.status).toBe(400)
    expect((JSON.parse(broken.state.body ?? '{}') as { error: { code: string } }).error.code).toBe('invalid_request')

    const array = responseRecorder()
    await handler(requestOf('POST', '/api/v1/auth/login/local', POST_JSON, []), array.response)
    expect(array.state.status).toBe(400)

    const size = responseRecorder()
    await handler(rawRequestOf('POST', '/api/v1/auth/login/local', {
      ...POST_JSON,
      'content-length': String(65 * 1024),
    }, Buffer.alloc(65 * 1024, 97)), size.response)
    expect(size.state.status).toBe(413)
  })

  it('surfaces faults after headers were sent by destroying the response', async () => {
    const { deps, dispose } = await depsHarness()
    cleanup.push(dispose)
    const warn = vi.fn()
    const handler = createAuthRouteHandler({ ...deps, warn })
    // A fault raised while the response is already committed cannot write a
    // clean 500: the handler logs and destroys instead.
    const { response, state, commitHeaders } = responseRecorder()
    commitHeaders()
    await handler(requestOf('POST', '/api/v1/auth/login/local', { 'content-type': 'text/plain' }), response)
    expect(warn).toHaveBeenCalled()
    expect(state.destroyed).toBe(true)
  })

  it('answers 500 and logs when the store explodes mid-login', async () => {
    const { deps, dispose } = await depsHarness()
    cleanup.push(dispose)
    const warn = vi.fn()
    const sabotaged: AuthRouterDeps = {
      ...deps,
      warn,
      store: new Proxy(deps.store, {
        get(target, property, receiver) {
          if (property === 'findUserByEmail') return () => { throw new Error('disk on fire') }
          // never widens the reflective read back to the store's method type
          return Reflect.get(target, property, receiver) as never
        },
      }),
    }
    const { response, state } = responseRecorder()
    await createAuthRouteHandler(sabotaged)(requestOf('POST', '/api/v1/auth/login/local', POST_JSON, {
      email: 'a@b.co',
      password: 'longenough',
    }), response)
    expect(state.status).toBe(500)
    expect(warn).toHaveBeenCalled()
    expect(state.destroyed).toBe(false)
  })
})

describe('credential errors normalized at the route layer', () => {
  it('maps the unknown-account bare Error from issueSession to a 401 on login', async () => {
    const { deps, user, dispose } = await depsHarness()
    cleanup.push(dispose)
    const warn = vi.fn()
    const handler = createAuthRouteHandler({
      ...deps,
      warn,
      sessions: {
        issueSession: () => {
          throw new Error('issueSession: user ' + user.id + ' does not exist')
        },
      } as unknown as SessionService,
    })
    const { response, state } = responseRecorder()
    await handler(requestOf('POST', '/api/v1/auth/login/local', POST_JSON, {
      email: 'existing@example.com',
      password: 'original-pass',
    }), response)
    expect(state.status).toBe(401)
    expect((JSON.parse(state.body ?? '{}') as { error: { code: string } }).error.code).toBe('invalid_credentials')
    expect(warn).toHaveBeenCalled()
  })

  it('maps the unknown-account bare Error to a 500 on the provision path', async () => {
    const { deps, dispose } = await depsHarness()
    cleanup.push(dispose)
    const warn = vi.fn()
    const handler = createAuthRouteHandler({
      ...deps,
      warn,
      sessions: {
        issueSession: () => {
          throw new Error('issueSession: user x does not exist')
        },
      } as unknown as SessionService,
    })
    const { response, state } = responseRecorder()
    await handler(requestOf('POST', '/api/v1/auth/register', POST_JSON, {
      email: 'someone@example.com',
      password: 'longenough',
    }), response)
    expect(state.status).toBe(500)
    expect(warn).toHaveBeenCalled()
  })

  it('answers 409 system_already_initialized when the store stops being empty mid-initialize', async () => {
    const { deps, dispose } = await depsHarness({
      insertUser() {
        throw new AccountConflictError('email')
      },
    })
    cleanup.push(dispose)
    const handler = createAuthRouteHandler(deps)
    const { response, state } = responseRecorder()
    await handler(requestOf('POST', '/api/v1/auth/initialize', POST_JSON, {
      email: 'root@example.com',
      password: 'longenough',
    }), response)
    expect(state.status).toBe(409)
    expect((JSON.parse(state.body ?? '{}') as { error: { code: string } }).error.code).toBe('system_already_initialized')
  })

  it('maps a duplicate register to 400 email_already_exists (legacy semantic)', async () => {
    const { deps, dispose } = await depsHarness()
    cleanup.push(dispose)
    const handler = createAuthRouteHandler(deps)
    const { response, state } = responseRecorder()
    await handler(requestOf('POST', '/api/v1/auth/register', POST_JSON, {
      email: 'existing@example.com',
      password: 'longenough',
    }), response)
    expect(state.status).toBe(400)
    expect((JSON.parse(state.body ?? '{}') as { error: { code: string } }).error.code).toBe('email_already_exists')
  })
})

describe('input validation', () => {
  it('rejects malformed emails and short passwords on the credential endpoints', async () => {
    const { deps, dispose } = await depsHarness()
    cleanup.push(dispose)
    const handler = createAuthRouteHandler(deps)
    for (const [body, code] of [
      [{ email: 'not-an-email', password: 'longenough' }, 'invalid_email'],
      [{ email: 'a@b.co', password: 'short' }, 'weak_password'],
      [{ email: 'a@b.co' }, 'weak_password'],
    ] as Array<[Record<string, unknown>, string]>) {
      const { response, state } = responseRecorder()
      await handler(requestOf('POST', '/api/v1/auth/register', POST_JSON, body), response)
      expect(state.status).toBe(400)
      expect((JSON.parse(state.body ?? '{}') as { error: { code: string } }).error.code).toBe(code)
    }
    const noCurrent = responseRecorder()
    await handler(requestOf('POST', '/api/v1/auth/change-password', POST_JSON, {
      newPassword: 'longenough',
    }), noCurrent.response)
    expect(noCurrent.state.status).toBe(401)
  })
})

describe('rate limiting at the router', () => {
  it('answers 429 with Retry-After once the shared login/register budget is gone', async () => {
    const { deps, dispose } = await depsHarness()
    cleanup.push(dispose)
    const handler = createAuthRouteHandler({ ...deps, limiter: new RateLimiter({ maxAttempts: 1, windowMs: 60_000 }) })
    const first = responseRecorder()
    await handler(requestOf('POST', '/api/v1/auth/login/local', POST_JSON, {
      email: 'existing@example.com',
      password: 'wrong-password',
    }), first.response)
    expect(first.state.status).toBe(401)
    const second = responseRecorder()
    await handler(requestOf('POST', '/api/v1/auth/register', POST_JSON, {
      email: 'new@example.com',
      password: 'longenough',
    }), second.response)
    expect(second.state.status).toBe(429)
    expect(second.state.cookies).toEqual([])
    expect(second.response.getHeader('Retry-After')).toBe('60')
  })
})

describe('cross-site auth POST defense', () => {
  it('denies a cross-origin login with the legacy 403 prose and spends no budget', async () => {
    const { deps, dispose } = await depsHarness()
    cleanup.push(dispose)
    const handler = createAuthRouteHandler({ ...deps, limiter: new RateLimiter({ maxAttempts: 1, windowMs: 60_000 }) })
    const denied = responseRecorder()
    await handler(requestOf('POST', '/api/v1/auth/login/local', { ...POST_JSON, origin: 'https://evil.example' }, {
      email: 'a@b.co',
      password: 'longenough',
    }), denied.response)
    expect(denied.state.status).toBe(403)
    expect((JSON.parse(denied.state.body ?? '{}') as { error: { message: string } }).error.message).toBe('Cross-site auth request denied.')
    // The budget was untouched: the same budget admits one in-window attempt.
    const allowed = responseRecorder()
    await handler(requestOf('POST', '/api/v1/auth/login/local', POST_JSON, {
      email: 'existing@example.com',
      password: 'original-pass',
    }), allowed.response)
    expect(allowed.state.status).toBe(200)
  })

  it('does not guard GET reads or the token-bearing change-password', async () => {
    const { deps, dispose } = await depsHarness()
    cleanup.push(dispose)
    const handler = createAuthRouteHandler(deps)
    const status = responseRecorder()
    await handler(requestOf('GET', '/api/v1/auth/setup-status', { origin: 'https://evil.example' }, undefined), status.response)
    expect(status.state.status).toBe(200)
    const change = responseRecorder()
    await handler(requestOf('POST', '/api/v1/auth/change-password', { ...POST_JSON, origin: 'https://evil.example' }, {
      currentPassword: 'x',
      newPassword: 'longenough',
    }), change.response)
    // Reaches authentication (anonymous) instead of the origin gate.
    expect(change.state.status).toBe(401)
  })
})

describe('auth-disabled valve at the router', () => {
  it('passes every chain with the synthetic principal and refuses password changes', async () => {
    const { deps, dispose } = await depsHarness()
    cleanup.push(dispose)
    const handler = createAuthRouteHandler({ ...deps, authDisabled: true })
    const crossSite = responseRecorder()
    await handler(requestOf('POST', '/api/v1/auth/login/local', { ...POST_JSON, origin: 'https://evil.example' }, {
      email: 'existing@example.com',
      password: 'original-pass',
    }), crossSite.response)
    expect(crossSite.state.status).toBe(200)

    const me = responseRecorder()
    await handler(requestOf('GET', '/api/v1/auth/me', {}, undefined), me.response)
    expect(me.state.status).toBe(200)
    expect(JSON.parse(me.state.body ?? '{}')).toMatchObject({ id: 'default', systemRole: 'admin' })

    const change = responseRecorder()
    await handler(requestOf('POST', '/api/v1/auth/change-password', POST_JSON, {
      currentPassword: 'original-pass',
      newPassword: 'longenough',
    }), change.response)
    expect(change.state.status).toBe(400)
    expect((JSON.parse(change.state.body ?? '{}') as { error: { message: string } }).error.message).toContain('OPENKYLIN_AUTH_DISABLED=1')
  })
})

describe('session lifecycle endpoints', () => {
  it('change-password verifies the current credential, kills old sessions, and re-issues', async () => {
    const { deps, store, user, dispose } = await depsHarness()
    cleanup.push(dispose)
    const handler = createAuthRouteHandler(deps)
    const login = responseRecorder()
    await handler(requestOf('POST', '/api/v1/auth/login/local', POST_JSON, {
      email: 'existing@example.com',
      password: 'original-pass',
    }), login.response)
    const sessionCookie = String(login.state.cookies[0])
    const token = sessionCookie.split(';')[0]!.split('=')[1] ?? ''
    expect(token).toBeTruthy()
    // Read the CSRF cookie minted at login: the double submit protects this
    // token-bearing endpoint.
    const csrfCookie = login.state.cookies.find(value => value.startsWith('csrf_token=')) ?? ''
    const csrf = csrfCookie.split(';')[0]!.split('=')[1] ?? ''

    const wrong = responseRecorder()
    await handler(requestOf('POST', '/api/v1/auth/change-password', {
      ...POST_JSON,
      cookie: 'access_token=' + token + '; csrf_token=' + csrf,
      'x-csrf-token': csrf,
    }, { currentPassword: 'nope', newPassword: 'longenough2' }), wrong.response)
    expect(wrong.state.status).toBe(400)
    expect((JSON.parse(wrong.state.body ?? '{}') as { error: { message: string } }).error.message).toBe('Current password is incorrect')

    const missingCsrf = responseRecorder()
    await handler(requestOf('POST', '/api/v1/auth/change-password', {
      ...POST_JSON,
      cookie: 'access_token=' + token,
    }, { currentPassword: 'original-pass', newPassword: 'longenough2' }), missingCsrf.response)
    expect(missingCsrf.state.status).toBe(403)

    const ok = responseRecorder()
    await handler(requestOf('POST', '/api/v1/auth/change-password', {
      ...POST_JSON,
      cookie: 'access_token=' + token + '; csrf_token=' + csrf,
      'x-csrf-token': csrf,
    }, { currentPassword: 'original-pass', newPassword: 'longenough2' }), ok.response)
    expect(ok.state.status).toBe(200)
    expect((JSON.parse(ok.state.body ?? '{}') as { message: string }).message).toBe('Password changed successfully')
    // Old session dead (contract B), new cookie set.
    expect(() => deps.sessions.validateSession(token ?? '')).toThrow()
    const fresh = String(ok.state.cookies[0]).split(';')[0]!.split('=')[1] ?? ''
    expect(fresh).not.toBe(token)
    const row = store.findUserById(user.id)
    expect(row?.sessionVersion).toBeGreaterThan(1)
  })

  it('change-password refuses OAuth-only accounts via the store hash probe', async () => {
    const { deps, dispose } = await depsHarness()
    cleanup.push(dispose)
    deps.store.insertUser({ email: 'sso@example.com', passwordHash: null, systemRole: 'user', oauthProvider: 'okta', oauthId: 'abc' })
    const sso = deps.store.findUserByEmail('sso@example.com')
    const ssoSessions = new SessionService({ store: deps.store })
    const issued = ssoSessions.issueSession({ userId: sso?.id ?? '', persistent: false })
    const handler = createAuthRouteHandler(deps)
    const { response, state } = responseRecorder()
    await handler(requestOf('POST', '/api/v1/auth/change-password', {
      ...POST_JSON,
      authorization: 'Bearer ' + issued.session.id,
    }, { currentPassword: 'whatever', newPassword: 'longenough2' }), response)
    expect(state.status).toBe(400)
    expect((JSON.parse(state.body ?? '{}') as { error: { message: string } }).error.message).toBe('OAuth users cannot change password')
  })

  it('logout revokes the presented session server-side and clears all three cookies', async () => {
    const { deps, dispose } = await depsHarness()
    cleanup.push(dispose)
    const handler = createAuthRouteHandler(deps)
    const login = responseRecorder()
    await handler(requestOf('POST', '/api/v1/auth/login/local', POST_JSON, {
      email: 'existing@example.com',
      password: 'original-pass',
    }), login.response)
    const token = String(login.state.cookies[0]).split(';')[0]!.split('=')[1] ?? ''
    const out = responseRecorder()
    await handler(requestOf('POST', '/api/v1/auth/logout', { cookie: 'access_token=' + token }, undefined), out.response)
    expect(out.state.status).toBe(200)
    expect(out.state.cookies).toEqual([
      'access_token=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax',
      'csrf_token=; Max-Age=0; Path=/; SameSite=Strict',
      'qilin_session_persistent=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax',
    ])
    // Idempotent without a cookie.
    const again = responseRecorder()
    await handler(requestOf('POST', '/api/v1/auth/logout', {}, undefined), again.response)
    expect(again.state.status).toBe(200)
  })
})

describe('registration switch and setup status', () => {
  it('closes register only while the file says so, and setup-status mirrors both facts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'router-switch-'))
    const path = join(root, 'auth-config.json')
    const { deps, dispose } = await depsHarness()
    cleanup.push(() => { dispose() })
    const handler = createAuthRouteHandler({ ...deps, authConfigPath: path })
    writeFileSync(path, '{"registrationEnabled": false}')

    const denied = responseRecorder()
    await handler(requestOf('POST', '/api/v1/auth/register', POST_JSON, {
      email: 'new@example.com',
      password: 'longenough',
    }), denied.response)
    expect(denied.state.status).toBe(403)
    expect((JSON.parse(denied.state.body ?? '{}') as { error: { code: string } }).error.code).toBe('registration_disabled')

    const closed = responseRecorder()
    await handler(requestOf('GET', '/api/v1/auth/setup-status', {}, undefined), closed.response)
    expect(JSON.parse(closed.state.body ?? '{}')).toEqual({ needsSetup: false, registrationEnabled: false })

    // Immediate effect: edit the file, next request sees the new state.
    writeFileSync(path, '{"registrationEnabled": true}')
    const opened = responseRecorder()
    await handler(requestOf('POST', '/api/v1/auth/register', POST_JSON, {
      email: 'new@example.com',
      password: 'longenough',
    }), opened.response)
    expect(opened.state.status).toBe(201)
    expect((JSON.parse(opened.state.body ?? '{}') as { user: { systemRole: unknown } }).user.systemRole).toBe('user')

    const open = responseRecorder()
    await handler(requestOf('GET', '/api/v1/auth/setup-status', {}, undefined), open.response)
    expect(JSON.parse(open.state.body ?? '{}')).toEqual({ needsSetup: false, registrationEnabled: true })
  })
})

describe('initialize and me', () => {
  it('initialize deterministically creates the first admin on an empty store', async () => {
    const { deps, dispose } = await depsHarness()
    cleanup.push(dispose)
    // An untouched second store models the cold system: router and session
    // service must agree on the same empty database.
    const cold = new SqliteAccountStore({ path: ':memory:' })
    const coldDeps: AuthRouterDeps = { ...deps, store: cold, sessions: new SessionService({ store: cold }) }
    const handler = createAuthRouteHandler(coldDeps)
    const status = responseRecorder()
    await handler(requestOf('GET', '/api/v1/auth/setup-status', {}, undefined), status.response)
    expect((JSON.parse(status.state.body ?? '{}') as { needsSetup: boolean }).needsSetup).toBe(true)

    const init = responseRecorder()
    await handler(requestOf('POST', '/api/v1/auth/initialize', POST_JSON, {
      email: 'root@example.com',
      password: 'longenough',
    }), init.response)
    expect(init.state.status).toBe(201)
    expect((JSON.parse(init.state.body ?? '{}') as { user: { systemRole: unknown } }).user.systemRole).toBe('admin')
    expect(init.state.cookies).toHaveLength(3)

    const repeat = responseRecorder()
    await handler(requestOf('POST', '/api/v1/auth/initialize', POST_JSON, {
      email: 'root@example.com',
      password: 'longenough',
    }), repeat.response)
    expect(repeat.state.status).toBe(409)

    const after = responseRecorder()
    await handler(requestOf('GET', '/api/v1/auth/setup-status', {}, undefined), after.response)
    expect((JSON.parse(after.state.body ?? '{}') as { needsSetup: boolean }).needsSetup).toBe(false)
    cold.close()
  })

  it('me answers the live account, typed rejections, and never leaks a password hash', async () => {
    const { deps, dispose } = await depsHarness()
    cleanup.push(dispose)
    const handler = createAuthRouteHandler(deps)
    const anonymous = responseRecorder()
    await handler(requestOf('GET', '/api/v1/auth/me', {}, undefined), anonymous.response)
    expect(anonymous.state.status).toBe(401)
    expect((JSON.parse(anonymous.state.body ?? '{}') as { error: { code: string } }).error.code).toBe('not_authenticated')

    const garbage = responseRecorder()
    await handler(requestOf('GET', '/api/v1/auth/me', { cookie: 'access_token=nonsense' }, undefined), garbage.response)
    expect(garbage.state.status).toBe(401)
    expect((JSON.parse(garbage.state.body ?? '{}') as { error: { code: string } }).error.code).toBe('token_invalid')

    const login = responseRecorder()
    await handler(requestOf('POST', '/api/v1/auth/login/local', POST_JSON, {
      email: 'existing@example.com',
      password: 'original-pass',
    }), login.response)
    const token = String(login.state.cookies[0]).split(';')[0]!.split('=')[1] ?? ''
    const ok = responseRecorder()
    await handler(requestOf('GET', '/api/v1/auth/me', {
      cookie: 'access_token=' + token,
    }, undefined), ok.response)
    const body = JSON.parse(ok.state.body ?? '{}') as { id: string; email: string; systemRole: string; passwordHash?: string }
    expect(body).toMatchObject({ email: 'existing@example.com', systemRole: 'user' })
    expect(body.id).toMatch(/[0-9a-f-]{8}/)
    expect(body.passwordHash).toBeUndefined()
  })
})
