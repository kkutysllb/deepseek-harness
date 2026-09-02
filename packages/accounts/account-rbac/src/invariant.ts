/**
 * Package-owned invariant companion for `@qilin/account-rbac`.
 * @module @qilin/account-rbac/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@qilin/invariants'

const PACKAGE_NAME = '@qilin/account-rbac'

/** Cordis companion plugin name. */
export const name = 'account-rbac-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the package owns no durable state of its own - the
 * policy document is boot-read operator config, principals and verdicts are
 * per-request values, and catalog filters are pure projections - leaving no
 * independent event stream or cross-plugin relation for a companion to
 * observe.
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
