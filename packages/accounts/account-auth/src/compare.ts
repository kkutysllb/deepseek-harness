/**
 * Constant-time secret comparison. Both sides are digested to fixed-length
 * SHA-256 values before the platform comparator runs, so the call never
 * branches on content or length and unequal-length inputs compare instead
 * of throwing.
 * @module @qilin/account-auth/compare
 */

import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Compare two strings in constant time for equal input lengths. Digesting to
 * fixed 32-byte values normalizes length before the comparator, closing the
 * early-exit side channel a raw comparator would open on unequal lengths.
 * @param a - first value.
 * @param b - second value.
 * @returns true only when the values are byte-identical.
 */
export function timingSafeStringEquals(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b))
}

/** Digest one value to the fixed-width bytes the comparator consumes. */
function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}
