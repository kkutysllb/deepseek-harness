import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AUTH_CONFIG_FILENAME, defaultAuthConfigPath, readRegistrationEnabled } from '../src/registration-config.ts'

describe('defaultAuthConfigPath', () => {
  it('sits beside the account database in the accounts home directory', () => {
    expect(defaultAuthConfigPath({ QILIN_HOME: '/home/qilin' })).toBe(
      join('/home/qilin', 'qilin-accounts', AUTH_CONFIG_FILENAME),
    )
  })

  it('falls back to the harness home when QILIN_HOME is absent', () => {
    expect(defaultAuthConfigPath({})).toContain('qilin-accounts')
  })
})

describe('readRegistrationEnabled', () => {
  const root = mkdtempSync(join(tmpdir(), 'account-http-config-'))
  const write = (name: string, content: string): string => {
    const path = join(root, name)
    writeFileSync(path, content)
    return path
  }

  it('opens by default when the file is absent (the D5 baseline)', () => {
    expect(readRegistrationEnabled(join(root, 'missing.json'))).toBe(true)
  })

  it('closes only on an explicit false and stays open otherwise', () => {
    expect(readRegistrationEnabled(write('closed.json', '{"registrationEnabled": false}'))).toBe(false)
    expect(readRegistrationEnabled(write('open.json', '{"registrationEnabled": true}'))).toBe(true)
    expect(readRegistrationEnabled(write('empty.json', '{}'))).toBe(true)
  })

  it('fails loud on malformed JSON, non-object roots, and non-boolean values', () => {
    expect(() => readRegistrationEnabled(write('broken.json', '{not json'))).toThrow(/not valid JSON/)
    expect(() => readRegistrationEnabled(write('array.json', '[]'))).toThrow(/must hold a JSON object/)
    expect(() => readRegistrationEnabled(write('string.json', '{"registrationEnabled": "false"}'))).toThrow(/non-boolean registrationEnabled/)
  })

  it('propagates read errors that are not simple absence (a directory)', () => {
    const dir = join(root, 'a-directory')
    mkdirSync(dir)
    expect(() => readRegistrationEnabled(dir)).toThrow()
  })
})
