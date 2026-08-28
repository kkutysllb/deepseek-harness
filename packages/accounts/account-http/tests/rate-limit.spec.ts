import { describe, expect, it } from 'vitest'
import { DEFAULT_MAX_TRACKED_KEYS, DEFAULT_RATE_LIMIT_MAX_ATTEMPTS, DEFAULT_RATE_LIMIT_WINDOW_MS, RateLimiter } from '../src/rate-limit.ts'

describe('RateLimiter construction', () => {
  it('exposes the documented defaults', () => {
    expect(DEFAULT_RATE_LIMIT_MAX_ATTEMPTS).toBe(10)
    expect(DEFAULT_RATE_LIMIT_WINDOW_MS).toBe(300_000)
    expect(DEFAULT_MAX_TRACKED_KEYS).toBe(10_000)
  })

  it('rejects non-positive or fractional knobs', () => {
    expect(() => new RateLimiter({ maxAttempts: 0 })).toThrow(/maxAttempts must be a positive integer/)
    expect(() => new RateLimiter({ maxAttempts: 1.5 })).toThrow(/maxAttempts must be a positive integer/)
    expect(() => new RateLimiter({ windowMs: 0 })).toThrow(/windowMs must be a positive integer/)
    expect(() => new RateLimiter({ maxTrackedKeys: -1 })).toThrow(/maxTrackedKeys must be a positive integer/)
  })
})

describe('RateLimiter windows', () => {
  it('admits up to the budget, then refuses with the remaining window time', () => {
    const now = 1_000
    const limiter = new RateLimiter({ maxAttempts: 3, windowMs: 10_000, now: () => now })
    expect(limiter.take('ip-a').allowed).toBe(true)
    expect(limiter.take('ip-a').allowed).toBe(true)
    expect(limiter.take('ip-a').allowed).toBe(true)
    const refused = limiter.take('ip-a')
    expect(refused.allowed).toBe(false)
    expect(refused.retryAfterSeconds).toBe(10)
    expect(limiter.take('ip-b').allowed).toBe(true)
  })

  it('resets the budget once the window has fully elapsed (injected clock)', () => {
    let now = 1_000
    const limiter = new RateLimiter({ maxAttempts: 2, windowMs: 5_000, now: () => now })
    limiter.take('ip-a')
    limiter.take('ip-a')
    expect(limiter.take('ip-a').allowed).toBe(false)
    now += 4_999
    expect(limiter.take('ip-a').allowed).toBe(false)
    now += 1
    const verdict = limiter.take('ip-a')
    expect(verdict.allowed).toBe(true)
    expect(verdict.retryAfterSeconds).toBe(0)
  })

  it('rounds a sub-second remainder up to one second of Retry-After', () => {
    const now = 0
    const limiter = new RateLimiter({ maxAttempts: 1, windowMs: 1_500, now: () => now })
    limiter.take('ip-a')
    expect(limiter.take('ip-a').retryAfterSeconds).toBe(2)
  })

  it('evicts the earliest half at the tracked-key bound, resetting that budget', () => {
    let now = 0
    const limiter = new RateLimiter({ maxAttempts: 1, windowMs: 100, maxTrackedKeys: 4, now: () => now })
    // Four spent windows fill the table exactly.
    for (let index = 1; index <= 4; index += 1) {
      now = index
      limiter.take('k' + String(index))
    }
    // A fifth live key at the bound evicts the earliest half (k1, k2).
    now = 5
    expect(limiter.take('k5').allowed).toBe(true)
    // A survivor keeps its spent budget; an evicted key starts over.
    now = 6
    expect(limiter.take('k3').allowed).toBe(false)
    expect(limiter.take('k1').allowed).toBe(true)
  })

  it('deletes only expired windows during a sweep at the bound', () => {
    let now = 0
    const limiter = new RateLimiter({ maxAttempts: 1, windowMs: 100, maxTrackedKeys: 2, now: () => now })
    now = 1
    limiter.take('a')
    now = 2
    limiter.take('b')
    // At the bound with 'a' expired and 'b' still live: the sweep deletes
    // exactly the expired window and keeps the live one without eviction.
    now = 101
    expect(limiter.take('c').allowed).toBe(true)
    // At now=102 'b' (start 2) is exactly expired too: the sweep deletes it,
    // so its next take starts a fresh window instead of being refused.
    now = 102
    expect(limiter.take('b').allowed).toBe(true)
    expect(limiter.take('a').allowed).toBe(true)
  })
})
