/**
 * The optional /api authentication contract the accounts composition may
 * provide as the 'apiAuth' service. Structural on purpose: the transport
 * layer knows only this shape and consults it by name at the same fence
 * points as the browser-trust check - never the account packages themselves.
 * The implementation lives in @qilin/account-http (cookie-first session
 * resolution, Bearer fallback, CSRF judgment, auth-disabled valve).
 * @module @qilin/client-connection/api-auth-gate
 */

import type { IncomingMessage } from 'node:http'

/** The verdict for one /api request. */
export interface ApiAuthVerdict {
  /** Whether the request may reach the dispatch. */
  readonly allowed: boolean
  /** The HTTP status to answer with when refused. */
  readonly status: number
  /** The pre-serialized JSON error body when refused. */
  readonly body: string
}

/** The gate every business route and WebSocket upgrade consults, when present. */
export interface ApiAuthGate {
  /**
   * Judge one /api request: authentication (401 with the typed reason) and,
   * for state-changing methods, the CSRF double-submit judgment (403).
   * @param request - the incoming node:http request.
   * @returns the verdict the transport answers with.
   */
  checkRequest(request: IncomingMessage): ApiAuthVerdict
  /**
   * Judge one WebSocket upgrade: a live session (cookie or Bearer) or the
   * auth-disabled valve passes; anything else refuses before negotiation.
   * @param request - the upgrade request.
   * @returns true when the upgrade may proceed.
   */
  checkUpgrade(request: IncomingMessage): boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Optional /api authentication gate; present only when the composition mounts the accounts HTTP plugin. */
    apiAuth?: ApiAuthGate
  }
}
