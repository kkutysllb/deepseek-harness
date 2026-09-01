import { EventEmitter, Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { hashPassword, SqliteAccountStore, type User } from '@qilin/account-core'
import { SessionCorruptError, SessionService } from '@qilin/account-auth'
import { describe, expect, it } from 'vitest'
import { createAdminUsersRouteHandler, ADMIN_USERS_ROUTE_PREFIX } from '../src/admin-users-router.ts'

const PREFIX = ADMIN_USERS_ROUTE_PREFIX

function req(method: string, url: string, headers: Record<string, string> = {}, body?: unknown): IncomingMessage {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  const r = Readable.from(chunks) as unknown as IncomingMessage
  Object.assign(r, { method, url, headers: { host: '127.0.0.1:3080', ...headers } })
  Object.defineProperty(r, 'socket', { value: { remoteAddress: '127.0.0.1' } })
  return r
}
function res(): { response: ServerResponse; state: { status: number | undefined; body: string | undefined } } {
  const state: { status: number | undefined; body: string | undefined } = { status: undefined, body: undefined }
  let sent = false
  const response = Object.assign(new EventEmitter(), {
    setHeader() { return response },
    writeHead(status: number) { state.status = status; sent = true; return response },
    end(body?: string) { state.body = body; sent = true; return response },
  }) as unknown as ServerResponse
  Object.defineProperty(response, 'headersSent', { get: () => sent })
  return { response, state }
}
async function call(
  handler: ReturnType<typeof createAdminUsersRouteHandler>,
  request: IncomingMessage,
): Promise<{ status: number | undefined; body: Record<string, unknown> }> {
  const out = res()
  await handler(request, out.response)
  let parsed: Record<string, unknown> = {}
  try { parsed = JSON.parse(out.state.body ?? '{}') as Record<string, unknown> } catch { parsed = {} }
  return { status: out.state.status, body: parsed }
}

/** One fresh store with an enabled admin plus one plain user, sessions ready. */
function rig(): { store: SqliteAccountStore; sessions: SessionService; admin: User; user: User } {
  const store = new SqliteAccountStore({ path: ':memory:' })
  const admin = store.insertUser({ email: 'admin@example.com', passwordHash: hashPassword('password-123'), systemRole: 'admin' })
  const user = store.insertUser({ email: 'user@example.com', passwordHash: hashPassword('password-123'), systemRole: 'user' })
  const sessions = new SessionService({ store })
  return { store, sessions, admin, user }
}
function cookieHandler(deps: { store: SqliteAccountStore; sessions: SessionService }): ReturnType<typeof createAdminUsersRouteHandler> {
  return createAdminUsersRouteHandler({ store: deps.store, sessions: deps.sessions, env: {}, authDisabled: false })
}
function valveHandler(deps: { store: SqliteAccountStore; sessions: SessionService }): ReturnType<typeof createAdminUsersRouteHandler> {
  return createAdminUsersRouteHandler({ store: deps.store, sessions: deps.sessions, env: {}, authDisabled: true })
}

it('lists users without passwordHash', async () => {
  const deps = rig()
  const handler = valveHandler(deps)
  const out = await call(handler, req('GET', PREFIX))
  expect(out.status).toBe(200)
  const users = out.body.users as Record<string, unknown>[]
  expect(users).toHaveLength(2)
  for (const row of users) {
    expect(row).not.toHaveProperty('passwordHash')
    expect(row).toHaveProperty('disabledAt', null)
  }
  deps.store.close()
})

it('answers 401 not_authenticated without any credential', async () => {
  const deps = rig()
  const handler = cookieHandler(deps)
  const out = await call(handler, req('GET', PREFIX))
  expect(out.status).toBe(401)
  expect((out.body.error as Record<string, unknown>).code).toBe('not_authenticated')
  deps.store.close()
})

it('answers 401 token_invalid for a garbage session cookie', async () => {
  const deps = rig()
  const handler = cookieHandler(deps)
  const out = await call(handler, req('GET', PREFIX, { cookie: 'access_token=garbage' }))
  expect(out.status).toBe(401)
  expect((out.body.error as Record<string, unknown>).code).toBe('token_invalid')
  deps.store.close()
})

it('answers 401 account_disabled for a session of a disabled account', async () => {
  const deps = rig()
  const issued = deps.sessions.issueSession({ userId: deps.admin.id, persistent: false })
  deps.store.setDisabled(deps.admin.id, Date.now())
  const handler = cookieHandler(deps)
  const out = await call(handler, req('GET', PREFIX, { cookie: 'access_token=' + issued.session.id }))
  expect(out.status).toBe(401)
  expect((out.body.error as Record<string, unknown>).code).toBe('account_disabled')
  deps.store.close()
})

it('answers 403 forbidden for an authenticated non-admin', async () => {
  const deps = rig()
  const issued = deps.sessions.issueSession({ userId: deps.user.id, persistent: false })
  const handler = cookieHandler(deps)
  const out = await call(handler, req('GET', PREFIX, { cookie: 'access_token=' + issued.session.id }))
  expect(out.status).toBe(403)
  expect((out.body.error as Record<string, unknown>).code).toBe('forbidden')
  deps.store.close()
})

it('accepts a Bearer chain and answers the list without CSRF', async () => {
  const deps = rig()
  const issued = deps.sessions.issueSession({ userId: deps.admin.id, persistent: false })
  const handler = cookieHandler(deps)
  const out = await call(handler, req('GET', PREFIX, { authorization: 'Bearer ' + issued.session.id }))
  expect(out.status).toBe(200)
  expect((out.body.users as unknown[]).length).toBe(2)
  deps.store.close()
})

it('rejects a cookie write without the CSRF token', async () => {
  const deps = rig()
  const issued = deps.sessions.issueSession({ userId: deps.admin.id, persistent: false })
  const handler = cookieHandler(deps)
  const out = await call(handler, req('PATCH', PREFIX + '/' + deps.user.id, { cookie: 'access_token=' + issued.session.id }, { systemRole: 'admin' }))
  expect(out.status).toBe(403)
  expect((out.body.error as Record<string, unknown>).code).toBe('csrf_missing')
  deps.store.close()
})

it('rejects a cookie write with a mismatched CSRF token', async () => {
  const deps = rig()
  const issued = deps.sessions.issueSession({ userId: deps.admin.id, persistent: false })
  const handler = cookieHandler(deps)
  const out = await call(handler, req('PATCH', PREFIX + '/' + deps.user.id, { cookie: 'access_token=' + issued.session.id + '; csrf_token=wrong', 'x-csrf-token': 'mismatched' }, { systemRole: 'admin' }))
  expect(out.status).toBe(403)
  expect((out.body.error as Record<string, unknown>).code).toBe('csrf_mismatch')
  deps.store.close()
})

it('changes a role over a cookie write with a matching CSRF pair', async () => {
  const deps = rig()
  const issued = deps.sessions.issueSession({ userId: deps.admin.id, persistent: false })
  const handler = cookieHandler(deps)
  const out = await call(handler, req('PATCH', PREFIX + '/' + deps.user.id, { cookie: 'access_token=' + issued.session.id + '; csrf_token=' + issued.csrfToken, 'x-csrf-token': issued.csrfToken }, { systemRole: 'admin' }))
  expect(out.status).toBe(200)
  expect((out.body.user as Record<string, unknown>).systemRole).toBe('admin')
  expect(deps.store.findUserById(deps.user.id)?.systemRole).toBe('admin')
  deps.store.close()
})

it('changes a role over Bearer with no CSRF required', async () => {
  const deps = rig()
  const issued = deps.sessions.issueSession({ userId: deps.admin.id, persistent: false })
  const handler = cookieHandler(deps)
  const out = await call(handler, req('PATCH', PREFIX + '/' + deps.user.id, { authorization: 'Bearer ' + issued.session.id }, { systemRole: 'admin' }))
  expect(out.status).toBe(200)
  expect((out.body.user as Record<string, unknown>).systemRole).toBe('admin')
  deps.store.close()
})

it('disables and re-enables an account over the valve', async () => {
  const deps = rig()
  const handler = valveHandler(deps)
  const off = await call(handler, req('PATCH', PREFIX + '/' + deps.user.id, {}, { disabled: true }))
  expect(off.status).toBe(200)
  const disabledAt = (off.body.user as Record<string, unknown>).disabledAt
  expect(typeof disabledAt).toBe('number')
  const on = await call(handler, req('PATCH', PREFIX + '/' + deps.user.id, {}, { disabled: false }))
  expect(on.status).toBe(200)
  expect((on.body.user as Record<string, unknown>).disabledAt).toBe(null)
  deps.store.close()
})

it('answers 404 for an unknown account id', async () => {
  const deps = rig()
  const handler = valveHandler(deps)
  const out = await call(handler, req('PATCH', PREFIX + '/missing-id', {}, { systemRole: 'user' }))
  expect(out.status).toBe(404)
  expect((out.body.error as Record<string, unknown>).code).toBe('not_found')
  deps.store.close()
})

it('refuses the administrator demoting themselves', async () => {
  const deps = rig()
  const handler = cookieHandler(deps)
  const issued = deps.sessions.issueSession({ userId: deps.admin.id, persistent: false })
  const out = await call(handler, req('PATCH', PREFIX + '/' + deps.admin.id, { authorization: 'Bearer ' + issued.session.id }, { systemRole: 'user' }))
  expect(out.status).toBe(400)
  expect((out.body.error as Record<string, unknown>).code).toBe('self_protected')
  expect(deps.store.findUserById(deps.admin.id)?.systemRole).toBe('admin')
  deps.store.close()
})

it('refuses disabling the only enabled administrator', async () => {
  const deps = rig()
  const second = deps.store.insertUser({ email: 'second@example.com', passwordHash: hashPassword('password-123'), systemRole: 'admin' })
  deps.store.setDisabled(second.id, Date.now())
  const handler = valveHandler(deps)
  const out = await call(handler, req('PATCH', PREFIX + '/' + deps.admin.id, {}, { disabled: true }))
  expect(out.status).toBe(409)
  expect((out.body.error as Record<string, unknown>).code).toBe('last_admin_protected')
  expect(deps.store.findUserById(deps.admin.id)?.disabledAt).toBe(null)
  deps.store.close()
})

it('answers 400 invalid_request for an empty or malformed update', async () => {
  const deps = rig()
  const handler = valveHandler(deps)
  const empty = await call(handler, req('PATCH', PREFIX + '/' + deps.user.id, {}, {}))
  expect(empty.status).toBe(400)
  expect((empty.body.error as Record<string, unknown>).code).toBe('invalid_request')
  const badRole = await call(handler, req('PATCH', PREFIX + '/' + deps.user.id, {}, { systemRole: 'owner' }))
  expect(badRole.status).toBe(400)
  expect((badRole.body.error as Record<string, unknown>).code).toBe('invalid_request')
  const badDisabled = await call(handler, req('PATCH', PREFIX + '/' + deps.user.id, {}, { disabled: 'yes' }))
  expect(badDisabled.status).toBe(400)
  expect((badDisabled.body.error as Record<string, unknown>).code).toBe('invalid_request')
  deps.store.close()
})

it('resets a password and revokes the account sessions', async () => {
  const deps = rig()
  const victimSession = deps.sessions.issueSession({ userId: deps.user.id, persistent: false })
  const handler = valveHandler(deps)
  const out = await call(handler, req('POST', PREFIX + '/' + deps.user.id + '/reset-password', {}, { newPassword: 'fresh-pass-99' }))
  expect(out.status).toBe(200)
  const user = out.body.user as Record<string, unknown>
  expect(user).not.toHaveProperty('passwordHash')
  expect(() => deps.sessions.validateSession(victimSession.session.id)).toThrow()
  deps.store.close()
})

it('answers 400 weak_password for a short reset password', async () => {
  const deps = rig()
  const handler = valveHandler(deps)
  const out = await call(handler, req('POST', PREFIX + '/' + deps.user.id + '/reset-password', {}, { newPassword: 'short' }))
  expect(out.status).toBe(400)
  expect((out.body.error as Record<string, unknown>).code).toBe('weak_password')
  deps.store.close()
})

it('answers 400 invalid_request when the reset body lacks newPassword', async () => {
  const deps = rig()
  const handler = valveHandler(deps)
  const out = await call(handler, req('POST', PREFIX + '/' + deps.user.id + '/reset-password', {}, {}))
  expect(out.status).toBe(400)
  expect((out.body.error as Record<string, unknown>).code).toBe('invalid_request')
  deps.store.close()
})

it('answers 405 for a wrong method on a known endpoint and 404 for an unknown suffix', async () => {
  const deps = rig()
  const handler = valveHandler(deps)
  const wrong = await call(handler, req('DELETE', PREFIX + '/' + deps.user.id))
  expect(wrong.status).toBe(405)
  expect((wrong.body.error as Record<string, unknown>).code).toBe('method_not_allowed')
  const postRoot = await call(handler, req('POST', PREFIX))
  expect(postRoot.status).toBe(405)
  const unknown = await call(handler, req('GET', PREFIX + '/nope/deeper'))
  expect(unknown.status).toBe(404)
  deps.store.close()
})

describe('valve', () => {
  it('passes every route as a synthetic administrator without credentials', async () => {
    const deps = rig()
    const handler = valveHandler(deps)
    const list = await call(handler, req('GET', PREFIX))
    expect(list.status).toBe(200)
    const patch = await call(handler, req('PATCH', PREFIX + '/' + deps.user.id, {}, { systemRole: 'admin' }))
    expect(patch.status).toBe(200)
    const reset = await call(handler, req('POST', PREFIX + '/' + deps.user.id + '/reset-password', {}, { newPassword: 'fresh-pass-99' }))
    expect(reset.status).toBe(200)
    deps.store.close()
  })
})

it('answers 405 for POST on the collection root', async () => {
  const deps = rig()
  const handler = valveHandler(deps)
  const out = await call(handler, req('POST', PREFIX, {}, { email: 'x@y.z', password: 'password-123' }))
  expect(out.status).toBe(405)
  deps.store.close()
})

it('answers 405 for DELETE on an item path', async () => {
  const deps = rig()
  const handler = valveHandler(deps)
  const out = await call(handler, req('DELETE', PREFIX + '/nope'))
  expect(out.status).toBe(405)
  deps.store.close()
})

it('answers 404 for a path outside the prefix', async () => {
  const deps = rig()
  const handler = valveHandler(deps)
  const out = await call(handler, req('GET', '/api/v1/somewhere-else'))
  expect(out.status).toBe(404)
  deps.store.close()
})

it('treats a missing url as an out-of-prefix request', async () => {
  const deps = rig()
  const handler = valveHandler(deps)
  const request = req('GET', PREFIX)
  request.url = undefined
  const out = await call(handler, request)
  expect(out.status).toBe(404)
  deps.store.close()
})

it('answers 500 and warns when the store read faults mid-dispatch', async () => {
  const deps = rig()
  const warnings: unknown[] = []
  const handler = createAdminUsersRouteHandler({
    store: { listUsers: () => { throw new Error('store down') } } as never,
    sessions: deps.sessions,
    env: {},
    authDisabled: true,
    warn: (error: unknown) => { warnings.push(error) },
  })
  const out = await call(handler, req('GET', PREFIX))
  expect(out.status).toBe(500)
  expect((out.body.error as Record<string, unknown>).code).toBe('internal_error')
  expect(warnings).toHaveLength(1)
  deps.store.close()
})

it('destroys the response when a fault lands after the headers were sent', async () => {
  const deps = rig()
  const destroyed: boolean[] = []
  const handler = createAdminUsersRouteHandler({
    store: { listUsers: () => { throw new Error('store down') } } as never,
    sessions: deps.sessions,
    env: {},
    authDisabled: true,
    warn: () => {},
  })
  const response = Object.assign(new EventEmitter(), {
    setHeader() { return response },
    writeHead() { return response },
    end() { return response },
    destroy() { destroyed.push(true) },
  }) as unknown as ServerResponse
  Object.defineProperty(response, 'headersSent', { get: () => true, configurable: true })
  await handler(req('GET', PREFIX), response)
  expect(destroyed).toEqual([true])
  deps.store.close()
})

it('answers 500 internal for a corrupt session record', async () => {
  const deps = rig()
  const handler = createAdminUsersRouteHandler({
    store: deps.store,
    sessions: { validateSession: () => { throw new SessionCorruptError('tampered') } } as never,
    env: {},
    authDisabled: false,
  })
  const out = await call(handler, req('GET', PREFIX, { cookie: 'access_token=anything' }))
  expect(out.status).toBe(500)
  expect((out.body.error as Record<string, unknown>).code).toBe('internal_error')
  deps.store.close()
})

it('reads the credential from a repeated (array) header', async () => {
  const deps = rig()
  const issued = deps.sessions.issueSession({ userId: deps.admin.id, persistent: false })
  const handler = cookieHandler(deps)
  const request = req('PATCH', PREFIX + '/' + deps.user.id, { cookie: 'access_token=' + issued.session.id + '; csrf_token=' + issued.csrfToken, 'x-csrf-token': [issued.csrfToken, 'extra'] } as never, { systemRole: 'user' })
  const out = await call(handler, request)
  expect(out.status).toBe(200)
  deps.store.close()
})

it('promotes a plain user through PATCH with the admin role', async () => {
  const deps = rig()
  const issued = deps.sessions.issueSession({ userId: deps.admin.id, persistent: false })
  const handler = cookieHandler(deps)
  const out = await call(handler, req('PATCH', PREFIX + '/' + deps.user.id, { authorization: 'Bearer ' + issued.session.id }, { systemRole: 'admin' }))
  expect(out.status).toBe(200)
  expect((out.body.user as Record<string, unknown>).systemRole).toBe('admin')
  deps.store.close()
})

it('rejects a reset body without a string newPassword and an unknown reset id', async () => {
  const deps = rig()
  const issued = deps.sessions.issueSession({ userId: deps.admin.id, persistent: false })
  const handler = cookieHandler(deps)
  const missing = await call(handler, req('POST', PREFIX + '/' + deps.user.id + '/reset-password', { authorization: 'Bearer ' + issued.session.id }, {}))
  expect(missing.status).toBe(400)
  expect((missing.body.error as Record<string, unknown>).code).toBe('invalid_request')
  const unknown = await call(handler, req('POST', PREFIX + '/ghost/reset-password', { authorization: 'Bearer ' + issued.session.id }, { newPassword: 'password-123' }))
  expect(unknown.status).toBe(404)
  deps.store.close()
})
