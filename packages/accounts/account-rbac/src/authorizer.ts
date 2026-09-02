/**
 * The RBAC authorizer: the single Principal construction point per request
 * (contract M) and the permission judgments of both layers - the role
 * baseline (B1) and the config-driven resource policy (B2). The transport
 * consults it after the authentication gate, so identity failures arrive
 * here only as fail-closed refusals, never as new 401s.
 * @module @qilin/account-rbac/authorizer
 */

import type { IncomingMessage } from 'node:http'
import { SessionValidationError } from '@qilin/account-auth'
import type { SessionService } from '@qilin/account-auth'
import { baselineAllows, isPermissionString, isResourceKind, isValidResourceName, routePermissionForEndpoint, type ResourceKind } from './permissions.ts'
import { evaluatePolicy, resourceVisible, type ResourcePolicy } from './policy.ts'
import { anonymousPrincipal, authDisabledRbacPrincipal, principalRole, type RbacPrincipal } from './principal.ts'

/** Error codes the RBAC layer answers with (the legacy envelope, extended). */
export const RBAC_ERROR_CODES = {
  permissionDenied: 'permission_denied',
  internalError: 'internal_error',
} as const

/** The verdict for one /api request at the RBAC fence. */
export interface RbacRequestVerdict {
  /** Whether the request may reach the dispatch. */
  readonly allowed: boolean
  /** The HTTP status to answer with when refused. */
  readonly status: number
  /** The pre-serialized JSON error body when refused. */
  readonly body: string
  /** The one principal this request resolved to (shared by every consumer). */
  readonly principal: RbacPrincipal
}

/** Construction seams. */
export interface RbacAuthorizerOptions {
  /** The session service backing identity resolution. */
  readonly sessions: SessionService
  /** Resolved once at plugin boot; true resolves every request as the synthetic admin. */
  readonly authDisabled?: boolean
  /** The loaded resource policy; null runs the role baseline alone. */
  readonly policy?: ResourcePolicy | null
}

/** The session cookie the account surface issues (the account-http wire constant). */
const SESSION_COOKIE = 'access_token'

/**
 * Read one cookie value out of the Cookie header.
 * @param header - the raw Cookie header, when present.
 * @param name - the cookie name to find.
 * @returns the first matching value, or undefined when absent or empty.
 */
function cookieValue(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined
  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=')
    if (eq === -1) continue
    if (pair.slice(0, eq).trim() === name) {
      const value = pair.slice(eq + 1).trim()
      return value === '' ? undefined : value
    }
  }
  return undefined
}

/**
 * The /api RBAC fence. Identity resolution is memoized per request object,
 * so every consumer of one request - the route judgment, owner checks,
 * catalog projections - shares one Principal.
 */
export class RbacAuthorizer {
  private readonly sessions: SessionService
  private readonly authDisabled: boolean
  private readonly policy: ResourcePolicy | null
  private readonly principals = new WeakMap<object, RbacPrincipal>()

  /**
   * Construct the authorizer over the session service, the boot-resolved
   * valve, and the boot-loaded policy.
   * @param options - the construction seams.
   */
  constructor(options: RbacAuthorizerOptions) {
    this.sessions = options.sessions
    this.authDisabled = options.authDisabled ?? false
    this.policy = options.policy ?? null
  }

  /**
   * Resolve one request's Principal - the single construction point. The
   * auth-disabled valve wins first; then the session cookie (contract D
   * cookie-first), then the Bearer header; anything else is the anonymous
   * fail-closed principal. Memoized per request object.
   * @param request - the incoming request.
   * @returns the request's one principal.
   */
  resolvePrincipal(request: IncomingMessage): RbacPrincipal {
    const cached = this.principals.get(request)
    if (cached !== undefined) return cached
    const principal = this.constructPrincipal(request)
    this.principals.set(request, principal)
    return principal
  }

  /**
   * Judge one route permission for one principal: policy deny first (it
   * wins over every role), policy allow next, then the role layer - the
   * admin baseline is a full pass, the user baseline is the default
   * matrix, and an unresolved identity or unknown role is refused.
   * @param principal - the request principal.
   * @param permission - the 'resource:action' string to judge.
   * @returns whether the action is allowed.
   */
  authorize(principal: RbacPrincipal, permission: string): boolean {
    if (!isPermissionString(permission)) return false
    const role = principalRole(principal)
    if (role !== 'admin' && role !== 'user') return false
    if (this.policy !== null) {
      const verdict = evaluatePolicy(this.policy, role, 'route', permission)
      if (verdict === 'deny') return false
      if (verdict === 'allow') return true
    }
    if (role === 'admin') return true
    return baselineAllows(permission)
  }

  /**
   * Judge one resource-level access (tool, model, ...) for one principal.
   * With no policy this stays at S3 parity: a resolved identity may use
   * what the catalogs serve. With a policy, the shared visibility
   * predicate decides, so runtime agrees with assembly-time filtering.
   * @param principal - the request principal.
   * @param kind - the resource kind.
   * @param name - the resource name.
   * @returns whether the resource may be used.
   */
  authorizeResource(principal: RbacPrincipal, kind: ResourceKind, name: string): boolean {
    if (!isResourceKind(kind) || !isValidResourceName(name)) return false
    const role = principalRole(principal)
    if (role !== 'admin' && role !== 'user') return false
    if (this.policy === null) return true
    return resourceVisible(name, role, this.policy, kind)
  }

  /**
   * Judge one /api request at the RBAC fence. The endpoint maps to its
   * route permission ('session.list' to 'session:list'); an empty endpoint
   * is nothing to authorize - the dispatch 404s it regardless.
   * @param request - the incoming request.
   * @param endpoint - the RPC endpoint exactly as the transport parsed it.
   * @returns the verdict the transport answers with.
   */
  checkRequest(request: IncomingMessage, endpoint: string): RbacRequestVerdict {
    const principal = this.resolvePrincipal(request)
    if (endpoint === '') return { allowed: true, status: 200, body: '', principal }
    const permission = routePermissionForEndpoint(endpoint)
    if (this.authorize(principal, permission)) {
      return { allowed: true, status: 200, body: '', principal }
    }
    return {
      allowed: false,
      status: 403,
      body: JSON.stringify({ error: { code: RBAC_ERROR_CODES.permissionDenied, message: `Permission denied for ${permission}` } }),
      principal,
    }
  }

  /**
   * Build (not memoize) one principal from the request headers.
   * @param request - the incoming request.
   * @returns the constructed principal.
   */
  private constructPrincipal(request: IncomingMessage): RbacPrincipal {
    if (this.authDisabled) return authDisabledRbacPrincipal()
    const headers = request.headers
    let token = cookieValue(headers.cookie, SESSION_COOKIE)
    if (token === undefined) {
      const header = headers.authorization
      if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
        token = header.slice(7).trim()
      }
    }
    if (token === undefined || token === '') return anonymousPrincipal()
    try {
      const authenticated = this.sessions.validateSession(token)
      return {
        kind: 'session',
        user: authenticated.user,
        session: {
          id: authenticated.session.id,
          issuedVersion: authenticated.session.issuedVersion,
          persistent: authenticated.session.persistent,
          createdAt: authenticated.session.createdAt,
          expiresAt: authenticated.session.expiresAt,
        },
      }
    } catch (error) {
      // Only the EXPECTED client-side validation failures fold into the
      // anonymous fail-closed identity. A corrupt durable row or an unknown
      // store fault is infrastructure damage, not a permission verdict: it
      // propagates so the transport maps it to 500 internal_error (never a
      // 403 dressing store damage up as an authorization decision).
      if (error instanceof SessionValidationError) return anonymousPrincipal()
      throw error
    }
  }
}
