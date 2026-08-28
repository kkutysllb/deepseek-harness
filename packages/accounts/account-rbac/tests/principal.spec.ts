import { describe, expect, it } from 'vitest'
import type { SessionUser } from '@qilin/account-auth'
import {
  RBAC_AUTH_DISABLED_USER_EMAIL,
  RBAC_AUTH_DISABLED_USER_ID,
  anonymousPrincipal,
  authDisabledRbacPrincipal,
  principalRole,
  type RbacPrincipal,
} from '../src/principal.ts'

export function sessionPrincipal(role: SessionUser['systemRole'], userId: string): RbacPrincipal {
  return {
    kind: 'session',
    user: {
      id: userId,
      email: userId + '@example.com',
      systemRole: role,
      needsSetup: false,
      oauthProvider: null,
      oauthId: null,
      sessionVersion: 1,
      createdAt: 0,
      updatedAt: 0,
    },
    session: {
      id: 'session-' + userId,
      issuedVersion: 1,
      persistent: false,
      createdAt: 0,
      expiresAt: 10,
    },
  }
}

describe('the anonymous principal (fail-closed identity for unresolvable requests)', () => {
  it('carries no user and no session', () => {
    const principal = anonymousPrincipal()
    expect(principal.kind).toBe('anonymous')
    expect(principal.user).toBeNull()
    expect(principal.session).toBeNull()
    expect(principalRole(principal)).toBeNull()
  })
})

describe('the auth-disabled synthetic admin (contract G valve semantics)', () => {
  it('mirrors the legacy default account with the admin role', () => {
    const principal = authDisabledRbacPrincipal()
    expect(principal.kind).toBe('auth-disabled')
    expect(principal.user?.id).toBe(RBAC_AUTH_DISABLED_USER_ID)
    expect(principal.user?.email).toBe(RBAC_AUTH_DISABLED_USER_EMAIL)
    expect(principal.user?.systemRole).toBe('admin')
    expect(principal.user?.sessionVersion).toBe(0)
    expect(principal.session).toBeNull()
    expect(principalRole(principal)).toBe('admin')
  })

  it('constructs a fresh principal per call', () => {
    expect(authDisabledRbacPrincipal()).not.toBe(authDisabledRbacPrincipal())
  })
})

describe('principalRole', () => {
  it('reads the system role off a resolved session principal', () => {
    expect(principalRole(sessionPrincipal('admin', 'a'))).toBe('admin')
    expect(principalRole(sessionPrincipal('user', 'u'))).toBe('user')
  })
})
