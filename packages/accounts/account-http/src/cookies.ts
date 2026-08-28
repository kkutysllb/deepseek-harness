/**
 * Session cookie policy and serialization (legacy contract E): an HttpOnly
 * `access_token` cookie carrying the opaque session id, the HttpOnly
 * `qilin_session_persistent` remember-me flag cookie, and the JS-readable
 * `csrf_token` double-submit cookie. Secure follows the request scheme
 * (proxy-header aware; the engine serves plain HTTP, so only an explicit
 * forwarded `https` marks it), the loopback exemption keeps persistent
 * cookies working over local HTTP, and the explicit environment escape covers
 * operator-accepted plain-HTTP deployments. String serialization only; no
 * HTTP surface lives here.
 * @module @qilin/account-http/cookies
 */

import type { IncomingHttpHeaders } from 'node:http'
import { CSRF_COOKIE_NAME } from '@qilin/account-auth'

/** Cookie carrying the opaque session id (legacy gateway name). */
export const SESSION_COOKIE_NAME = 'access_token'

/** Cookie carrying the remember-me flag (legacy gateway name). */
export const PERSISTENT_COOKIE_NAME = 'qilin_session_persistent'

/** Re-exported for route-layer convenience: the double-submit cookie name. */
export { CSRF_COOKIE_NAME }

/** Environment escape allowing an insecure persistent cookie (legacy name). */
export const INSECURE_PERSISTENT_COOKIE_ENV = 'QILIN_AUTH_ALLOW_INSECURE_PERSISTENT_COOKIE'

/** Flag values the operator escape accepts (case- and whitespace-insensitive). */
const TRUTHY_FLAG_VALUES: readonly string[] = ['1', 'true', 'yes', 'on']

/** Parsed cookie jar: name -> value, later duplicates winning like starlette. */
export type CookieJar = Record<string, string>

/**
 * Parse one `Cookie` header into name/value pairs. Values are kept verbatim
 * (session ids are canonical UUIDs and CSRF tokens are hex; no quoting or
 * percent-decoding), and a name without an `=` value parses as empty.
 * @param header - the raw `Cookie` header value, when present.
 * @returns the parsed jar, empty when the header is absent.
 */
export function parseCookies(header: string | undefined): CookieJar {
  const jar: CookieJar = {}
  if (header === undefined || header === '') return jar
  for (const pair of header.split(';')) {
    const at = pair.indexOf('=')
    const name = (at === -1 ? pair : pair.slice(0, at)).trim()
    if (name === '') continue
    jar[name] = at === -1 ? '' : pair.slice(at + 1).trim()
  }
  return jar
}

/**
 * Read one cookie with the remember-me tri-state semantics: an explicit
 * `1`/`0` decides; any other value (or absence) falls back to the default.
 * @param jar - the parsed cookie jar.
 * @param fallback - the value to use when the cookie does not decide.
 * @returns the resolved remember-me intent.
 */
export function rememberMeFromCookie(jar: CookieJar, fallback: boolean): boolean {
  const value = jar[PERSISTENT_COOKIE_NAME]
  if (value === '1') return true
  if (value === '0') return false
  return fallback
}

/**
 * Whether the request arrived over HTTPS: the first `X-Forwarded-Proto`
 * value equals `https` (case-insensitive). The engine's own listener is
 * plain HTTP, so an explicit proxy header is the only https signal; trusting
 * it is the deployment's proxy contract, as in the legacy gateway.
 * @param headers - the request headers.
 * @returns true when the original scheme is https.
 */
export function isSecureRequest(headers: IncomingHttpHeaders): boolean {
  const raw = headers['x-forwarded-proto']
  const first = Array.isArray(raw) ? raw[0] : raw
  return first !== undefined && first.split(',', 1)[0]?.trim().toLowerCase() === 'https'
}

/**
 * Whether one request hostname is a loopback browser origin where plain-HTTP
 * persistence is acceptable: `localhost`, an `*.localhost` name, an
 * IPv4 address in the `127.0.0.0/8` block, or the IPv6 `::1` literal.
 * @param hostname - the lowercased hostname, without port.
 * @returns true when the host is loopback.
 */
export function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true
  if (hostname === '::1') return true
  const parts = hostname.split('.')
  return parts.length === 4 && parts[0] === '127' && parts.every(part => /^\d+$/.test(part) && Number(part) <= 255)
}

/**
 * The request hostname taken from the `Host` header (never a forwarded
 * host): lowercased, port stripped, IPv6 brackets removed.
 * @param headers - the request headers.
 * @returns the hostname, or an empty string when the header is missing or unparsable.
 */
export function requestHostname(headers: IncomingHttpHeaders): string {
  const host = headers.host
  if (host === undefined || host === '') return ''
  try {
    // WHATWG keeps the IPv6 brackets; the loopback checks want the bare name.
    const hostname = new URL('http://' + host).hostname.toLowerCase()
    return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
  } catch {
    return ''
  }
}

/** Whether one operator escape flag is enabled in the environment. */
function envFlagEnabled(env: NodeJS.ProcessEnv, name: string): boolean {
  const value = env[name]
  return value !== undefined && TRUTHY_FLAG_VALUES.includes(value.trim().toLowerCase())
}

/** The resolved cookie settings for one session-creating auth response. */
export interface SessionCookiePolicy {
  /** Whether the cookies carry the `Secure` attribute. */
  readonly secure: boolean
  /** Persistent lifetime in seconds, or undefined for a browser-session cookie. */
  readonly maxAge: number | undefined
  /** The resolved remember-me intent. */
  readonly remember: boolean
  /** Why the policy resolved this way (legacy reason strings). */
  readonly reason: string
}

/** Everything the policy resolution reads. */
export interface SessionCookiePolicyInput {
  /** Whether the request arrived over https. */
  readonly secure: boolean
  /** Whether the request host is a loopback browser origin. */
  readonly loopback: boolean
  /** Explicit remember-me intent from the request body, when present. */
  readonly rememberMe?: boolean
  /** The `qilin_session_persistent` cookie value, when present. */
  readonly persistentCookieValue?: string
  /** Persistent lifetime in seconds. */
  readonly ttlSeconds: number
  /** Environment consulted for the operator escape flag. */
  readonly env: NodeJS.ProcessEnv
}

/**
 * Resolve the cookie settings from user intent and deployment context (legacy
 * `resolve_session_cookie_policy`): an explicit session (non-persistent)
 * intent wins; a persistent cookie lives the full ttl when the request is
 * https, on a loopback host, or under the operator escape; every other
 * plain-HTTP persistent request degrades to a browser-session cookie.
 * @param input - the request facts, ttl, and environment.
 * @returns the resolved policy.
 */
export function resolveSessionCookiePolicy(input: SessionCookiePolicyInput): SessionCookiePolicy {
  const remember = input.rememberMe ?? rememberMeFromCookie(
    { [PERSISTENT_COOKIE_NAME]: input.persistentCookieValue ?? '' },
    true,
  )
  if (!remember) {
    return { secure: input.secure, maxAge: undefined, remember: false, reason: 'session_requested' }
  }
  if (input.secure) {
    return { secure: true, maxAge: input.ttlSeconds, remember: true, reason: 'secure_persistent' }
  }
  if (input.loopback) {
    return { secure: false, maxAge: input.ttlSeconds, remember: true, reason: 'localhost_persistent' }
  }
  if (envFlagEnabled(input.env, INSECURE_PERSISTENT_COOKIE_ENV)) {
    return { secure: false, maxAge: input.ttlSeconds, remember: true, reason: 'operator_insecure_persistent' }
  }
  return { secure: false, maxAge: undefined, remember: true, reason: 'public_http_session' }
}

/** The stable `Set-Cookie` attribute suffix shared by the cookie pair. */
function cookieAttributes(secure: boolean, maxAge: number | undefined): string {
  const parts = ['Path=/']
  if (maxAge !== undefined) parts.push('Max-Age=' + String(Math.floor(maxAge)))
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

/**
 * Serialize the session-issuing `Set-Cookie` pair: the HttpOnly session-id
 * cookie and the HttpOnly persistent-flag cookie, sharing one policy.
 * @param values - the session id and the resolved policy.
 * @returns the `Set-Cookie` header values in pair order.
 */
export function serializeSessionCookies(values: { token: string; policy: SessionCookiePolicy }): string[] {
  const attributes = cookieAttributes(values.policy.secure, values.policy.maxAge)
  const remember = values.policy.remember ? '1' : '0'
  return [
    SESSION_COOKIE_NAME + '=' + values.token + '; ' + attributes + '; HttpOnly; SameSite=Lax',
    PERSISTENT_COOKIE_NAME + '=' + remember + '; ' + attributes + '; HttpOnly; SameSite=Lax',
  ]
}

/**
 * Serialize the JS-readable double-submit cookie: never HttpOnly (the browser
 * must echo it in the `X-CSRF-Token` header), SameSite=Strict, lifetime
 * mirroring the session cookie so the pair never diverges.
 * @param values - the minted token and the resolved policy.
 * @returns the `Set-Cookie` header value.
 */
export function serializeCsrfCookie(values: { token: string; policy: SessionCookiePolicy }): string {
  const attributes = cookieAttributes(values.policy.secure, values.policy.maxAge)
  return CSRF_COOKIE_NAME + '=' + values.token + '; ' + attributes + '; SameSite=Strict'
}

/**
 * Serialize one cookie deletion: empty value, `Max-Age=0`, and the
 * attributes the cookie was set with (legacy `delete_cookie` semantics).
 * @param values - the cookie name and the request security context.
 * @returns the expiring `Set-Cookie` header value.
 */
export function serializeClearCookie(values: {
  name: string
  secure: boolean
  httpOnly: boolean
  sameSite: 'Lax' | 'Strict'
}): string {
  const parts = [values.name + '=; Max-Age=0; Path=/']
  if (values.secure) parts.push('Secure')
  if (values.httpOnly) parts.push('HttpOnly')
  parts.push('SameSite=' + values.sameSite)
  return parts.join('; ')
}
