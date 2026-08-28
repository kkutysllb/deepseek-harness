import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import { SessionCorruptError, SessionService, SessionValidationError } from '@qilin/account-auth'
import { SqliteAccountStore } from '@qilin/account-core'
import { RbacAuthorizer } from '../src/authorizer.ts'
import { validatePolicyDocument } from '../src/policy.ts'
import type { ResourceKind } from '../src/permissions.ts'
import { anonymousPrincipal } from '../src/principal.ts'

function requestWithCookie(token: string): IncomingMessage {
  return { headers: { cookie: 'access_token=' + token } } as unknown as IncomingMessage
}

function requestWithBearer(token: string): IncomingMessage {
  return { headers: { authorization: 'Bearer ' + token } } as unknown as IncomingMessage
}

function requestWithNothing(): IncomingMessage {
  return { headers: {} } as unknown as IncomingMessage
}

interface Harness {
  sessions: SessionService
  adminToken: string
  userToken: string
  close: () => void
}

function mintSessions(): Harness {
  const store = new SqliteAccountStore({ path: ':memory:', env: {} })
  const sessions = new SessionService({ store })
  const admin = store.insertUser({ email: 'admin@example.com', passwordHash: null, systemRole: 'admin' })
  const user = store.insertUser({ email: 'user@example.com', passwordHash: null, systemRole: 'user' })
  const adminSession = sessions.issueSession({ userId: admin.id, persistent: false })
  const userSession = sessions.issueSession({ userId: user.id, persistent: false })
  return {
    sessions,
    adminToken: adminSession.session.id,
    userToken: userSession.session.id,
    close: () => { store.close() },
  }
}

const denyUserRoutes = validatePolicyDocument({
  version: 1,
  roles: {
    user: {
      route: { deny: ['session:list'], allow: ['credentials:write'] },
      tool: { deny: ['schedule_create'] },
    },
  },
})

const denyAdminRoutes = validatePolicyDocument({
  version: 1,
  roles: { admin: { route: { deny: ['session:list'] } } },
})

describe('Principal construction uniqueness (contract M: one builder, one principal per request)', () => {
  it('returns the identical principal object for repeated resolution of the same request', () => {
    const harness = mintSessions()
    try {
      const authorizer = new RbacAuthorizer({ sessions: harness.sessions, policy: null })
      const request = requestWithCookie(harness.adminToken)
      const first = authorizer.resolvePrincipal(request)
      const second = authorizer.resolvePrincipal(request)
      expect(second).toBe(first)
      expect(first.kind).toBe('session')
      expect(first.user?.systemRole).toBe('admin')
      expect(first.session?.id).toBeTruthy()
    } finally {
      harness.close()
    }
  })

  it('lets every consumption point of one request share the constructed principal', () => {
    const harness = mintSessions()
    try {
      const authorizer = new RbacAuthorizer({ sessions: harness.sessions, policy: denyUserRoutes })
      const request = requestWithCookie(harness.userToken)
      const verdict = authorizer.checkRequest(request, 'session.list')
      expect(verdict.principal).toBe(authorizer.resolvePrincipal(request))
    } finally {
      harness.close()
    }
  })

  it('builds distinct principals for distinct requests over the same session', () => {
    const harness = mintSessions()
    try {
      const authorizer = new RbacAuthorizer({ sessions: harness.sessions, policy: null })
      const first = authorizer.resolvePrincipal(requestWithCookie(harness.userToken))
      const second = authorizer.resolvePrincipal(requestWithCookie(harness.userToken))
      expect(first).not.toBe(second)
      expect(first.user?.id).toBe(second.user?.id)
    } finally {
      harness.close()
    }
  })
})

describe('the auth-disabled valve (contract G consumed at the RBAC layer)', () => {
  it('resolves the synthetic admin without touching the session store', () => {
    const harness = mintSessions()
    try {
      const authorizer = new RbacAuthorizer({ sessions: harness.sessions, authDisabled: true, policy: null })
      const principal = authorizer.resolvePrincipal(requestWithNothing())
      expect(principal.kind).toBe('auth-disabled')
      expect(principal.user?.systemRole).toBe('admin')
      expect(authorizer.checkRequest(requestWithNothing(), 'settings.update').allowed).toBe(true)
    } finally {
      harness.close()
    }
  })
})

describe('fail-closed identity (contract L: unresolved identity is denied)', () => {
  it('answers an absent credential with the anonymous principal and refusals', () => {
    const harness = mintSessions()
    try {
      const authorizer = new RbacAuthorizer({ sessions: harness.sessions, policy: null })
      const principal = authorizer.resolvePrincipal(requestWithNothing())
      expect(principal.kind).toBe('anonymous')
      expect(authorizer.authorize(principal, 'session:list')).toBe(false)
      expect(authorizer.authorizeResource(principal, 'tool', 'schedule_list')).toBe(false)
      const verdict = authorizer.checkRequest(requestWithNothing(), 'session.list')
      expect(verdict.allowed).toBe(false)
      expect(verdict.status).toBe(403)
      const denied = JSON.parse(verdict.body) as { error: { code: string; message: string } }
      expect(denied.error.code).toBe('permission_denied')
      expect(denied.error.message).toContain('session:list')
    } finally {
      harness.close()
    }
  })

  it('fails closed on a garbage token instead of surfacing the typed session error', () => {
    const harness = mintSessions()
    try {
      const authorizer = new RbacAuthorizer({ sessions: harness.sessions, policy: null })
      expect(authorizer.resolvePrincipal(requestWithCookie('not-a-real-session')).kind).toBe('anonymous')
    } finally {
      harness.close()
    }
  })

  it('keeps the typed session error available for callers that want it (parity with the gate)', () => {
    const store = new SqliteAccountStore({ path: ':memory:', env: {} })
    try {
      expect(() => new SessionService({ store }).validateSession('not-a-real-session')).toThrow(SessionValidationError)
    } finally {
      store.close()
    }
  })

  it('fails closed for an unknown role (contract L)', () => {
    const harness = mintSessions()
    try {
      const authorizer = new RbacAuthorizer({ sessions: harness.sessions, policy: null })
      const ghost = {
        kind: 'session',
        user: { id: 'x', email: 'x@example.com', systemRole: 'root', needsSetup: false, oauthProvider: null, oauthId: null, sessionVersion: 1, createdAt: 0, updatedAt: 0 },
        session: null,
      } as unknown as Parameters<typeof authorizer.authorize>[0]
      expect(authorizer.authorize(ghost, 'session:list')).toBe(false)
      expect(authorizer.authorizeResource(ghost, 'tool', 'schedule_list')).toBe(false)
    } finally {
      harness.close()
    }
  })
})

describe('contract L decision matrix over /api route permissions', () => {
  it('default matrix: admin passes everything, user passes the baseline only', () => {
    const harness = mintSessions()
    try {
      const authorizer = new RbacAuthorizer({ sessions: harness.sessions, policy: null })
      const admin = authorizer.resolvePrincipal(requestWithCookie(harness.adminToken))
      const user = authorizer.resolvePrincipal(requestWithCookie(harness.userToken))
      for (const permission of ['session:list', 'settings:update', 'anything:at-all']) {
        expect(authorizer.authorize(admin, permission)).toBe(true)
      }
      expect(authorizer.authorize(user, 'session:list')).toBe(true)
      expect(authorizer.authorize(user, 'session:create')).toBe(true)
      expect(authorizer.authorize(user, 'settings:update')).toBe(false)
      expect(authorizer.authorize(user, 'credentials:write')).toBe(false)
    } finally {
      harness.close()
    }
  })

  it('deny always wins: a policy deny removes a baseline-allowed permission from the user', () => {
    const harness = mintSessions()
    try {
      const authorizer = new RbacAuthorizer({ sessions: harness.sessions, policy: denyUserRoutes })
      const user = authorizer.resolvePrincipal(requestWithCookie(harness.userToken))
      expect(authorizer.authorize(user, 'session:list')).toBe(false)
      expect(authorizer.authorize(user, 'settings:update')).toBe(false)
    } finally {
      harness.close()
    }
  })

  it('a policy allow lifts a baseline denial for the user', () => {
    const harness = mintSessions()
    try {
      const authorizer = new RbacAuthorizer({ sessions: harness.sessions, policy: denyUserRoutes })
      const user = authorizer.resolvePrincipal(requestWithCookie(harness.userToken))
      expect(authorizer.authorize(user, 'credentials:write')).toBe(true)
    } finally {
      harness.close()
    }
  })

  it('an explicit admin deny binds the admin too (deny wins, no role exemption)', () => {
    const harness = mintSessions()
    try {
      const authorizer = new RbacAuthorizer({ sessions: harness.sessions, policy: denyAdminRoutes })
      const admin = authorizer.resolvePrincipal(requestWithCookie(harness.adminToken))
      expect(authorizer.authorize(admin, 'session:list')).toBe(false)
      expect(authorizer.authorize(admin, 'settings:update')).toBe(true)
    } finally {
      harness.close()
    }
  })

  it('resource decisions share the policy: user loses schedule_create, admin keeps it', () => {
    const harness = mintSessions()
    try {
      const authorizer = new RbacAuthorizer({ sessions: harness.sessions, policy: denyUserRoutes })
      const admin = authorizer.resolvePrincipal(requestWithCookie(harness.adminToken))
      const user = authorizer.resolvePrincipal(requestWithCookie(harness.userToken))
      expect(authorizer.authorizeResource(user, 'tool', 'schedule_create')).toBe(false)
      expect(authorizer.authorizeResource(user, 'tool', 'schedule_list')).toBe(true)
      expect(authorizer.authorizeResource(admin, 'tool', 'schedule_create')).toBe(true)
      expect(authorizer.authorizeResource(user, 'tool', 'other_tool')).toBe(true)
    } finally {
      harness.close()
    }
  })

  it('resource decisions with no policy keep S3 parity for resolved identities', () => {
    const harness = mintSessions()
    try {
      const authorizer = new RbacAuthorizer({ sessions: harness.sessions, policy: null })
      const user = authorizer.resolvePrincipal(requestWithCookie(harness.userToken))
      expect(authorizer.authorizeResource(user, 'tool', 'schedule_create')).toBe(true)
    } finally {
      harness.close()
    }
  })
})

describe('checkRequest: the verdict the transport answers with', () => {
  it('answers allowed verdicts with the principal attached', () => {
    const harness = mintSessions()
    try {
      const authorizer = new RbacAuthorizer({ sessions: harness.sessions, policy: null })
      const verdict = authorizer.checkRequest(requestWithCookie(harness.adminToken), 'session.list')
      expect(verdict).toMatchObject({ allowed: true, status: 200, body: '' })
      expect(verdict.principal.kind).toBe('session')
    } finally {
      harness.close()
    }
  })

  it('maps the endpoint through the route permission before judging', () => {
    const harness = mintSessions()
    try {
      const authorizer = new RbacAuthorizer({ sessions: harness.sessions, policy: null })
      expect(authorizer.checkRequest(requestWithCookie(harness.userToken), 'settings.update').allowed).toBe(false)
      expect(authorizer.checkRequest(requestWithCookie(harness.userToken), 'health').allowed).toBe(false)
      expect(authorizer.checkRequest(requestWithCookie(harness.adminToken), 'health').allowed).toBe(true)
    } finally {
      harness.close()
    }
  })

  it('resolves the Bearer fallback like the gate does (contract D parity)', () => {
    const harness = mintSessions()
    try {
      const authorizer = new RbacAuthorizer({ sessions: harness.sessions, policy: null })
      const verdict = authorizer.checkRequest(requestWithBearer(harness.adminToken), 'settings.update')
      expect(verdict.allowed).toBe(true)
      expect(verdict.principal.user?.systemRole).toBe('admin')
    } finally {
      harness.close()
    }
  })

  it('prefers the cookie over the Bearer header when both ride one request', () => {
    const harness = mintSessions()
    try {
      const authorizer = new RbacAuthorizer({ sessions: harness.sessions, policy: null })
      const request = {
        headers: { cookie: 'access_token=' + harness.userToken, authorization: 'Bearer ' + harness.adminToken },
      } as unknown as IncomingMessage
      expect(authorizer.resolvePrincipal(request).user?.systemRole).toBe('user')
    } finally {
      harness.close()
    }
  })

  it('treats a malformed Authorization header and an empty cookie value as no credential', () => {
    const harness = mintSessions()
    try {
      const authorizer = new RbacAuthorizer({ sessions: harness.sessions, policy: null })
      const malformed = { headers: { authorization: 'basic abc' } } as unknown as IncomingMessage
      expect(authorizer.resolvePrincipal(malformed).kind).toBe('anonymous')
      const junkPair = { headers: { cookie: 'junk-no-equals; other=1' } } as unknown as IncomingMessage
      expect(authorizer.resolvePrincipal(junkPair).kind).toBe('anonymous')
      const emptyValue = { headers: { cookie: 'access_token=' } } as unknown as IncomingMessage
      expect(authorizer.resolvePrincipal(emptyValue).kind).toBe('anonymous')
      const emptyBearer = { headers: { authorization: 'Bearer ' } } as unknown as IncomingMessage
      expect(authorizer.resolvePrincipal(emptyBearer).kind).toBe('anonymous')
    } finally {
      harness.close()
    }
  })

  it('answers refused verdicts with 403 and the legacy error envelope', () => {
    const harness = mintSessions()
    try {
      const authorizer = new RbacAuthorizer({ sessions: harness.sessions, policy: denyUserRoutes })
      const verdict = authorizer.checkRequest(requestWithCookie(harness.userToken), 'session.list')
      expect(verdict.allowed).toBe(false)
      expect(verdict.status).toBe(403)
      expect((JSON.parse(verdict.body) as { error: { code: string } }).error.code).toBe('permission_denied')
    } finally {
      harness.close()
    }
  })

  it('treats an empty endpoint as nothing to authorize (the dispatch 404s it anyway)', () => {
    const harness = mintSessions()
    try {
      const authorizer = new RbacAuthorizer({ sessions: harness.sessions, policy: denyUserRoutes })
      const verdict = authorizer.checkRequest(requestWithCookie(harness.userToken), '')
      expect(verdict.allowed).toBe(true)
    } finally {
      harness.close()
    }
  })

  it('keeps the anonymous principal factory aligned with the authorizer refusals', () => {
    expect(anonymousPrincipal().kind).toBe('anonymous')
  })
})

describe('Identity and store faults propagate (never degrade to 403)', () => {
  it('propagates a corrupt session row as a thrown fault instead of an anonymous 403', () => {
    const harness = mintSessions()
    try {
      const corrupt = new SessionCorruptError('user_id holds null')
      const sessions = { validateSession: () => { throw corrupt } } as unknown as SessionService
      const authorizer = new RbacAuthorizer({ sessions, policy: null })
      expect(() => authorizer.checkRequest(requestWithCookie(harness.userToken), 'session.list')).toThrow(corrupt)
    } finally {
      harness.close()
    }
  })

  it('propagates an unknown store fault the same way', () => {
    const sessions = { validateSession: () => { throw new Error('disk unavailable') } } as unknown as SessionService
    const authorizer = new RbacAuthorizer({ sessions, policy: null })
    expect(() => authorizer.checkRequest(requestWithCookie('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 'session.list'))
      .toThrow('disk unavailable')
  })

  it('still folds client-side validation failures into the anonymous refusal', () => {
    const sessions = { validateSession: () => { throw new SessionValidationError('EXPIRED') } } as unknown as SessionService
    const authorizer = new RbacAuthorizer({ sessions, policy: null })
    const verdict = authorizer.checkRequest(requestWithCookie('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 'session.list')
    expect(verdict.principal.kind).toBe('anonymous')
    expect(verdict.status).toBe(403)
  })

  it('refuses malformed permission input at the boundary instead of matching it', () => {
    const harness = mintSessions()
    try {
      const authorizer = new RbacAuthorizer({ sessions: harness.sessions, policy: null })
      const admin = authorizer.resolvePrincipal(requestWithCookie(harness.adminToken))
      const garbage: unknown[] = ['', 'abc', 'a:b:c', ':action', 'resource:', 'a b:c', 42, null, undefined, {}]
      for (const raw of garbage) expect(authorizer.authorize(admin, raw as string)).toBe(false)
    } finally {
      harness.close()
    }
  })

  it('refuses malformed resource names at the resource boundary', () => {
    const harness = mintSessions()
    try {
      const authorizer = new RbacAuthorizer({ sessions: harness.sessions, policy: null })
      const admin = authorizer.resolvePrincipal(requestWithCookie(harness.adminToken))
      const names: unknown[] = ['', 'a:b', 42, null, undefined, {}]
      for (const name of names) expect(authorizer.authorizeResource(admin, 'tool', name as string)).toBe(false)
      // The legal name stays admitted for the admin.
      expect(authorizer.authorizeResource(admin, 'tool', 'schedule_create')).toBe(true)
    } finally {
      harness.close()
    }
  })

  it('refuses unknown resource kinds at the resource boundary', () => {
    const harness = mintSessions()
    try {
      const policy = validatePolicyDocument({ version: 1, roles: { admin: { tool: { allow: ['safe'] } } } })
      const kinds: unknown[] = ['not-a-resource-kind', 42, null, undefined, {}, []]
      for (const selectedPolicy of [null, policy]) {
        const authorizer = new RbacAuthorizer({ sessions: harness.sessions, policy: selectedPolicy })
        const admin = authorizer.resolvePrincipal(requestWithCookie(harness.adminToken))
        for (const kind of kinds) {
          expect(authorizer.authorizeResource(admin, kind as ResourceKind, 'arbitrary')).toBe(false)
        }
      }
    } finally {
      harness.close()
    }
  })
})
