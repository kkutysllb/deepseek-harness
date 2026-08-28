import { describe, expect, it } from 'vitest'
import { ownerCheck } from '../src/owner.ts'
import { anonymousPrincipal } from '../src/principal.ts'
import { authDisabledRbacPrincipal } from '../src/principal.ts'
import { sessionPrincipal } from './principal.spec.ts'

describe('owner_check (contract N ownership verification, functional form)', () => {
  it('admits the owner', () => {
    expect(ownerCheck(sessionPrincipal('user', 'u-1'), 'u-1')).toBe(true)
  })

  it('rejects a non-owner', () => {
    expect(ownerCheck(sessionPrincipal('user', 'u-2'), 'u-1')).toBe(false)
  })

  it('bypasses for the admin role', () => {
    expect(ownerCheck(sessionPrincipal('admin', 'a-1'), 'u-1')).toBe(true)
  })

  it('bypasses for the auth-disabled synthetic admin', () => {
    expect(ownerCheck(authDisabledRbacPrincipal(), 'u-1')).toBe(true)
  })

  it('rejects the anonymous principal', () => {
    expect(ownerCheck(anonymousPrincipal(), 'u-1')).toBe(false)
  })

  it('fails closed when the caller has no owner referent at all', () => {
    for (const absent of [undefined, null, '']) {
      expect(ownerCheck(sessionPrincipal('user', 'u-1'), absent)).toBe(false)
      expect(ownerCheck(sessionPrincipal('admin', 'a-1'), absent)).toBe(false)
    }
  })
})
