import { describe, expect, it } from 'vitest'
import {
  SCRYPT_ENCODING_PREFIX,
  SCRYPT_PARAMS,
  hashPassword,
  verifyPassword,
} from '../src/index.ts'

/** A deterministic 32-byte salt of 0xab bytes, standing in for crypto.randomBytes. */
const FIXED_SALT = new Uint8Array(SCRYPT_PARAMS.saltLength).fill(0xab)

describe('SCRYPT_PARAMS', () => {
  it('stays frozen at the documented cost', () => {
    expect(SCRYPT_PARAMS).toEqual({ N: 16384, r: 8, p: 1, saltLength: 32, keyLength: 64 })
  })
})

describe('hashPassword', () => {
  it('emits the self-describing encoding with the frozen parameters and the injected salt', () => {
    const stored = hashPassword('correct horse battery staple', () => FIXED_SALT)
    const parts = stored.split('$')
    expect(parts).toHaveLength(6)
    expect(parts[0]).toBe(SCRYPT_ENCODING_PREFIX)
    expect(parts[1]).toBe(String(SCRYPT_PARAMS.N))
    expect(parts[2]).toBe(String(SCRYPT_PARAMS.r))
    expect(parts[3]).toBe(String(SCRYPT_PARAMS.p))
    expect(Buffer.from(parts[4] ?? '', 'base64')).toEqual(Buffer.from(FIXED_SALT))
    expect(Buffer.from(parts[5] ?? '', 'base64')).toHaveLength(SCRYPT_PARAMS.keyLength)
  })

  it('draws a fresh salt per hash, so equal passwords never share a stored encoding', () => {
    expect(hashPassword('same')).not.toBe(hashPassword('same'))
  })
})

describe('verifyPassword', () => {
  it('accepts the password a stored encoding was made from', () => {
    expect(verifyPassword('correct horse battery staple', hashPassword('correct horse battery staple'))).toBe(true)
  })

  it.each(['', 'x', 'wrong password', '密码测试'])('rejects the wrong password %j', (candidate) => {
    expect(verifyPassword(candidate, hashPassword('correct horse battery staple'))).toBe(false)
  })

  it.each([
    ['foreign algorithm prefix', 'bcrypt$16384$8$1$AAAA$AAAA'],
    ['too few fields', 'scrypt$16384$8$1$AAAA'],
    ['too many fields', 'scrypt$16384$8$1$AAAA$AAAA$extra'],
    ['non-numeric cost', 'scrypt$fast$8$1$AAAA$AAAA'],
    ['cost below the scrypt floor', 'scrypt$1$8$1$AAAA$AAAA'],
    ['empty hash field', 'scrypt$16384$8$1$AAAA$'],
    ['truncated hash field', 'scrypt$16384$8$1$AAAA$AA'],
  ])('rejects a hostile stored encoding: %s', (_name, stored) => {
    expect(verifyPassword('correct horse battery staple', stored)).toBe(false)
  })
})

describe('AccountConflictError', () => {
  it('names the conflicting subject with and without a driver cause', async () => {
    const { AccountConflictError } = await import('../src/errors.ts')
    const email = new AccountConflictError('email')
    expect(email.kind).toBe('email')
    expect(email.message).toContain('email address')
    const oauth = new AccountConflictError('oauth', new Error('driver'))
    expect(oauth.kind).toBe('oauth')
    expect(oauth.message).toContain('OAuth identity')
  })
})
