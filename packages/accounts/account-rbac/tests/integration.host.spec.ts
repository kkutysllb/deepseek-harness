import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import HttpServer from '@qilin/host-webserver'
import * as Connection from '@qilin/client-connection'
import { afterEach, describe, expect, it } from 'vitest'
import * as AccountHttp from '@qilin/account-http'
import { PolicyConfigError } from '../src/policy.ts'
import * as AccountRbac from '../src/index.ts'

/**
 * REAL-composition coverage: a live node:http server (webServer + client
 * connection + account-http + account-rbac on one cordis context) observed
 * through raw HTTP - the acceptance surface for the /api RBAC fence
 * (contracts L/M/N at the transport enforcement point). A bodyless,
 * content-type-less POST that clears the trust fence, authentication, CSRF,
 * and RBAC answers with the carrier's 415 - the pass-through proof; an RBAC
 * refusal answers 403 before the dispatch ever runs.
 */

/** The /api proxy stub: RBAC-passed business requests land here. */
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
  policyPath: string
  dbPath: string
}

let cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
  const pending = cleanup
  cleanup = []
  for (const fn of pending) await fn()
})

/** Mount the real composition and wait for the OS-assigned port. */
async function mount(rbac: AccountRbac.PluginConfig = {}, rbacMounted = true, prePolicy?: unknown): Promise<Server> {
  const root = await mkdtemp(join(tmpdir(), 'account-rbac-int-'))
  const policyPath = join(root, 'rbac-policy.json')
  const dbPath = join(root, 'accounts.db')
  if (prePolicy !== undefined) await writeFile(policyPath, JSON.stringify(prePolicy))
  const ctx = new Context()
  ctx.provide('apiProxy', proxyStub)
  ctx.plugin(HttpServer, { host: '127.0.0.1', port: 0 })
  ctx.plugin({ inject: [...Connection.inject], apply: Connection.apply }, {})
  ctx.plugin({ inject: [...AccountHttp.inject], apply: AccountHttp.apply }, {
    dbPath,
    authConfigPath: join(root, 'auth-config.json'),
  })
  if (rbacMounted) {
    const rbacConfig: AccountRbac.PluginConfig = { enabled: true, dbPath, policyPath }
    if (rbac !== undefined) Object.assign(rbacConfig, rbac)
    ctx.plugin({ inject: [...AccountRbac.inject], apply: AccountRbac.apply }, rbacConfig)
  }
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
  return { origin: 'http://127.0.0.1:' + String(port), policyPath, dbPath }
}

interface Call {
  status: number
  body: string
  cookies: string[]
}

async function call(origin: string, path: string, init: RequestInit = {}): Promise<Call> {
  const response = await fetch(origin + path, init)
  return {
    status: response.status,
    body: await response.text(),
    cookies: response.headers.getSetCookie(),
  }
}

function jarOf(call: Call): string {
  return call.cookies.map(cookie => cookie.split(';')[0]).join('; ')
}

/** Authenticated cookie-write with no media type: the carrier answers 415 once RBAC passes. */
const business = (cookie: string, csrf: string): RequestInit => ({
  method: 'POST',
  headers: { cookie, 'x-csrf-token': csrf },
})

/** Provision an admin (initialize) and a plain user (register); returns their cookie jars and CSRF tokens. */
async function provisionAccounts(origin: string): Promise<{ admin: string; adminCsrf: string; user: string; userCsrf: string }> {
  const init = await call(origin, '/api/v1/auth/initialize', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'root@example.com', password: 'root-pass-123' }),
  })
  expect(init.status).toBe(201)
  const register = await call(origin, '/api/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'kid@example.com', password: 'kid-pass-123' }),
  })
  expect(register.status).toBe(201)
  const csrfOf = (cookies: string[]): string =>
    cookies.find(value => value.startsWith('csrf_token='))?.split(';')[0]?.split('=')[1] ?? ''
  return { admin: jarOf(init), adminCsrf: csrfOf(init.cookies), user: jarOf(register), userCsrf: csrfOf(register.cookies) }
}

describe('/api RBAC enforcement (contract N at the real enforcement point)', () => {
  it('admits the admin and refuses the plain user on a write-class method (default matrix)', async () => {
    const { origin } = await mount()
    const { admin, adminCsrf, user, userCsrf } = await provisionAccounts(origin)
    // The write-class settings.update passes for the admin: the request
    // clears authentication, CSRF, and RBAC, and the carrier's media-type
    // check answers 415 (the pass-through proof).
    const adminWrite = await call(origin, '/api/settings.update', business(admin, adminCsrf))
    expect(adminWrite.status).toBe(415)
    expect(adminWrite.body).toBe('content type must be application/json')
    // The same method is outside the user baseline: 403 permission_denied
    // before the dispatch ever sees it.
    const userWrite = await call(origin, '/api/settings.update', business(user, userCsrf))
    expect(userWrite.status).toBe(403)
    expect((JSON.parse(userWrite.body) as { error: { code: string } }).error.code).toBe('permission_denied')
    // The read-class surface stays open to the user (the baseline keeps the
    // SPA usable): session.list passes RBAC and reaches the carrier.
    const userList = await call(origin, '/api/session.list', business(user, userCsrf))
    expect(userList.status).toBe(415)
    expect(userList.body).toBe('content type must be application/json')
  })

  it('answers 401 from the authentication fence before RBAC is consulted', async () => {
    const { origin } = await mount()
    const anonymous = await call(origin, '/api/settings.update', { method: 'POST' })
    expect(anonymous.status).toBe(401)
    expect((JSON.parse(anonymous.body) as { error: { code: string } }).error.code).toBe('not_authenticated')
  })

  it('keeps exact pre-RBAC behavior when the plugin is not mounted (contract L default-off)', async () => {
    const { origin } = await mount({}, false)
    const { user, userCsrf } = await provisionAccounts(origin)
    const write = await call(origin, '/api/settings.update', business(user, userCsrf))
    expect(write.status).toBe(415)
    expect(write.body).toBe('content type must be application/json')
  })

  it('keeps exact pre-RBAC behavior when the switch is off in a mounted config', async () => {
    const { origin } = await mount({ enabled: false })
    const { user, userCsrf } = await provisionAccounts(origin)
    const write = await call(origin, '/api/settings.update', business(user, userCsrf))
    expect(write.status).toBe(415)
  })

  it('flips a baseline-allowed method to 403 with a policy deny (contract L deny-wins, assembly-time read)', async () => {
    const { origin } = await mount({}, true, {
      version: 1,
      roles: { user: { route: { deny: ['session:list'] } } },
    })
    const { admin, adminCsrf, user, userCsrf } = await provisionAccounts(origin)
    const userList = await call(origin, '/api/session.list', business(user, userCsrf))
    expect(userList.status).toBe(403)
    expect((JSON.parse(userList.body) as { error: { code: string } }).error.code).toBe('permission_denied')
    // The admin deny is untouched: no admin section, full pass.
    const adminList = await call(origin, '/api/session.list', business(admin, adminCsrf))
    expect(adminList.status).toBe(415)
    expect(adminList.body).toBe('content type must be application/json')
  })

  it('answers 500 internal_error on a corrupt session row instead of 403', async () => {
    const { origin, dbPath } = await mount()
    const { user, userCsrf } = await provisionAccounts(origin)
    // Corrupt the durable row underneath the live session: the identity the
    // account surface just minted now points at a missing account.
    const db = new DatabaseSync(dbPath)
    db.exec('PRAGMA foreign_keys = OFF')
    const row = db.prepare('SELECT id FROM sessions ORDER BY created_at DESC LIMIT 1').get() as { id: string }
    db.prepare('UPDATE sessions SET user_id = ? WHERE id = ?').run('ghost-missing-account', row.id)
    db.close()
    const refused = await call(origin, '/api/session.list', business(user, userCsrf))
    // Store-level damage is an internal error at this fence, never a
    // permission refusal dressed up as 403.
    expect(refused.status).toBe(500)
    expect((JSON.parse(refused.body) as { error: { code: string } }).error.code).toBe('internal_error')
  })

  it('refuses the whole composition on an invalid policy file (fail-closed boot)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'account-rbac-int-invalid-'))
    cleanup.push(async () => { await rm(root, { recursive: true, force: true }) })
    const policyPath = join(root, 'rbac-policy.json')
    await writeFile(policyPath, JSON.stringify({ version: 1, roles: { ghost: {} } }))
    const ctx = new Context()
    expect(() => { AccountRbac.apply(ctx, { enabled: true, dbPath: ':memory:', policyPath }) }).toThrow(PolicyConfigError)
  })
})
