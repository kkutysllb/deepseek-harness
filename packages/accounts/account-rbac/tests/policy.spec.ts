import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SystemRole } from '@qilin/account-core'
import type { ResourceKind } from '../src/permissions.ts'
import {
  PolicyConfigError,
  evaluatePolicy,
  loadPolicyFileSync,
  resourceRulesFor,
  resourceVisible,
  validatePolicyDocument,
} from '../src/policy.ts'

const ghost = 'ghost' as unknown as SystemRole

const valid = {
  version: 1,
  roles: {
    user: {
      tool: { deny: ['schedule_create'], allow: ['schedule_*'] },
      model: { allow: ['deepseek-*'] },
      route: { deny: ['settings:update', 'session:list'] },
    },
    admin: { mcp_server: { deny: ['legacy-*'] } },
  },
}

describe('policy document validation (contract L: invalid policy refuses boot, fail-closed)', () => {
  it('accepts a complete document', () => {
    const policy = validatePolicyDocument(valid)
    expect(policy.version).toBe(1)
    expect(resourceRulesFor(policy, 'user', 'tool')?.deny).toEqual(['schedule_create'])
    expect(resourceRulesFor(policy, 'admin', 'mcp_server')?.deny).toEqual(['legacy-*'])
  })

  it('accepts an empty roles map and rule sections with only one side', () => {
    const policy = validatePolicyDocument({ version: 1, roles: { user: { skill: { deny: ['*'] } } } })
    expect(resourceRulesFor(policy, 'user', 'skill')?.deny).toEqual(['*'])
    expect(validatePolicyDocument({ version: 1, roles: {} }).roles).toEqual({})
  })

  it.each([
    ['null document', null],
    ['array document', []],
    ['number document', 42],
    ['string document', 'policy'],
    ['missing version', { roles: {} }],
    ['unknown version', { version: 2, roles: {} }],
    ['string version', { version: '1', roles: {} }],
    ['missing roles', { version: 1 }],
    ['array roles', { version: 1, roles: [] }],
    ['unknown role', { version: 1, roles: { superadmin: {} } }],
    ['non-object role section', { version: 1, roles: { user: 7 } }],
    ['unknown resource kind', { version: 1, roles: { user: { widget: { allow: ['a'] } } } }],
    ['non-object rules', { version: 1, roles: { user: { tool: 5 } } }],
    ['allow not an array', { version: 1, roles: { user: { tool: { allow: 'a' } } } }],
    ['non-string deny entry', { version: 1, roles: { user: { tool: { deny: [3] } } } }],
    ['empty pattern', { version: 1, roles: { user: { tool: { deny: [''] } } } }],
    ['whitespace pattern', { version: 1, roles: { user: { tool: { allow: ['a b'] } } } }],
    ['colon in a non-route pattern', { version: 1, roles: { user: { tool: { allow: ['a:b'] } } } }],
    ['route pattern without a colon', { version: 1, roles: { user: { route: { allow: ['sessionlist'] } } } }],
    ['route pattern with two colons', { version: 1, roles: { user: { route: { deny: ['a:b:c'] } } } }],
    ['internal wildcard', { version: 1, roles: { user: { tool: { deny: ['a*b'] } } } }],
    ['empty allow array', { version: 1, roles: { user: { tool: { allow: [] } } } }],
    ['empty deny array', { version: 1, roles: { user: { tool: { deny: [] } } } }],
    ['unknown key inside rules', { version: 1, roles: { user: { tool: { allow: ['a'], block: ['b'] } } } }],
    ['unknown top-level key', { version: 1, roles: {}, extra: true }],
  ])('rejects %s with a PolicyConfigError', (_label, document) => {
    expect(() => validatePolicyDocument(document)).toThrow(PolicyConfigError)
  })
})

describe('policy evaluation (contract L: deny always wins)', () => {
  const policy = validatePolicyDocument(valid)

  it('answers deny when any deny pattern matches, even beside a matching allow', () => {
    expect(evaluatePolicy(policy, 'user', 'tool', 'schedule_create')).toBe('deny')
  })

  it('answers allow when only allow patterns match', () => {
    expect(evaluatePolicy(policy, 'user', 'tool', 'schedule_list')).toBe('allow')
  })

  it('answers undecided when no pattern matches, the kind has no rules, or the role is unknown', () => {
    expect(evaluatePolicy(policy, 'user', 'tool', 'other_tool')).toBe('undecided')
    expect(evaluatePolicy(policy, 'user', 'skill', 'anything')).toBe('undecided')
    expect(evaluatePolicy(policy, ghost, 'tool', 'schedule_create')).toBe('undecided')
  })

  it('carries role-scoped rules separately: an admin deny does not reach the user section', () => {
    expect(evaluatePolicy(policy, 'admin', 'mcp_server', 'legacy-fs')).toBe('deny')
    expect(evaluatePolicy(policy, 'admin', 'mcp_server', 'filesystem')).toBe('undecided')
    expect(evaluatePolicy(policy, 'user', 'mcp_server', 'legacy-fs')).toBe('undecided')
  })

  it('fails closed for invalid runtime kinds and candidates', () => {
    const unknownKind = 'widget' as unknown as ResourceKind
    expect(resourceRulesFor(policy, 'user', unknownKind)).toBeUndefined()
    expect(evaluatePolicy(policy, 'user', unknownKind, 'schedule_create')).toBe('undecided')
    const garbageNames: unknown[] = [42]
    for (const name of garbageNames) expect(evaluatePolicy(policy, 'user', 'tool', name as string)).toBe('undecided')
    expect(resourceVisible('schedule_create', 'user', policy, unknownKind)).toBe(false)
    for (const name of garbageNames) expect(resourceVisible(name as string, 'user', policy, 'tool')).toBe(false)
    expect(resourceVisible('anything', ghost, policy, 'tool')).toBe(false)
  })
})

describe('resource visibility (catalog and runtime share one predicate)', () => {
  const policy = validatePolicyDocument(valid)

  it('removes denied entries for the user', () => {
    expect(resourceVisible('schedule_create', 'user', policy, 'tool')).toBe(false)
    expect(resourceVisible('schedule_list', 'user', policy, 'tool')).toBe(true)
  })

  it('applies allow-list mode to the user when allow entries exist', () => {
    expect(resourceVisible('gpt-4', 'user', policy, 'model')).toBe(false)
    expect(resourceVisible('deepseek-chat', 'user', policy, 'model')).toBe(true)
  })

  it('binds explicit admin denies but never admin allow-lists (deny wins, admin stays full)', () => {
    expect(resourceVisible('legacy-fs', 'admin', policy, 'mcp_server')).toBe(false)
    expect(resourceVisible('filesystem', 'admin', policy, 'mcp_server')).toBe(true)
    expect(resourceVisible('other-tool', 'admin', policy, 'tool')).toBe(true)
  })

  it('runs in deny-list mode for a user when only deny entries exist', () => {
    const denyOnly = validatePolicyDocument({ version: 1, roles: { user: { route: { deny: ['settings:update'] } } } })
    expect(resourceVisible('settings:update', 'user', denyOnly, 'route')).toBe(false)
    expect(resourceVisible('session:list', 'user', denyOnly, 'route')).toBe(true)
  })
})

describe('policy file loading (assembly-time read, contract M)', () => {
  it('reads and validates a policy file from disk', () => {
    const root = mkdtempSync(join(tmpdir(), 'account-rbac-policy-'))
    const path = join(root, 'rbac-policy.json')
    writeFileSync(path, JSON.stringify(valid))
    const policy = loadPolicyFileSync(path)
    expect(evaluatePolicy(policy, 'user', 'tool', 'schedule_create')).toBe('deny')
  })

  it('fails loud on a missing file, broken JSON, and an invalid document', () => {
    const root = mkdtempSync(join(tmpdir(), 'account-rbac-policy-'))
    expect(() => loadPolicyFileSync(join(root, 'absent.json'))).toThrow(PolicyConfigError)
    const broken = join(root, 'broken.json')
    writeFileSync(broken, '{"version": 1,')
    expect(() => loadPolicyFileSync(broken)).toThrow(PolicyConfigError)
    const invalid = join(root, 'invalid.json')
    writeFileSync(invalid, JSON.stringify({ version: 1, roles: { ghost: {} } }))
    expect(() => loadPolicyFileSync(invalid)).toThrow(PolicyConfigError)
  })
})

describe('policy file error hygiene (stable codes; no path, errno, or parser leakage)', () => {
  const root = mkdtempSync(join(tmpdir(), 'account-rbac-policy-hygiene-'))
  const secret = join(root, 'allocate-policy-9f21.json')

  it('keeps the absolute path and fs errno out of the unreadable-file refusal', () => {
    let thrown: unknown
    try {
      loadPolicyFileSync(secret)
      expect.unreachable()
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(PolicyConfigError)
    const refusal = thrown as PolicyConfigError
    expect(refusal.message).not.toContain(secret)
    expect(refusal.message).not.toContain('9f21')
    expect(refusal.message).not.toMatch(/ENOENT|EACCES|errno/i)
    expect(refusal.code).toBe('policy-file-unreadable')
    // The raw cause survives for the internal logger boundary only.
    expect(refusal.cause).toBeDefined()
  })

  it('keeps the path and JSON parser detail out of the parse refusal', () => {
    writeFileSync(secret, '{"version":1,"roles":')
    let thrown: unknown
    try {
      loadPolicyFileSync(secret)
      expect.unreachable()
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(PolicyConfigError)
    const refusal = thrown as PolicyConfigError
    expect(refusal.message).not.toContain(secret)
    expect(refusal.message).not.toContain('Unexpected token')
    expect(refusal.message).not.toMatch(/position \d+/)
    expect(refusal.code).toBe('policy-file-json')
    expect(refusal.cause).toBeDefined()
  })

  it('keeps schema refusals stable and free of the path while naming the content reason', () => {
    writeFileSync(secret, JSON.stringify({ version: 1, roles: { ghost: {} } }))
    let thrown: unknown
    try {
      loadPolicyFileSync(secret)
      expect.unreachable()
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(PolicyConfigError)
    const refusal = thrown as PolicyConfigError
    expect(refusal.message).not.toContain(secret)
    expect(refusal.message).toContain('ghost')
    expect(refusal.code).toBe('policy-schema')
  })
})
