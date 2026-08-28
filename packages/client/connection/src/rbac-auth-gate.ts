/**
 * The optional /api RBAC contract the accounts composition may provide as
 * the 'rbacAuth' service. Structural on purpose: the transport layer knows
 * only this shape and consults it by name immediately after the apiAuth
 * authentication fence on the /api channel - never the account packages
 * themselves. The implementation lives in @qilin/account-rbac (request
 * Principal, role baseline, config-driven resource policy, deny-wins).
 * @module @qilin/client-connection/rbac-auth-gate
 */

import type { IncomingMessage } from 'node:http'

/** The verdict for one /api request at the RBAC fence. */
export interface RbacAuthVerdict {
  /** Whether the request may reach the dispatch. */
  readonly allowed: boolean
  /** The HTTP status to answer with when refused. */
  readonly status: number
  /** The pre-serialized JSON error body when refused. */
  readonly body: string
}

/** The RBAC fence the /api business channel consults, when present. */
export interface RbacAuthGate {
  /**
   * Judge one /api request for the resolved identity's permission on the
   * endpoint. Consulted only after the authentication verdict passed.
   * @param request - the incoming node:http request.
   * @param endpoint - the RPC endpoint the transport parsed from the path.
   * @returns the verdict the transport answers with.
   */
  checkRequest(request: IncomingMessage, endpoint: string): RbacAuthVerdict
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Optional /api RBAC fence; present only when the composition mounts the account-rbac plugin. */
    rbacAuth?: RbacAuthGate
  }
}

/**
 * The pre-serialized 500 answer the transport maps ANY thrown gate fault
 * to. A gate that throws is infrastructure damage (a corrupt session row,
 * a store outage) observed at the authorization fence: it must never be
 * dressed up as a 403 permission refusal, and its details stay at the
 * provider's logger boundary - the transport answers this stable envelope.
 */
export const RBAC_GATE_FAULT_RESPONSE = {
  status: 500,
  body: JSON.stringify({ error: { code: 'internal_error', message: 'Internal error' } }),
} as const
