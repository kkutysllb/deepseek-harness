import { describe, expect, it } from 'vitest'
import { timingSafeStringEquals } from '../src/compare.ts'
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  CSRF_SAFE_METHODS,
  CSRF_TOKEN_BYTES,
  CSRF_WRITE_METHODS,
  type CsrfDecision,
  evaluateCsrfRequest,
  mintCsrfToken,
  requiresCsrfCheck,
  verifyCsrfTokens,
} from '../src/csrf.ts'

describe('token minting', () => {
  it('mints 64 hex characters from process randomness, distinct per call', () => {
    const first = mintCsrfToken()
    const second = mintCsrfToken()
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(second).toMatch(/^[0-9a-f]{64}$/)
    expect(first).not.toBe(second)
  })

  it('honors an injected randomness seam deterministically', () => {
    const token = mintCsrfToken(length => Buffer.alloc(length, 0x0a))
    expect(token).toBe('0a'.repeat(CSRF_TOKEN_BYTES))
  })

  it('keeps the legacy cookie and header names', () => {
    expect(CSRF_COOKIE_NAME).toBe('csrf_token')
    expect(CSRF_HEADER_NAME).toBe('X-CSRF-Token')
  })
})

describe('method matrix (contract F)', () => {
  it('exempts the RFC-safe methods', () => {
    expect(CSRF_SAFE_METHODS).toEqual(['GET', 'HEAD', 'OPTIONS', 'TRACE'])
    for (const method of CSRF_SAFE_METHODS) {
      expect(requiresCsrfCheck(method), method).toBe(false)
      expect(evaluateCsrfRequest({ method }), method).toEqual({ outcome: 'skip', reason: 'safe-method' })
    }
  })

  it('forces the check for the legacy state-changing methods', () => {
    expect(CSRF_WRITE_METHODS).toEqual(['POST', 'PUT', 'DELETE', 'PATCH'])
    for (const method of CSRF_WRITE_METHODS) {
      expect(requiresCsrfCheck(method), method).toBe(true)
      expect(evaluateCsrfRequest({ method }), method).toEqual({ outcome: 'reject', reason: 'missing-token' })
    }
  })

  it('normalizes method casing', () => {
    expect(requiresCsrfCheck('get')).toBe(false)
    expect(requiresCsrfCheck('post')).toBe(true)
  })

  it('fails closed on methods outside both lists', () => {
    for (const method of ['QUERY', 'CONNECT', 'PROPFIND', '']) {
      expect(requiresCsrfCheck(method), JSON.stringify(method)).toBe(true)
      expect(evaluateCsrfRequest({ method }), JSON.stringify(method)).toEqual({ outcome: 'reject', reason: 'missing-token' })
    }
  })
})

describe('double-submit comparator', () => {
  const table: { name: string; cookie?: string | undefined; header?: string | undefined; valid: boolean }[] = [
    { name: 'identical tokens', cookie: 't1', header: 't1', valid: true },
    { name: 'mismatched tokens', cookie: 't1', header: 't2', valid: false },
    { name: 'unequal lengths', cookie: 't1', header: 't1-and-more', valid: false },
    { name: 'case difference', cookie: 'token', header: 'TOKEN', valid: false },
    { name: 'missing cookie', header: 't1', valid: false },
    { name: 'missing header', cookie: 't1', valid: false },
    { name: 'undefined cookie', cookie: undefined, header: 't1', valid: false },
    { name: 'undefined header', cookie: 't1', header: undefined, valid: false },
    { name: 'empty cookie', cookie: '', header: 't1', valid: false },
    { name: 'empty header', cookie: 't1', header: '', valid: false },
    { name: 'both empty', cookie: '', header: '', valid: false },
  ]

  for (const { name, cookie, header, valid } of table) {
    it(`answers ${valid} when ${name}`, () => {
      expect(verifyCsrfTokens(cookie, header)).toBe(valid)
    })
  }

  it('compares through a fixed-digest constant-time path (never throws on length)', () => {
    expect(timingSafeStringEquals('a'.repeat(1000), 'b'.repeat(1))).toBe(false)
    expect(timingSafeStringEquals('same', 'same')).toBe(true)
  })
})

describe('request evaluation (contract F with the D2 Bearer exemption)', () => {
  const TOKEN = 'a'.repeat(64)

  const table: {
    name: string
    method: string
    path?: string
    bearer?: boolean
    cookie?: string
    header?: string
    authDisabled?: boolean
    exemptions?: { exactPaths?: string[]; pathPrefixes?: string[] }
    expected: CsrfDecision
  }[] = [
    { name: 'safe method skips everything', method: 'GET', authDisabled: true, expected: { outcome: 'skip', reason: 'safe-method' } },
    { name: 'auth-disabled chain skips', method: 'POST', authDisabled: true, expected: { outcome: 'skip', reason: 'auth-disabled' } },
    { name: 'bearer request skips without any token', method: 'POST', bearer: true, expected: { outcome: 'skip', reason: 'bearer-auth' } },
    { name: 'bearer request skips even with mismatched tokens', method: 'POST', bearer: true, cookie: 'x', header: 'y', expected: { outcome: 'skip', reason: 'bearer-auth' } },
    { name: 'exact exempt path (trailing slash normalized)', method: 'POST', path: '/api/v1/auth/me/', exemptions: { exactPaths: ['/api/v1/auth/me'] }, expected: { outcome: 'skip', reason: 'exempt-path' } },
    { name: 'prefix exempt path (webhook style)', method: 'POST', path: '/api/webhooks/github', exemptions: { pathPrefixes: ['/api/webhooks/'] }, expected: { outcome: 'skip', reason: 'exempt-path' } },
    { name: 'exact list miss falls through to prefixes', method: 'POST', path: '/api/webhooks/slack', exemptions: { exactPaths: ['/other'], pathPrefixes: ['/api/webhooks/'] }, expected: { outcome: 'skip', reason: 'exempt-path' } },
    { name: 'non-exempt path rejects a tokenless write', method: 'POST', path: '/api/threads', exemptions: { exactPaths: ['/other'], pathPrefixes: ['/api/webhooks/'] }, expected: { outcome: 'reject', reason: 'missing-token' } },
    { name: 'empty prefix is ignored, not a wildcard', method: 'POST', path: '/api/threads', exemptions: { pathPrefixes: [''] }, expected: { outcome: 'reject', reason: 'missing-token' } },
    { name: 'no exemptions at all rejects a tokenless write', method: 'POST', path: '/api/threads', expected: { outcome: 'reject', reason: 'missing-token' } },
    { name: 'missing header rejects', method: 'POST', cookie: TOKEN, expected: { outcome: 'reject', reason: 'missing-token' } },
    { name: 'missing cookie rejects', method: 'POST', header: TOKEN, expected: { outcome: 'reject', reason: 'missing-token' } },
    { name: 'matching pair passes', method: 'POST', cookie: TOKEN, header: TOKEN, expected: { outcome: 'pass' } },
    { name: 'mismatched pair rejects', method: 'POST', cookie: TOKEN, header: 'b'.repeat(64), expected: { outcome: 'reject', reason: 'token-mismatch' } },
    { name: 'unpathed request with defaults rejects', method: 'PUT', cookie: TOKEN, header: 'zz', expected: { outcome: 'reject', reason: 'token-mismatch' } },
  ]

  for (const { name, method, path, bearer, cookie, header, authDisabled, exemptions, expected } of table) {
    it(name, () => {
      const facts = {
        method,
        ...(path !== undefined && { path }),
        ...(bearer !== undefined && { bearerAuthenticated: bearer }),
        ...(cookie !== undefined && { cookieToken: cookie }),
        ...(header !== undefined && { headerToken: header }),
        ...(authDisabled !== undefined && { authDisabled }),
      }
      expect(evaluateCsrfRequest(facts, exemptions)).toEqual(expected)
    })
  }

  it('defaults to no exemptions when called without the second argument', () => {
    expect(evaluateCsrfRequest({ method: 'DELETE' })).toEqual({ outcome: 'reject', reason: 'missing-token' })
  })
})
