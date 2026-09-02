/**
 * The account HTTP plugin: composes the account store and the session
 * service, registers the /api/v1/auth route family on the webServer, and
 * provides the 'apiAuth' gate every /api business route and WebSocket
 * upgrade consults (the structural contract in @qilin/client-connection).
 * Boot resolves the auth-disabled escape valve: an explicit production
 * environment asking for the valve refuses to compose, and an active valve
 * logs the operator warning before serving anything.
 * @module @qilin/account-http/plugin
 */

import type { IncomingMessage } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@qilin/host-webserver'
import {
  assertAuthDisabledAllowed,
  authDisabledWarning,
  resolveAuthDisabled,
  SessionService,
} from '@qilin/account-auth'
import { SqliteAccountStore } from '@qilin/account-core'
import { createAuthRouteHandler, AUTH_ROUTE_PREFIX } from './auth-router.ts'
import { createAdminUsersRouteHandler, ADMIN_USERS_ROUTE_PREFIX } from './admin-users-router.ts'
import { ApiAuthorizer } from './gate.ts'
import { defaultAuthConfigPath } from './registration-config.ts'
import { RateLimiter } from './rate-limit.ts'

/** Stable Cordis plugin name. */
export const name = 'account-http'

/** Services required before the account HTTP surface can mount. */
export const inject = ['webServer']

/** Plugin config: storage locations and the rate-limit budget. */
export interface Config {
  /** Account database file path (or :memory:); defaults to <home>/qilin-accounts/accounts.db. */
  dbPath?: string
  /** Registration-switch file path; defaults to <home>/qilin-accounts/auth-config.json. */
  authConfigPath?: string
  /** Rate limit: attempts per IP per window across login and register; default 10. */
  rateLimitMaxAttempts?: number
  /** Rate limit window length in milliseconds; default 300000. */
  rateLimitWindowMs?: number
}

/** Schema for {@link Config}; absent fields fall back to their documented defaults. */
export const Config: z<Config> = z.object({
  dbPath: z.string(),
  authConfigPath: z.string(),
  rateLimitMaxAttempts: z.natural().min(1),
  rateLimitWindowMs: z.natural().min(1),
})

/**
 * Mount the account HTTP surface.
 * @param ctx - plugin context carrying the webServer service.
 * @param config - validated {@link Config}; hand-built test contexts may omit it.
 */
export function apply(ctx: Context, config?: Config): void {
  const env = process.env
  // Boot guard (contract G): a production deployment asking for the valve
  // fails the composition instead of silently serving with auth on.
  assertAuthDisabledAllowed(env)
  const authDisabled = resolveAuthDisabled(env)
  const warning = authDisabledWarning(env)
  if (warning !== null) ctx.logger.warn(warning)

  const store = new SqliteAccountStore({ ...(config?.dbPath !== undefined ? { path: config.dbPath } : {}), env })
  ctx.effect(() => () => { store.close() }, 'account-http: account store')
  const sessions = new SessionService({ store })
  const limiter = new RateLimiter({
    ...(config?.rateLimitMaxAttempts !== undefined ? { maxAttempts: config.rateLimitMaxAttempts } : {}),
    ...(config?.rateLimitWindowMs !== undefined ? { windowMs: config.rateLimitWindowMs } : {}),
  })
  const authorizer = new ApiAuthorizer({ sessions, authDisabled })
  const adminUsersHandler = createAdminUsersRouteHandler({
    store,
    sessions,
    env,
    authDisabled,
    warn: (error) => { ctx.logger.warn(error) },
  })
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: ADMIN_USERS_ROUTE_PREFIX, handler: adminUsersHandler }),
    'account-http: /api/v1/admin/users routes',
  )
  const handler = createAuthRouteHandler({
    store,
    sessions,
    env,
    authDisabled,
    authConfigPath: config?.authConfigPath ?? defaultAuthConfigPath(env),
    limiter,
    warn: (error) => { ctx.logger.warn(error) },
  })
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: AUTH_ROUTE_PREFIX, handler }),
    'account-http: /api/v1/auth routes',
  )
  // The transport layer reads this service by name under its structural
  // ApiAuthGate contract; this package deliberately does not import it.
  ctx.provide('apiAuth', {
    checkRequest: (request: IncomingMessage) => authorizer.checkRequest(request),
    checkUpgrade: (request: IncomingMessage) => authorizer.checkUpgrade(request),
  })
}
