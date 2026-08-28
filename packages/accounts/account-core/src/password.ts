/**
 * scrypt password hashing with frozen parameters and constant-time
 * verification. The stored encoding embeds its parameters so a future
 * cost increase can migrate hashes row by row without a re-key step;
 * today every fresh hash uses the one frozen parameter set.
 * @module @qilin/account-core/password
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

/** Frozen scrypt cost parameters; every fresh hash uses exactly these values. */
export const SCRYPT_PARAMS = {
  /** CPU/memory cost. */
  N: 16384,
  /** Block size. */
  r: 8,
  /** Parallelization factor. */
  p: 1,
  /** Salt length in bytes. */
  saltLength: 32,
  /** Derived key length in bytes. */
  keyLength: 64,
} as const

/** Algorithm tag prefixing the stored encoding. */
export const SCRYPT_ENCODING_PREFIX = 'scrypt'

/** Generator for the per-hash random salt; defaults to `crypto.randomBytes`. */
export type RandomBytes = (length: number) => Uint8Array

/** Field count of a well-formed stored encoding. */
const ENCODING_FIELDS = 6

/**
 * Hash one password with the frozen scrypt parameters and a fresh random salt.
 * @param password - the plaintext credential; never persisted or logged.
 * @param randomBytes - salt-generation seam (test hook); defaults to `crypto.randomBytes`.
 * @returns the stored encoding `scrypt$N$r$p$<salt-base64>$<hash-base64>`.
 */
export function hashPassword(password: string, randomBytes: RandomBytes = defaultRandomBytes): string {
  const salt = randomBytes(SCRYPT_PARAMS.saltLength)
  const derived = scryptSync(password, salt, SCRYPT_PARAMS.keyLength, scryptOptions())
  return [
    SCRYPT_ENCODING_PREFIX,
    SCRYPT_PARAMS.N,
    SCRYPT_PARAMS.r,
    SCRYPT_PARAMS.p,
    Buffer.from(salt).toString('base64'),
    derived.toString('base64'),
  ].join('$')
}

/**
 * Verify one password against a stored encoding in constant time for equal-length
 * derived keys. Any encoding this module did not produce verifies as false rather
 * than throwing, so corrupt or hostile stored values cannot crash a login path.
 * @param password - the candidate plaintext.
 * @param stored - the encoding returned by `hashPassword`.
 * @returns true only when the candidate hashes to the stored value.
 */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$')
  if (parts.length !== ENCODING_FIELDS) return false
  // The length guard above proves all six fields exist; the tuple view only
  // teaches that to the compiler under noUncheckedIndexedAccess.
  const [prefix, rawN, rawR, rawP, rawSalt, rawHash] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ]
  if (prefix !== SCRYPT_ENCODING_PREFIX) return false
  const N = Number(rawN)
  const r = Number(rawR)
  const p = Number(rawP)
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false
  if (N < 2 || r < 1 || p < 1) return false
  // The Node base64 decoder is lenient and never throws, so hostile stored
  // text degrades to mismatching bytes rather than an exception path.
  const salt = Buffer.from(rawSalt, 'base64')
  const expected = Buffer.from(rawHash, 'base64')
  if (expected.length === 0) return false
  const derived = scryptSync(password, salt, expected.length, { N, r, p, maxmem: maxMemory(N, r, p) })
  return derived.length === expected.length && timingSafeEqual(derived, expected)
}

/** The frozen scrypt options passed to the driver. */
function scryptOptions(): { N: number; r: number; p: number; maxmem: number } {
  return {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
    maxmem: maxMemory(SCRYPT_PARAMS.N, SCRYPT_PARAMS.r, SCRYPT_PARAMS.p),
  }
}

/** Headroom above the `128 * r * N` working memory so the driver never refuses the cost. */
function maxMemory(N: number, r: number, p: number): number {
  return 128 * r * N * p + 32 * 1024 * 1024
}

function defaultRandomBytes(length: number): Uint8Array {
  return randomBytes(length)
}
