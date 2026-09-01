/** Package-owned invariant companion. @module @qilin/api-workspace-controller/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@qilin/invariants'

const PACKAGE_NAME = '@qilin/api-workspace-controller'

/** Cordis companion plugin name. */
export const name = 'api-workspace-controller-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: Workspace Registry owns persistence; every stream generation is a full projection. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
