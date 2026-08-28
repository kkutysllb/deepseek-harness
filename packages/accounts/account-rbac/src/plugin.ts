/**
 * The account RBAC plugin: loads the resource policy once at boot (an
 * invalid or explicitly-missing document refuses the composition - the
 * fail-closed load, contract L), consumes the auth-disabled valve, and
 * provides the optional 'rbacAuth' service the client-connection transport
 * consults structurally after its apiAuth fence. Disabled (the default)
 * the plugin provides nothing and /api behaves exactly as before.
 * @module @qilin/account-rbac/plugin
 */

import { existsSync } from 'node:fs'
import type { IncomingMessage } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { assertAuthDisabledAllowed, resolveAuthDisabled, SessionService } from '@qilin/account-auth'
import { SqliteAccountStore } from '@qilin/account-core'
import { RbacAuthorizer } from './authorizer.ts'
import { loadPolicyFileSync, type ResourcePolicy } from './policy.ts'
import type { } from '@qilin/system-prompt'
import { readBoundRbacPrincipal } from './carrier.ts'

/** Stable Cordis plugin name. */
export const name = 'account-rbac'

/** Services required before the RBAC surface can mount (none: it self-composes). */
export const inject: string[] = []

/** Plugin config: the enforcement switch, the policy file, and the account store. */
export interface Config {
  /** Enforcement switch; default false keeps exact pre-RBAC behavior. */
  enabled?: boolean
  /** Resource policy file path; a configured file must exist and validate or the boot refuses. */
  policyPath?: string
  /** Inline policy object (programmatic/tests); `policyPath` wins when both are set. */
  policy?: ResourcePolicy
  /** Account database path; mount with the same path as account-http so sessions are shared. */
  dbPath?: string
}

/** Schema for {@link Config}; absent fields fall back to their documented defaults. */
export const Config: z<Config> = z.object({
  enabled: z.boolean(),
  policyPath: z.string(),
  policy: z.any(),
  dbPath: z.string(),
})

/**
 * Mount the RBAC enforcement surface.
 * @param ctx - plugin context; the provided 'rbacAuth' service is read by name.
 * @param config - validated {@link Config}; hand-built test contexts may omit it.
 */
export function apply(ctx: Context, config?: Config): void {
  if (config?.enabled !== true) return
  const env = process.env
  // Valve boot guard parity (contract G): the same production refusal the
  // HTTP surface enforces also bounds the RBAC valve consumption.
  assertAuthDisabledAllowed(env)
  const authDisabled = resolveAuthDisabled(env)
  let policy: ResourcePolicy | null = null
  if (config.policy !== undefined) policy = config.policy
  if (config.policyPath !== undefined) {
    // A configured path with no file yet is the documented default-off state
    // for the resource-policy layer (baseline matrix alone); a file that
    // exists but fails validation refuses the boot (fail-closed).
    if (existsSync(config.policyPath)) policy = loadPolicyFileSync(config.policyPath)
    else ctx.logger.warn(`account-rbac: policy file ${config.policyPath} does not exist; running the role baseline without resource policy`)
  }
  const store = new SqliteAccountStore({ ...(config.dbPath !== undefined ? { path: config.dbPath } : {}), env })
  ctx.effect(() => () => { store.close() }, 'account-rbac: account store')
  const sessions = new SessionService({ store })
  const authorizer = new RbacAuthorizer({ sessions, authDisabled, policy })
  // Structural by-name provide (the apiAuth precedent): the transport reads
  // this service under its RbacAuthGate contract; this package deliberately
  // does not import the transport.
  ctx.provide('rbacAuth', {
    checkRequest: (request: IncomingMessage, endpoint: string) => {
      try {
        return authorizer.checkRequest(request, endpoint)
      } catch (error) {
        // The logger boundary lives on the provider side (it owns the
        // context logger); the transport maps the rethrown fault to its
        // stable 500 without seeing any detail.
        ctx.logger.error('account-rbac: identity/store fault at the rbac gate:', String(error))
        throw error
      }
    },
  })
  // The REAL assembly-time catalog fence: when the context carries the
  // engine's system prompt service, attach a waterfall listener that runs
  // at the END of the assembly chain (it awaits next() first, so the tools
  // @qilin/tools contributed are already present), then filters
  // assembly.tools through the same visibility predicate the runtime
  // judgment uses, under the principal explicitly bound to the requesting
  // agent scope. A scope with no bound principal fails closed to an empty
  // tool list. The listener registers UNCONDITIONALLY at apply time (no
  // one-shot get, no readiness gate): an RBAC boot that precedes the
  // system-prompt service still ends up attached, and a context that never
  // mounts the service never emits the event at all - the listener just
  // never fires, so the default composition is untouched either way.
  // Restart-to-apply: the listener closes over the policy loaded at boot
  // and never re-reads it.
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next()
    const principal = readBoundRbacPrincipal(context.scope)
    if (principal === undefined) return { ...assembled, tools: [] }
    return {
      ...assembled,
      tools: assembled.tools.filter(tool => authorizer.authorizeResource(principal, 'tool', tool.name)),
    }
  })
}
