/**
 * The auth-disabled escape valve (legacy contract G): an explicit opt-in that
 * bypasses authentication for local and E2E runs, refused in an explicit
 * production environment. Unconfigured means authentication is on — the
 * default is the safe direction.
 * @module @qilin/account-auth/auth-disabled
 */

/** The environment variable that requests the escape valve; exactly `1` opts in. */
export const AUTH_DISABLED_ENV_VAR = 'OPENKYLIN_AUTH_DISABLED'

/** Environment variables whose value can mark the deployment as production. */
export const PRODUCTION_ENV_VARS: readonly string[] = ['OPENKYLIN_ENV', 'ENVIRONMENT']

/** The values (case- and whitespace-insensitive) that mark production. */
export const PRODUCTION_ENV_VALUES: readonly string[] = ['prod', 'production']

/**
 * Whether the escape valve was explicitly requested. Only the exact value
 * `1` requests it (legacy semantic); any other spelling is not a request.
 * @param env - environment consulted; defaults to `process.env`.
 * @returns true when `${AUTH_DISABLED_ENV_VAR}=1` is set.
 */
export function isAuthDisabledRequested(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[AUTH_DISABLED_ENV_VAR] === '1'
}

/**
 * Whether the environment explicitly marks itself production through one of
 * {@link PRODUCTION_ENV_VARS} holding one of {@link PRODUCTION_ENV_VALUES}
 * (compared trimmed and lowercased, legacy semantic).
 * @param env - environment consulted; defaults to `process.env`.
 * @returns true when a production marker is present.
 */
export function isExplicitProductionEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return PRODUCTION_ENV_VARS.some(name => productionValue(env[name]) !== undefined)
}

/**
 * Resolve the escape valve for request composition: disabled only when
 * explicitly requested outside an explicit production environment. In
 * production the request resolves to `false` — authentication stays on.
 * @param env - environment consulted; defaults to `process.env`.
 * @returns true when authentication is bypassed.
 */
export function resolveAuthDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isAuthDisabledRequested(env) && !isExplicitProductionEnvironment(env)
}

/**
 * The boot-time fail-loud guard: refuse a deployment that asks to disable
 * authentication inside an explicit production environment, instead of
 * silently serving it with auth on while the operator believes otherwise.
 * @param env - environment consulted; defaults to `process.env`.
 * @throws {AuthDisabledProhibitedError} when the escape valve is requested in production.
 */
export function assertAuthDisabledAllowed(env: NodeJS.ProcessEnv = process.env): void {
  if (isAuthDisabledRequested(env) && isExplicitProductionEnvironment(env)) throw new AuthDisabledProhibitedError()
}

/**
 * The operator-facing warning for an active escape valve; the HTTP layer
 * logs it at startup (legacy warn_if_auth_disabled_enabled semantic).
 * @param env - environment consulted; defaults to `process.env`.
 * @returns the warning text, or null when the valve is inactive.
 */
export function authDisabledWarning(env: NodeJS.ProcessEnv = process.env): string | null {
  if (!resolveAuthDisabled(env)) return null
  return `${AUTH_DISABLED_ENV_VAR}=1 is active: authentication is bypassed and every request runs unauthenticated. Do not enable this in shared or production deployments.`
}

/**
 * A deployment asked to disable authentication in an explicit production
 * environment. Fail loud at composition time so the misconfiguration is
 * fixed, not absorbed.
 */
export class AuthDisabledProhibitedError extends Error {
  /** Construct the refusal naming the variables involved. */
  constructor() {
    super(
      `${AUTH_DISABLED_ENV_VAR}=1 cannot disable authentication in an explicit production environment (${PRODUCTION_ENV_VARS.join(' / ')} must not hold ${PRODUCTION_ENV_VALUES.join(' or ')})`,
    )
    this.name = 'AuthDisabledProhibitedError'
  }
}

/** Normalize one candidate production value, or undefined when it is not one. */
function productionValue(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  const normalized = raw.trim().toLowerCase()
  return PRODUCTION_ENV_VALUES.includes(normalized) ? normalized : undefined
}
