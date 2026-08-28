/**
 * The /api/v1/admin/users route family (P3 subset): the administrator's
 * account-management surface — list accounts, change a system role, disable
 * or re-enable an account, and reset a password on the administrator's
 * behalf. Every route resolves the caller's session first (cookie or Bearer),
 * refuses non-administrators, and — like the auth surface — requires the CSRF
 * double-submit token on cookie-authenticated writes while exempting Bearer
 * chains. Responses project accounts without the password hash; a disabled
 * account keeps its rows and history but can hold no session.
 * @module @qilin/account-http/admin-users-router
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { hashPassword, type AccountStore, type User } from '@qilin/account-core'
import {
  CSRF_HEADER_NAME,
  SessionCorruptError,
  SessionValidationError,
  evaluateCsrfRequest,
  type SessionService,
} from '@qilin/account-auth'
import { CSRF_COOKIE_NAME, parseCookies, SESSION_COOKIE_NAME } from './cookies.ts'

/** The route prefix this router owns on the webServer. */
export const ADMIN_USERS_ROUTE_PREFIX = '/api/v1/admin/users'

/** Error code values this surface answers with. */
export const ADMIN_USERS_ERROR_CODES = {
  invalidRequest: 'invalid_request',
  weakPassword: 'weak_password',
  methodNotAllowed: 'method_not_allowed',
  notFound: 'not_found',
  notAuthenticated: 'not_authenticated',
  accountDisabled: 'account_disabled',
  forbidden: 'forbidden',
  csrfMissing: 'csrf_missing',
  csrfMismatch: 'csrf_mismatch',
  selfProtected: 'self_protected',
  lastAdminProtected: 'last_admin_protected',
  internal: 'internal_error',
} as const

/** Everything the router runs against; every seam is injectable for tests. */
export interface AdminUsersRouterDeps {
  /** Durable account storage (read side plus the admin mutations). */
  readonly store: AccountStore
  /** Session validation service backing the caller's credential. */
  readonly sessions: SessionService
  /** Environment consulted for the escape-valve setting (wiring parity). */
  readonly env: NodeJS.ProcessEnv
  /** Boot-resolved auth-disabled valve; true answers as a synthetic admin. */
  readonly authDisabled: boolean
  /** Fault logger (plugin wiring passes the cordis logger). */
  readonly warn?: (error: unknown) => void
}

/** A parsed admin request body: the fields this surface reads. */
interface AdminBody {
  readonly [field: string]: unknown
}

/** The outcome of resolving the caller's credential before any route logic. */
type AuthVerdict =
  | { kind: 'ok'; admin: boolean; bearer: boolean; userId?: string }
  | { kind: 'error'; status: number; code: string; message: string }

/**
 * Build the route handler for the whole admin family, to be registered as one
 * prefix route on the webServer.
 * @param deps - the router's seams.
 * @returns the handler owning the full response lifecycle of the prefix.
 */
export function createAdminUsersRouteHandler(deps: AdminUsersRouterDeps): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    try {
      await dispatch(req, res, deps)
    } catch (error) {
      deps.warn?.(error)
      if (!res.headersSent) {
        sendJson(res, 500, { error: { code: ADMIN_USERS_ERROR_CODES.internal, message: 'internal failure' } })
        return
      }
      res.destroy()
    }
  }
}

async function dispatch(req: IncomingMessage, res: ServerResponse, deps: AdminUsersRouterDeps): Promise<void> {
  const path = new URL(req.url ?? '/', 'http://localhost.invalid').pathname.replace(/\/+$/, '')
  const suffix = path.startsWith(ADMIN_USERS_ROUTE_PREFIX)
    ? path.slice(ADMIN_USERS_ROUTE_PREFIX.length)
    : null
  if (suffix === null || (suffix !== '' && !/^\/[^/]+(?:\/reset-password)?$/.test(suffix))) {
    notFound(res)
    return
  }
  const method = (req.method ?? 'GET').toUpperCase()
  const verdict = authenticate(req, deps)
  if (verdict.kind === 'error') {
    sendJson(res, verdict.status, { error: { code: verdict.code, message: verdict.message } })
    return
  }
  if (!deps.authDisabled && !verdict.admin) {
    sendJson(res, 403, { error: { code: ADMIN_USERS_ERROR_CODES.forbidden, message: 'Administrator role required' } })
    return
  }
  if ((method === 'PATCH' || method === 'POST') && !deps.authDisabled && !verdict.bearer) {
    const jar = parseCookies(req.headers.cookie)
    const cookieToken = jar[CSRF_COOKIE_NAME]
    const headerToken = headerValue(req.headers[CSRF_HEADER_NAME.toLowerCase()])
    const decision = evaluateCsrfRequest({
      method,
      ...(cookieToken !== undefined ? { cookieToken } : {}),
      ...(headerToken !== undefined ? { headerToken } : {}),
    })
    if (decision.outcome === 'reject') {
      sendJson(res, 403, {
        error: {
          code: decision.reason === 'missing-token' ? ADMIN_USERS_ERROR_CODES.csrfMissing : ADMIN_USERS_ERROR_CODES.csrfMismatch,
          message: decision.reason === 'missing-token' ? 'CSRF token is required' : 'CSRF token mismatch',
        },
      })
      return
    }
  }
  if (method === 'GET' && suffix === '') {
    list(res, deps.store)
    return
  }
  if (suffix === '') {
    methodNotAllowed(res)
    return
  }
  const match = suffix.match(/^\/([^/]+)(?:\/reset-password)?$/)
  if (match === null) {
    notFound(res)
    return
  }
  const id = match[1] as string
  if (method === 'PATCH' && suffix === `/${id}`) {
    await patch(req, res, deps, id, verdict.userId)
    return
  }
  if (method === 'POST' && suffix === `/${id}/reset-password`) {
    await reset(req, res, deps, id, verdict.userId)
    return
  }
  if (suffix === `/${id}` || suffix === `/${id}/reset-password`) {
    methodNotAllowed(res)
    return
  }
  notFound(res)
}

/**
 * Resolve the caller's credential: the session cookie first, then a Bearer
 * token; the auth-disabled valve answers as a synthetic administrator with no
 * actor id (self-protection cannot bind to a real account). A session whose
 * account is disabled answers 401 account_disabled — the same wire code the
 * auth and gate surfaces use.
 */
function authenticate(req: IncomingMessage, deps: AdminUsersRouterDeps): AuthVerdict {
  if (deps.authDisabled) {
    return { kind: 'ok', admin: true, bearer: false }
  }
  const jar = parseCookies(req.headers.cookie)
  let token = jar[SESSION_COOKIE_NAME]
  let bearer = false
  if (!token) {
    const auth = req.headers.authorization
    if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
      token = auth.slice(7).trim()
      bearer = true
    }
  }
  if (token === undefined || token === '') {
    return { kind: 'error', status: 401, code: ADMIN_USERS_ERROR_CODES.notAuthenticated, message: 'Authentication required' }
  }
  try {
    const user = deps.sessions.validateSession(token).user
    return { kind: 'ok', admin: user.systemRole === 'admin', bearer, userId: user.id }
  } catch (error) {
    if (error instanceof SessionValidationError && error.code === 'DISABLED') {
      return { kind: 'error', status: 401, code: ADMIN_USERS_ERROR_CODES.accountDisabled, message: error.message }
    }
    if (error instanceof SessionValidationError) {
      return { kind: 'error', status: 401, code: 'token_invalid', message: error.message }
    }
    if (error instanceof SessionCorruptError) {
      return { kind: 'error', status: 500, code: ADMIN_USERS_ERROR_CODES.internal, message: 'session store failure' }
    }
    throw error
  }
}

/** The account projection every answer uses: the whole row minus the hash. */
function project(user: User): Omit<User, 'passwordHash'> {
  const { passwordHash: _omitted, ...safe } = user
  return safe
}

/** GET /api/v1/admin/users — every account, hash stripped, store order. */
function list(res: ServerResponse, store: AccountStore): void {
  sendJson(res, 200, { users: store.listUsers().map(project) })
}

/**
 * PATCH /api/v1/admin/users/:id — change the system role and/or the disabled
 * flag in one request. Self-demotions and self-disables are refused (the last
 * administrator would otherwise lock themselves out through their own
 * console), and demoting or disabling the only enabled administrator is
 * refused so an installation can never lose its management path.
 */
async function patch(req: IncomingMessage, res: ServerResponse, deps: AdminUsersRouterDeps, id: string, actorId?: string): Promise<void> {
  const body = await readBody(req)
  const hasRole = Object.prototype.hasOwnProperty.call(body, 'systemRole')
  const hasDisabled = Object.prototype.hasOwnProperty.call(body, 'disabled')
  if (
    (!hasRole && !hasDisabled) ||
    (hasRole && body.systemRole !== 'admin' && body.systemRole !== 'user') ||
    (hasDisabled && typeof body.disabled !== 'boolean')
  ) {
    bad(res, ADMIN_USERS_ERROR_CODES.invalidRequest, 'at least one valid update is required')
    return
  }
  const target = deps.store.findUserById(id)
  if (!target) {
    notFound(res)
    return
  }
  if (actorId === id) {
    bad(res, ADMIN_USERS_ERROR_CODES.selfProtected, 'cannot demote or disable the calling administrator')
    return
  }
  const enabledAdmins = deps.store.listUsers().filter(user => user.systemRole === 'admin' && user.disabledAt === null).length
  const removesAdmin =
    target.systemRole === 'admin' && target.disabledAt === null && ((hasRole && body.systemRole === 'user') || (hasDisabled && body.disabled === true))
  if (removesAdmin && enabledAdmins === 1) {
    conflict(res, ADMIN_USERS_ERROR_CODES.lastAdminProtected)
    return
  }
  let updated = target
  if (hasRole) {
    updated = deps.store.updateRole(id, body.systemRole as 'admin' | 'user')
  }
  if (hasDisabled) {
    updated = deps.store.setDisabled(id, body.disabled ? Date.now() : null)
  }
  sendJson(res, 200, { user: project(updated) })
}

/**
 * POST /api/v1/admin/users/:id/reset-password — set a new local password on
 * the administrator's behalf through the store's updatePassword seam, so the
 * session version rises and every old session dies, exactly as a self-serve
 * password change would.
 */
async function reset(req: IncomingMessage, res: ServerResponse, deps: AdminUsersRouterDeps, id: string, actorId?: string): Promise<void> {
  const body = await readBody(req)
  if (typeof body.newPassword !== 'string') {
    bad(res, ADMIN_USERS_ERROR_CODES.invalidRequest, 'newPassword is required')
    return
  }
  if (body.newPassword.length < 8) {
    bad(res, ADMIN_USERS_ERROR_CODES.weakPassword, 'A password of at least 8 characters is required.')
    return
  }
  if (actorId === id) {
    bad(res, ADMIN_USERS_ERROR_CODES.selfProtected, 'cannot reset the calling administrator password')
    return
  }
  if (!deps.store.findUserById(id)) {
    notFound(res)
    return
  }
  sendJson(res, 200, { user: project(deps.store.updatePassword(id, hashPassword(body.newPassword))) })
}

/** Buffer one JSON body; any shape other than a plain object is a fault. */
async function readBody(req: IncomingMessage): Promise<AdminBody> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(chunk as Buffer)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString() || 'null')
  } catch {
    throw new Error('invalid JSON')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('body must be an object')
  }
  return parsed as AdminBody
}

/** Collapse a repeated or missing header to one token value. */
function headerValue(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value
  return first || undefined
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(payload))
}

/** The shared 400 shape for malformed or refused admin updates. */
function bad(res: ServerResponse, code: string, message: string): void {
  sendJson(res, 400, { error: { code, message } })
}

/** The shared 409 shape for protection conflicts. */
function conflict(res: ServerResponse, code: string): void {
  sendJson(res, 409, { error: { code, message: code } })
}

function methodNotAllowed(res: ServerResponse): void {
  sendJson(res, 405, { error: { code: ADMIN_USERS_ERROR_CODES.methodNotAllowed, message: 'method not allowed on admin user endpoints' } })
}

function notFound(res: ServerResponse): void {
  sendJson(res, 404, { error: { code: ADMIN_USERS_ERROR_CODES.notFound, message: 'unknown admin user endpoint' } })
}
