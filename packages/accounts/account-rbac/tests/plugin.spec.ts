import { DatabaseSync } from 'node:sqlite'
import { Readable } from 'node:stream'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@qilin/scope'
import { defineTool, ToolRuntime } from '@qilin/tools'
import { SystemPrompt } from '@qilin/system-prompt'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionCorruptError } from '@qilin/account-auth'
import { PolicyConfigError } from '../src/policy.ts'
import { Config, apply, inject, name } from '../src/plugin.ts'
import { bindRbacPrincipal } from '../src/carrier.ts'
import { authDisabledRbacPrincipal, type RbacPrincipal } from '../src/principal.ts'

const ENV_VAR = 'QILIN_AUTH_DISABLED'
const savedEnv = process.env[ENV_VAR]

afterEach(() => {
  if (savedEnv === undefined) Reflect.deleteProperty(process.env, ENV_VAR)
  else process.env[ENV_VAR] = savedEnv
})

function requestWithoutCredentials(): Parameters<NonNullable<ReturnType<typeof rbacAuthOf>>['checkRequest']>[0] {
  const request = Readable.from([]) as Parameters<NonNullable<ReturnType<typeof rbacAuthOf>>['checkRequest']>[0]
  Object.assign(request, { headers: {} })
  return request
}

type RbacAuth = { checkRequest(request: object, endpoint: string): { allowed: boolean } }

function rbacAuthOf(ctx: Context): RbacAuth {
  return (ctx as unknown as { rbacAuth: RbacAuth }).rbacAuth
}

describe('account-rbac plugin composition', () => {
  it('exposes the plugin identity with no service injections', () => {
    expect(name).toBe('account-rbac')
    expect(inject).toEqual([])
    expect(Config).toBeDefined()
  })

  it('provides nothing when disabled (the default keeps exact S3 behavior)', () => {
    const ctx = new Context()
    apply(ctx, { enabled: false, dbPath: ':memory:' })
    expect(rbacAuthOf(ctx)).toBeUndefined()
  })

  it('provides the rbacAuth service when enabled without a policy file', () => {
    const ctx = new Context()
    apply(ctx, { enabled: true, dbPath: ':memory:' })
    const gate = rbacAuthOf(ctx)
    expect(typeof gate.checkRequest).toBe('function')
    expect(gate.checkRequest(requestWithoutCredentials(), 'session.list').allowed).toBe(false)
  })

  it('defaults the enabled switch to false when the config omits it', () => {
    const ctx = new Context()
    apply(ctx)
    expect(rbacAuthOf(ctx)).toBeUndefined()
  })

  it('composes without dbPath by falling back to the home-derived store location', () => {
    const home = mkdtempSync(join(tmpdir(), 'account-rbac-home-'))
    const saved = process.env['QILIN_HOME']
    process.env['QILIN_HOME'] = home
    try {
      const ctx = new Context()
      apply(ctx, { enabled: true })
      expect(typeof rbacAuthOf(ctx).checkRequest).toBe('function')
    } finally {
      if (saved === undefined) Reflect.deleteProperty(process.env, 'QILIN_HOME')
      else process.env['QILIN_HOME'] = saved
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('refuses to compose on an invalid policy file (fail-closed boot, contract L)', () => {
    const root = mkdtempSync(join(tmpdir(), 'account-rbac-plugin-'))
    const policyPath = join(root, 'policy.json')
    writeFileSync(policyPath, JSON.stringify({ version: 1, roles: { ghost: {} } }))
    const ctx = new Context()
    expect(() => { apply(ctx, { enabled: true, dbPath: ':memory:', policyPath }) }).toThrow(PolicyConfigError)
    expect(rbacAuthOf(ctx)).toBeUndefined()
  })

  it('warns and runs the baseline when the configured policy file is missing (default-off for the resource layer)', () => {
    const root = mkdtempSync(join(tmpdir(), 'account-rbac-plugin-'))
    const ctx = new Context()
    apply(ctx, { enabled: true, dbPath: ':memory:', policyPath: join(root, 'absent.json') })
    expect(typeof rbacAuthOf(ctx).checkRequest).toBe('function')
  })

  it('composes when the configured policy file validates', () => {
    const root = mkdtempSync(join(tmpdir(), 'account-rbac-plugin-'))
    const policyPath = join(root, 'policy.json')
    writeFileSync(policyPath, JSON.stringify({ version: 1, roles: { user: { tool: { deny: ['schedule_create'] } } } }))
    const ctx = new Context()
    apply(ctx, { enabled: true, dbPath: ':memory:', policyPath })
    expect(typeof rbacAuthOf(ctx).checkRequest).toBe('function')
  })

  it('passes everything under the auth-disabled valve without touching the store', () => {
    process.env[ENV_VAR] = '1'
    const ctx = new Context()
    apply(ctx, { enabled: true, dbPath: ':memory:' })
    const verdict = rbacAuthOf(ctx).checkRequest(requestWithoutCredentials(), 'settings.update')
    expect(verdict.allowed).toBe(true)
  })
})

// REAL composition: real Context + real SystemPrompt + real ToolRuntime +
// two real ToolDefinition registrations; the RBAC plugin attaches its
// waterfall listener BEFORE ToolRuntime mounts on purpose, so the test also
// covers registration order (the listener filters at the waterfall end
// regardless of whether the registry mounted before or after it).
async function mountCatalog(rbacConfig?: Config): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  if (rbacConfig !== undefined) apply(ctx, rbacConfig)
  await ctx.plugin(ToolRuntime)
  ctx.tools.register(defineTool({
    name: 'schedule_create',
    description: 'Create one reminder (real registry entry for the RBAC fence).',
    parameters: {
      prompt: { type: 'string', required: true, description: 'Reminder content.' },
    },
    output: {
      schema: { type: 'boolean' },
      render: () => [{ type: 'text', text: 'ok' }],
    },
    async execute() {
      return true
    },
  }))
  ctx.tools.register(defineTool({
    name: 'schedule_list',
    description: 'List reminders (real registry entry for the RBAC fence).',
    parameters: {},
    output: {
      schema: { type: 'boolean' },
      render: () => [{ type: 'text', text: 'ok' }],
    },
    async execute() {
      return true
    },
  }))
  return ctx
}

function userRbacPrincipal(): RbacPrincipal {
  return {
    kind: 'session',
    user: { id: 'u1', email: 'kid@example.com', systemRole: 'user', needsSetup: false, oauthProvider: null, oauthId: null, sessionVersion: 1, createdAt: 0, updatedAt: 0 },
    session: null,
  }
}

function toolNames(assembly: { tools: ReadonlyArray<{ name: string }> }): string[] {
  return assembly.tools.map(tool => tool.name)
}

describe('assembly-time catalog filtering (system-prompt waterfall, real composition)', () => {

  it('filters the real assembly: the bound user loses schedule_create, the bound admin keeps it', async () => {
    const ctx = await mountCatalog({
      enabled: true,
      dbPath: ':memory:',
      policy: { version: 1, roles: { user: { tool: { deny: ['schedule_create'] } } } },
    })
    try {
      const scopeKey: object = {}
      const agentScope = createScope(ctx, scopeKey)
      bindRbacPrincipal(agentScope.ctx, authDisabledRbacPrincipal())
      const adminAssembly = await ctx.systemPrompt.assemble({ scope: scopeKey })
      expect(toolNames(adminAssembly)).toContain('schedule_create')
      expect(toolNames(adminAssembly)).toContain('schedule_list')
      bindRbacPrincipal(agentScope.ctx, userRbacPrincipal())
      const userAssembly = await ctx.systemPrompt.assemble({ scope: scopeKey })
      expect(toolNames(userAssembly)).not.toContain('schedule_create')
      expect(toolNames(userAssembly)).toContain('schedule_list')
      // The real registry itself is untouched: the fence filters the
      // assembly, it never mutates the registry.
      expect(ctx.tools.schemas().map(schema => schema.name).sort()).toEqual(['schedule_create', 'schedule_list'])
      await agentScope.dispose()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('fails a scope with no bound principal closed to an empty tool list', async () => {
    const ctx = await mountCatalog({ enabled: true, dbPath: ':memory:' })
    try {
      const scopeKey: object = {}
      const agentScope = createScope(ctx, scopeKey)
      const assembly = await ctx.systemPrompt.assemble({ scope: scopeKey })
      expect(assembly.tools).toEqual([])
      await agentScope.dispose()
      // A scope-less assembly has nothing to bind onto: same fail-closed.
      const scopeless = await ctx.systemPrompt.assemble({})
      expect(scopeless.tools).toEqual([])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('keeps the full real registry for a bound principal when no policy is loaded (default parity)', async () => {
    const ctx = await mountCatalog({ enabled: true, dbPath: ':memory:' })
    try {
      const scopeKey: object = {}
      const agentScope = createScope(ctx, scopeKey)
      bindRbacPrincipal(agentScope.ctx, userRbacPrincipal())
      const assembly = await ctx.systemPrompt.assemble({ scope: scopeKey })
      expect(toolNames(assembly).sort()).toEqual(['schedule_create', 'schedule_list'])
      await agentScope.dispose()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('binds through a scoped context and refuses an unscoped one', async () => {
    const ctx = await mountCatalog({ enabled: true, dbPath: ':memory:' })
    try {
      expect(() => bindRbacPrincipal(ctx, userRbacPrincipal())).toThrow(/scoped/)
      const scopeKey: object = {}
      const agentScope = createScope(ctx, scopeKey)
      expect(() => bindRbacPrincipal(agentScope.ctx, userRbacPrincipal())).not.toThrow()
      await agentScope.dispose()
    } finally {
      await ctx.fiber.dispose()
    }
  })
})

describe('rbacAuth gate fault boundary (provider-side log, transport-side 500)', () => {
  it('logs and rethrows a store-level identity fault from the provided rbacAuth gate', () => {
    const root = mkdtempSync(join(tmpdir(), 'account-rbac-fault-'))
    const dbPath = join(root, 'accounts.db')
    try {
      const ctx = new Context()
      apply(ctx, { enabled: true, dbPath })
      // A durable row that references a missing account: store corruption,
      // not a client-side credential problem.
      const db = new DatabaseSync(dbPath)
      db.exec('PRAGMA foreign_keys = OFF')
      db.exec('INSERT INTO sessions (id, user_id, issued_version, persistent, created_at, expires_at) VALUES (\'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\', \'ghost-missing-account\', 1, 0, 0, 99999999999999)')
      db.close()
      const gate = rbacAuthOf(ctx)
      const request = requestWithoutCredentials()
      Object.assign(request, { headers: { cookie: 'access_token=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } })
      expect(() => gate.checkRequest(request, 'session.list')).toThrow(SessionCorruptError)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('catalog fence lifecycle', () => {
  it('attaches the waterfall listener even when systemPrompt mounts after apply (late load)', async () => {
    const ctx = new Context()
    apply(ctx, {
      enabled: true,
      dbPath: ':memory:',
      policy: { version: 1, roles: { user: { tool: { deny: ['schedule_create'] } } } },
    })
    // systemPrompt arrives AFTER the RBAC boot: the fence must still attach.
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime)
    ctx.tools.register(defineTool({
      name: 'schedule_create',
      description: 'Create one reminder (late-load fence coverage).',
      parameters: {
        prompt: { type: 'string', required: true, description: 'Reminder content.' },
      },
      output: {
        schema: { type: 'boolean' },
        render: () => [{ type: 'text', text: 'ok' }],
      },
      async execute() {
        return true
      },
    }))
    // The undenied control: proves a missing tool is the fence filtering,
    // not an empty registry.
    ctx.tools.register(defineTool({
      name: 'schedule_list',
      description: 'List reminders (late-load control).',
      parameters: {},
      output: {
        schema: { type: 'boolean' },
        render: () => [{ type: 'text', text: 'ok' }],
      },
      async execute() {
        return true
      },
    }))
    const scopeKey: object = {}
    const agentScope = createScope(ctx, scopeKey)
    bindRbacPrincipal(agentScope.ctx, userRbacPrincipal())
    const assembly = await ctx.systemPrompt.assemble({ scope: scopeKey })
    // The denied REAL tool is gone ONLY if the fence attached; the control
    // stays, so an empty assembly can never masquerade as a pass.
    expect(toolNames(assembly)).not.toContain('schedule_create')
    expect(toolNames(assembly)).toContain('schedule_list')
    await agentScope.dispose()
    await ctx.fiber.dispose()
  })

  it('unbinds through the returned disposer so a disposed scope keeps no principal', async () => {
    const ctx = await mountCatalog({ enabled: true, dbPath: ':memory:' })
    try {
      const scopeKey: object = {}
      const agentScope = createScope(ctx, scopeKey)
      const unbind = bindRbacPrincipal(agentScope.ctx, userRbacPrincipal())
      const bound = await ctx.systemPrompt.assemble({ scope: scopeKey })
      expect(toolNames(bound).sort()).toEqual(['schedule_create', 'schedule_list'])
      unbind()
      const unbound = await ctx.systemPrompt.assemble({ scope: scopeKey })
      // Without a binding the fence fails closed again.
      expect(unbound.tools).toEqual([])
      await agentScope.dispose()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('does not let an old disposer clear a newer scope binding', async () => {
    const ctx = await mountCatalog({
      enabled: true,
      dbPath: ':memory:',
      policy: { version: 1, roles: { user: { tool: { deny: ['schedule_create'] } } } },
    })
    try {
      const scopeKey: object = {}
      const agentScope = createScope(ctx, scopeKey)
      const unbindUser = bindRbacPrincipal(agentScope.ctx, userRbacPrincipal())
      const unbindAdmin = bindRbacPrincipal(agentScope.ctx, authDisabledRbacPrincipal())
      unbindUser()
      const adminAssembly = await ctx.systemPrompt.assemble({ scope: scopeKey })
      expect(toolNames(adminAssembly).sort()).toEqual(['schedule_create', 'schedule_list'])
      unbindAdmin()
      const unbound = await ctx.systemPrompt.assemble({ scope: scopeKey })
      expect(unbound.tools).toEqual([])
      await agentScope.dispose()
    } finally {
      await ctx.fiber.dispose()
    }
  })
})

describe('carrier disposer generations', () => {
  it('keeps the rebound principal when an older disposer fires', async () => {
    const ctx = await mountCatalog({
      enabled: true,
      dbPath: ':memory:',
      policy: { version: 1, roles: { user: { tool: { deny: ['schedule_create'] } } } },
    })
    try {
      const scopeKey: object = {}
      const agentScope = createScope(ctx, scopeKey)
      const unbindAdmin = bindRbacPrincipal(agentScope.ctx, authDisabledRbacPrincipal())
      const unbindUser = bindRbacPrincipal(agentScope.ctx, userRbacPrincipal())
      // The STALE disposer fires after the scope was rebound to the user: it
      // must not take the newer binding down with it.
      unbindAdmin()
      const assembly = await ctx.systemPrompt.assemble({ scope: scopeKey })
      // The user binding survived: filtered by policy, not failed closed.
      expect(toolNames(assembly)).not.toContain('schedule_create')
      expect(toolNames(assembly)).toContain('schedule_list')
      unbindUser()
      const after = await ctx.systemPrompt.assemble({ scope: scopeKey })
      expect(after.tools).toEqual([])
      await agentScope.dispose()
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
