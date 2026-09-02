/**
 * Account RBAC: the request Principal construction point, the role baseline
 * permissions, the config-driven resource policy with deny-wins evaluation,
 * the assembly-time catalog filter, the functional owner check, and the
 * Cordis plugin providing the optional rbacAuth /api fence.
 * @module @qilin/account-rbac
 */

/* v8 ignore start -- a pure re-export barrel executes no branching logic;
   each symbol's own module carries the coverage. */

export {
  DEFAULT_USER_BASELINE,
  RESOURCE_KINDS,
  baselineAllows,
  matchesPattern,
  parsePermission,
  routePermissionForEndpoint,
  type PermissionParts,
  type ResourceKind,
} from './permissions.ts'
export {
  PolicyConfigError,
  evaluatePolicy,
  loadPolicyFileSync,
  resourceRulesFor,
  resourceVisible,
  validatePolicyDocument,
  type PolicyRules,
  type PolicyVerdict,
  type ResourcePolicy,
  type RolePolicy,
} from './policy.ts'
export {
  RBAC_AUTH_DISABLED_USER_EMAIL,
  RBAC_AUTH_DISABLED_USER_ID,
  anonymousPrincipal,
  authDisabledRbacPrincipal,
  principalRole,
  type PrincipalSessionMetadata,
  type RbacPrincipal,
  type RbacPrincipalKind,
} from './principal.ts'
export { bindRbacPrincipal, readBoundRbacPrincipal } from './carrier.ts'
export { isPermissionString, isResourceKind, isValidResourceName } from './permissions.ts'
export { ownerCheck } from './owner.ts'
export { filterCatalog, type CatalogFilterOptions } from './catalog.ts'
export {
  RBAC_ERROR_CODES,
  RbacAuthorizer,
  type RbacAuthorizerOptions,
  type RbacRequestVerdict,
} from './authorizer.ts'
export { Config, apply, inject, name, type Config as PluginConfig } from './plugin.ts'

/* v8 ignore end */
