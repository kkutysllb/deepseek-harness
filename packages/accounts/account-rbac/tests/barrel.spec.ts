import { describe, expect, it } from 'vitest'
import * as AccountRbac from '../src/index.ts'

describe('package barrel', () => {
  it('exposes the composition-consumable surface', () => {
    const expected = [
      'Config',
      'DEFAULT_USER_BASELINE',
      'PolicyConfigError',
      'RBAC_AUTH_DISABLED_USER_EMAIL',
      'RBAC_AUTH_DISABLED_USER_ID',
      'RBAC_ERROR_CODES',
      'RESOURCE_KINDS',
      'RbacAuthorizer',
      'anonymousPrincipal',
      'apply',
      'authDisabledRbacPrincipal',
      'baselineAllows',
      'bindRbacPrincipal',
      'evaluatePolicy',
      'filterCatalog',
      'inject',
      'isPermissionString',
      'isResourceKind',
      'isValidResourceName',
      'loadPolicyFileSync',
      'matchesPattern',
      'name',
      'ownerCheck',
      'parsePermission',
      'principalRole',
      'resourceRulesFor',
      'readBoundRbacPrincipal',
      'resourceVisible',
      'routePermissionForEndpoint',
      'validatePolicyDocument',
    ].sort()
    expect(Object.keys(AccountRbac).sort()).toEqual(expected)
  })
})
