import { describe, expect, it } from 'vitest'
import { CORS_ORIGINS_ENV_VAR, configuredCorsOrigins, isAllowedAuthOrigin, normalizeOrigin, requestOrigin } from '../src/origin.ts'

describe('normalizeOrigin', () => {
  it('normalizes scheme casing, host casing, and non-default ports', () => {
    expect(normalizeOrigin('HTTPS://Example.com:8443')).toBe('https://example.com:8443')
    expect(normalizeOrigin('http://LOCALHOST')).toBe('http://localhost')
    expect(normalizeOrigin('http://[::1]:3080')).toBe('http://[::1]:3080')
  })

  it('omits the default ports', () => {
    expect(normalizeOrigin('http://example.com:80')).toBe('http://example.com')
    expect(normalizeOrigin('https://example.com:443')).toBe('https://example.com')
    expect(normalizeOrigin('https://example.com')).toBe('https://example.com')
  })

  it('rejects values that are not bare browser origins', () => {
    const rejected = [
      'example.com',
      'null',
      'ftp://example.com',
      'app://-',
      'http://user@example.com',
      'http://user:pass@example.com',
      'http://example.com/path',
      'http://example.com?query',
      'http://example.com#frag',
      '',
      '   ',
      'not a url',
    ]
    for (const value of rejected) expect(normalizeOrigin(value)).toBeUndefined()
  })
})

describe('configuredCorsOrigins', () => {
  it('is empty without the environment variable and skips blanks and wildcards', () => {
    expect(configuredCorsOrigins({})).toEqual(new Set())
    expect(configuredCorsOrigins({ [CORS_ORIGINS_ENV_VAR]: ' , * ,, ' })).toEqual(new Set())
  })

  it('normalizes standard schemes and passes non-standard ones through verbatim', () => {
    expect(configuredCorsOrigins({ [CORS_ORIGINS_ENV_VAR]: ' https://App.Example:443 , app://- ' })).toEqual(
      new Set(['https://app.example', 'app://-']),
    )
  })
})

describe('requestOrigin', () => {
  it('derives http from the Host header when no proxy headers exist', () => {
    expect(requestOrigin({ host: '127.0.0.1:3080' })).toBe('http://127.0.0.1:3080')
    expect(requestOrigin({ host: 'example.com' })).toBe('http://example.com')
    expect(requestOrigin({ host: 'example.com', 'x-forwarded-proto': '' })).toBe('http://example.com')
    expect(requestOrigin({ host: 'example.com', forwarded: 'garbage-parameters' })).toBe('http://example.com')
    expect(requestOrigin({ host: 'example.com', forwarded: 'for=1.2.3.4' })).toBe('http://example.com')
    expect(requestOrigin({ host: 'example.com', forwarded: 'host=;proto=https' })).toBe('https://example.com')
    expect(requestOrigin({ host: 'api.example', 'x-forwarded-host': ['edge.example'] })).toBe('http://edge.example')
    expect(requestOrigin({ host: 'api.example', forwarded: 'for=1.2.3.4;host=edge.example;proto=https', 'x-forwarded-port': ['8443'] })).toBe('https://edge.example:8443')
  })

  it('honors the Forwarded header parameters first', () => {
    expect(requestOrigin({ host: 'internal:3080', forwarded: 'for=1.2.3.4;host=example.com;proto=https' })).toBe(
      'https://example.com',
    )
  })

  it('honors the X-Forwarded-* trio including an added port', () => {
    expect(requestOrigin({ host: 'example.com', 'x-forwarded-proto': 'https' })).toBe('https://example.com')
    expect(requestOrigin({ host: '10.0.0.1', 'x-forwarded-host': 'cdn.example', 'x-forwarded-port': '8443' })).toBe(
      'http://cdn.example:8443',
    )
    expect(requestOrigin({ host: '10.0.0.1', 'x-forwarded-host': 'cdn.example', 'x-forwarded-proto': 'https', 'x-forwarded-port': '443' })).toBe(
      'https://cdn.example',
    )
  })

  it('brackets a bare forwarded IPv6 host and returns undefined without any host', () => {
    expect(requestOrigin({ 'x-forwarded-host': '::1', 'x-forwarded-port': '80' })).toBe('http://[::1]')
    expect(requestOrigin({})).toBeUndefined()
  })
})

describe('isAllowedAuthOrigin', () => {
  const host = { host: '127.0.0.1:3080' }

  it('passes Origin-less (non-browser) requests', () => {
    expect(isAllowedAuthOrigin(host, {})).toBe(true)
  })

  it('passes same-origin requests through the rebuilt request origin', () => {
    expect(isAllowedAuthOrigin({ ...host, origin: 'http://127.0.0.1:3080' }, {})).toBe(true)
  })

  it('passes configured origins both raw and normalized', () => {
    const env = { [CORS_ORIGINS_ENV_VAR]: 'https://app.example,app://-' }
    expect(isAllowedAuthOrigin({ ...host, origin: 'https://app.example' }, env)).toBe(true)
    expect(isAllowedAuthOrigin({ ...host, origin: 'app://-' }, env)).toBe(true)
    expect(isAllowedAuthOrigin({ ...host, origin: 'https://app.example:443' }, env)).toBe(true)
  })

  it('denies cross-site and malformed origins', () => {
    expect(isAllowedAuthOrigin({ ...host, origin: 'https://evil.example' }, {})).toBe(false)
    expect(isAllowedAuthOrigin({ ...host, origin: 'null' }, {})).toBe(false)
    expect(isAllowedAuthOrigin({ ...host, origin: 'http://127.0.0.1:3080/path' }, {})).toBe(false)
  })
})
