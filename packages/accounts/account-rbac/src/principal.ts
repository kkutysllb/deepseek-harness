/**
 * The request Principal (contract M): the account projection, the system
 * role read off it, and the live session metadata, in one immutable value
 * the whole request shares. Three kinds exist - a resolved session, the
 * auth-disabled valve's synthetic admin, and the fail-closed anonymous
 * identity every unresolved request gets.
 * @module @qilin/account-rbac/principal
 */

import type { SessionUser } from '@qilin/account-auth'

/** How this request's principal was resolved. */
export type RbacPrincipalKind =
  /** A validated session row and its live account. */
  | 'session'
  /** The auth-disabled escape valve: no credential was consulted. */
  | 'auth-disabled'
  /** Unresolvable or absent credential; every RBAC judgment refuses it. */
  | 'anonymous'

/** The session facts a principal carries alongside the account. */
export interface PrincipalSessionMetadata {
  /** Opaque session identifier (the token exactly as issued). */
  readonly id: string
  /** The account's session version at issuance. */
  readonly issuedVersion: number
  /** Whether the session outlives a browser close. */
  readonly persistent: boolean
  /** Creation time as epoch milliseconds (UTC). */
  readonly createdAt: number
  /** Absolute expiry as epoch milliseconds (UTC). */
  readonly expiresAt: number
}

/** The resolved identity of one request. */
export interface RbacPrincipal {
  /** Which channel resolved the identity. */
  readonly kind: RbacPrincipalKind
  /** The account behind the request, password hash stripped; null only for anonymous. */
  readonly user: SessionUser | null
  /** The live session's metadata; null for anonymous and the valve principal. */
  readonly session: PrincipalSessionMetadata | null
}

/** Stable id of the synthetic auth-disabled account (the legacy default user; the wire-level twin of the account-http constant). */
export const RBAC_AUTH_DISABLED_USER_ID = 'default'

/** Stable email of the synthetic auth-disabled account. */
export const RBAC_AUTH_DISABLED_USER_EMAIL = 'default@test.local'

/**
 * The system role a principal resolves to, or null when the identity is
 * unresolved (the fail-closed case every judgment refuses).
 * @param principal - the request principal.
 * @returns the system role, or null for the anonymous principal.
 */
export function principalRole(principal: RbacPrincipal): SessionUser['systemRole'] | null {
  return principal.user?.systemRole ?? null
}

/**
 * Construct the fail-closed anonymous principal for an unresolvable
 * request: no user, no session, no role - every permission judgment
 * refuses it.
 * @returns the anonymous principal.
 */
export function anonymousPrincipal(): RbacPrincipal {
  return { kind: 'anonymous', user: null, session: null }
}

/**
 * Construct the synthetic admin the auth-disabled valve stamps onto every
 * request - the legacy default account, never backed by a store row.
 * Fresh per call so consumers cannot share mutable state.
 * @returns the valve principal.
 */
export function authDisabledRbacPrincipal(): RbacPrincipal {
  return {
    kind: 'auth-disabled',
    user: {
      id: RBAC_AUTH_DISABLED_USER_ID,
      email: RBAC_AUTH_DISABLED_USER_EMAIL,
      systemRole: 'admin',
      needsSetup: false,
      oauthProvider: null,
      oauthId: null,
      sessionVersion: 0,
      createdAt: 0,
      updatedAt: 0,
    },
    session: null,
  }
}
