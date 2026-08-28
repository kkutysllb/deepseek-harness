/**
 * The owner_check equivalent (contract N): the functional ownership test a
 * route handler composes with its permission check. Admins pass through
 * ownership like the legacy gateway's require_permission(owner_check); an
 * absent owner referent fails closed.
 * @module @qilin/account-rbac/owner
 */

import { principalRole, type RbacPrincipal } from './principal.ts'

/**
 * Judge whether the principal owns the resource behind one owner id.
 * @param principal - the request principal.
 * @param ownerId - the resource's owning account id, when the caller has one.
 * @returns true for the owner and the admin role (including the
 * auth-disabled synthetic admin); false for everyone else and for a
 * missing referent.
 */
export function ownerCheck(principal: RbacPrincipal, ownerId: string | null | undefined): boolean {
  if (ownerId === null || ownerId === undefined || ownerId === '') return false
  if (principalRole(principal) === 'admin') return true
  return principal.user?.id === ownerId
}
