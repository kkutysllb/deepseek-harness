/**
 * The auth-endpoint Origin whitelist (legacy `is_allowed_auth_origin`): the
 * login-CSRF defense for the auth POSTs that are exempt from the double-submit
 * token because first-time browsers hold no CSRF cookie yet. A request
 * carrying an Origin header must be same-origin (compared against the request
 * authority the browser is actually targeting) or listed in the configured
 * CORS origins; Origin-less requests are non-browser callers and pass. The
 * comparison normalizes both sides to `scheme://host[:port]` with default
 * ports omitted, exactly like the legacy gateway.
 * @module @qilin/account-http/origin
 */

import type { IncomingHttpHeaders } from 'node:http'

/** Environment variable listing extra browser origins allowed at auth POSTs. */
export const CORS_ORIGINS_ENV_VAR = 'QILIN_CORS_ORIGINS'

/** The schemes a browser Origin may carry for the comparison. */
const ALLOWED_SCHEMES: readonly string[] = ['http:', 'https:']

/** First header value of a possibly repeated, possibly comma-joined header. */
function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  if (raw === undefined) return undefined
  const first = raw.split(',', 1)[0]?.trim()
  return first === undefined || first === '' ? undefined : first
}

/**
 * Normalize one origin to `scheme://host[:port]`, or undefined when the
 * value cannot be a browser origin: non-http(s) schemes, a missing hostname,
 * or any URL part beyond the authority (path, query, fragment, credentials) —
 * the legacy rule that rejects URL-shaped values instead of comparing
 * prefixes. Default ports (80/443) are omitted; IPv6 hosts stay bracketed.
 * @param raw - the origin header value, verbatim.
 * @returns the normalized origin, or undefined when invalid.
 */
export function normalizeOrigin(raw: string): string | undefined {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return undefined
  }
  if (!ALLOWED_SCHEMES.includes(url.protocol) || url.hostname === '') return undefined
  if (url.username !== '' || url.password !== '' || url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    return undefined
  }
  const scheme = url.protocol.slice(0, -1)
  const defaultPort = scheme === 'https' ? '443' : '80'
  const port = url.port !== '' && url.port !== defaultPort ? ':' + url.port : ''
  return scheme + '://' + url.hostname.toLowerCase() + port
}

/**
 * The explicitly configured browser origins that may call auth routes
 * (legacy `GATEWAY_CORS_ORIGINS` semantics): comma-separated; blank and
 * `*` entries are skipped; standard http(s) origins are normalized; any
 * other scheme (an Electron `app://-` build, for example) passes through
 * verbatim so it can still exact-match the Origin header.
 * @param env - environment consulted for the configured list.
 * @returns the configured origin set.
 */
export function configuredCorsOrigins(env: NodeJS.ProcessEnv): Set<string> {
  const origins = new Set<string>()
  const raw = env[CORS_ORIGINS_ENV_VAR]
  if (raw === undefined) return origins
  for (const entry of raw.split(',')) {
    const candidate = entry.trim()
    if (candidate === '' || candidate === '*') continue
    const normalized = normalizeOrigin(candidate)
    origins.add(normalized ?? candidate)
  }
  return origins
}

/** The scheme/host parameter extracted from the first Forwarded entry. */
function forwardedParameter(headers: IncomingHttpHeaders, name: string): string | undefined {
  const forwarded = firstHeaderValue(headers.forwarded)
  if (forwarded === undefined) return undefined
  for (const part of forwarded.split(';')) {
    const at = part.indexOf('=')
    if (at === -1) continue
    const key = part.slice(0, at).trim().toLowerCase()
    if (key !== name) continue
    const value = part.slice(at + 1).trim().replace(/^"|"$/g, '')
    if (value !== '') return value
  }
  return undefined
}

/**
 * Bracket an IPv6 hostname that arrived bare (a forwarded host value may omit
 * the brackets a Host header carries). A bare IPv6 always holds two or more
 * colons, so a plain host:port authority stays untouched.
 */
function bracketIpv6(host: string): string {
  return (host.match(/:/g)?.length ?? 0) >= 2 && !host.startsWith('[') ? '[' + host + ']' : host
}

/**
 * Rebuild the origin the browser is actually targeting, through the trusted
 * proxy headers when a front proxy presents them (legacy semantics): scheme
 * from Forwarded proto or `X-Forwarded-Proto` (the engine listener itself
 * is plain http), host from Forwarded host, `X-Forwarded-Host`, or the
 * Host header, port from `X-Forwarded-Port` when the host carries none.
 * @param headers - the request headers.
 * @returns the normalized request origin, or undefined when underivable.
 */
export function requestOrigin(headers: IncomingHttpHeaders): string | undefined {
  const scheme = (forwardedParameter(headers, 'proto') ?? firstHeaderValue(headers['x-forwarded-proto']) ?? 'http').toLowerCase()
  const rawHost = forwardedParameter(headers, 'host') ?? firstHeaderValue(headers['x-forwarded-host']) ?? firstHeaderValue(headers.host)
  if (rawHost === undefined) return undefined
  let host = bracketIpv6(rawHost)
  const forwardedPort = firstHeaderValue(headers['x-forwarded-port'])
  if (forwardedPort !== undefined && host.lastIndexOf(':') <= host.lastIndexOf(']')) {
    host = host + ':' + forwardedPort
  }
  return normalizeOrigin(scheme + '://' + host)
}

/** The request facts the whitelist reads. */
export type OriginRequestFacts = Partial<Pick<IncomingHttpHeaders, 'origin' | 'host' | 'forwarded' | 'x-forwarded-proto' | 'x-forwarded-host' | 'x-forwarded-port'>>

/**
 * Whether one auth POST may pass despite holding no CSRF token: Origin-less
 * requests pass (curl, mobile integrations); a configured origin passes
 * (raw fast path for non-standard schemes, then normalized); anything else
 * must equal the request's own origin.
 * @param headers - the request headers.
 * @param env - environment consulted for the configured origin list.
 * @returns true when the origin is allowed.
 */
export function isAllowedAuthOrigin(headers: OriginRequestFacts, env: NodeJS.ProcessEnv): boolean {
  const origin = firstHeaderValue(headers.origin)
  if (origin === undefined) return true
  const configured = configuredCorsOrigins(env)
  if (configured.has(origin)) return true
  const normalized = normalizeOrigin(origin)
  if (normalized === undefined) return false
  if (configured.has(normalized)) return true
  const requestSide = requestOrigin(headers)
  return requestSide !== undefined && normalized === requestSide
}
