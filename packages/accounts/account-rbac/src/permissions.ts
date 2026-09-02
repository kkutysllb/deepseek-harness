/**
 * Permission strings (contract N) and the single pattern grammar shared by
 * the role baseline and the resource policy. A permission names one action
 * on one resource domain ('session:list'); a pattern narrows a candidate
 * either exactly, by trailing '*' prefix, or by the full '*' wildcard.
 * @module @qilin/account-rbac/permissions
 */

/** The engine resource domains a policy may speak for (D3-B: the real catalog surfaces). */
export const RESOURCE_KINDS = ['tool', 'model', 'skill', 'mcp_server', 'route'] as const

/** One engine resource domain. */
export type ResourceKind = (typeof RESOURCE_KINDS)[number]

/** Whether a runtime value names one of the policy's supported resource domains. */
export function isResourceKind(raw: unknown): raw is ResourceKind {
  return typeof raw === 'string' && RESOURCE_KINDS.includes(raw as ResourceKind)
}

/** The two halves of one permission string. */
export interface PermissionParts {
  /** The resource domain, e.g. 'session'. */
  readonly resource: string
  /** The action on that domain, e.g. 'list'. */
  readonly action: string
}

/**
 * Whether one runtime value is a well-formed 'resource:action' permission
 * string: a non-empty string with exactly one colon and no whitespace,
 * both segments non-empty. The judgment gates every authorizer entry point,
 * so malformed runtime input fails closed instead of reaching the matcher.
 * @param raw - the runtime value to judge.
 * @returns whether the value is a usable permission string.
 */
export function isPermissionString(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false
  const first = raw.indexOf(':')
  return raw !== ''
  && !/\s/.test(raw)
  && first !== -1
  && first === raw.lastIndexOf(':')
  && first !== 0
  && first !== raw.length - 1
}

/**
 * Whether one runtime value is a usable resource name for the authorizer:
 * a non-empty string without a colon (route permissions name actions, not
 * resource names). Wildcard characters are legal in names - a policy may
 * name them exactly - so only structural garbage fails here.
 * @param raw - the runtime value to judge.
 * @returns whether the value is a usable resource name.
 */
export function isValidResourceName(raw: unknown): raw is string {
  return typeof raw === 'string' && raw !== '' && !raw.includes(':') && !/\s/.test(raw)
}

/**
 * Parse one 'resource:action' permission string.
 * @param raw - the runtime value; whitespace and extra colons are rejected.
 * @returns the two halves.
 * @throws when the value is not a well-formed 'resource:action' pair.
 */
export function parsePermission(raw: unknown): PermissionParts {
  if (!isPermissionString(raw)) {
    throw new Error("invalid permission string: expected a non-empty 'resource:action' pair")
  }
  const first = raw.indexOf(':')
  return { resource: raw.slice(0, first), action: raw.slice(first + 1) }
}

/**
 * Map one /api RPC endpoint to its route permission. The endpoint namespace
 * is 'domain.action' (e.g. 'session.list'); the permission namespace is
 * 'domain:action' (contract N), so the first dot becomes the colon. A
 * dot-less endpoint lands under the 'route' domain so a policy can still
 * name it.
 * @param endpoint - the RPC endpoint exactly as the transport parsed it.
 * @returns the permission string the route is judged against.
 */
export function routePermissionForEndpoint(endpoint: string): string {
  if (typeof endpoint !== 'string' || endpoint === '') return ''
  const dot = endpoint.indexOf('.')
  if (dot === -1) return `route:${endpoint}`
  return `${endpoint.slice(0, dot)}:${endpoint.slice(dot + 1)}`
}

/**
 * Judge one candidate against one pattern. The grammar is segment-aware:
 * a bare '*' matches everything, a '*' segment matches any segment at its
 * position (so '*:read' names the read action on every domain and
 * 'session:*' names every action on one domain), a trailing '*' inside a
 * segment matches its literal prefix, anything else matches exactly.
 * @param pattern - a validated pattern (validation lives in the policy module).
 * @param candidate - the permission string or resource name to test.
 * @returns whether the pattern covers the candidate; invalid runtime values return false.
 */
export function matchesPattern(pattern: unknown, candidate: unknown): boolean {
  if (typeof pattern !== 'string' || typeof candidate !== 'string') return false
  if (pattern === '*') return true
  return matchesSegments(pattern.split(':'), candidate.split(':'))
}

/** Judge one pattern segment against one candidate segment at the same position. */
function segmentMatches(segment: string, candidate: string): boolean {
  if (segment === '*') return true
  if (segment.endsWith('*')) return candidate.startsWith(segment.slice(0, -1))
  return segment === candidate
}

/**
 * Pairwise segment judgment. Exhaustion IS the length semantics: a pattern
 * segment with no candidate left (or the reverse) means the segment counts
 * differ, which is no match; running out on both sides together is a match.
 * Destructuring keeps every branch reachable, so noUncheckedIndexedAccess
 * needs neither an index assertion nor an unreachable guard.
 */
function matchesSegments(segments: readonly string[], candidates: readonly string[]): boolean {
  const [segment, ...segmentRest] = segments
  const [candidate, ...candidateRest] = candidates
  if (segment === undefined || candidate === undefined) {
    return segment === undefined && candidate === undefined
  }
  return segmentMatches(segment, candidate) && matchesSegments(segmentRest, candidateRest)
}

/**
 * The user role's default matrix (the other half is the admin role's
 * structural full pass). Read-class actions on any domain keep the open
 * Web surface usable for self-registered users, the whole conversation
 * domain carries the legacy threads/runs user set forward, and everything
 * else is denied so a deployment must grant write access explicitly.
 * Rationale: contract N's legacy user routes (threads read/write/delete,
 * runs create/read/cancel) are the engine's session domain; D5-B open
 * registration makes this role the anonymous-visitor default.
 */
export const DEFAULT_USER_BASELINE: readonly string[] = [
  '*:read',
  '*:list',
  '*:get',
  '*:status',
  '*:search',
  '*:stats',
  'session:*',
]

/**
 * Judge one permission against the user baseline.
 * @param permission - the 'resource:action' string to test.
 * @returns whether the default user matrix allows it.
 */
export function baselineAllows(permission: string): boolean {
  if (!isPermissionString(permission)) return false
  return DEFAULT_USER_BASELINE.some(pattern => matchesPattern(pattern, permission))
}
