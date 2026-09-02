/**
 * Assembly-time catalog filtering (contract M, D5 adaptation clause d): the
 * composition-layer projection that removes policy-denied resources from a
 * role's catalog before anything reaches the wire. One predicate with the
 * runtime resource decision, so a resource hidden at assembly time is also
 * refused at run time.
 * @module @qilin/account-rbac/catalog
 */

import { isResourceKind, matchesPattern, type ResourceKind } from './permissions.ts'
import type { ResourcePolicy } from './policy.ts'
import { principalRole, type RbacPrincipal } from './principal.ts'

/** Inputs for one catalog projection. */
export interface CatalogFilterOptions {
  /** The principal whose role the catalog is projected for. */
  readonly principal: RbacPrincipal
  /** The loaded policy; null keeps catalogs untouched (default-off parity). */
  readonly policy: ResourcePolicy | null
  /** Which resource kind this catalog is. */
  readonly resource: ResourceKind
}

/**
 * Project one catalog for one principal. An unresolved identity gets an
 * empty catalog (fail-closed); with no policy the entries pass through
 * unchanged; with rules, the shared visibility predicate decides each entry.
 * @param entries - the catalog entries, each carrying its resource name.
 * @param options - the principal, the policy, and the catalog's resource kind.
 * @returns the filtered entries; invalid resource kinds and unresolved identities return
 * an empty list, and the caller's array is never mutated.
 */
export function filterCatalog<T extends { readonly name: string }>(
  entries: readonly T[],
  options: CatalogFilterOptions,
): T[] {
  const role = principalRole(options.principal)
  if (role === null || !isResourceKind(options.resource)) return []
  const rules = options.policy === null ? undefined : options.policy.roles[role]?.[options.resource]
  if (rules === undefined) return [...entries]
  return entries.filter((entry) => {
    if (rules.deny?.some(pattern => matchesPattern(pattern, entry.name))) return false
    if (role === 'admin') return true
    if (rules.allow === undefined) return true
    return rules.allow.some(pattern => matchesPattern(pattern, entry.name))
  })
}
