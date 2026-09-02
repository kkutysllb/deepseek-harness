import type { IncomingMessage, ServerResponse } from 'node:http'
import { EventEmitter, Readable } from 'node:stream'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionCorruptError, SessionService, SessionValidationError } from '@qilin/account-auth'
import { AccountConflictError, hashPassword, SqliteAccountStore, type AccountStore } from '@qilin/account-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAuthRouteHandler, type AuthRouterDeps } from '../src/auth-router.ts'
import { RateLimiter } from '../src/rate-limit.ts'

/**
 * Coverage completions for the route dispatcher: login-side validation, the
 * rememberMe tri-state, router-level CSRF mismatch, change-password body
 * validation, expired/corrupt session mapping, non-Error rethrows, stream
 * caps, and array-shaped headers. The happy paths live in auth-router.spec.
 */

function requestOf(method: string, url: string, headers: Record<string, string | string[]>, body?: unknown): IncomingMessage {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  const request = Readable.from(payload) as unknown as IncomingMessage
  Object.assign(request, { url, method, headers: { host: '127.0.0.1:3080', ...headers } })
  Object.defineProperty(request, 'socket', { value: { remoteAddress: '203.0.113.9' } })
  return request
}

function rawRequestOf(method: string, url: string, headers: Record<string, string | string[]>, payload: Buffer): IncomingMessage {
  const request = Readable.from([payload]) as unknown as IncomingMessage
  Object.assign(request, { url, method, headers: { host: '127.0.0.1:3080', ...headers } })
  Object.defineProperty(request, 'socket', { value: { remoteAddress: '203.0.113.9' } })
  return request
}

type RecordedState = { status?: number | undefined; body?: string | undefined; cookies: string[]; destroyed: boolean }

function responseRecorder(): { response: ServerResponse; state: RecordedState } {
  const state = {
    cookies: [] as string[],
    destroyed: false,
    status: undefined as number | undefined,
    body: undefined as string | undefined,
  }
  const response = Object.assign(new EventEmitter(), {
    headers: {},
    headersSent: false,
    setHeader(name: string, value: string | string[]) {
      ;(response as unknown as { headers: Record<string, string | string[]> }).headers[name.toLowerCase()] = value
      if (name.toLowerCase() === 'set-cookie') state.cookies.push(...(Array.isArray(value) ? value : [value]))
      return response
    },
    writeHead(status: number) {
      state.status = status
      return response
    },
    getHeader(name: string) {
      return (response as unknown as { headers: Record<string, string | string[]> }).headers[name.toLowerCase()]
    },
    end(payload?: string | Uint8Array) {
      state.status = state.status ?? 200
      if (typeof payload === 'string' || payload instanceof Uint8Array) state.body = String(payload)
      return response
    },
    destroy() {
      state.destroyed = true
      return response
    },
  }) as unknown as ServerResponse
  return { response, state }
}

let cleanup: Array<() => void> = []

afterEach(() => {
  for (const fn of cleanup) fn()
  cleanup = []
  vi.restoreAllMocks()
})

const POST_JSON = { 'content-type': 'application/json' }

async function depsHarness(): Promise<{ deps: AuthRouterDeps; dispose: () => void }> {
  const store = new SqliteAccountStore({ path: ':memory:' })
  const user = store.insertUser({
    email: 'existing@example.com',
    passwordHash: hashPassword('original-pass'),
    systemRole: 'user',
  })
  void user
  const deps: AuthRouterDeps = {
    store,
    sessions: new SessionService({ store }),
    env: {},
    authDisabled: false,
    authConfigPath: join(mkdtempSync(join(tmpdir(), 'completions-deps-')), 'auth-config.json'),
    limiter: new RateLimiter({ maxAttempts: 1000 }),
  }
  return { deps, dispose: () => { store.close() } }
}

async function loginJar(handler: ReturnType<typeof createAuthRouteHandler>): Promise<string> {
  const login = responseRecorder()
  await handler(requestOf('POST', '/api/v1/auth/login/local', POST_JSON, {
    email: 'existing@example.com',
    password: 'original-pass',
  }), login.response)
  return login.state.cookies.map(cookie => cookie.split(';')[0]).join('; ')
}

describe('login validation and rememberMe tri-state', () => {
  it('rejects malformed login input on the login endpoint itself', async () => {
    const { deps, dispose } = await depsHarness()
    cleanup.push(dispose)
    const handler = createAuthRouteHandler(deps)
    for (const [body, code] of [
      [{ email: 'nope', password: 'longenough' }, 'invalid_email'],
      [{ email: 'a@b.co', password: 'short' }, 'weak_password'],
    ] as Array<[Record<string, unknown>, string]>) {
      const { response, state } = responseRecorder()
      await handler(requestOf('POST', '/api/v1/auth/login/local', POST_JSON, body), response)
      expect(state.status).toBe(400)
      expect((JSON.parse(state.body ?? '{}') as { error: { code: string } }).error.code).toBe(code)
    }
  })

  it('honors an explicit rememberMe=false on login over the persistence cookie', async () => {
    const { deps, dispose } = await depsHarness()
    cleanup.push(dispose)
    const handler = createAuthRouteHandler(deps)
    const session = responseRecorder()
    await handler(requestOf('POST', '/api/v1/auth/login/local', POST_JSON, {
      email: 'existing@example.com',
      password: 'original-pass',
      rememberMe: false,
    }), session.response)
    expect(session.state.status).toBe(200)
    expect(session.state.cookies.find(value => value.startsWith('qilin_session_persistent='))).toContain('qilin_session_persistent=0; Path=/; HttpOnly; SameSite=Lax')
    expect(session.state.cookies.find(value => value.startsWith('access_token='))).not.toContain('Max-Age')
  })

  it('answers router-level csrf_mismatch for a wrong header echo', async () => {
    const { deps, dispose } = await depsHarness()
    cleanup.push(dispose)
    const handler = createAuthRouteHandler(deps)
    const jar = await loginJar(handler)
    const token = /access_token=([^;]+)/.exec(jar)?.[1] ?? ''
    const wrong = responseRecorder()
    await handler(requestOf('POST', '/api/v1/auth/change-password', {
      ...POST_JSON,
      cookie: 'access_token=' + token + '; csrf_token=good',
      'x-csrf-token': 'bad',
    }, { currentPassword: 'original-pass', newPassword: 'longenough2' }), wrong.response)
    expect(wrong.state.status).toBe(403)
    expect((JSON.parse(wrong.state.body ?? '{}') as { error: { code: string } }).error.code).toBe('csrf_mismatch')
    expect((JSON.parse(wrong.state.body ?? '{}') as { error: { message: string } }).error.message).toBe('CSRF token mismatch.')
  })

  it('validates the change-password body after authentication and CSRF', async () => {
    const { deps, dispose } = await depsHarness()
    cleanup.push(dispose)
    const handler = createAuthRouteHandler(deps)
    const jar = await loginJar(handler)
    const csrf = /csrf_token=([^;]+)/.exec(jar)?.[1] ?? ''

    const noCurrent = responseRecorder()
    await handler(requestOf('POST', '/api/v1/auth/change-password', {
      ...POST_JSON, cookie: jar, 'x-csrf-token': csrf,
    }, { newPassword: 'longenough2' }), noCurrent.response)
    expect(noCurrent.state.status).toBe(400)
    expect((JSON.parse(noCurrent.state.body ?? '{}') as { error: { message: string } }).error.message).toBe('The current password is required.')

    const shortNew = responseRecorder()
    await handler(requestOf('POST', '/api/v1/auth/change-password', {
      ...POST_JSON, cookie: jar, 'x-csrf-token': csrf,
    }, { currentPassword: 'original-pass', newPassword: 'short' }), shortNew.response)
    expect(shortNew.state.status).toBe(400)
    expect((JSON.parse(shortNew.state.body ?? '{}') as { error: { code: string } }).error.code).toBe('weak_password')
  })

  it('maps expired and corrupt session reads on the router itself', async () => {
    const { deps, dispose } = await depsHarness()
    cleanup.push(dispose)
    const handler = createAuthRouteHandler(deps)
    const login = responseRecorder()
    await handler(requestOf('POST', '/api/v1/auth/login/local', POST_JSON, {
      email: 'existing@example.com',
      password: 'original-pass',
    }), login.response)
    const token = String(login.state.cookies[0]).split(';')[0]!.split('=')[1] ?? ''
    const jar = { cookie: 'access_token=' + token }

    const expired = responseRecorder()
    deps.sessions.validateSession = () => {
      throw new SessionValidationError('EXPIRED')
    }
    await handler(requestOf('GET', '/api/v1/auth/me', jar, undefined), expired.response)
    expect(expired.state.status).toBe(401)
    expect((JSON.parse(expired.state.body ?? '{}') as { error: { code: string } }).error.code).toBe('token_expired')

    const corrupt = responseRecorder()
    deps.sessions.validateSession = () => {
      throw new SessionCorruptError('negative issued version')
    }
    await handler(requestOf('GET', '/api/v1/auth/me', jar, undefined), corrupt.response)
    expect(corrupt.state.status).toBe(500)
    expect((JSON.parse(corrupt.state.body ?? '{}') as { error: { code: string } }).error.code).toBe('internal_error')
  })

  it('normalizes even non-Error throwables from issuance on the login path', async () => {
    const { deps, dispose } = await depsHarness()
    cleanup.push(dispose)
    const warn = vi.fn()
    const handler = createAuthRouteHandler({
      ...deps,
      warn,
      sessions: {
        issueSession: () => {
          throw 'not-an-error' as unknown as Error
        },
      } as unknown as SessionService,
    })
    const { response, state } = responseRecorder()
    await handler(requestOf('POST', '/api/v1/auth/login/local', POST_JSON, {
      email: 'existing@example.com',
      password: 'original-pass',
    }), response)
    // The route layer normalizes anything the service raises into the typed
    // login answer, whatever its type.
    expect(state.status).toBe(401)
    expect((JSON.parse(state.body ?? '{}') as { error: { code: string } }).error.code).toBe('invalid_credentials')
    expect(warn).toHaveBeenCalled()
  })

  it('answers 413 for oversized streams without a content-length and 400 for empty bodies', async () => {
    const { deps, dispose } = await depsHarness()
    cleanup.push(dispose)
    const handler = createAuthRouteHandler(deps)
    const stream = responseRecorder()
    await handler(rawRequestOf('POST', '/api/v1/auth/login/local', POST_JSON, Buffer.alloc(70 * 1024, 97)), stream.response)
    expect(stream.state.status).toBe(413)

    const empty = responseRecorder()
    await handler(requestOf('POST', '/api/v1/auth/login/local', POST_JSON, undefined), empty.response)
    expect(empty.state.status).toBe(400)
    expect((JSON.parse(empty.state.body ?? '{}') as { error: { code: string } }).error.code).toBe('invalid_request')
  })

})
describe('dispatcher defensive branches and initialize edges', () => {
  it('falls back when url, method, and peer address are absent', async () => {
    const { deps, dispose } = await depsHarness()
    cleanup.push(dispose)
    const handler = createAuthRouteHandler(deps)
    const { response, state } = responseRecorder()
    const bare = Readable.from([]) as unknown as IncomingMessage
    Object.assign(bare, { headers: { cookie: 'access_token=garbage' } })
    Object.defineProperty(bare, 'socket', { value: {} })
    await handler(bare, response)
    expect(state.status).toBe(404)
  })

  it('validates the register body and reports duplicate registration as the legacy 400', async () => {
    const { deps, dispose } = await depsHarness()
    cleanup.push(dispose)
    const handler = createAuthRouteHandler(deps)
    for (const [body, code] of [
      [{ email: 'nope', password: 'longenough' }, 'invalid_email'],
      [{ email: 'fresh@example.com', password: 'short' }, 'weak_password'],
      [{ email: 'existing@example.com', password: 'longenough' }, 'email_already_exists'],
    ] as Array<[Record<string, unknown>, string]>) {
      const { response, state } = responseRecorder()
      await handler(requestOf('POST', '/api/v1/auth/register', POST_JSON, body), response)
      expect(state.status).toBe(400)
      expect((JSON.parse(state.body ?? '{}') as { error: { code: string } }).error.code).toBe(code)
    }
  })

  it('honors an explicit rememberMe=false on register', async () => {
    const { deps, dispose } = await depsHarness()
    cleanup.push(dispose)
    const handler = createAuthRouteHandler(deps)
    const { response, state } = responseRecorder()
    await handler(requestOf('POST', '/api/v1/auth/register', POST_JSON, {
      email: 'fresh@example.com',
      password: 'longenough',
      rememberMe: false,
    }), response)
    expect(state.status).toBe(201)
    expect(state.cookies.find(value => value.startsWith('qilin_session_persistent='))).toContain('qilin_session_persistent=0; Path=/; HttpOnly; SameSite=Lax')
  })

  it('validates the initialize body before consulting the store', async () => {
    const { deps, dispose } = await depsHarness()
    cleanup.push(dispose)
    const handler = createAuthRouteHandler(deps)
    for (const [body, code] of [
      [{ email: 'nope', password: 'longenough' }, 'invalid_email'],
      [{ email: 'admin@example.com', password: 'short' }, 'weak_password'],
    ] as Array<[Record<string, unknown>, string]>) {
      const { response, state } = responseRecorder()
      await handler(requestOf('POST', '/api/v1/auth/initialize', POST_JSON, body), response)
      expect(state.status).toBe(400)
      expect((JSON.parse(state.body ?? '{}') as { error: { code: string } }).error.code).toBe(code)
    }
  })

  it('provisions the first admin with an explicit rememberMe=false on an empty store', async () => {
    const store = new SqliteAccountStore({ path: ':memory:' })
    cleanup.push(() => { store.close() })
    const deps: AuthRouterDeps = {
      store,
      sessions: new SessionService({ store }),
      env: {},
      authDisabled: false,
      authConfigPath: join(mkdtempSync(join(tmpdir(), 'completions-init-')), 'auth-config.json'),
      limiter: new RateLimiter({ maxAttempts: 1000 }),
    }
    const handler = createAuthRouteHandler(deps)
    const { response, state } = responseRecorder()
    await handler(requestOf('POST', '/api/v1/auth/initialize', POST_JSON, {
      email: 'admin@example.com',
      password: 'longenough',
      rememberMe: false,
    }), response)
    expect(state.status).toBe(201)
  })

  it('answers 409 when the empty-store gate races a collision and 500 on other faults', async () => {
    const { deps, dispose } = await depsHarness()
    cleanup.push(dispose)
    const warn = vi.fn()
    const colliding = createAuthRouteHandler({
      ...deps,
      warn,
      store: {
        countUsers: () => 0,
        insertUser: () => {
          throw new AccountConflictError('email', new Error('raced'))
        },
      } as unknown as AccountStore,
    })
    const raced = responseRecorder()
    await colliding(requestOf('POST', '/api/v1/auth/initialize', POST_JSON, {
      email: 'admin@example.com',
      password: 'longenough',
    }), raced.response)
    expect(raced.state.status).toBe(409)
    expect((JSON.parse(raced.state.body ?? '{}') as { error: { code: string } }).error.code).toBe('system_already_initialized')

    const faulting = createAuthRouteHandler({
      ...deps,
      warn,
      store: {
        countUsers: () => 0,
        insertUser: () => {
          throw new RangeError('disk full')
        },
      } as unknown as AccountStore,
    })
    const faulted = responseRecorder()
    await faulting(requestOf('POST', '/api/v1/auth/initialize', POST_JSON, {
      email: 'admin@example.com',
      password: 'longenough',
    }), faulted.response)
    expect(faulted.state.status).toBe(500)
    expect((JSON.parse(faulted.state.body ?? '{}') as { error: { code: string } }).error.code).toBe('internal_error')
    expect(warn).toHaveBeenCalled()
  })

  it('maps non-session failures during session resolution to a 500', async () => {
    const { deps, dispose } = await depsHarness()
    cleanup.push(dispose)
    const handler = createAuthRouteHandler(deps)
    const login = responseRecorder()
    await handler(requestOf('POST', '/api/v1/auth/login/local', POST_JSON, {
      email: 'existing@example.com',
      password: 'original-pass',
    }), login.response)
    const token = String(login.state.cookies[0]).split(';')[0]!.split('=')[1] ?? ''
    deps.sessions.validateSession = () => {
      throw new RangeError('store exploded')
    }
    const { response, state } = responseRecorder()
    await handler(requestOf('GET', '/api/v1/auth/me', { cookie: 'access_token=' + token }, undefined), response)
    expect(state.status).toBe(500)
    expect((JSON.parse(state.body ?? '{}') as { error: { code: string } }).error.code).toBe('internal_error')
  })

  it('reads array-shaped CSRF headers and honors rememberMe on change-password', async () => {
    const { deps, dispose } = await depsHarness()
    cleanup.push(dispose)
    const handler = createAuthRouteHandler(deps)
    const jar = await loginJar(handler)
    const csrf = /csrf_token=([^;]+)/.exec(jar)?.[1] ?? ''
    const { response, state } = responseRecorder()
    await handler(requestOf('POST', '/api/v1/auth/change-password', {
      ...POST_JSON,
      cookie: jar,
      'x-csrf-token': [csrf],
    }, { currentPassword: 'original-pass', newPassword: 'longenough2', rememberMe: false }), response)
    expect(state.status).toBe(200)
    expect((JSON.parse(state.body ?? '{}') as { message: string }).message).toBe('Password changed successfully')
  })
})

describe('registration store failures beyond the conflict', () => {
  it('rethrows non-conflict store failures from registration into the dispatch catch', async () => {
    const { deps, dispose } = await depsHarness()
    cleanup.push(dispose)
    const warn = vi.fn()
    const handler = createAuthRouteHandler({
      ...deps,
      warn,
      store: {
        insertUser: () => {
          throw new RangeError('disk full')
        },
      } as unknown as AccountStore,
    })
    const { response, state } = responseRecorder()
    await handler(requestOf('POST', '/api/v1/auth/register', POST_JSON, {
      email: 'fresh@example.com',
      password: 'longenough',
    }), response)
    expect(state.status).toBe(500)
    expect((JSON.parse(state.body ?? '{}') as { error: { code: string } }).error.code).toBe('internal_error')
    expect(warn).toHaveBeenCalled()
  })
})
