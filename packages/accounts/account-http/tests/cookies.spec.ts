import { describe, expect, it } from 'vitest'
import {
  INSECURE_PERSISTENT_COOKIE_ENV,
  PERSISTENT_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  isLoopbackHostname,
  isSecureRequest,
  parseCookies,
  rememberMeFromCookie,
  requestHostname,
  resolveSessionCookiePolicy,
  serializeClearCookie,
  serializeCsrfCookie,
  serializeSessionCookies,
} from '../src/cookies.ts'

const EMPTY_ENV: NodeJS.ProcessEnv = {}

describe('parseCookies', () => {
  it('parses pairs, keeps values verbatim, and lets later duplicates win', () => {
    expect(parseCookies('access_token=abc-123; csrf_token=cafe; access_token=def')).toEqual({
      access_token: 'def',
      csrf_token: 'cafe',
    })
  })

  it('tolerates whitespace, valueless names, and absent headers', () => {
    expect(parseCookies('  a = 1 ;  ; b')).toEqual({ a: '1', b: '' })
    expect(parseCookies(undefined)).toEqual({})
    expect(parseCookies('')).toEqual({})
  })
})

describe('rememberMeFromCookie', () => {
  it('decides on the explicit flag and falls back otherwise', () => {
    const table: Array<[string | undefined, boolean, boolean]> = [
      ['1', false, true],
      ['0', true, false],
      ['garbage', false, false],
      [undefined, true, true],
      ['', false, false],
    ]
    for (const [value, fallback, expected] of table) {
      expect(rememberMeFromCookie({ [PERSISTENT_COOKIE_NAME]: value ?? '' }, fallback)).toBe(expected)
    }
  })
})

describe('isSecureRequest', () => {
  it('reads the first forwarded proto value only', () => {
    const table: Array<[Record<string, string | string[] | undefined>, boolean]> = [
      [{}, false],
      [{ 'x-forwarded-proto': 'https' }, true],
      [{ 'x-forwarded-proto': 'HTTPS' }, true],
      [{ 'x-forwarded-proto': 'https, http' }, true],
      [{ 'x-forwarded-proto': ['http', 'https'] }, false],
      [{ 'x-forwarded-proto': 'http' }, false],
    ]
    for (const [headers, expected] of table) {
      expect(isSecureRequest(headers)).toBe(expected)
    }
  })
})

describe('isLoopbackHostname', () => {
  it('accepts the loopback name forms and rejects everything else', () => {
    const yes = ['localhost', 'app.localhost', '127.0.0.1', '127.9.9.9', '::1']
    const no = ['example.com', 'localhost.example.com', '128.0.0.1', '127.0.0.0.1', '::2', '1270.0.1.1', '']
    for (const host of yes) expect(isLoopbackHostname(host)).toBe(true)
    for (const host of no) expect(isLoopbackHostname(host)).toBe(false)
  })
})

describe('requestHostname', () => {
  it('lowercases, strips the port, unwraps IPv6 brackets, and fails soft', () => {
    expect(requestHostname({ host: 'Example.COM:3080' })).toBe('example.com')
    expect(requestHostname({ host: '[::1]:3080' })).toBe('::1')
    expect(requestHostname({ host: '127.0.0.1' })).toBe('127.0.0.1')
    expect(requestHostname({ host: 'a.example' })).toBe('a.example')
    expect(requestHostname({})).toBe('')
    expect(requestHostname({ host: '' })).toBe('')
    expect(requestHostname({ host: 'not a host' })).toBe('')
  })
})

describe('resolveSessionCookiePolicy', () => {
  const base = { ttlSeconds: 604800, env: EMPTY_ENV }

  it('degrades a public plain-HTTP persistent request to a browser-session cookie', () => {
    expect(resolveSessionCookiePolicy({ ...base, secure: false, loopback: false })).toEqual({
      secure: false,
      maxAge: undefined,
      remember: true,
      reason: 'public_http_session',
    })
  })

  it('keeps the persistent lifetime when https, loopback, or the operator escape applies', () => {
    expect(resolveSessionCookiePolicy({ ...base, secure: true, loopback: false })).toEqual({
      secure: true,
      maxAge: 604800,
      remember: true,
      reason: 'secure_persistent',
    })
    expect(resolveSessionCookiePolicy({ ...base, secure: false, loopback: true })).toEqual({
      secure: false,
      maxAge: 604800,
      remember: true,
      reason: 'localhost_persistent',
    })
    expect(resolveSessionCookiePolicy({
      ...base,
      secure: false,
      loopback: false,
      env: { [INSECURE_PERSISTENT_COOKIE_ENV]: 'yes' },
    })).toEqual({
      secure: false,
      maxAge: 604800,
      remember: true,
      reason: 'operator_insecure_persistent',
    })
  })

  it('honors the explicit session intent over every other signal', () => {
    expect(resolveSessionCookiePolicy({ ...base, secure: true, loopback: true, rememberMe: false })).toEqual({
      secure: true,
      maxAge: undefined,
      remember: false,
      reason: 'session_requested',
    })
  })

  it('falls back through the persistence cookie tri-state', () => {
    expect(resolveSessionCookiePolicy({ ...base, secure: false, loopback: true, persistentCookieValue: '1' }).maxAge).toBe(604800)
    expect(resolveSessionCookiePolicy({ ...base, secure: false, loopback: true, persistentCookieValue: '0' }).maxAge).toBeUndefined()
    expect(resolveSessionCookiePolicy({ ...base, secure: false, loopback: false, persistentCookieValue: 'junk' }).maxAge).toBeUndefined()
  })
})

describe('serialization', () => {
  const policy = { secure: true, maxAge: 604800, remember: true, reason: 'secure_persistent' }

  it('emits the session pair with shared attributes', () => {
    expect(serializeSessionCookies({ token: 'id-1', policy })).toEqual([
      'access_token=id-1; Path=/; Max-Age=604800; Secure; HttpOnly; SameSite=Lax',
      'qilin_session_persistent=1; Path=/; Max-Age=604800; Secure; HttpOnly; SameSite=Lax',
    ])
    const sessionOnly = { ...policy, secure: false, maxAge: undefined, remember: false }
    expect(serializeSessionCookies({ token: 'id-2', policy: sessionOnly })).toEqual([
      'access_token=id-2; Path=/; HttpOnly; SameSite=Lax',
      'qilin_session_persistent=0; Path=/; HttpOnly; SameSite=Lax',
    ])
  })

  it('emits the JS-readable Strict CSRF cookie mirroring the lifetime', () => {
    expect(serializeCsrfCookie({ token: 'deadbeef', policy })).toBe(
      'csrf_token=deadbeef; Path=/; Max-Age=604800; Secure; SameSite=Strict',
    )
    expect(serializeCsrfCookie({ token: 'deadbeef', policy: { ...policy, maxAge: undefined } })).toBe(
      'csrf_token=deadbeef; Path=/; Secure; SameSite=Strict',
    )
  })

  it('expires cookies with their original attributes', () => {
    expect(serializeClearCookie({ name: SESSION_COOKIE_NAME, secure: false, httpOnly: true, sameSite: 'Lax' })).toBe(
      'access_token=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax',
    )
    expect(serializeClearCookie({ name: 'csrf_token', secure: true, httpOnly: false, sameSite: 'Strict' })).toBe(
      'csrf_token=; Max-Age=0; Path=/; Secure; SameSite=Strict',
    )
  })
})
