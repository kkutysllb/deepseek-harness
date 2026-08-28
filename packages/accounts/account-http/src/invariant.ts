/**
 * Package-owned invariant companion for `@qilin/account-http`.
 * @module @qilin/account-http/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@qilin/invariants'

const PACKAGE_NAME = '@qilin/account-http'

/** Cordis companion plugin name. */
export const name = 'account-http-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the package owns no durable state of its own -
 * accounts and sessions live in the account-core store, the rate-limit table
 * is deliberately ephemeral process memory, and the registration switch is
 * an operator-owned config file re-read per request - leaving no independent
 * event stream or cross-plugin relation for a companion to observe.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
