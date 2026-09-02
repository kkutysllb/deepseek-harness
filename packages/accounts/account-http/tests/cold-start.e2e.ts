import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import HttpServer from '@qilin/host-webserver'
import * as Connection from '@qilin/client-connection'
import { afterEach, describe, expect, it } from 'vitest'
import * as AccountHttp from '../src/index.ts'
import { defaultAccountsDbPath } from '@qilin/account-core'

/**
 * End-to-end cold start: a pristine OPENKYLIN_HOME (no accounts database, no auth
 * config) boots the real composition with DEFAULT configuration only — the
 * engine derives every path itself — and a first-run journey walks
 * setup-status → register → login → me → change-password → logout.
 */

const proxyStub = {
  fetch: async () => new Response('proxy-stub', { status: 404 }),
  events: {
    mux: async function* eventsMux(): AsyncGenerator<Uint8Array> {
      yield* [] as Uint8Array[]
    },
    host: async function* eventsHost(): AsyncGenerator<Uint8Array> {
      yield* [] as Uint8Array[]
    },
  },
}

let disposes: Array<() => Promise<void>> = []
let homes: string[] = []

afterEach(async () => {
  for (const dispose of disposes) await dispose()
  disposes = []
  for (const home of homes) await rm(home, { recursive: true, force: true })
  homes = []
})

interface Server {
  origin: string
  home: string
  dispose: () => Promise<void>
}

/** Mount the real composition against one pristine home; waits for the port. */
async function mountCold(): Promise<Server> {
  const home = await mkdtemp(join(tmpdir(), 'account-http-e2e-home-'))
  homes.push(home)
  const previousHome = process.env.OPENKYLIN_HOME
  process.env.OPENKYLIN_HOME = home
  const ctx = new Context()
  ctx.provide('apiProxy', proxyStub)
  ctx.plugin(HttpServer, { host: '127.0.0.1', port: 0 })
  ctx.plugin({ inject: [...Connection.inject], apply: Connection.apply }, {})
  ctx.plugin({ inject: [...AccountHttp.inject], apply: AccountHttp.apply }, {})
  const deadline = Date.now() + 20_000
  while ((ctx.get('webServer')?.port ?? 0) === 0) {
    if (Date.now() > deadline) throw new Error('webServer never bound a port')
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  const origin = 'http://127.0.0.1:' + String(ctx.get('webServer')!.port)
  return {
    origin,
    home,
    dispose: async () => {
      await ctx.fiber.dispose()
      if (previousHome === undefined) delete process.env.OPENKYLIN_HOME
      else process.env.OPENKYLIN_HOME = previousHome
    },
  }
}

async function call(origin: string, path: string, init: RequestInit = {}): Promise<{ status: number; body: string; cookies: string[] }> {
  const response = await fetch(origin + path, init)
  return {
    status: response.status,
    body: await response.text(),
    cookies: response.headers.getSetCookie(),
  }
}

const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

describe('cold start to first admin', () => {
  it('walks the whole first-run journey over the default-derived paths', async () => {
    const { origin, home, dispose } = await mountCold()
    disposes.push(dispose)

    // The engine derived the database path from OPENKYLIN_HOME alone.
    const dbPath = defaultAccountsDbPath(process.env)
    expect(dbPath).toContain(home)

    const setup = await call(origin, '/api/v1/auth/setup-status')
    expect(setup.status).toBe(200)
    expect(JSON.parse(setup.body)).toEqual({ needsSetup: true, registrationEnabled: true })

    // Registration is open by default: the very first account may self-register.
    const register = await call(origin, '/api/v1/auth/register', post({ email: 'founder@example.com', password: 'founder-pass-1' }))
    expect(register.status).toBe(201)
    expect((JSON.parse(register.body) as { user: { systemRole: unknown } }).user.systemRole).toBe('user')

    // Initialize only ever runs on the empty store.
    const init = await call(origin, '/api/v1/auth/initialize', post({ email: 'root@example.com', password: 'root-pass-123' }))
    expect(init.status).toBe(409)
    expect((JSON.parse(init.body) as { error: { code: string } }).error.code).toBe('system_already_initialized')

    const login = await call(origin, '/api/v1/auth/login/local', post({ email: 'founder@example.com', password: 'founder-pass-1' }))
    expect(login.status).toBe(200)
    const accessToken = (JSON.parse(login.body) as { accessToken: string }).accessToken
    const jar = login.cookies.map(cookie => cookie.split(';')[0]).join('; ')

    const me = await call(origin, '/api/v1/auth/me', { headers: { cookie: jar } })
    expect(me.status).toBe(200)
    expect((JSON.parse(me.body) as { email: string }).email).toBe('founder@example.com')

    // The password change kills every old session (contract B) and re-issues
    // a fresh cookie set.
    const change = await call(origin, '/api/v1/auth/change-password', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: jar,
        'x-csrf-token': login.cookies.find(value => value.startsWith('csrf_token='))?.split(';')[0]!.split('=')[1] ?? '',
      },
      body: JSON.stringify({ currentPassword: 'founder-pass-1', newPassword: 'founder-pass-2' }),
    })
    expect(change.status).toBe(200)
    expect((JSON.parse(change.body) as { message: string }).message).toBe('Password changed successfully')
    const oldToken = await call(origin, '/api/v1/auth/me', { headers: { authorization: 'Bearer ' + accessToken } })
    expect(oldToken.status).toBe(401)
    const freshMe = await call(origin, '/api/v1/auth/me', {
      headers: { cookie: change.cookies.map(cookie => cookie.split(';')[0]).join('; ') },
    })
    expect(freshMe.status).toBe(200)

    const out = await call(origin, '/api/v1/auth/logout', { method: 'POST', headers: { cookie: jar } })
    expect(out.status).toBe(200)
    const gone = await call(origin, '/api/v1/auth/me', { headers: { cookie: jar } })
    expect(gone.status).toBe(401)

    // The database really landed in the derived home.
    expect((await stat(dbPath)).size).toBeGreaterThan(0)
  })
})
