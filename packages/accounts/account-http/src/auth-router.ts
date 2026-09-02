/**
 * The /api/v1/auth route family (legacy contract K, P3 subset): local login,
 * registration (open by default, switchable with immediate effect, always
 * creating a plain user - the D5 adaptation a), logout, password change
 * (contract B: every old session dies), the session probe, setup status, and
 * the deterministic first-admin initialize (empty database only, refusing an
 * already-populated store so a public deployment cannot race an admin into
 * existence). Cross-site auth POSTs without a CSRF token pass the Origin
 * whitelist (legacy login-CSRF defense); login and register additionally
 * spend the per-IP rate-limit budget (D5 adaptation c).
 * @module @qilin/account-http/auth-router
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  CSRF_HEADER_NAME,
  SessionCorruptError,
  SessionValidationError,
  evaluateCsrfRequest,
  type CsrfRequestFacts,
  type SessionService,
  type SessionUser,
} from '@qilin/account-auth'
import {
  AccountConflictError,
  hashPassword,
  verifyPassword,
  type AccountStore,
} from '@qilin/account-core'
import {
  CSRF_COOKIE_NAME,
  isLoopbackHostname,
  isSecureRequest,
  parseCookies,
  PERSISTENT_COOKIE_NAME,
  rememberMeFromCookie,
  requestHostname,
  resolveSessionCookiePolicy,
  serializeClearCookie,
  serializeCsrfCookie,
  serializeSessionCookies,
  SESSION_COOKIE_NAME,
} from './cookies.ts'
import { isAllowedAuthOrigin } from './origin.ts'
import type { RateLimiter } from './rate-limit.ts'
import { authDisabledPrincipal } from './principal.ts'
import { readRegistrationEnabled } from './registration-config.ts'

/** The route prefix this router owns on the webServer. */
export const AUTH_ROUTE_PREFIX = '/api/v1/auth'

/** Maximum buffered JSON body for one auth request. */
export const MAX_AUTH_BODY_BYTES = 64 * 1024

/** Error code values this surface answers with (legacy AuthErrorCode values). */
export const AUTH_ROUTER_ERROR_CODES = {
  invalidCredentials: 'invalid_credentials',
  emailAlreadyExists: 'email_already_exists',
  notAuthenticated: 'not_authenticated',
  systemAlreadyInitialized: 'system_already_initialized',
  registrationDisabled: 'registration_disabled',
  rateLimited: 'rate_limited',
  invalidEmail: 'invalid_email',
  weakPassword: 'weak_password',
  invalidRequest: 'invalid_request',
  unsupportedMediaType: 'unsupported_media_type',
  payloadTooLarge: 'payload_too_large',
  methodNotAllowed: 'method_not_allowed',
  notFound: 'not_found',
  csrfMissing: 'csrf_missing',
  csrfMismatch: 'csrf_mismatch',
  internal: 'internal_error',
} as const

/** The endpoint paths behind the prefix; a known path with the wrong method answers 405, an unknown one 404. */
const KNOWN_PATHS: readonly string[] = [
  'login/local',
  'register',
  'logout',
  'change-password',
  'me',
  'setup-status',
  'initialize',
]

/** Everything the router runs against; every seam is injectable for tests. */
export interface AuthRouterDeps {
  /** Durable account storage. */
  readonly store: AccountStore
  /** Session issue/validate/revoke service. */
  readonly sessions: SessionService
  /** Environment consulted for the proxy, escape, and origin settings. */
  readonly env: NodeJS.ProcessEnv
  /** Boot-resolved auth-disabled valve; true passes chains transparently. */
  readonly authDisabled: boolean
  /** Registration-switch file path, read fresh per request. */
  readonly authConfigPath: string
  /** The per-IP fixed-window limiter shared by login and register. */
  readonly limiter: RateLimiter
  /** Fault logger (plugin wiring passes the cordis logger). */
  readonly warn?: (error: unknown) => void
}

/** A parsed auth request body: the fields this surface reads. */
interface AuthBody {
  readonly [field: string]: unknown
}

/** The per-request facts the handlers share. */
interface RequestContext {
  readonly method: string
  readonly subpath: string
  readonly secure: boolean
  readonly loopback: boolean
  readonly clientIp: string
}

/**
 * Build the route handler for the whole auth family, to be registered as one
 * prefix route on the webServer.
 * @param deps - the router's seams.
 * @returns the handler owning the full response lifecycle of the prefix.
 */
export function createAuthRouteHandler(deps: AuthRouterDeps): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    try {
      await dispatch(req, res, deps)
    } catch (error) {
      if (isHttpFault(error) && !res.headersSent) {
        sendJson(res, error.status, { error: { code: error.code, message: error.message } })
        return
      }
      deps.warn?.(error)
      if (!res.headersSent) {
        sendJson(res, 500, { error: { code: AUTH_ROUTER_ERROR_CODES.internal, message: 'internal failure' } })
        return
      }
      res.destroy()
    }
  }
}

async function dispatch(req: IncomingMessage, res: ServerResponse, deps: AuthRouterDeps): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost.invalid')
  const subpath = url.pathname.startsWith(AUTH_ROUTE_PREFIX + '/')
    ? url.pathname.slice(AUTH_ROUTE_PREFIX.length + 1).replace(/\/+$/, '')
    : ''
  const context: RequestContext = {
    method: (req.method ?? 'GET').toUpperCase(),
    subpath,
    secure: isSecureRequest(req.headers),
    loopback: isLoopbackHostname(requestHostname(req.headers)),
    clientIp: req.socket.remoteAddress ?? 'unknown',
  }
  const jar = parseCookies(req.headers.cookie)

  if (context.method === 'POST' && context.subpath !== 'change-password'
    && !deps.authDisabled && !isAllowedAuthOrigin(req.headers, deps.env)) {
    // The Origin whitelist guards exactly the auth POSTs the legacy gateway
    // exempted from the double-submit token: login, logout, register,
    // initialize. change-password carries the token instead.
    denyCrossSiteAuth(res)
    return
  }

  switch (context.method + ' ' + context.subpath) {
    case 'POST login/local':
      return loginLocal(req, res, deps, context)
    case 'POST register':
      return register(req, res, deps, context)
    case 'POST logout':
      logout(req, res, deps)
      return
    case 'POST change-password':
      return changePassword(req, res, deps, jar, context)
    case 'GET me':
      me(req, res, deps)
      return
    case 'GET setup-status':
      setupStatus(res, deps)
      return
    case 'POST initialize':
      return initialize(req, res, deps, context)
    default:
      if (KNOWN_PATHS.includes(context.subpath)) {
        methodNotAllowed(res)
        return
      }
      notFound(res)
      return
  }
}

/** POST /login/local: local email/password login (legacy contract D login face). */
async function loginLocal(req: IncomingMessage, res: ServerResponse, deps: AuthRouterDeps, context: RequestContext): Promise<void> {
  const budget = deps.limiter.take(context.clientIp)
  if (!budget.allowed) {
    rateLimited(res, budget.retryAfterSeconds)
    return
  }
  const body = await readAuthBody(req)
  if (!isEmailShape(body.email)) {
    badRequest(res, AUTH_ROUTER_ERROR_CODES.invalidEmail, 'A valid email address is required.')
    return
  }
  const password = body.password
  if (typeof password !== 'string' || password.length < 8) {
    weakPassword(res)
    return
  }
  const user = deps.store.findUserByEmail(body.email)
  const hash = user?.passwordHash ?? null
  if (user === undefined || hash === null) {
    // Timing floor: an unknown email or an OAuth-only account answers after
    // the same scrypt work as a real verification.
    verifyPassword(password, loginTimingGuardHash())
    unauthorizedCredentials(res)
    return
  }
  if (!verifyPassword(password, hash)) {
    unauthorizedCredentials(res)
    return
  }
  const remember = typeof body.rememberMe === 'boolean' ? body.rememberMe : rememberMeFromCookie(parseCookies(req.headers.cookie), true)
  issueAndRespond(res, deps, context, user, remember, { kind: 'login' }, 200)
  return
}

/** POST /register: open-by-default self-registration, always a plain user. */
async function register(req: IncomingMessage, res: ServerResponse, deps: AuthRouterDeps, context: RequestContext): Promise<void> {
  const budget = deps.limiter.take(context.clientIp)
  if (!budget.allowed) {
    rateLimited(res, budget.retryAfterSeconds)
    return
  }
  if (!readRegistrationEnabled(deps.authConfigPath)) {
    sendJson(res, 403, {
      error: { code: AUTH_ROUTER_ERROR_CODES.registrationDisabled, message: 'Self-registration is disabled on this deployment' },
    })
    return
  }
  const body = await readAuthBody(req)
  if (!isEmailShape(body.email)) {
    badRequest(res, AUTH_ROUTER_ERROR_CODES.invalidEmail, 'A valid email address is required.')
    return
  }
  const password = body.password
  if (typeof password !== 'string' || password.length < 8) {
    weakPassword(res)
    return
  }
  let user
  try {
    user = deps.store.insertUser({
      email: body.email,
      passwordHash: hashPassword(password),
      systemRole: 'user',
      needsSetup: false,
    })
  } catch (error) {
    if (error instanceof AccountConflictError) {
      // Legacy semantic: the duplicate answers 400 email_already_exists. The
      // enumeration exposure this implies is evaluated in the P3 ledger.
      badRequest(res, AUTH_ROUTER_ERROR_CODES.emailAlreadyExists, 'Email already registered')
      return
    }
    throw error
  }
  const remember = typeof body.rememberMe === 'boolean' ? body.rememberMe : true
  issueAndRespond(res, deps, context, user, remember, { kind: 'provision' }, 201)
  return
}

/** POST /logout: revoke the presented session server-side and clear the cookies. */
function logout(req: IncomingMessage, res: ServerResponse, deps: AuthRouterDeps): void {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME]
  if (token !== undefined && token !== '') deps.sessions.revokeSession(token)
  const secure = isSecureRequest(req.headers)
  res.setHeader('Set-Cookie', [
    serializeClearCookie({ name: SESSION_COOKIE_NAME, secure, httpOnly: true, sameSite: 'Lax' }),
    serializeClearCookie({ name: CSRF_COOKIE_NAME, secure, httpOnly: false, sameSite: 'Strict' }),
    serializeClearCookie({ name: PERSISTENT_COOKIE_NAME, secure, httpOnly: true, sameSite: 'Lax' }),
  ])
  sendJson(res, 200, { message: 'Successfully logged out' })
}

/** POST /change-password: verify the current credential, kill every session, re-issue one. */
async function changePassword(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AuthRouterDeps,
  jar: Record<string, string>,
  context: RequestContext,
): Promise<void> {
  const resolution = resolveAuthenticated(req, deps)
  if (resolution.kind === 'refused') {
    sendJson(res, resolution.status, { error: resolution.error })
    return
  }
  if (resolution.kind === 'auth-disabled') {
    badRequest(res, AUTH_ROUTER_ERROR_CODES.invalidCredentials, 'Password changes are not available when OPENKYLIN_AUTH_DISABLED=1.')
    return
  }
  const decision = evaluateCsrfRequest(csrfFacts({
    method: context.method,
    bearerAuthenticated: resolution.bearer,
    cookieToken: jar[CSRF_COOKIE_NAME],
    headerToken: headerValue(req.headers[CSRF_HEADER_NAME.toLowerCase()]),
  }))
  if (decision.outcome === 'reject') {
    const missing = decision.reason === 'missing-token'
    sendJson(res, 403, {
      error: {
        code: missing ? AUTH_ROUTER_ERROR_CODES.csrfMissing : AUTH_ROUTER_ERROR_CODES.csrfMismatch,
        message: missing ? 'CSRF token missing. Include X-CSRF-Token header.' : 'CSRF token mismatch.',
      },
    })
    return
  }
  const body = await readAuthBody(req)
  const current = body.currentPassword
  if (typeof current !== 'string' || current === '') {
    badRequest(res, AUTH_ROUTER_ERROR_CODES.invalidRequest, 'The current password is required.')
    return
  }
  const fresh = body.newPassword
  if (typeof fresh !== 'string' || fresh.length < 8) {
    weakPassword(res, 'A new password of at least 8 characters is required.')
    return
  }
  const user = resolution.user
  const stored = deps.store.findUserById(user.id)
  const hash = stored?.passwordHash ?? null
  if (hash === null) {
    badRequest(res, AUTH_ROUTER_ERROR_CODES.invalidCredentials, 'OAuth users cannot change password')
    return
  }
  if (!verifyPassword(current, hash)) {
    badRequest(res, AUTH_ROUTER_ERROR_CODES.invalidCredentials, 'Current password is incorrect')
    return
  }
  const updated = deps.sessions.changePassword(user.id, hashPassword(fresh))
  const remember = typeof body.rememberMe === 'boolean' ? body.rememberMe : rememberMeFromCookie(jar, true)
  issueAndRespond(res, deps, context, updated, remember, { kind: 'message', message: 'Password changed successfully' }, 200)
  return
}

/** GET /me: the live account behind the session, or the synthetic valve principal. */
function me(req: IncomingMessage, res: ServerResponse, deps: AuthRouterDeps): void {
  const resolution = resolveAuthenticated(req, deps)
  if (resolution.kind === 'refused') {
    sendJson(res, resolution.status, { error: resolution.error })
    return
  }
  if (resolution.kind === 'auth-disabled') {
    sendJson(res, 200, authDisabledPrincipal().user)
    return
  }
  sendJson(res, 200, resolution.user)
}

/** GET /setup-status: whether the deterministic admin initialize can still run. */
function setupStatus(res: ServerResponse, deps: AuthRouterDeps): void {
  sendJson(res, 200, {
    needsSetup: deps.store.countUsers() === 0,
    registrationEnabled: readRegistrationEnabled(deps.authConfigPath),
  })
}

/** POST /initialize: deterministic first admin, empty database only (D5 adaptation a). */
async function initialize(req: IncomingMessage, res: ServerResponse, deps: AuthRouterDeps, context: RequestContext): Promise<void> {
  const body = await readAuthBody(req)
  if (!isEmailShape(body.email)) {
    badRequest(res, AUTH_ROUTER_ERROR_CODES.invalidEmail, 'A valid email address is required.')
    return
  }
  const password = body.password
  if (typeof password !== 'string' || password.length < 8) {
    weakPassword(res)
    return
  }
  if (deps.store.countUsers() > 0) {
    sendJson(res, 409, {
      error: { code: AUTH_ROUTER_ERROR_CODES.systemAlreadyInitialized, message: 'System already initialized' },
    })
    return
  }
  let user
  try {
    user = deps.store.insertUser({
      email: body.email,
      passwordHash: hashPassword(password),
      systemRole: 'admin',
      needsSetup: false,
    })
  } catch (error) {
    // The empty-store gate ran first, so a collision means the store stopped
    // being empty between the gate and the insert: the system is initialized.
    if (error instanceof AccountConflictError) {
      sendJson(res, 409, {
        error: { code: AUTH_ROUTER_ERROR_CODES.systemAlreadyInitialized, message: 'System already initialized' },
      })
      return
    }
    throw error
  }
  const remember = typeof body.rememberMe === 'boolean' ? body.rememberMe : true
  issueAndRespond(res, deps, context, user, remember, { kind: 'provision' }, 201)
  return
}

/** ── shared plumbing ─────────────────────────────────────────────────────── */

/** The authentication verdict for one request at the auth surface. */
type AuthVerdict =
  | { readonly kind: 'authenticated'; readonly user: SessionUser; readonly bearer: boolean }
  | { readonly kind: 'auth-disabled' }
  | { readonly kind: 'refused'; readonly status: number; readonly error: { code: string; message: string } }

/**
 * Resolve one request's credential at the auth surface: the valve answers
 * with its synthetic channel, a live session with the account, and anything
 * else with the typed 401 (contract-C reason) or a 500 store fault.
 */
function resolveAuthenticated(req: IncomingMessage, deps: AuthRouterDeps): AuthVerdict {
  if (deps.authDisabled) return { kind: 'auth-disabled' }
  const jar = parseCookies(req.headers.cookie)
  let token: string | undefined = jar[SESSION_COOKIE_NAME]
  let bearer = false
  if (token === undefined || token === '') {
    const header = req.headers.authorization
    if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
      token = header.slice(7).trim()
      bearer = true
    }
  }
  if (token === undefined || token === '') {
    return { kind: 'refused', status: 401, error: { code: AUTH_ROUTER_ERROR_CODES.notAuthenticated, message: 'Authentication required' } }
  }
  try {
    const authenticated = deps.sessions.validateSession(token)
    return { kind: 'authenticated', user: authenticated.user, bearer }
  } catch (error) {
    if (error instanceof SessionValidationError) {
      const expired = error.code === 'EXPIRED'
      return {
        kind: 'refused',
        status: 401,
        error: { code: expired ? 'token_expired' : 'token_invalid', message: error.message },
      }
    }
    if (error instanceof SessionCorruptError) {
      return { kind: 'refused', status: 500, error: { code: AUTH_ROUTER_ERROR_CODES.internal, message: 'session store failure' } }
    }
    throw error
  }
}

/** How a successful issuance answers. */
type IssuanceResponse =
  | { readonly kind: 'login' }
  | { readonly kind: 'provision' }
  | { readonly kind: 'message'; readonly message: string }

/**
 * Issue the session for a successful login or provision and answer with the
 * full cookie set: the session-id and persistent-flag pair plus the CSRF
 * cookie, all under one resolved policy (contract E). The account-auth
 * service raises a bare Error for an unknown account (the S2 review note);
 * the route layer normalizes it into the typed response the calling
 * endpoint promises - a 401 on the login path, a 500 on the provision path
 * where the account was just created.
 */
function issueAndRespond(
  res: ServerResponse,
  deps: AuthRouterDeps,
  context: RequestContext,
  user: SessionUser,
  remember: boolean,
  response: IssuanceResponse,
  status: number,
): void {
  let issued
  try {
    issued = deps.sessions.issueSession({ userId: user.id, persistent: remember })
  } catch (error) {
    deps.warn?.(error)
    if (response.kind === 'login') {
      unauthorizedCredentials(res)
      return
    }
    sendJson(res, 500, { error: { code: AUTH_ROUTER_ERROR_CODES.internal, message: 'internal failure' } })
    return
  }
  const ttlSeconds = Math.round((issued.session.expiresAt - issued.session.createdAt) / 1000)
  const policy = resolveSessionCookiePolicy({
    secure: context.secure,
    loopback: context.loopback,
    rememberMe: remember,
    ttlSeconds,
    env: deps.env,
  })
  res.setHeader('Set-Cookie', [
    ...serializeSessionCookies({ token: issued.session.id, policy }),
    serializeCsrfCookie({ token: issued.csrfToken, policy }),
  ])
  if (response.kind === 'login') {
    sendJson(res, status, { expiresIn: ttlSeconds, needsSetup: issued.user.needsSetup, accessToken: issued.session.id })
    return
  }
  if (response.kind === 'provision') {
    sendJson(res, status, { user: issued.user, accessToken: issued.session.id })
    return
  }
  sendJson(res, status, { message: response.message })
}

/** Lazily computed scrypt hash backing the login timing floor. */
let timingGuardHash: string | undefined
function loginTimingGuardHash(): string {
  if (timingGuardHash === undefined) timingGuardHash = hashPassword('timing-guard-placeholder')
  return timingGuardHash
}

/** Read and parse one auth JSON body, enforcing the media type and size cap. */
async function readAuthBody(req: IncomingMessage): Promise<AuthBody> {
  const contentType = req.headers['content-type']
  const mediaType = contentType?.split(';', 1)[0]?.trim().toLowerCase()
  if (mediaType !== 'application/json') {
    throw httpFault(415, AUTH_ROUTER_ERROR_CODES.unsupportedMediaType, 'auth requests must carry application/json bodies')
  }
  const declaredLength = req.headers['content-length']
  if (declaredLength !== undefined && Number(declaredLength) > MAX_AUTH_BODY_BYTES) {
    throw httpFault(413, AUTH_ROUTER_ERROR_CODES.payloadTooLarge, 'auth request body is too large')
  }
  const chunks: Buffer[] = []
  let received = 0
  for await (const chunk of req) {
    received += (chunk as Buffer).byteLength
    if (received > MAX_AUTH_BODY_BYTES) {
      throw httpFault(413, AUTH_ROUTER_ERROR_CODES.payloadTooLarge, 'auth request body is too large')
    }
    chunks.push(chunk as Buffer)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null') as unknown
  } catch {
    throw httpFault(400, AUTH_ROUTER_ERROR_CODES.invalidRequest, 'body is not valid JSON')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw httpFault(400, AUTH_ROUTER_ERROR_CODES.invalidRequest, 'body must be a JSON object')
  }
  return parsed as AuthBody
}

/** The email shape this surface accepts (the legacy EmailStr practical form). */
function isEmailShape(value: unknown): value is string {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

/** An error carrying its intended HTTP answer, raised through the dispatch. */
function httpFault(status: number, code: string, message: string): Error & { status: number; code: string; message: string } {
  const error = new Error(message) as Error & { status: number; code: string; message: string }
  error.status = status
  error.code = code
  return error
}

/** Whether one caught error is a fault carrying its intended HTTP answer. */
function isHttpFault(error: unknown): error is ReturnType<typeof httpFault> {
  return error instanceof Error && typeof (error as ReturnType<typeof httpFault>).status === 'number'
    && typeof (error as ReturnType<typeof httpFault>).code === 'string'
}

/** First value of a possibly-array header. */
function headerValue(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  return raw === undefined || raw === '' ? undefined : raw
}

/**
 * Build the pure CSRF decision's facts, dropping absent optional fields so
 * the exact-optional property type stays honest.
 */
function csrfFacts(facts: {
  method: string
  bearerAuthenticated?: boolean | undefined
  cookieToken?: string | undefined
  headerToken?: string | undefined
}): CsrfRequestFacts {
  return {
    method: facts.method,
    ...(facts.bearerAuthenticated === true ? { bearerAuthenticated: true } : {}),
    ...(facts.cookieToken !== undefined ? { cookieToken: facts.cookieToken } : {}),
    ...(facts.headerToken !== undefined ? { headerToken: facts.headerToken } : {}),
  }
}

/** Write one JSON response, optionally with Set-Cookie headers already set. */
function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(payload))
}

/** The 403 the Origin whitelist answers with (legacy prose). */
function denyCrossSiteAuth(res: ServerResponse): void {
  sendJson(res, 403, { error: { code: AUTH_ROUTER_ERROR_CODES.csrfMissing, message: 'Cross-site auth request denied.' } })
}

/** The 401 wrong-credential answer (existence-blind, legacy prose). */
function unauthorizedCredentials(res: ServerResponse): void {
  sendJson(res, 401, { error: { code: AUTH_ROUTER_ERROR_CODES.invalidCredentials, message: 'Incorrect email or password' } })
}

function badRequest(res: ServerResponse, code: string, message: string): void {
  sendJson(res, 400, { error: { code, message } })
}

function weakPassword(res: ServerResponse, message = 'A password of at least 8 characters is required.'): void {
  badRequest(res, AUTH_ROUTER_ERROR_CODES.weakPassword, message)
}

function rateLimited(res: ServerResponse, retryAfterSeconds: number): void {
  res.setHeader('Retry-After', String(retryAfterSeconds))
  sendJson(res, 429, {
    error: { code: AUTH_ROUTER_ERROR_CODES.rateLimited, message: 'Too many attempts. Try again later.' },
  })
}

function methodNotAllowed(res: ServerResponse): void {
  sendJson(res, 405, { error: { code: AUTH_ROUTER_ERROR_CODES.methodNotAllowed, message: 'method not allowed on auth endpoints' } })
}

function notFound(res: ServerResponse): void {
  sendJson(res, 404, { error: { code: AUTH_ROUTER_ERROR_CODES.notFound, message: 'unknown auth endpoint' } })
}
