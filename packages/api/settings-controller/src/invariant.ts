/** Package-owned invariant companion. @module @qilin/api-settings-controller/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@qilin/invariants'

const PACKAGE_NAME = '@qilin/api-settings-controller'

/** Cordis companion plugin name. */
export const name = 'api-settings-controller-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the settings and credential seams own storage and
 * update events, while this package only projects their methods onto the wire.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
