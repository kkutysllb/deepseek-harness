/**
 * Typed account-domain errors. Storage implementations translate SQLite
 * uniqueness failures into these so callers never inspect driver details.
 * @module @qilin/account-core/errors
 */

import type { AccountConflictKind } from './types.ts'

/**
 * An account write violated the email or OAuth-identity uniqueness constraint.
 * @remarks the driver error's message is carried as the cause; it names the
 * exact table and column and never contains secret material.
 */
export class AccountConflictError extends Error {
  /** Which uniqueness constraint rejected the write. */
  readonly kind: AccountConflictKind

  /**
   * Construct the conflict for one constraint kind.
   * @param kind - the violated uniqueness constraint.
   * @param cause - the underlying driver error, preserved for diagnostics.
   */
  constructor(kind: AccountConflictKind, cause?: unknown) {
    const subject = kind === 'email' ? 'email address' : 'OAuth identity'
    super(`an account with this ${subject} already exists`, cause === undefined ? undefined : { cause })
    this.name = 'AccountConflictError'
    this.kind = kind
  }
}
