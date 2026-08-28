/**
 * The /api authentication gate - the wrapper every business route and
 * WebSocket upgrade consults. Session resolution is cookie-first with a
 * Bearer fallback (contract D) and the legacy junk-cookie rejection (contract
 * H: a garbage cookie value can never be a session); a typed session error
 * maps to 401 with its contract-C reason (EXPIRED names token_expired), a
 * corrupt row is a 500 server fault. State-changing requests additionally
 * pass the CSRF double-submit judgment (contract F), skipped for
 * Bearer-authenticated and auth-disabled chains. The auth-disabled valve
 * passes everything through under the synthetic principal.
 * @module @qilin/account-http/gate
 */

import type { IncomingMessage } from 'node:http'
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  CSRF_SAFE_METHODS,
  SessionCorruptError,
  SessionValidationError,
  evaluateCsrfRequest,
  type CsrfRequestFacts,
  type SessionService,
} from '@qilin/account-auth'
import { parseCookies, SESSION_COOKIE_NAME } from './cookies.ts'
import { authDisabledPrincipal, type Principal } from './principal.ts'

/** Error codes the gate answers with (legacy AuthErrorCode values). */
export const AUTH_ERROR_CODES = {
  notAuthenticated: 'not_authenticated',
  tokenExpired: 'token_expired',
  tokenInvalid: 'token_invalid',
  csrfMissing: 'csrf_missing',
  csrfMismatch: 'csrf_mismatch',
  internal: 'internal_error',
} as const

/** The gate's rejection payload: the legacy error codes, engine envelope. */
export interface ApiAuthError {
  /** Legacy error code value (snake case, contract-aligned). */
  readonly code: string
  /** Operator/client-facing prose. */
  readonly message: string
}

/** The verdict for one /api request. */
export interface ApiAuthVerdict {
  /** Whether the request may reach the dispatch. */
  readonly allowed: boolean
  /** The HTTP status to answer with when refused. */
  readonly status: number
  /** The pre-serialized JSON error body when refused. */
  readonly body: string
}

/** How one request's credential resolved. */
export type AuthResolution =
  | { readonly outcome: 'authenticated'; readonly principal: Principal; readonly bearer: boolean }
  | { readonly outcome: 'auth-disabled'; readonly principal: Principal }
  | { readonly outcome: 'missing' }
  | { readonly outcome: 'rejected'; readonly error: ApiAuthError }
  | { readonly outcome: 'fault'; readonly cause: unknown }

/** Construction seams. */
export interface ApiAuthorizerOptions {
  /** The session service backing every validation. */
  readonly sessions: SessionService
  /** Resolved once at plugin boot; true passes every chain transparently. */
  readonly authDisabled?: boolean
}

/** The legacy CSRF prose, keyed by the pure decision's rejection reason. */
const CSRF_MESSAGES: Record<'missing-token' | 'token-mismatch', string> = {
  'missing-token': 'CSRF token missing. Include X-CSRF-Token header.',
  'token-mismatch': 'CSRF token mismatch.',
}

/**
 * The /api enforcement wrapper. Synchronous by construction: session
 * validation runs on the synchronous store, so both entry points answer
 * inline and the transport layer can gate without awaiting.
 */
export class ApiAuthorizer {
  private readonly sessions: SessionService
  private readonly authDisabled: boolean

  /**
   * Construct the gate over the session service and the boot-resolved valve.
   * @param options - the session service and valve state.
   */
  constructor(options: ApiAuthorizerOptions) {
    this.sessions = options.sessions
    this.authDisabled = options.authDisabled ?? false
  }

  /**
   * Resolve one request's credential: the 'access_token' cookie first, then
   * an explicit 'Authorization: Bearer' header (contract D). A presented
   * cookie that is garbage is MALFORMED, never an anonymous fallback.
   * @param request - the incoming request.
   * @returns the resolution outcome.
   */
  authenticate(request: IncomingMessage): AuthResolution {
    if (this.authDisabled) return { outcome: 'auth-disabled', principal: authDisabledPrincipal() }
    const jar = parseCookies(request.headers.cookie)
    let token: string | undefined = jar[SESSION_COOKIE_NAME]
    let bearer = false
    if (token === undefined || token === '') {
      const header = request.headers.authorization
      if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
        token = header.slice(7).trim()
        bearer = true
      }
    }
    if (token === undefined || token === '') return { outcome: 'missing' }
    try {
      const authenticated = this.sessions.validateSession(token)
      return { outcome: 'authenticated', principal: { kind: 'session', user: authenticated.user }, bearer }
    } catch (error) {
      if (error instanceof SessionValidationError) {
        const expired = error.code === 'EXPIRED'
        return {
          outcome: 'rejected',
          error: {
            code: expired ? AUTH_ERROR_CODES.tokenExpired : AUTH_ERROR_CODES.tokenInvalid,
            message: error.message,
          },
        }
      }
      if (error instanceof SessionCorruptError) return { outcome: 'fault', cause: error }
      throw error
    }
  }

  /**
   * Judge one /api request: authentication first (401 with the contract-C
   * reason), then the CSRF double-submit judgment for state-changing methods
   * (403) - skipped for Bearer-authenticated chains (no ambient credential to
   * ride) and for the auth-disabled valve.
   * @param request - the incoming request.
   * @returns the verdict the transport layer answers with.
   */
  checkRequest(request: IncomingMessage): ApiAuthVerdict {
    const authenticated = this.authenticate(request)
    if (authenticated.outcome === 'missing') {
      return refuse(401, AUTH_ERROR_CODES.notAuthenticated, 'Authentication required')
    }
    if (authenticated.outcome === 'rejected') {
      return refuse(401, authenticated.error.code, authenticated.error.message)
    }
    if (authenticated.outcome === 'fault') {
      return refuse(500, AUTH_ERROR_CODES.internal, 'session store failure')
    }
    const method = (request.method ?? 'GET').toUpperCase()
    if (CSRF_SAFE_METHODS.includes(method)) {
      return { allowed: true, status: 200, body: '' }
    }
    const bearer = authenticated.outcome === 'authenticated' ? authenticated.bearer : false
    const cookieToken = parseCookies(request.headers.cookie)[CSRF_COOKIE_NAME]
    const headerToken = headerValue(request.headers[CSRF_HEADER_NAME.toLowerCase()])
    const facts: CsrfRequestFacts = {
      method,
      ...(bearer ? { bearerAuthenticated: true } : {}),
      ...(authenticated.outcome === 'auth-disabled' ? { authDisabled: true } : {}),
      ...(cookieToken !== undefined ? { cookieToken } : {}),
      ...(headerToken !== undefined ? { headerToken } : {}),
    }
    const decision = evaluateCsrfRequest(facts)
    if (decision.outcome === 'reject') {
      const missing = decision.reason === 'missing-token'
      return refuse(403, missing ? AUTH_ERROR_CODES.csrfMissing : AUTH_ERROR_CODES.csrfMismatch, CSRF_MESSAGES[decision.reason])
    }
    return { allowed: true, status: 200, body: '' }
  }

  /**
   * Judge one WebSocket upgrade: a live session (cookie or Bearer) or the
   * auth-disabled valve passes; anything else refuses before protocol
   * negotiation, chaining with the existing untrusted-upgrade fence.
   * @param request - the upgrade request.
   * @returns true when the upgrade may proceed.
   */
  checkUpgrade(request: IncomingMessage): boolean {
    const outcome = this.authenticate(request).outcome
    return outcome === 'authenticated' || outcome === 'auth-disabled'
  }
}

/** Serialize one refusal. */
function refuse(status: number, code: string, message: string): ApiAuthVerdict {
  return { allowed: false, status, body: JSON.stringify({ error: { code, message } }) }
}

/** First value of a possibly-array header. */
function headerValue(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  return raw === undefined || raw === '' ? undefined : raw
}
