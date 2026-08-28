/**
 * Session lifecycle over the account store: issue on successful login
 * (ephemeral or persistent tier), validate an opaque session token with a
 * format gate, constant-time token match, absolute-expiry judgment, and the
 * issued-version vs account-version comparison, then revoke — single logout
 * or account-wide kill. Revocation is dual-channel (contract B): deleting a
 * row revokes immediately, and bumping the account's session version
 * (password change) invalidates every session issued from an earlier value.
 * No HTTP surface lives here; the route layer owns cookies and statuses.
 * @module @qilin/account-auth/session-service
 */

import { type AccountStore, type Session, type User } from '@qilin/account-core'
import { defaultRandomToken, mintCsrfToken, type RandomToken } from './csrf.ts'
import { timingSafeStringEquals } from './compare.ts'
import { SessionCorruptError, SessionValidationError } from './errors.ts'

/**
 * Default session lifetime, both tiers (legacy contract A: one 7-day token
 * expiry; the persistent tier historically differed only in cookie lifetime).
 */
export const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * The exact shape of an issued session identifier: a canonical lowercase
 * UUID, because the store mints ids with `crypto.randomUUID`. Any other
 * cookie value is rejected before storage is consulted (contract H).
 */
export const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** An account as exposed past validation: everything except the password hash. */
export type SessionUser = Omit<User, 'passwordHash'>

/** Construction seams; the store is the only required field. */
export interface SessionServiceOptions {
  /** Durable account and session storage backing every operation. */
  readonly store: AccountStore
  /** Clock seam returning epoch milliseconds; defaults to `Date.now`. */
  readonly now?: () => number
  /** Ephemeral-tier lifetime in milliseconds; defaults to {@link DEFAULT_SESSION_TTL_MS}. */
  readonly sessionTtlMs?: number
  /** Persistent-tier lifetime in milliseconds; defaults to {@link DEFAULT_SESSION_TTL_MS}. */
  readonly persistentTtlMs?: number
  /** Randomness seam for minted CSRF tokens; defaults to `crypto.randomBytes`. */
  readonly randomToken?: RandomToken
}

/** Input for issuing one session after a successful login. */
export interface IssueSessionInput {
  /** Owning account; must exist. */
  readonly userId: string
  /** Remember-me tier: `true` outlives a browser close under the caller's cookie policy. */
  readonly persistent: boolean
}

/** One issued session plus everything the login response needs. */
export interface IssuedSession {
  /** The durable session row (opaque id, absolute expiry, tier flag). */
  readonly session: Session
  /** The owning account without its password hash. */
  readonly user: SessionUser
  /** The double-submit CSRF token minted for this session; the server never stores it. */
  readonly csrfToken: string
}

/** One validated session: the row plus its owning account, secrets stripped. */
export interface AuthenticatedSession {
  /** The durable session row. */
  readonly session: Session
  /** The owning account without its password hash. */
  readonly user: SessionUser
}

/**
 * Issue, validate, and revoke account sessions against one store. Every
 * validation reads the durable row through invariants guards: a row that
 * violates what the service relies on (positive issued version, numeric
 * timestamps, boolean flag, live owner) fails loud as a typed server fault
 * instead of flowing onward.
 */
export class SessionService {
  private readonly store: AccountStore
  private readonly now: () => number
  private readonly sessionTtlMs: number
  private readonly persistentTtlMs: number
  private readonly randomToken: RandomToken

  /**
   * Construct the service over one store.
   * @param options - store, clock, lifetime, and randomness seams.
   * @throws when a configured lifetime is not a positive integer.
   */
  constructor(options: SessionServiceOptions) {
    this.store = options.store
    this.now = options.now ?? Date.now
    this.sessionTtlMs = checkedTtl(options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS, 'sessionTtlMs')
    this.persistentTtlMs = checkedTtl(options.persistentTtlMs ?? DEFAULT_SESSION_TTL_MS, 'persistentTtlMs')
    this.randomToken = options.randomToken ?? defaultRandomToken
  }

  /**
   * Issue one session for a successful login: snapshot the account's current
   * session version, stamp an absolute expiry from the tier's lifetime, and
   * mint the session's CSRF token.
   * @param input - the owning account and the tier.
   * @returns the session, the account (hash stripped), and the CSRF token.
   * @throws when the account does not exist or its row is corrupt.
   */
  issueSession(input: IssueSessionInput): IssuedSession {
    const user = this.store.findUserById(input.userId)
    if (user === undefined) throw new Error(`account "${input.userId}" does not exist`, { cause: 'issueSession' })
    guardAccountRow(user)
    if (user.disabledAt !== null) throw new SessionValidationError('DISABLED')
    const ttl = input.persistent ? this.persistentTtlMs : this.sessionTtlMs
    const session = this.store.insertSession({
      userId: input.userId,
      issuedVersion: user.sessionVersion,
      persistent: input.persistent,
      expiresAt: this.now() + ttl,
    })
    return { session, user: projectUser(user), csrfToken: mintCsrfToken(this.randomToken) }
  }

  /**
   * Validate one presented opaque token. Order of judgment: format gate
   * (MALFORMED — garbage never reaches storage, contract H), storage lookup
   * and constant-time token match (INVALID), row invariants (typed server
   * fault), absolute expiry (EXPIRED), then issued-version vs account
   * session-version comparison (INVALID — the contract-B kill channel).
   * @param rawToken - the opaque token exactly as the client presented it.
   * @returns the live session and its account, password hash stripped.
   * @throws {SessionValidationError} with the contract-C code for the failure.
   * @throws {SessionCorruptError} when the durable rows violate their invariants.
   */
  validateSession(rawToken: string): AuthenticatedSession {
    const token = normalizeSessionToken(rawToken)
    const session = this.store.findSession(token)
    if (session === undefined) throw new SessionValidationError('INVALID')
    guardSessionRow(session)
    if (!timingSafeStringEquals(token, session.id)) throw new SessionValidationError('INVALID')
    if (this.now() >= session.expiresAt) throw new SessionValidationError('EXPIRED')
    const user = this.store.findUserById(session.userId)
    if (user === undefined) {
      throw new SessionCorruptError(`session "${session.id}" references missing account "${session.userId}"`)
    }
    guardAccountRow(user)
    if (user.disabledAt !== null) throw new SessionValidationError('DISABLED')
    if (session.issuedVersion !== user.sessionVersion) {
      throw new SessionValidationError(
        'INVALID',
        `the session was issued under version ${session.issuedVersion} but the account is at version ${user.sessionVersion}`,
      )
    }
    return { session, user: projectUser(user) }
  }

  /**
   * Revoke one session (logout). Idempotent: revoking an unknown, already
   * deleted, or malformed token deletes nothing and succeeds.
   * @param rawToken - the presented token; malformed shapes are no-ops.
   */
  revokeSession(rawToken: string): void {
    if (!SESSION_ID_PATTERN.test(rawToken.toLowerCase())) return
    this.store.deleteSession(rawToken.toLowerCase())
  }

  /**
   * Revoke every session owned by one account (admin kick, or the deletion
   * half of a password change). Idempotent; unknown accounts revoke nothing.
   * @param userId - the owning account.
   */
  revokeAllForUser(userId: string): void {
    this.store.deleteSessionsForUser(userId)
  }

  /**
   * Store a new password hash and kill every existing session (contract B):
   * the store bumps the account's session version — invalidating any session
   * issued from an earlier value even if its row survives — and the service
   * then deletes the account's rows outright. The version bump first means a
   * crash between the two steps still leaves every old session dead.
   * @param userId - the account changing its credential.
   * @param passwordHash - the fresh scrypt encoding from `hashPassword`.
   * @returns the updated account, password hash stripped.
   * @throws when the account does not exist.
   */
  changePassword(userId: string, passwordHash: string): SessionUser {
    const updated = this.store.updatePassword(userId, passwordHash)
    this.store.deleteSessionsForUser(userId)
    return projectUser(updated)
  }
}

/**
 * Project one account for exposure past validation: everything except the
 * password hash.
 * @param user - the durable account row.
 * @returns the account without `passwordHash`.
 */
export function projectUser(user: User): SessionUser {
  return {
    id: user.id,
    email: user.email,
    systemRole: user.systemRole,
    needsSetup: user.needsSetup,
    oauthProvider: user.oauthProvider,
    oauthId: user.oauthId,
    sessionVersion: user.sessionVersion,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    disabledAt: user.disabledAt,
  }
}

/**
 * Normalize one presented token and enforce the identifier shape. Lowercasing
 * makes the hex compare case-insensitive for ids this deployment issued; the
 * pattern gate guarantees a fixed length before any comparison, so the
 * constant-time path never sees ragged input (contract H: a garbage cookie
 * value is never treated as a session).
 * @param rawToken - the presented token.
 * @returns the normalized token.
 * @throws {SessionValidationError} with code MALFORMED for any non-identifier shape.
 */
function normalizeSessionToken(rawToken: string): string {
  const token = rawToken.toLowerCase()
  if (!SESSION_ID_PATTERN.test(token)) throw new SessionValidationError('MALFORMED')
  return token
}

/** Guard the session-row invariants validation relies on; the store does not re-read these columns. */
function guardSessionRow(session: Session): void {
  if (typeof session.userId !== 'string' || session.userId === '') {
    throw new SessionCorruptError(`user_id holds ${JSON.stringify(session.userId)}`)
  }
  if (!Number.isInteger(session.issuedVersion) || session.issuedVersion < 1) {
    throw new SessionCorruptError(`issued_version holds ${JSON.stringify(session.issuedVersion)}`)
  }
  if (typeof session.persistent !== 'boolean') {
    throw new SessionCorruptError(`persistent holds ${JSON.stringify(session.persistent)}`)
  }
  if (!Number.isFinite(session.createdAt) || !Number.isFinite(session.expiresAt)) {
    throw new SessionCorruptError(`timestamps hold ${JSON.stringify(session.createdAt)} / ${JSON.stringify(session.expiresAt)}`)
  }
  if (session.expiresAt <= session.createdAt) {
    throw new SessionCorruptError(`expires_at ${session.expiresAt} does not exceed created_at ${session.createdAt}`)
  }
}

/** Guard the account invariant validation relies on: a positive integer credential epoch. */
function guardAccountRow(user: User): void {
  if (!Number.isInteger(user.sessionVersion) || user.sessionVersion < 1) {
    throw new SessionCorruptError(`session_version holds ${JSON.stringify(user.sessionVersion)}`)
  }
}

/** Reject a non-positive-integer lifetime at construction instead of issuing dead sessions. */
function checkedTtl(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer number of milliseconds`)
  return value
}
