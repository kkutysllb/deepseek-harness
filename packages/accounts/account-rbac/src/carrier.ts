/**
 * The explicit, server-side RBAC principal carrier: the one sanctioned way a
 * composition tells the RBAC fence WHICH principal owns an agent scope. The
 * binding is a deliberate server-side act on a scoped context - never a guess
 * from client metadata, async-local storage, or a raw cookie - and a scope
 * with no binding fails closed (the waterfall projects an empty catalog).
 * @module @qilin/account-rbac/carrier
 */

import type { Context } from '@deepseek-ai/cordis'
import { scopeOf, type ScopeKey } from '@qilin/scope'
import type { RbacPrincipal } from './principal.ts'

/** One binding carries a generation token so stale disposers cannot clear a newer identity. */
interface PrincipalBinding {
  readonly principal: RbacPrincipal
  readonly token: object
}

/** Bindings live per scope key; WeakMap keeps disposed scopes collectable. */
const boundPrincipals = new WeakMap<ScopeKey, PrincipalBinding>()

/**
 * Bind one principal to one scoped agent context. The context MUST carry a
 * scope tag (the tag is the lookup key the waterfall listener reads).
 * Re-binding a scope replaces its previous principal (last bind wins), so a
 * reused scope never keeps a stale identity; the returned disposer removes
 * the binding for teardown - call it when the scope is disposed so no old
 * principal outlives its agent.
 * @param agentCtx - the scoped context (an agent's ctx).
 * @param principal - the server-resolved principal owning that scope.
 * @returns a disposer that unbinds the scope.
 * @throws when the context carries no scope tag.
 */
export function bindRbacPrincipal(agentCtx: Context, principal: RbacPrincipal): () => void {
  const key = scopeOf(agentCtx)
  if (key === undefined) {
    throw new Error('bindRbacPrincipal requires a scoped agent context (createScope) - no scope tag to bind onto')
  }
  const token = {}
  boundPrincipals.set(key, { principal, token })
  return () => {
    if (boundPrincipals.get(key)?.token === token) boundPrincipals.delete(key)
  }
}

/**
 * Read the principal bound to one scope, if any.
 * @param scope - the scope key from the assembly context.
 * @returns the bound principal, or undefined when nothing is bound (the
 * caller must fail closed).
 */
export function readBoundRbacPrincipal(scope: ScopeKey | undefined): RbacPrincipal | undefined {
  return scope === undefined ? undefined : boundPrincipals.get(scope)?.principal
}
