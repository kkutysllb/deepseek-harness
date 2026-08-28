/**
 * CSRF double-submit decisions as pure functions: one token per session at
 * issuance, a constant-time cookie-vs-header comparator, the RFC 7231 method
 * matrix, the Bearer-auth exemption, and a caller-supplied path exemption
 * list. No HTTP surface lives here; the route layer reads the facts off the
 * request and calls {@link evaluateCsrfRequest}.
 * @module @qilin/account-auth/csrf
 */

import { randomBytes } from 'node:crypto'
import { timingSafeStringEquals } from './compare.ts'

/** Cookie carrying the double-submit token (legacy gateway name). */
export const CSRF_COOKIE_NAME = 'csrf_token'

/** Header carrying the double-submit token (legacy gateway name). */
export const CSRF_HEADER_NAME = 'X-CSRF-Token'

/** Entropy of one minted token, in bytes (rendered as 64 hex characters). */
export const CSRF_TOKEN_BYTES = 32

/** Methods the RFC classifies safe; they never mutate and skip CSRF. */
export const CSRF_SAFE_METHODS: readonly string[] = ['GET', 'HEAD', 'OPTIONS', 'TRACE']

/** The legacy contract's state-changing methods; they always require CSRF. */
export const CSRF_WRITE_METHODS: readonly string[] = ['POST', 'PUT', 'DELETE', 'PATCH']

const SAFE_METHOD_SET = new Set(CSRF_SAFE_METHODS)

/** Generator for minted tokens; defaults to `crypto.randomBytes`. */
export type RandomToken = (length: number) => Uint8Array

/**
 * Mint one double-submit token: 32 random bytes as 64 lowercase hex
 * characters. One token per session issuance; the server never stores it.
 * @param randomToken - randomness seam (test hook); defaults to `crypto.randomBytes`.
 * @returns the token to hand to the client (cookie value and header echo).
 */
export function mintCsrfToken(randomToken: RandomToken = defaultRandomToken): string {
  return Buffer.from(randomToken(CSRF_TOKEN_BYTES)).toString('hex')
}

/**
 * Whether one request method lands in the CSRF matrix. RFC-safe methods skip;
 * the legacy write methods force the check; any method outside both lists is
 * treated as state-changing (fail-closed, deny-wins heritage).
 * @param method - the request method as received.
 * @returns true when the request must pass the double-submit check.
 */
export function requiresCsrfCheck(method: string): boolean {
  return !SAFE_METHOD_SET.has(method.toUpperCase())
}

/**
 * The pure double-submit comparator: both tokens must be present and
 * byte-identical, compared through a constant-time path.
 * @param cookieToken - the token from the CSRF cookie.
 * @param headerToken - the token from the CSRF header.
 * @returns true only when both values are present and equal.
 */
export function verifyCsrfTokens(cookieToken: string | undefined, headerToken: string | undefined): boolean {
  if (!cookieToken || !headerToken) return false
  return timingSafeStringEquals(cookieToken, headerToken)
}

/** What the route layer reports about one request, read off the wire. */
export interface CsrfRequestFacts {
  /** Request method as received (case-insensitive here). */
  readonly method: string
  /** Request path, when the caller wants path exemptions applied. */
  readonly path?: string
  /** True when the request authenticated via an explicitly presented Bearer token (no ambient cookie credential). */
  readonly bearerAuthenticated?: boolean
  /** The CSRF cookie value, when present. */
  readonly cookieToken?: string
  /** The CSRF header value, when present. */
  readonly headerToken?: string
  /** True when the auth-disabled escape valve has already resolved this chain to pass-through. */
  readonly authDisabled?: boolean
}

/**
 * Caller-configured path exemptions (legacy gateway shape): exact matches are
 * trailing-slash-insensitive; prefixes match the raw path head. Defaults to
 * no exemptions — every write request carries the check.
 */
export interface CsrfExemptions {
  /** Paths exempt by exact match after trailing-slash normalization. */
  readonly exactPaths?: readonly string[]
  /** Path heads exempt by prefix match; empty strings are ignored. */
  readonly pathPrefixes?: readonly string[]
}

/** Why a request skipped the double-submit check entirely. */
export type CsrfSkipReason =
  /** RFC-safe method. */
  | 'safe-method'
  /** The auth-disabled escape valve resolved the chain to pass-through. */
  | 'auth-disabled'
  /** The path matched the caller's exemption list. */
  | 'exempt-path'
  /** The request authenticated via an explicit Bearer token — no ambient credential, nothing for CSRF to ride. */
  | 'bearer-auth'

/** Why the double-submit check rejected a write request. */
export type CsrfRejectReason =
  /** Cookie or header token absent (legacy "CSRF token missing" case). */
  | 'missing-token'
  /** Both present but not byte-identical (legacy "CSRF token mismatch" case). */
  | 'token-mismatch'

/** The verdict for one request: skip entirely, pass the check, or reject with its reason. */
export type CsrfDecision =
  | { readonly outcome: 'skip'; readonly reason: CsrfSkipReason }
  | { readonly outcome: 'pass' }
  | { readonly outcome: 'reject'; readonly reason: CsrfRejectReason }

/**
 * Decide one request against the CSRF matrix: safe methods skip; an
 * auth-disabled chain skips; exempt paths skip; Bearer-authenticated
 * requests skip (D2 fallback channel); everything else must present the
 * double-submit pair, compared in constant time.
 * @param facts - what the route layer read off the request.
 * @param exemptions - the caller's explicit path exemption list; defaults to none.
 * @returns the verdict with its reason when it is not a plain pass.
 */
export function evaluateCsrfRequest(facts: CsrfRequestFacts, exemptions: CsrfExemptions = {}): CsrfDecision {
  if (!requiresCsrfCheck(facts.method)) return { outcome: 'skip', reason: 'safe-method' }
  if (facts.authDisabled === true) return { outcome: 'skip', reason: 'auth-disabled' }
  if (facts.path !== undefined && isExemptPath(facts.path, exemptions)) return { outcome: 'skip', reason: 'exempt-path' }
  if (facts.bearerAuthenticated === true) return { outcome: 'skip', reason: 'bearer-auth' }
  if (!facts.cookieToken || !facts.headerToken) return { outcome: 'reject', reason: 'missing-token' }
  return verifyCsrfTokens(facts.cookieToken, facts.headerToken)
    ? { outcome: 'pass' }
    : { outcome: 'reject', reason: 'token-mismatch' }
}

/** Trailing-slash-insensitive exact match, then raw-head prefix match (legacy webhook style). */
function isExemptPath(path: string, exemptions: CsrfExemptions): boolean {
  const normalized = stripTrailingSlashes(path)
  const exact = exemptions.exactPaths?.some(candidate => stripTrailingSlashes(candidate) === normalized) ?? false
  if (exact) return true
  return exemptions.pathPrefixes?.some(prefix => prefix !== '' && path.startsWith(prefix)) ?? false
}

/** Drop every trailing slash so `/path/` and `/path` compare equal. */
function stripTrailingSlashes(path: string): string {
  return path.replace(/\/+$/, '')
}

/** Process-wide default randomness seam backing `mintCsrfToken`. */
export const defaultRandomToken: RandomToken = randomBytes
