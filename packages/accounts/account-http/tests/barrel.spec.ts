import { describe, expect, it } from 'vitest'
import * as AccountHttp from '../src/index.ts'

describe('package barrel', () => {
  it('exposes the composition-consumable surface', () => {
    const expected = [
      'AUTH_CONFIG_FILENAME',
      'AUTH_DISABLED_USER_EMAIL',
      'AUTH_DISABLED_USER_ID',
      'AUTH_ERROR_CODES',
      'AUTH_ROUTER_ERROR_CODES',
      'AUTH_ROUTE_PREFIX',
      'ApiAuthorizer',
      'CORS_ORIGINS_ENV_VAR',
      'CSRF_COOKIE_NAME',
      'Config',
      'DEFAULT_MAX_TRACKED_KEYS',
      'DEFAULT_RATE_LIMIT_MAX_ATTEMPTS',
      'DEFAULT_RATE_LIMIT_WINDOW_MS',
      'INSECURE_PERSISTENT_COOKIE_ENV',
      'MAX_AUTH_BODY_BYTES',
      'PERSISTENT_COOKIE_NAME',
      'RateLimiter',
      'SESSION_COOKIE_NAME',
      'apply',
      'authDisabledPrincipal',
      'configuredCorsOrigins',
      'createAuthRouteHandler',
      'defaultAuthConfigPath',
      'inject',
      'isAllowedAuthOrigin',
      'isLoopbackHostname',
      'isSecureRequest',
      'name',
      'normalizeOrigin',
      'parseCookies',
      'readRegistrationEnabled',
      'rememberMeFromCookie',
      'requestHostname',
      'requestOrigin',
      'resolveSessionCookiePolicy',
      'serializeClearCookie',
      'serializeCsrfCookie',
      'serializeSessionCookies',
    ].sort()
    expect(Object.keys(AccountHttp).sort()).toEqual(expected)
  })
})
