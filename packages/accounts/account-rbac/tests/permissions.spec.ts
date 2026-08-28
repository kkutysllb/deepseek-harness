import { describe, expect, it } from 'vitest'
import {
  DEFAULT_USER_BASELINE,
  RESOURCE_KINDS,
  baselineAllows,
  matchesPattern,
  parsePermission,
  routePermissionForEndpoint,
} from '../src/permissions.ts'

describe('permission strings (contract N resource:action)', () => {
  it('parses well-formed resource:action pairs', () => {
    expect(parsePermission('threads:read')).toEqual({ resource: 'threads', action: 'read' })
    expect(parsePermission('session:list')).toEqual({ resource: 'session', action: 'list' })
    expect(parsePermission('settings:update')).toEqual({ resource: 'settings', action: 'update' })
  })

  it.each([
    ['no colon', 'threadsread'],
    ['multiple colons', 'threads:read:extra'],
    ['empty resource', ':read'],
    ['empty action', 'threads:'],
    ['embedded whitespace', 'th reads:read'],
    ['leading whitespace', ' threads:read'],
    ['trailing whitespace', 'threads:read '],
    ['empty string', ''],
  ])('rejects %s', (_label, raw) => {
    expect(() => parsePermission(raw)).toThrow(/permission string/i)
  })

  it('exposes the five engine resource kinds (D3-B: tool/model/skill/mcp_server/route)', () => {
    expect([...RESOURCE_KINDS]).toEqual(['tool', 'model', 'skill', 'mcp_server', 'route'])
  })
})

describe('route permission mapping (the /api endpoint namespace)', () => {
  it.each([
    ['session.list', 'session:list'],
    ['settings.update', 'settings:update'],
    ['a.b.c', 'a:b.c'],
  ])('maps endpoint %s to %s by splitting at the first dot', (endpoint, expected) => {
    expect(routePermissionForEndpoint(endpoint)).toBe(expected)
  })

  it.each([
    ['dot-less segment', 'health'],
    ['dot-less multi-segment path', 'health/probe'],
  ])('maps the endpoint %s under the route resource when it has no dot', (_label, endpoint) => {
    expect(routePermissionForEndpoint(endpoint)).toBe('route:' + endpoint)
  })
})

describe('pattern matcher (shared grammar of baseline and policy)', () => {
  it.each([
    ['*', 'anything'],
    ['*', ''],
    ['schedule_*', 'schedule_create'],
    ['schedule_create', 'schedule_create'],
    ['session:*', 'session:list'],
    ['deepseek-*', 'deepseek-chat'],
  ])('%s matches %s', (pattern, candidate) => {
    expect(matchesPattern(pattern, candidate)).toBe(true)
  })

  it.each([
    ['schedule_*', 'schedulex'],
    ['schedule_create', 'schedule_list'],
    ['settings:*', 'session:list'],
    ['pre*', 'xprey'],
    ['exact', 'exact-but-longer'],
    ['session:*', 'session:list:extra'],
    ['*:read', 'settings:read:extra'],
  ])('%s does not match %s', (pattern, candidate) => {
    expect(matchesPattern(pattern, candidate)).toBe(false)
  })

  it('supports the segment wildcard the role baseline is written in', () => {
    expect(matchesPattern('*:read', 'settings:read')).toBe(true)
    expect(matchesPattern('*:read', 'session:list')).toBe(false)
    expect(matchesPattern('*', 'session:list')).toBe(true)
    expect(matchesPattern('session:*', 'session:list')).toBe(true)
  })

  it('fails closed for non-string matcher inputs', () => {
    const values: unknown[] = [42, null, undefined, {}, []]
    for (const value of values) {
      expect(matchesPattern(value as string, 'x')).toBe(false)
      expect(matchesPattern('x', value as string)).toBe(false)
    }
  })
})

describe('default user baseline (the role default matrix, rationale in the package README)', () => {
  it('allows read-class actions on any resource', () => {
    for (const permission of ['session:list', 'settings:read', 'model:get', 'tools:status', 'catalog:search', 'usage:stats']) {
      expect(baselineAllows(permission)).toBe(true)
    }
  })

  it('allows the conversation domain in full (the engine descendant of the legacy threads/runs set)', () => {
    for (const permission of ['session:create', 'session:update', 'session:delete', 'session:read', 'session:cancel']) {
      expect(baselineAllows(permission)).toBe(true)
    }
  })

  it('denies write-class actions outside the conversation domain (fail-closed default)', () => {
    for (const permission of ['settings:update', 'settings:replace', 'model:deploy', 'credentials:write', 'sessionx:create']) {
      expect(baselineAllows(permission)).toBe(false)
    }
  })

  it('is expressed with the same pattern grammar the policy file uses', () => {
    expect(DEFAULT_USER_BASELINE.length).toBeGreaterThan(0)
    for (const pattern of DEFAULT_USER_BASELINE) {
      expect(() => parsePermission(pattern)).not.toThrow()
    }
  })
})

describe('permission input boundary (fail-closed, no garbage reaches the matcher)', () => {
  const malformed = ['', 'abc', 'a:b:c', ':action', 'resource:', 'a b:c', ' a:c', 'a: c']

  it('refuses malformed permission strings at baselineAllows', () => {
    for (const raw of malformed) expect(baselineAllows(raw)).toBe(false)
  })

  it('refuses non-string runtime input at baselineAllows', () => {
    const garbage: unknown[] = [42, null, undefined, {}, []]
    for (const raw of garbage) expect(baselineAllows(raw as string)).toBe(false)
  })

  it('keeps the legal baseline judgments intact', () => {
    expect(baselineAllows('session:list')).toBe(true)
    expect(baselineAllows('threads:read')).toBe(true)
    expect(baselineAllows('settings:update')).toBe(false)
  })

  it('maps non-string and empty endpoints to the empty permission (dispatch 404s it)', () => {
    const endpoints: unknown[] = [42, null, undefined, {}, '']
    for (const raw of endpoints) expect(routePermissionForEndpoint(raw as string)).toBe('')
  })

  it('keeps the legal endpoint mappings intact', () => {
    expect(routePermissionForEndpoint('session.list')).toBe('session:list')
    expect(routePermissionForEndpoint('health/probe')).toBe('route:health/probe')
    expect(routePermissionForEndpoint('session.list.extra')).toBe('session:list.extra')
  })

  it('rejects non-string parse input with the stable permission error', () => {
    const values: unknown[] = [42, null, undefined, {}, []]
    for (const value of values) expect(() => parsePermission(value as string)).toThrow(/permission string/i)
  })
})
