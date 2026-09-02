/**
 * The optional /api authentication contract the accounts composition may
 * provide as the 'apiAuth' service. Structural on purpose: the transport
 * layer knows only this shape and consults it by name at the same fence
 * points as the browser-trust check - never the account packages themselves.
 * The implementation lives in @qilin/account-http (cookie-first session
 * resolution, Bearer fallback, CSRF judgment, auth-disabled valve).
 * @module @qilin/client-connection/api-auth-gate
 */
export {};
//# sourceMappingURL=api-auth-gate.js.map