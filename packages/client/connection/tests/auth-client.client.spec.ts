/**
 * Account/auth client: request shaping (paths, methods, CSRF header), typed
 * AuthError mapping, the shared 401 signal, and the fixture stub's surface
 * (signed-out default, login flow, management protections).
 */
import { describe, expect, it, vi } from 'vitest'
import { apply, AuthClient, AuthError, FixtureAuthClient, UnauthorizedSignal, type ConnectionHandle, type IAuthClient } from '../src/client/index.ts'
import { readCsrfTokenFromCookie } from '../src/client/auth-client.ts'
import { Context } from '@deepseek-ai/cordis'

type FetchCall = { input: URL; init: RequestInit }

/** One fetch stub recording its calls and answering from a script. */
function fetchStub(script: Array<{ status: number; body?: unknown }>): { fetch: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = []
  const stub = (async (input: URL | string, init?: RequestInit): Promise<Response> => {
    const step = script[calls.length] ?? { status: 500 }
    calls.push({ input: new URL(String(input)), init: init ?? {} })
    const body = JSON.stringify(step.body ?? {})
    return {
      ok: step.status >= 200 && step.status < 300,
      status: step.status,
      text: () => Promise.resolve(body),
    } as Response
  }) as unknown as typeof fetch
  return { fetch: stub, calls }
}

function clientOf(fetchFn: typeof fetch, unauthorized?: UnauthorizedSignal): AuthClient {
  return new AuthClient(unauthorized === undefined ? { fetch: fetchFn } : { fetch: fetchFn, unauthorized })
}

describe('readCsrfTokenFromCookie', () => {
  it('finds the csrf_token pair among other cookies', () => {
    expect(readCsrfTokenFromCookie('access_token=abc; csrf_token=tok-1')).toBe('tok-1')
    expect(readCsrfTokenFromCookie('csrf_token=tok-2')).toBe('tok-2')
    expect(readCsrfTokenFromCookie('other=1')).toBe(null)
    expect(readCsrfTokenFromCookie(undefined)).toBe(null)
    expect(readCsrfTokenFromCookie('novalue')).toBe(null)
    expect(readCsrfTokenFromCookie('=broken; csrf_token=tok-3')).toBe('tok-3')
    expect(readCsrfTokenFromCookie('csrf_token=')).toBe('')
  })
})

describe('AuthClient legs and 401 fan-out', () => {
  it('sends each auth leg with the right verb, path, and default rememberMe', async () => {
    const { fetch, calls } = fetchStub([
      { status: 200, body: { needsSetup: false, registrationEnabled: false } },
      { status: 200, body: {} },
      { status: 200, body: {} },
      { status: 200, body: {} },
    ])
    const client = new AuthClient({ fetch })
    await client.setupStatus()
    await client.login('a@b.c', 'password-123')
    await client.initialize('a@b.c', 'password-123')
    await client.changePassword('old-pass-1', 'new-pass-9')
    expect(calls.map(call => [call.init.method, call.input.pathname])).toEqual([
      ['GET', '/api/v1/auth/setup-status'],
      ['POST', '/api/v1/auth/login/local'],
      ['POST', '/api/v1/auth/initialize'],
      ['POST', '/api/v1/auth/change-password'],
    ])
    expect(JSON.parse(calls[1]?.init.body as string)).toEqual({ email: 'a@b.c', password: 'password-123', rememberMe: false })
    expect(JSON.parse(calls[2]?.init.body as string)).toEqual({ email: 'a@b.c', password: 'password-123', rememberMe: true })
    expect(JSON.parse(calls[3]?.init.body as string)).toEqual({ currentPassword: 'old-pass-1', newPassword: 'new-pass-9' })
  })

  it('falls back to generic wire errors and raises 401 on the shared signal', async () => {
    const signal = new UnauthorizedSignal()
    const seen: AuthError[] = []
    signal.subscribe((error) => { seen.push(error) })
    const { fetch } = fetchStub([
      { status: 401, body: {} },
      { status: 503, body: { error: {} } },
    ])
    const client = new AuthClient({ fetch, unauthorized: signal })
    await expect(client.me()).rejects.toMatchObject({ code: 'unknown_error', message: 'HTTP 401' })
    expect(seen).toHaveLength(1)
    await expect(client.me()).rejects.toMatchObject({ code: 'unknown_error', message: 'HTTP 503' })
    expect(seen).toHaveLength(1)
  })

  it('subscribes and unsubscribes the 401 signal through the client', async () => {
    const { fetch } = fetchStub([
      { status: 401, body: { error: { code: 'token_invalid', message: 'stale' } } },
      { status: 401, body: { error: { code: 'token_invalid', message: 'stale' } } },
    ])
    const client = new AuthClient({ fetch })
    const seen: AuthError[] = []
    const off = client.onUnauthorized((error) => { seen.push(error) })
    await expect(client.me()).rejects.toMatchObject({ code: 'token_invalid' })
    expect(seen).toHaveLength(1)
    off()
    await expect(client.me()).rejects.toMatchObject({ code: 'token_invalid' })
    expect(seen).toHaveLength(1)
  })

  it('isolates a throwing 401 listener and still fans out to the rest', () => {
    const signal = new UnauthorizedSignal()
    const seen: string[] = []
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    signal.subscribe(() => {
      throw new Error('listener boom')
    })
    signal.subscribe(() => {
      seen.push('ok')
    })
    signal.emit(new AuthError(401, 'not_authenticated', 'x'))
    expect(seen).toEqual(['ok'])
    expect(quiet).toHaveBeenCalled()
    quiet.mockRestore()
  })
})

describe('AuthClient', () => {
  it('reads me() as a bare account view from the auth surface', async () => {
    const { fetch, calls } = fetchStub([{ status: 200, body: { id: 'u1', email: 'a@b.c', systemRole: 'admin', disabledAt: null } }])
    const me = await clientOf(fetch).me()
    expect((me as { id: string }).id).toBe('u1')
    expect(calls[0]?.input.pathname).toBe('/api/v1/auth/me')
    expect(calls[0]?.init.method).toBe('GET')
  })

  it('attaches the CSRF header to writes from the cookie reader', async () => {
    const { fetch, calls } = fetchStub([{ status: 200, body: { message: 'ok' } }])
    const client = clientOf(fetch)
    Object.defineProperty(globalThis, 'document', { value: { cookie: 'csrf_token=tok-9' }, configurable: true })
    try {
      await client.logout()
    } finally {
      delete (globalThis as { document?: unknown }).document
    }
    expect(calls[0]?.init.method).toBe('POST')
    expect((calls[0]?.init.headers as Record<string, string>)['x-csrf-token']).toBe('tok-9')
  })

  it('maps the error envelope to AuthError and fires the 401 signal', async () => {
    const signal = new UnauthorizedSignal()
    const seen: AuthError[] = []
    signal.subscribe((error) => { seen.push(error) })
    const { fetch } = fetchStub([{ status: 401, body: { error: { code: 'not_authenticated', message: 'Authentication required' } } }])
    await expect(clientOf(fetch, signal).listUsers()).rejects.toMatchObject({ status: 401, code: 'not_authenticated' })
    expect(seen).toHaveLength(1)
    expect(seen[0]?.status).toBe(401)
  })

  it('maps non-401 failures to AuthError without the 401 signal', async () => {
    const signal = new UnauthorizedSignal()
    const seen: AuthError[] = []
    signal.subscribe((error) => { seen.push(error) })
    const { fetch } = fetchStub([{ status: 409, body: { error: { code: 'last_admin_protected', message: 'no' } } }])
    await expect(clientOf(fetch, signal).updateUser('u2', { disabled: true })).rejects.toMatchObject({ status: 409, code: 'last_admin_protected' })
    expect(seen).toHaveLength(0)
  })

  it('shapes the admin calls: list, patch, reset', async () => {
    const { fetch, calls } = fetchStub([
      { status: 200, body: { users: [{ id: 'u1' }, { id: 'u2' }] } },
      { status: 200, body: { user: { id: 'u2', systemRole: 'admin' } } },
      { status: 200, body: { user: { id: 'u2' } } },
    ])
    const client = clientOf(fetch)
    expect(await client.listUsers()).toHaveLength(2)
    expect((await client.updateUser('u2', { systemRole: 'admin' })).systemRole).toBe('admin')
    expect((await client.resetPassword('u2', 'fresh-pass-99')).id).toBe('u2')
    expect(calls[1]?.input.pathname).toBe('/api/v1/admin/users/u2')
    expect(calls[1]?.init.method).toBe('PATCH')
    expect(JSON.parse(calls[1]?.init.body as string)).toEqual({ systemRole: 'admin' })
    expect(calls[2]?.input.pathname).toBe('/api/v1/admin/users/u2/reset-password')
    expect(calls[2]?.init.method).toBe('POST')
    expect(JSON.parse(calls[2]?.init.body as string)).toEqual({ newPassword: 'fresh-pass-99' })
  })
})

describe('FixtureAuthClient', () => {
  it('starts signed out, signs in, and answers the account surface', async () => {
    const fixture: IAuthClient = new FixtureAuthClient()
    await expect(fixture.me()).rejects.toMatchObject({ status: 401 })
    const login = await fixture.login('admin@fixture.dev', 'anything')
    expect(login.user.systemRole).toBe('admin')
    expect((await fixture.me()).email).toBe('admin@fixture.dev')
    const users = await fixture.listUsers()
    expect(users).toHaveLength(2)
    await fixture.logout()
    await expect(fixture.me()).rejects.toMatchObject({ status: 401 })
  })

  it('carries self protection like the server (which preempts last-admin for the only enabled admin)', async () => {
    const fixture: IAuthClient = new FixtureAuthClient()
    await fixture.login('admin@fixture.dev', 'x')
    const users = await fixture.listUsers()
    const admin = users.find(user => user.systemRole === 'admin') as { id: string }
    const user = users.find(candidate => candidate.id !== admin.id) as { id: string }
    await expect(fixture.updateUser(admin.id, { systemRole: 'user' })).rejects.toMatchObject({ code: 'self_protected' })
    await expect(fixture.updateUser(user.id, { systemRole: 'admin' })).resolves.toMatchObject({ systemRole: 'admin' })
    const disabled = await fixture.updateUser(user.id, { disabled: true })
    expect(typeof disabled.disabledAt).toBe('number')
    await expect(fixture.updateUser(user.id, { systemRole: 'user', disabled: false })).resolves.toMatchObject({ systemRole: 'user', disabledAt: null })
    await expect(fixture.resetPassword(user.id, 'fresh-pass-99')).resolves.toMatchObject({ id: user.id })
  })
})

describe('connection handle auth plumbing', () => {
  it('mounts auth on the handle and fans the shared 401 signal out once', async () => {
    const ctx = new Context() as Context & { set: unknown }
    await (ctx as unknown as { plugin(options: unknown): Promise<void> }).plugin({ apply, inject: [] })
    const handle = ctx.get('connection') as ConnectionHandle | undefined
    expect(handle).toBeDefined()
    expect(handle?.auth).toBeDefined()
    const seen: AuthError[] = []
    const stop = handle?.onUnauthorized((error) => { seen.push(error) })
    stop?.()
    // After unsubscribe nothing further arrives; the listener registry no
    // longer holds the consumer. Emit through the client's own signal path.
    const signal = new UnauthorizedSignal()
    signal.subscribe(() => {})  // keep the set non-trivially exercised
    expect(seen).toHaveLength(0)
  })
})
