import { describe, expect, it } from 'vitest'
import {
  AUTH_DISABLED_ENV_VAR,
  AuthDisabledProhibitedError,
  PRODUCTION_ENV_VARS,
  PRODUCTION_ENV_VALUES,
  assertAuthDisabledAllowed,
  authDisabledWarning,
  isAuthDisabledRequested,
  isExplicitProductionEnvironment,
  resolveAuthDisabled,
} from '../src/auth-disabled.ts'

describe('escape valve request (contract G)', () => {
  it('keeps the legacy environment variable contract', () => {
    expect(AUTH_DISABLED_ENV_VAR).toBe('OPENKYLIN_AUTH_DISABLED')
    expect(PRODUCTION_ENV_VARS).toEqual(['OPENKYLIN_ENV', 'ENVIRONMENT'])
    expect(PRODUCTION_ENV_VALUES).toEqual(['prod', 'production'])
  })

  it('recognizes only the exact value 1 as a request', () => {
    const table: { env: Record<string, string>; requested: boolean }[] = [
      { env: {}, requested: false },
      { env: { OPENKYLIN_AUTH_DISABLED: '1' }, requested: true },
      { env: { OPENKYLIN_AUTH_DISABLED: '0' }, requested: false },
      { env: { OPENKYLIN_AUTH_DISABLED: 'true' }, requested: false },
      { env: { OPENKYLIN_AUTH_DISABLED: '' }, requested: false },
      { env: { OPENKYLIN_AUTH_DISABLED: ' 1' }, requested: false },
      { env: { OPENKYLIN_AUTH_DISABLED: '1 ' }, requested: false },
    ]
    for (const { env, requested } of table) {
      expect(isAuthDisabledRequested(env), JSON.stringify(env)).toBe(requested)
    }
  })
})

describe('explicit production detection (contract G)', () => {
  it('marks production through either variable, trimmed and case-insensitive', () => {
    const table: { env: Record<string, string>; production: boolean }[] = [
      { env: {}, production: false },
      { env: { OPENKYLIN_ENV: 'production' }, production: true },
      { env: { OPENKYLIN_ENV: 'prod' }, production: true },
      { env: { OPENKYLIN_ENV: 'PROD' }, production: true },
      { env: { OPENKYLIN_ENV: '  Production  ' }, production: true },
      { env: { ENVIRONMENT: 'prod' }, production: true },
      { env: { OPENKYLIN_ENV: 'dev' }, production: false },
      { env: { OPENKYLIN_ENV: 'staging' }, production: false },
      { env: { OPENKYLIN_ENV: 'productionism' }, production: false },
      { env: { ENVIRONMENT: '' }, production: false },
    ]
    for (const { env, production } of table) {
      expect(isExplicitProductionEnvironment(env), JSON.stringify(env)).toBe(production)
    }
  })
})

describe('two-state resolution (contract G)', () => {
  it('defaults to authentication enabled when unconfigured', () => {
    expect(resolveAuthDisabled({})).toBe(false)
    expect(authDisabledWarning({})).toBeNull()
  })

  it('passes through transparently when requested outside production', () => {
    expect(resolveAuthDisabled({ OPENKYLIN_AUTH_DISABLED: '1' })).toBe(true)
    expect(resolveAuthDisabled({ OPENKYLIN_AUTH_DISABLED: '1', OPENKYLIN_ENV: 'dev' })).toBe(true)
    expect(authDisabledWarning({ OPENKYLIN_AUTH_DISABLED: '1' })).toContain('authentication is bypassed')
  })

  it('refuses to disable inside an explicit production environment', () => {
    for (const env of [
      { OPENKYLIN_AUTH_DISABLED: '1', OPENKYLIN_ENV: 'production' },
      { OPENKYLIN_AUTH_DISABLED: '1', OPENKYLIN_ENV: 'prod' },
      { OPENKYLIN_AUTH_DISABLED: '1', ENVIRONMENT: 'production' },
    ]) {
      expect(resolveAuthDisabled(env), JSON.stringify(env)).toBe(false)
      expect(authDisabledWarning(env), JSON.stringify(env)).toBeNull()
    }
  })
})

describe('boot-time fail-loud guard (contract G)', () => {
  it('allows an unconfigured environment', () => {
    expect(() => { assertAuthDisabledAllowed({}) }).not.toThrow()
  })

  it('allows an active escape valve outside production', () => {
    expect(() => { assertAuthDisabledAllowed({ OPENKYLIN_AUTH_DISABLED: '1' }) }).not.toThrow()
    expect(() => { assertAuthDisabledAllowed({ OPENKYLIN_AUTH_DISABLED: '1', OPENKYLIN_ENV: 'dev' }) }).not.toThrow()
  })

  it('allows production without the flag', () => {
    expect(() => { assertAuthDisabledAllowed({ OPENKYLIN_ENV: 'production' }) }).not.toThrow()
  })

  it('refuses a production deployment that asks to disable authentication', () => {
    for (const env of [
      { OPENKYLIN_AUTH_DISABLED: '1', OPENKYLIN_ENV: 'production' },
      { OPENKYLIN_AUTH_DISABLED: '1', ENVIRONMENT: 'prod' },
    ]) {
      try {
        assertAuthDisabledAllowed(env)
        expect.unreachable(JSON.stringify(env))
      } catch (error) {
        expect(error).toBeInstanceOf(AuthDisabledProhibitedError)
        expect((error as Error).message).toContain('OPENKYLIN_AUTH_DISABLED')
        expect((error as Error).name).toBe('AuthDisabledProhibitedError')
      }
    }
  })
})
