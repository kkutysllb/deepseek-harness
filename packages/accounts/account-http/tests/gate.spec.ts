import type { IncomingMessage } from 'node:http'
import { Readable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import {
  CSRF_COOKIE_NAME,
  SESSION_ID_PATTERN,
  SessionCorruptError,
  SessionService,
} from '@qilin/account-auth'
import { hashPassword, SqliteAccountStore } from '@qilin/account-core'
import { describe, expect, it } from 'vitest'
import { ApiAuthorizer, AUTH_ERROR_CODES } from '../src/gate.ts'
import { AUTH_DISABLED_USER_EMAIL, AUTH_DISABLED_USER_ID } from '../src/principal.ts'

/** A request carrying exactly the given headers and no body. */
function requestOf(headers: Record<string, string>, method = 'GET'): IncomingMessage {
  const request = Readable.from([]) as unknown as IncomingMessage
  Object.assign(request, { url: '/api/session.list', method, headers })
  return request
}

interface Harness {
  authorizer: ApiAuthorizer
  sessions: SessionService
  store: SqliteAccountStore
  userId: string
  /** Login (token, csrfToken): the credentials one successful session holds. */
  login(persistent?: boolean): Promise<{ token: string; csrfToken: string }>
}

async function harness(authDisabled = false, sessionTtlMs?: number): Promise<Harness> {
  const store = new SqliteAccountStore({ path: ':memory:' })
  const sessions = new SessionService({
    store,
    ...(sessionTtlMs !== undefined ? { sessionTtlMs, persistentTtlMs: sessionTtlMs } : {}),
  })
  const user = store.insertUser({ email: 'kid@example.com', passwordHash: hashPassword('correct horse'), systemRole: 'user' })
  const authorizer = new ApiAuthorizer({ sessions, authDisabled })
  return {
    authorizer,
    sessions,
    store,
    userId: user.id,
    login: async (persistent = true): Promise<{ token: string; csrfToken: string }> => {
      const issued = sessions.issueSession({ userId: user.id, persistent })
      return { token: issued.session.id, csrfToken: issued.csrfToken }
    },
  }
}

const COOKIE = (token: string): Record<string, string> => ({ cookie: 'access_token=' + token })

describe('ApiAuthorizer.authenticate', () => {
  it('stamps the synthetic admin under the valve without touching storage', async () => {
    const { authorizer, store } = await harness(true)
    const resolution = authorizer.authenticate(requestOf({}))
    expect(resolution.outcome).toBe('auth-disabled')
    if (resolution.outcome !== 'auth-disabled') return
    expect(resolution.principal.kind).toBe('auth-disabled')
    expect(resolution.principal.user).toMatchObject({ id: AUTH_DISABLED_USER_ID, email: AUTH_DISABLED_USER_EMAIL, systemRole: 'admin', needsSetup: false })
    expect(store.countUsers()).toBe(1)
  })

  it('resolves the cookie first and the Bearer header second', async () => {
    const session1 = await harness()
    const authorizer = session1.authorizer
    const { token } = await session1.login()
    const viaCookie = authorizer.authenticate(requestOf(COOKIE(token)))
    expect(viaCookie).toMatchObject({ outcome: 'authenticated', bearer: false })
    const viaBearer = authorizer.authenticate(requestOf({ authorization: 'Bearer ' + token }))
    expect(viaBearer).toMatchObject({ outcome: 'authenticated', bearer: true })
    expect(authorizer.authenticate(requestOf({ authorization: 'bearer ' + token }))).toMatchObject({ outcome: 'authenticated', bearer: true })
  })

  it('answers missing for a credential-less request', async () => {
    const { authorizer } = await harness()
    expect(authorizer.authenticate(requestOf({})).outcome).toBe('missing')
    expect(authorizer.authenticate(requestOf({ authorization: 'Basic dXNlcjpwYXNz' })).outcome).toBe('missing')
    expect(authorizer.authenticate(requestOf({ authorization: 'Bearer   ' })).outcome).toBe('missing')
    expect(authorizer.authenticate(requestOf({ cookie: 'csrf_token=x' })).outcome).toBe('missing')
  })

  it('maps the typed session errors to their contract-C codes', async () => {
    // A one-millisecond lifetime turns the session expired deterministically.
    const expired = await harness(false, 1)
    const { token: deadToken } = await expired.login()
    await new Promise(resolve => setTimeout(resolve, 5))
    const dead = expired.authorizer.authenticate(requestOf(COOKIE(deadToken)))
    expect(dead).toMatchObject({
      outcome: 'rejected',
      error: { code: AUTH_ERROR_CODES.tokenExpired },
    })

    const fresh = await harness()
    const garbage = fresh.authorizer.authenticate(requestOf(COOKIE('not-a-uuid')))
    expect(garbage).toMatchObject({ outcome: 'rejected', error: { code: AUTH_ERROR_CODES.tokenInvalid } })
    const revoked = await fresh.login()
    fresh.sessions.revokeSession(revoked.token)
    expect(fresh.authorizer.authenticate(requestOf(COOKIE(revoked.token)))).toMatchObject({
      outcome: 'rejected',
      error: { code: AUTH_ERROR_CODES.tokenInvalid },
    })
  })

  it('reports a corrupt session row as a server fault', async () => {
    const forged = await harness()
    const { token } = await forged.login()
    expect(SESSION_ID_PATTERN.test(token)).toBe(true)
    // A durable row that passes the format gate but fails validation is a
    // fault, not an auth failure: authenticate must surface it as such.
    forged.sessions.validateSession = () => {
      throw new SessionCorruptError('issued version 0 in row')
    }
    expect(forged.authorizer.authenticate(requestOf(COOKIE(token)))).toMatchObject({ outcome: 'fault' })
    // Anything else is a bug and propagates to the dispatch.
    forged.sessions.validateSession = () => {
      throw new RangeError('unexpected')
    }
    expect(() => forged.authorizer.authenticate(requestOf(COOKIE(token)))).toThrow(RangeError)
  })
})

describe('ApiAuthorizer.checkRequest', () => {
  it('refuses credential-less requests with the legacy not_authenticated code', async () => {
    const { authorizer } = await harness()
    const verdict = authorizer.checkRequest(requestOf({}, 'POST'))
    expect(verdict).toMatchObject({ allowed: false, status: 401 })
    expect(JSON.parse(verdict.body)).toEqual({ error: { code: 'not_authenticated', message: 'Authentication required' } })
  })

  it('refuses expired and invalid sessions with their reason on 401', async () => {
    const expired = await harness(false, 1)
    const { token: deadToken } = await expired.login()
    await new Promise(resolve => setTimeout(resolve, 5))
    const dead = expired.authorizer.checkRequest(requestOf(COOKIE(deadToken)))
    expect((JSON.parse(dead.body) as { error: { code: string } }).error.code).toBe('token_expired')
    expect(dead.status).toBe(401)

    const fresh = await harness()
    const garbage = fresh.authorizer.checkRequest(requestOf(COOKIE('garbage')))
    expect((JSON.parse(garbage.body) as { error: { code: string } }).error.code).toBe('token_invalid')
  })

  it('reports a corrupt row as a 500 without leaking internals', async () => {
    const forged = await harness()
    forged.sessions.validateSession = () => {
      throw new SessionCorruptError('issued version 0 in row')
    }
    const { token } = await forged.login()
    const verdict = forged.authorizer.checkRequest(requestOf(COOKIE(token)))
    expect(verdict).toMatchObject({ allowed: false, status: 500 })
    expect((JSON.parse(verdict.body) as { error: { code: string; message: string } }).error).toEqual({ code: 'internal_error', message: 'session store failure' })
  })

  it('enforces the CSRF double submit on cookie-authenticated writes', async () => {
    const session1 = await harness()
    const authorizer = session1.authorizer
    const { token, csrfToken } = await session1.login()
    const pair = 'access_token=' + token + '; ' + CSRF_COOKIE_NAME + '=' + csrfToken
    const base = { cookie: pair, 'content-type': 'application/json' }
    // Session cookie without the CSRF cookie on a write: missing side.
    const missing = authorizer.checkRequest(requestOf({ ...COOKIE(token), 'content-type': 'application/json' }, 'POST'))
    expect(missing).toMatchObject({ allowed: false, status: 403 })
    expect((JSON.parse(missing.body) as { error: { code: string } }).error.code).toBe('csrf_missing')

    // A header alone cannot substitute for the missing cookie side.
    const headerOnly = authorizer.checkRequest(requestOf({ ...COOKIE(token), 'x-csrf-token': csrfToken }, 'POST'))
    expect(headerOnly.allowed).toBe(false)
    expect((JSON.parse(headerOnly.body) as { error: { code: string } }).error.code).toBe('csrf_missing')

    const mismatch = authorizer.checkRequest(requestOf({
      cookie: pair,
      'content-type': 'application/json',
      'x-csrf-token': 'wrong',
    }, 'POST'))
    expect(mismatch.allowed).toBe(false)
    expect((JSON.parse(mismatch.body) as { error: { code: string } }).error.code).toBe('csrf_mismatch')
    expect((JSON.parse(mismatch.body) as { error: { message: string } }).error.message).toBe('CSRF token mismatch.')

    const matched = authorizer.checkRequest(requestOf({ ...base, 'x-csrf-token': csrfToken }, 'POST'))
    expect(matched.allowed).toBe(true)
    // The header must echo the cookie: a cookie pair without the header is
    // still refused (the legacy double submit requires both sides).
    const cookieOnly = authorizer.checkRequest(requestOf({ cookie: pair }, 'POST'))
    expect(cookieOnly.allowed).toBe(false)
    expect((JSON.parse(cookieOnly.body) as { error: { code: string } }).error.code).toBe('csrf_missing')
  })

  it('exempts Bearer chains and reads from the auth-disabled valve', async () => {
    const session1 = await harness()
    const authorizer = session1.authorizer
    const { token } = await session1.login()
    expect(authorizer.checkRequest(requestOf({ authorization: 'Bearer ' + token }, 'POST')).allowed).toBe(true)

    const valved = await harness(true)
    expect(valved.authorizer.checkRequest(requestOf({}, 'POST')).allowed).toBe(true)
    expect(valved.authorizer.checkRequest(requestOf({})).allowed).toBe(true)
  })

  it('skips CSRF on safe methods while still demanding authentication', async () => {
    const session1 = await harness()
    expect(session1.authorizer.checkRequest(requestOf({})).allowed).toBe(false)
    const { token } = await session1.login()
    expect(session1.authorizer.checkRequest(requestOf(COOKIE(token))).allowed).toBe(true)
  })
})

describe('ApiAuthorizer.checkUpgrade', () => {
  it('passes live sessions and the valve, refuses anonymous upgrades', async () => {
    const session1 = await harness()
    const authorizer = session1.authorizer
    const { token } = await session1.login()
    expect(authorizer.checkUpgrade(requestOf(COOKIE(token)))).toBe(true)
    expect(authorizer.checkUpgrade(requestOf({ authorization: 'Bearer ' + token }))).toBe(true)
    expect(authorizer.checkUpgrade(requestOf({}))).toBe(false)
    expect(authorizer.checkUpgrade(requestOf(COOKIE('garbage')))).toBe(false)

    const valved = await harness(true)
    expect(valved.authorizer.checkUpgrade(requestOf({}))).toBe(true)
  })
})

describe('plugin service contract', () => {
  it('is satisfied structurally by the plugin-provided pair', async () => {
    // The cordis provide call is exercised end-to-end in integration.host.spec;
    // here we pin the augmentation reading the service back as optional.
    const ctx = new Context()
    expect(ctx.get('apiAuth')).toBeUndefined()
  })

  it('defaults the valve flag and tolerates header-array and method-less requests', async () => {
    const store = new SqliteAccountStore({ path: ':memory:' })
    const authorizer = new ApiAuthorizer({ sessions: new SessionService({ store }) })
    const methodless = Readable.from([]) as unknown as IncomingMessage
    Object.assign(methodless, { url: '/api/session.list', headers: { cookie: 'access_token=garbage' } })
    // A missing method falls back to GET (a safe method, so no CSRF judgment);
    // an array-shaped authorization header reads like its first wire value.
    const verdict = authorizer.checkRequest(methodless)
    expect(verdict.allowed).toBe(false)
    expect((JSON.parse(verdict.body) as { error: { code: string } }).error.code).toBe('token_invalid')
    const arrayBearer = Readable.from([]) as unknown as IncomingMessage
    Object.assign(arrayBearer, { url: '/api/session.list', method: 'GET', headers: { authorization: ['Bearer garbage'] } })
    const bearerVerdict = authorizer.checkRequest(arrayBearer)
    expect(bearerVerdict.allowed).toBe(false)
    expect((JSON.parse(bearerVerdict.body) as { error: { code: string } }).error.code).toBe('not_authenticated')
    store.close()
  })
})

describe('authenticated request method fallbacks', () => {
  it('exempts a bearer-authenticated write from CSRF and reads a methodless request as safe', () => {
    const store = new SqliteAccountStore({ path: ':memory:' })
    const sessions = new SessionService({ store })
    const user = store.insertUser({
      email: 'gate-bearer@example.com',
      passwordHash: hashPassword('longenough'),
      systemRole: 'user',
    })
    const issued = sessions.issueSession({ userId: user.id, persistent: false })
    const authorizer = new ApiAuthorizer({ sessions })

    // A write carrying a live Bearer session is exempt from double submit.
    const write = Readable.from([]) as unknown as IncomingMessage
    Object.assign(write, {
      url: '/api/goals/create',
      method: 'POST',
      headers: { authorization: 'Bearer ' + issued.session.id },
    })
    expect(authorizer.checkRequest(write).allowed).toBe(true)

    // An authenticated request without a method falls back to a safe read.
    const methodless = Readable.from([]) as unknown as IncomingMessage
    Object.assign(methodless, {
      url: '/api/session.list',
      headers: { cookie: 'access_token=' + issued.session.id },
    })
    expect(authorizer.checkRequest(methodless).allowed).toBe(true)

    // A cookie-authenticated write with an array-shaped CSRF header reads
    // the first wire value.
    const arrayed = Readable.from([]) as unknown as IncomingMessage
    Object.assign(arrayed, {
      url: '/api/goals/create',
      method: 'POST',
      headers: {
        cookie: 'access_token=' + issued.session.id + '; csrf_token=' + issued.csrfToken,
        'x-csrf-token': [issued.csrfToken],
      },
    })
    expect(authorizer.checkRequest(arrayed).allowed).toBe(true)

    store.close()
  })
})
