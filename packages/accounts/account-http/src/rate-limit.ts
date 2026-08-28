/**
 * Fixed-window per-key attempt counter for the credential-bearing auth
 * endpoints (D5 adaptation clause c): login and register share one per-IP
 * budget, counted per attempt whatever its outcome, and an over-the-limit IP
 * answers 429 until the window resets. The module is in-memory with an
 * injected clock — state dies with the process, so a restart clears every
 * counter, and a multi-instance deployment counts per instance.
 * @module @qilin/account-http/rate-limit
 */

/** Default attempts one key may spend per window. */
export const DEFAULT_RATE_LIMIT_MAX_ATTEMPTS = 10

/** Default window length in milliseconds (the legacy five-minute lockout horizon). */
export const DEFAULT_RATE_LIMIT_WINDOW_MS = 300_000

/** Bound on tracked keys before expired windows are swept. */
export const DEFAULT_MAX_TRACKED_KEYS = 10_000

/** Construction seams; every field has a production default. */
export interface RateLimiterOptions {
  /** Attempts allowed per key per window; defaults to {@link DEFAULT_RATE_LIMIT_MAX_ATTEMPTS}. */
  readonly maxAttempts?: number
  /** Window length in milliseconds; defaults to {@link DEFAULT_RATE_LIMIT_WINDOW_MS}. */
  readonly windowMs?: number
  /** Maximum tracked keys before sweeping; defaults to {@link DEFAULT_MAX_TRACKED_KEYS}. */
  readonly maxTrackedKeys?: number
  /** Clock seam returning epoch milliseconds; defaults to `Date.now`. */
  readonly now?: () => number
}

/** The verdict for one attempt, with the 429 retry hint when refused. */
export interface RateLimitVerdict {
  /** Whether the attempt is admitted under the window budget. */
  readonly allowed: boolean
  /** Seconds until the current window resets (0 for admitted attempts). */
  readonly retryAfterSeconds: number
}

interface Window {
  start: number
  count: number
}

/**
 * One fixed-window counter table. A key's window opens at its first attempt
 * and resets `windowMs` later; attempts beyond the budget within the window
 * are refused with the time remaining. Sweeping evicts expired windows when
 * the table grows past the tracked-key bound, then the earliest-starting
 * half if sweep alone is not enough (the legacy eviction shape).
 */
export class RateLimiter {
  private readonly windows = new Map<string, Window>()
  private readonly maxAttempts: number
  private readonly windowMs: number
  private readonly maxTrackedKeys: number
  private readonly now: () => number

  /**
   * Construct the limiter over its seams.
   * @param options - budget, window, bound, and clock.
   * @throws when the budget, window, or bound is not a positive integer.
   */
  constructor(options: RateLimiterOptions = {}) {
    this.maxAttempts = options.maxAttempts ?? DEFAULT_RATE_LIMIT_MAX_ATTEMPTS
    this.windowMs = options.windowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS
    this.maxTrackedKeys = options.maxTrackedKeys ?? DEFAULT_MAX_TRACKED_KEYS
    this.now = options.now ?? Date.now
    for (const [name, value] of [['maxAttempts', this.maxAttempts], ['windowMs', this.windowMs], ['maxTrackedKeys', this.maxTrackedKeys]] as const) {
      if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`)
    }
  }

  /**
   * Spend one attempt of the key's window budget.
   * @param key - the caller key (the client IP for the auth endpoints).
   * @returns the admission verdict with the retry hint when refused.
   */
  take(key: string): RateLimitVerdict {
    const now = this.now()
    if (this.windows.size >= this.maxTrackedKeys) this.sweep(now)
    let window = this.windows.get(key)
    if (window === undefined || now >= window.start + this.windowMs) {
      window = { start: now, count: 0 }
      this.windows.set(key, window)
    }
    window.count += 1
    if (window.count > this.maxAttempts) {
      const retryAfterSeconds = Math.max(1, Math.ceil((window.start + this.windowMs - now) / 1000))
      return { allowed: false, retryAfterSeconds }
    }
    return { allowed: true, retryAfterSeconds: 0 }
  }

  /** Forget expired windows, then the earliest-starting half if still at the bound. */
  private sweep(now: number): void {
    for (const [key, window] of this.windows) {
      if (now >= window.start + this.windowMs) this.windows.delete(key)
    }
    if (this.windows.size < this.maxTrackedKeys) return
    const earliest = [...this.windows.entries()].sort((a, b) => a[1].start - b[1].start)
    for (const [key] of earliest.slice(0, Math.ceil(earliest.length / 2))) this.windows.delete(key)
  }
}
