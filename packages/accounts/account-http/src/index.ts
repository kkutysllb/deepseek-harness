/**
 * Account HTTP surface: the /api/v1/auth route family, the /api
 * authentication gate, the cookie policy, the Origin whitelist, the rate
 * limiter, and the Cordis plugin wiring them onto the webServer.
 * @module @qilin/account-http
 */

/* v8 ignore start -- a pure re-export barrel executes no branching logic;
   each symbol's own module carries the coverage. */

export {
  CSRF_COOKIE_NAME,
  INSECURE_PERSISTENT_COOKIE_ENV,
  PERSISTENT_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  type CookieJar,
  type SessionCookiePolicy,
  type SessionCookiePolicyInput,
  isLoopbackHostname,
  isSecureRequest,
  parseCookies,
  rememberMeFromCookie,
  requestHostname,
  resolveSessionCookiePolicy,
  serializeClearCookie,
  serializeCsrfCookie,
  serializeSessionCookies,
} from './cookies.ts'
export {
  AUTH_ROUTE_PREFIX,
  AUTH_ROUTER_ERROR_CODES,
  MAX_AUTH_BODY_BYTES,
  type AuthRouterDeps,
  createAuthRouteHandler,
} from './auth-router.ts'
export {
  AUTH_ERROR_CODES,
  type ApiAuthError,
  type ApiAuthVerdict,
  type ApiAuthorizerOptions,
  type AuthResolution,
  ApiAuthorizer,
} from './gate.ts'
export { CORS_ORIGINS_ENV_VAR, type OriginRequestFacts, configuredCorsOrigins, isAllowedAuthOrigin, normalizeOrigin, requestOrigin } from './origin.ts'
export {
  AUTH_DISABLED_USER_EMAIL,
  AUTH_DISABLED_USER_ID,
  type Principal,
  type PrincipalKind,
  authDisabledPrincipal,
} from './principal.ts'
export { AUTH_CONFIG_FILENAME, type AuthConfigFile, defaultAuthConfigPath, readRegistrationEnabled } from './registration-config.ts'
export {
  DEFAULT_MAX_TRACKED_KEYS,
  DEFAULT_RATE_LIMIT_MAX_ATTEMPTS,
  DEFAULT_RATE_LIMIT_WINDOW_MS,
  type RateLimitVerdict,
  type RateLimiterOptions,
  RateLimiter,
} from './rate-limit.ts'
export { Config, apply, inject, name, type Config as PluginConfig } from './plugin.ts'
