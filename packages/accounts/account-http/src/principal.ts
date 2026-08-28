/**
 * The request principal the HTTP layer resolves and stamps: the live account
 * behind a validated session, or the synthetic admin the auth-disabled escape
 * valve constructs for every request (legacy `get_auth_disabled_user`
 * semantics — same id, email, role, and setup state, with the credential
 * epoch at zero because the synthetic account has none).
 * @module @qilin/account-http/principal
 */

import type { SessionUser } from '@qilin/account-auth'

/** How this request's principal was resolved. */
export type PrincipalKind =
  /** A validated session row and its live account. */
  | 'session'
  /** The auth-disabled escape valve: no credential existed; the chain is transparent. */
  | 'auth-disabled'

/** The resolved identity of one request. */
export interface Principal {
  /** Which channel resolved the identity. */
  readonly kind: PrincipalKind
  /** The account behind the request, password hash stripped. */
  readonly user: SessionUser
}

/** Stable id of the synthetic auth-disabled account (the legacy default user). */
export const AUTH_DISABLED_USER_ID = 'default'

/** Stable email of the synthetic auth-disabled account. */
export const AUTH_DISABLED_USER_EMAIL = 'default@test.local'

/**
 * Construct the synthetic admin the escape valve stamps onto every request.
 * Fresh per call: handlers may mutate their copy in principle, and the
 * synthetic account is not backed by any store row — so it is never disabled
 * and the disabled-surface field reads as null.
 * @returns the synthetic principal.
 */
export function authDisabledPrincipal(): Principal {
  return {
    kind: 'auth-disabled',
    user: {
      id: AUTH_DISABLED_USER_ID,
      email: AUTH_DISABLED_USER_EMAIL,
      systemRole: 'admin',
      needsSetup: false,
      oauthProvider: null,
      oauthId: null,
      sessionVersion: 0,
      createdAt: 0,
      updatedAt: 0,
      disabledAt: null,
    },
  }
}
