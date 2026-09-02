/**
 * The optional /api RBAC contract the accounts composition may provide as
 * the 'rbacAuth' service. Structural on purpose: the transport layer knows
 * only this shape and consults it by name immediately after the apiAuth
 * authentication fence on the /api channel - never the account packages
 * themselves. The implementation lives in @qilin/account-rbac (request
 * Principal, role baseline, config-driven resource policy, deny-wins).
 * @module @qilin/client-connection/rbac-auth-gate
 */
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
};
//# sourceMappingURL=rbac-auth-gate.js.map