/**
 * Typed session errors. Validation failures carry one of three codes aligned
 * with the legacy gateway's token error classes so a client can tell
 * "sign in again" (expired, revoked) from "fix the request" (malformed).
 * @module @qilin/account-auth/errors
 */

/** Coarse failure classes for one session-validation attempt (contract C). */
export type SessionErrorCode =
  /** The session existed but its absolute expiry has passed. */
  | 'EXPIRED'
  /** The token is well-formed but names no live session (unknown, logged out, or revoked by a version bump). */
  | 'INVALID'
  /** The token cannot be a session identifier at all — garbage cookie, wrong shape, wrong length. */
  | 'MALFORMED'
  /** The owning account is disabled; the session row itself may still be live. */
  | 'DISABLED'

/** Default prose per error code; constructors may override with detail. */
const SESSION_ERROR_MESSAGES: Record<SessionErrorCode, string> = {
  EXPIRED: 'the session token has expired',
  INVALID: 'the session token does not name a live session',
  MALFORMED: 'the session token is not a well-formed session identifier',
  DISABLED: 'the account is disabled',
}

/**
 * A session validation failure carrying its contract-C code. The HTTP layer
 * maps codes to statuses and client copy; this package only classifies.
 */
export class SessionValidationError extends Error {
  /** Which contract-C class the failure belongs to. */
  readonly code: SessionErrorCode

  /**
   * Construct the failure for one code.
   * @param code - the contract-C class.
   * @param message - optional detail overriding the default prose for the code.
   */
  constructor(code: SessionErrorCode, message?: string) {
    super(message ?? SESSION_ERROR_MESSAGES[code])
    this.name = 'SessionValidationError'
    this.code = code
  }
}

/**
 * A durable session (or owning account) row violates the invariants the
 * service reads — a non-positive issued version, non-numeric timestamps, a
 * non-boolean flag. This is a server fault, not a client error: fail loud
 * instead of serving a row whose semantics cannot be trusted.
 */
export class SessionCorruptError extends Error {
  /**
   * Construct the corruption report for one violated invariant.
   * @param detail - what the row held and why it cannot be served.
   */
  constructor(detail: string) {
    super(`corrupt session record: ${detail}`)
    this.name = 'SessionCorruptError'
  }
}
