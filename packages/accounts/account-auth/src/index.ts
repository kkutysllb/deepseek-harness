/**
 * Account session and CSRF services: session issue/validate/revoke over the
 * account store, typed contract-C session errors, pure CSRF double-submit
 * decisions, and the auth-disabled escape valve. No HTTP surface lives here;
 * routing, cookies, and statuses belong to the HTTP package.
 * @module @qilin/account-auth
 */

/* v8 ignore start -- a pure re-export barrel executes no branching logic;
   each symbol's own module carries the coverage. */

export { timingSafeStringEquals } from './compare.ts'
export { SessionCorruptError, SessionValidationError, type SessionErrorCode } from './errors.ts'
export {
  AUTH_DISABLED_ENV_VAR,
  AuthDisabledProhibitedError,
  PRODUCTION_ENV_VARS,
  PRODUCTION_ENV_VALUES,
  assertAuthDisabledAllowed,
  authDisabledWarning,
  isAuthDisabledRequested,
  isExplicitProductionEnvironment,
  resolveAuthDisabled,
} from './auth-disabled.ts'
export {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  CSRF_SAFE_METHODS,
  CSRF_TOKEN_BYTES,
  CSRF_WRITE_METHODS,
  type CsrfDecision,
  type CsrfExemptions,
  type CsrfRejectReason,
  type CsrfRequestFacts,
  type CsrfSkipReason,
  type RandomToken,
  defaultRandomToken,
  evaluateCsrfRequest,
  mintCsrfToken,
  requiresCsrfCheck,
  verifyCsrfTokens,
} from './csrf.ts'
export {
  DEFAULT_SESSION_TTL_MS,
  SESSION_ID_PATTERN,
  SessionService,
  type AuthenticatedSession,
  type IssueSessionInput,
  type IssuedSession,
  type SessionServiceOptions,
  type SessionUser,
  projectUser,
} from './session-service.ts'
