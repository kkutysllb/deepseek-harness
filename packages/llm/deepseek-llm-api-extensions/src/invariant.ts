/** Package-owned invariant companion for `@qilin/deepseek-llm-api-extensions`. */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@qilin/invariants'

const PACKAGE_NAME = '@qilin/deepseek-llm-api-extensions'

/** Cordis companion plugin name. */
export const name = 'deepseek-llm-api-extensions-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: duplicate ownership, detached output, and one acceptance
 * settlement are enforced inside the registry operation that owns each decision.
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
