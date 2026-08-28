import { describe, expect, it } from 'vitest'
import { filterCatalog } from '../src/catalog.ts'
import { validatePolicyDocument } from '../src/policy.ts'
import { anonymousPrincipal, authDisabledRbacPrincipal } from '../src/principal.ts'
import { sessionPrincipal } from './principal.spec.ts'

/** Real engine tool names from @qilin/schedule - the assembly-filter proof surface. */
const SCHEDULE_TOOLS = [
  { name: 'schedule_create' },
  { name: 'schedule_list' },
  { name: 'schedule_delete' },
] as const

const userDeniedCreate = validatePolicyDocument({
  version: 1,
  roles: { user: { tool: { deny: ['schedule_create'] } } },
})

describe('assembly-time catalog filtering (contract M, B2 clause d)', () => {
  it('leaves the catalog untouched when no policy is loaded (default-off parity with S3)', () => {
    const filtered = filterCatalog(SCHEDULE_TOOLS, { principal: sessionPrincipal('user', 'u-1'), policy: null, resource: 'tool' })
    expect(filtered.map(tool => tool.name)).toEqual(['schedule_create', 'schedule_list', 'schedule_delete'])
  })

  it('hands an unresolved identity an empty catalog (fail-closed), with or without a policy', () => {
    for (const policy of [null, userDeniedCreate] as const) {
      expect(filterCatalog(SCHEDULE_TOOLS, { principal: anonymousPrincipal(), policy, resource: 'tool' })).toEqual([])
    }
  })

  it('keeps a real tool visible for admin and removes it for the denied user', () => {
    const admin = filterCatalog(SCHEDULE_TOOLS, { principal: sessionPrincipal('admin', 'a-1'), policy: userDeniedCreate, resource: 'tool' })
    expect(admin.map(tool => tool.name)).toEqual(['schedule_create', 'schedule_list', 'schedule_delete'])
    const user = filterCatalog(SCHEDULE_TOOLS, { principal: sessionPrincipal('user', 'u-1'), policy: userDeniedCreate, resource: 'tool' })
    expect(user.map(tool => tool.name)).toEqual(['schedule_list', 'schedule_delete'])
  })

  it('binds an explicit admin deny (deny wins for every role)', () => {
    const policy = validatePolicyDocument({
      version: 1,
      roles: { admin: { tool: { deny: ['schedule_delete'] } } },
    })
    const admin = filterCatalog(SCHEDULE_TOOLS, { principal: sessionPrincipal('admin', 'a-1'), policy, resource: 'tool' })
    expect(admin.map(tool => tool.name)).toEqual(['schedule_create', 'schedule_list'])
  })

  it('applies allow-list mode to the user when allow entries exist', () => {
    const policy = validatePolicyDocument({
      version: 1,
      roles: { user: { tool: { allow: ['schedule_list'] } } },
    })
    const user = filterCatalog(SCHEDULE_TOOLS, { principal: sessionPrincipal('user', 'u-1'), policy, resource: 'tool' })
    expect(user.map(tool => tool.name)).toEqual(['schedule_list'])
  })

  it('ignores rules written for another resource kind', () => {
    const policy = validatePolicyDocument({
      version: 1,
      roles: { user: { model: { deny: ['*'] } } },
    })
    const user = filterCatalog(SCHEDULE_TOOLS, { principal: sessionPrincipal('user', 'u-1'), policy, resource: 'tool' })
    expect(user).toHaveLength(3)
  })

  it('filters model catalogs by the same grammar', () => {
    const models = [{ name: 'deepseek-chat' }, { name: 'claude-sonnet' }] as const
    const policy = validatePolicyDocument({
      version: 1,
      roles: { user: { model: { deny: ['claude-*'] } } },
    })
    const user = filterCatalog(models, { principal: sessionPrincipal('user', 'u-1'), policy, resource: 'model' })
    expect(user.map(model => model.name)).toEqual(['deepseek-chat'])
  })

  it('admits the auth-disabled synthetic admin through everything', () => {
    const filtered = filterCatalog(SCHEDULE_TOOLS, { principal: authDisabledRbacPrincipal(), policy: userDeniedCreate, resource: 'tool' })
    expect(filtered).toHaveLength(3)
  })

  it('does not mutate the caller array', () => {
    const entries = [...SCHEDULE_TOOLS]
    filterCatalog(entries, { principal: sessionPrincipal('user', 'u-1'), policy: userDeniedCreate, resource: 'tool' })
    expect(entries).toHaveLength(3)
  })

  it('fails closed for an unknown resource kind', () => {
    const resource = 'widget' as unknown as 'tool'
    for (const policy of [null, userDeniedCreate] as const) {
      expect(filterCatalog(SCHEDULE_TOOLS, { principal: sessionPrincipal('admin', 'a-1'), policy, resource })).toEqual([])
    }
  })
})
