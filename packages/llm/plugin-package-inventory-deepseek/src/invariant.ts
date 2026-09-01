/** Package-owned invariant companion for `@qilin/plugin-package-inventory-deepseek`. */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@qilin/invariants'

const PACKAGE_NAME = '@qilin/plugin-package-inventory-deepseek'

/** Cordis companion plugin name. */
export const name = 'plugin-package-inventory-deepseek-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: each request reads authoritative Loader fiber state and
 * package manifests directly; the plugin retains no independently mutable inventory.
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
