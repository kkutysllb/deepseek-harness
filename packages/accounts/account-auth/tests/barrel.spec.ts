import { describe, expect, it } from 'vitest'
import * as AccountAuth from '../src/index.ts'

describe('package barrel', () => {
  it('exposes the S3-consumable surface', () => {
    const expected = [
      'AUTH_DISABLED_ENV_VAR',
      'AuthDisabledProhibitedError',
      'CSRF_COOKIE_NAME',
      'CSRF_HEADER_NAME',
      'CSRF_SAFE_METHODS',
      'CSRF_TOKEN_BYTES',
      'CSRF_WRITE_METHODS',
      'DEFAULT_SESSION_TTL_MS',
      'PRODUCTION_ENV_VARS',
      'PRODUCTION_ENV_VALUES',
      'SESSION_ID_PATTERN',
      'SessionCorruptError',
      'SessionService',
      'SessionValidationError',
      'assertAuthDisabledAllowed',
      'authDisabledWarning',
      'defaultRandomToken',
      'evaluateCsrfRequest',
      'isAuthDisabledRequested',
      'isExplicitProductionEnvironment',
      'mintCsrfToken',
      'projectUser',
      'requiresCsrfCheck',
      'resolveAuthDisabled',
      'timingSafeStringEquals',
      'verifyCsrfTokens',
    ].sort()
    expect(Object.keys(AccountAuth).sort()).toEqual(expected)
  })
})
