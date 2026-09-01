/**
 * Package-owned invariant companion for `@qilin/experimental-agent-team-profile`.
 * @module @qilin/experimental-agent-team-profile/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@qilin/invariants'

const PACKAGE_NAME = '@qilin/experimental-agent-team-profile'

/** Cordis companion plugin name. */
export const name = 'agent-team-profile-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

// No runtime invariant: the package carries only a static profile patch. The
// Team domain and tool packages own the mutable relationships it activates.
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
