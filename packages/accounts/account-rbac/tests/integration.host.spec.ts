import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import HttpServer from '@qilin/host-webserver'
import * as Connection from '@qilin/client-connection'
import type { HostConnectionHandle } from '@qilin/client-connection'
import { afterEach, describe, expect, it } from 'vitest'
import * as AccountHttp from '@qilin/account-http'
import { PolicyConfigError } from '../src/policy.ts'
import * as AccountRbac from '../src/index.ts'

/**
 * REAL-composition coverage: a live node:http server (webServer + client
 * connection + account-http + account-rbac on one cordis context) observed
 * through raw HTTP - the acceptance surface for the /api RBAC fence
 * (contracts L/M/N at the transport enforcement point). The alpha.3
 * connection route enforces the fence chain in order: the Host/Origin trust
 * check, the persistent browser session minted through the launch-token
 * exchange, the account authentication gate, then the RBAC gate - and the
 * typert gateway interceptor standing as the /api carrier is stood in here by
 * a claim-all registration. A bodyless, content-type-less POST that clears
 * every fence answers with the carrier's 415 - the pass-through proof; an
 * RBAC refusal answers 403 before the dispatch ever runs.
 */

/** In-memory credential provider double: Connection persists only its browser-session signing secret. */
function provideBrowserCredentials(ctx: Context): void {
  let record: unknown
  ctx.provide('credentials', {
    readRecord: (): Promise<unknown> => Promise.resolve(record),
    modifyRecord: (_key: unknown, mutate: (current: unknown) => Promise<unknown>): Promise<unknown> =>
      mutate(record).then((next) => {
        if (next !== undefined) record = next
        return record
      }),
    deleteRecord: (): Promise<void> => {
      record = undefined
      return Promise.resolve()
    },
  } as never)
}

/** Wait for the connection service its plugin provides during async activation. */
async function waitForConnection(ctx: Context): Promise<HostConnectionHandle> {
  const deadline = Date.now() + 10_000
  while (ctx.get('connection') === undefined) {
    if (Date.now() > deadline) throw new Error('connection service never mounted')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  return ctx.get('connection')!
}

/**
 * Exchange the process launch token for the authority-bound browser-session
 * cookie — the index flow the shipped web runtime serves. A minted cookie
 * owns the response (the return value only decides whether the caller may
 * serve index.html), so the Set-Cookie header is the proof.
 */
function browserCookieOf(connection: HostConnectionHandle, authority: string): string {
  const url = new URL(connection.authenticatedUrl(`http://${authority}`))
  const headers: Record<string, string> = {}
  connection.authorizeIndex(
    { method: 'GET', url: `${url.pathname}${url.search}`, headers: { host: authority } },
    {
      writeHead: (_status: number, written: Record<string, string>) => {
        Object.assign(headers, written)
        return undefined
      },
      end: () => undefined,
    },
  )
  const cookie = headers['set-cookie']?.split(';')[0]
  if (cookie === undefined) throw new Error('browser token exchange did not yield the session cookie')
  return cookie
}

interface Server {
  origin: string
  policyPath: string
  dbPath: string
  /** The connection browser-session cookie for this server's loopback authority. */
  browserCookie: string
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
  provideBrowserCredentials(ctx)
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
  const connection = await waitForConnection(ctx)
  // The shipped /api interceptor is the typert gateway's endpoint registry; a
  // claim-all registration stands in for it so every gate-passed request
  // reaches the carrier's JSON media-type judgment.
  connection.rpc.intercept('/api', () => true, async () => ({ ok: true, value: null }))
  const browserCookie = browserCookieOf(connection, `127.0.0.1:${String(port)}`)
  cleanup.push(async () => {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  return { origin: 'http://127.0.0.1:' + String(port), policyPath, dbPath, browserCookie }
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

/**
 * Authenticated cookie-write with no media type: the carrier answers 415 once
 * RBAC passes. The account jar and the transport's browser-session cookie
 * ride together — each fence judges its own credential.
 */
const business = (accountJar: string, csrf: string, browserCookie: string): RequestInit => ({
  method: 'POST',
  headers: { cookie: `${accountJar}; ${browserCookie}`, 'x-csrf-token': csrf },
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
    const { origin, browserCookie } = await mount()
    const { admin, adminCsrf, user, userCsrf } = await provisionAccounts(origin)
    // The write-class settings.update passes for the admin: the request
    // clears the browser fence, authentication, CSRF, and RBAC, and the
    // carrier's media-type check answers 415 (the pass-through proof).
    const adminWrite = await call(origin, '/api/settings.update', business(admin, adminCsrf, browserCookie))
    expect(adminWrite.status).toBe(415)
    expect(adminWrite.body).toBe('content type must be application/json')
    // The same method is outside the user baseline: 403 permission_denied
    // before the dispatch ever sees it.
    const userWrite = await call(origin, '/api/settings.update', business(user, userCsrf, browserCookie))
    expect(userWrite.status).toBe(403)
    expect((JSON.parse(userWrite.body) as { error: { code: string } }).error.code).toBe('permission_denied')
    // The read-class surface stays open to the user (the baseline keeps the
    // SPA usable): session.list passes RBAC and reaches the carrier.
    const userList = await call(origin, '/api/session.list', business(user, userCsrf, browserCookie))
    expect(userList.status).toBe(415)
    expect(userList.body).toBe('content type must be application/json')
  })

  it('answers 401 from the authentication fence before RBAC is consulted', async () => {
    const { origin, browserCookie } = await mount()
    // The transport's browser-session fence runs first: a request without it
    // is refused before any account gate is consulted.
    const anonymous = await call(origin, '/api/settings.update', { method: 'POST' })
    expect(anonymous.status).toBe(401)
    expect(anonymous.body).toBe('unauthorized')
    // Past the browser session but without an account identity, the
    // authentication fence answers its typed refusal - RBAC is never
    // consulted (a permission_denied envelope would mean the order inverted).
    const accountless = await call(origin, '/api/settings.update', { method: 'POST', headers: { cookie: browserCookie } })
    expect(accountless.status).toBe(401)
    expect((JSON.parse(accountless.body) as { error: { code: string } }).error.code).toBe('not_authenticated')
  })

  it('keeps exact pre-RBAC behavior when the plugin is not mounted (contract L default-off)', async () => {
    const { origin, browserCookie } = await mount({}, false)
    const { user, userCsrf } = await provisionAccounts(origin)
    const write = await call(origin, '/api/settings.update', business(user, userCsrf, browserCookie))
    expect(write.status).toBe(415)
    expect(write.body).toBe('content type must be application/json')
  })

  it('keeps exact pre-RBAC behavior when the switch is off in a mounted config', async () => {
    const { origin, browserCookie } = await mount({ enabled: false })
    const { user, userCsrf } = await provisionAccounts(origin)
    const write = await call(origin, '/api/settings.update', business(user, userCsrf, browserCookie))
    expect(write.status).toBe(415)
  })

  it('flips a baseline-allowed method to 403 with a policy deny (contract L deny-wins, assembly-time read)', async () => {
    const { origin, browserCookie } = await mount({}, true, {
      version: 1,
      roles: { user: { route: { deny: ['session:list'] } } },
    })
    const { admin, adminCsrf, user, userCsrf } = await provisionAccounts(origin)
    const userList = await call(origin, '/api/session.list', business(user, userCsrf, browserCookie))
    expect(userList.status).toBe(403)
    expect((JSON.parse(userList.body) as { error: { code: string } }).error.code).toBe('permission_denied')
    // The admin deny is untouched: no admin section, full pass.
    const adminList = await call(origin, '/api/session.list', business(admin, adminCsrf, browserCookie))
    expect(adminList.status).toBe(415)
    expect(adminList.body).toBe('content type must be application/json')
  })

  it('answers 500 internal_error on a corrupt session row instead of 403', async () => {
    const { origin, dbPath, browserCookie } = await mount()
    const { user, userCsrf } = await provisionAccounts(origin)
    // Corrupt the durable row underneath the live session: the identity the
    // account surface just minted now points at a missing account.
    const db = new DatabaseSync(dbPath)
    db.exec('PRAGMA foreign_keys = OFF')
    const row = db.prepare('SELECT id FROM sessions ORDER BY created_at DESC LIMIT 1').get() as { id: string }
    db.prepare('UPDATE sessions SET user_id = ? WHERE id = ?').run('ghost-missing-account', row.id)
    db.close()
    const refused = await call(origin, '/api/session.list', business(user, userCsrf, browserCookie))
    // Store-level damage is an internal error at the transport gates (the
    // authentication gate and the RBAC fence both map a thrown identity
    // fault to the stable 500), never a permission refusal dressed up as 403.
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
