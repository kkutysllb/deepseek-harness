/**
 * Package-owned invariant companion for `@qilin/sdk-app`.
 * @module @qilin/sdk-app/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@qilin/invariants'

const PACKAGE_NAME = '@qilin/sdk-app'

/** Cordis companion plugin name. */
export const name = 'sdk-app-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: the bundle adds a process transport and startup latch;
 * source/built stdio tests own frame purity, help exclusion, and shutdown.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
