/**
 * Browser-safe account/auth client: same-origin fetch calls to the engine's
 * /api/v1/auth and /api/v1/admin/users surfaces. Writes carry the CSRF
 * double-submit token read from the non-HttpOnly csrf_token cookie (the auth
 * surface mints it at login; Bearer callers are exempt server-side and simply
 * have no cookie here). Failures surface as typed AuthError values carrying
 * the HTTP status and the wire error code, and every 401 feeds one shared
 * UnauthorizedSignal so session expiry looks identical wherever it happens —
 * an auth call of this client or a business fetch through the API carrier.
 * @module @qilin/client-connection/auth-client
 */

/** The account projection the browser works with; the hash never leaves the server. */
export interface AccountView {
  readonly id: string
  readonly email: string
  readonly systemRole: 'admin' | 'user'
  readonly needsSetup: boolean
  readonly oauthProvider: string | null
  readonly oauthId: string | null
  readonly sessionVersion: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly disabledAt: number | null
}

/** GET /api/v1/auth/setup-status payload. */
export interface SetupStatus {
  /** True while the store holds no accounts: the deterministic initialize may run. */
  readonly needsSetup: boolean
  /** Whether open registration is currently switched on. */
  readonly registrationEnabled: boolean
}

/** Login/initialize payload: the issued session id doubles as the Bearer token. */
export interface IssuedLogin {
  readonly user: AccountView
  readonly accessToken: string
}

/** One role/disable update body for PATCH /api/v1/admin/users/:id. */
export interface AccountUpdate {
  readonly systemRole?: 'admin' | 'user'
  readonly disabled?: boolean
}

/** One failed account-surface call: HTTP status plus the wire error code. */
export class AuthError extends Error {
  /**
   * @param status - the HTTP status the surface answered with.
   * @param code - the wire error code from the envelope (or 'unknown_error').
   * @param message - human-readable wire prose (or an HTTP fallback).
   */
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

/**
 * Observable 401 channel. One instance is shared by every carrier in the
 * connection handle, so a consumer subscribes once and learns about session
 * loss from any surface. Listener throws are isolated (observation must never
 * break the caller that triggered the 401).
 */
export class UnauthorizedSignal {
  private readonly listeners = new Set<(error: AuthError) => void>()

  /**
   * Subscribe one listener.
   * @param listener - receives each 401 AuthError.
   * @returns unsubscribe function.
   */
  subscribe(listener: (error: AuthError) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Fan one 401 out to every listener, isolating listener faults. */
  emit(error: AuthError): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(error)
      } catch (error) {
        console.error('[client-connection] unauthorized listener threw:', error)
      }
    }
  }
}

/** Everything AuthClient runs against; every seam is injectable for tests. */
export interface AuthClientOptions {
  /** Injected transport (tests); defaults to globalThis.fetch. */
  fetch?: typeof fetch
  /** Shared 401 signal; this client emits the same event its callers receive. */
  unauthorized?: UnauthorizedSignal
}

/** The account/auth surface the browser side may call. */
export interface IAuthClient {
  /** GET /api/v1/auth/me — the live account behind the session cookie. */
  me(): Promise<AccountView>
  /** GET /api/v1/auth/setup-status — whether the deterministic initialize may run. */
  setupStatus(): Promise<SetupStatus>
  /** POST /api/v1/auth/login/local — password login, cookies minted server-side. */
  login(email: string, password: string, rememberMe?: boolean): Promise<IssuedLogin>
  /** POST /api/v1/auth/initialize — deterministic first admin, empty store only. */
  initialize(email: string, password: string, rememberMe?: boolean): Promise<IssuedLogin>
  /** POST /api/v1/auth/logout — revoke the cookie session server-side. */
  logout(): Promise<void>
  /** POST /api/v1/auth/change-password — self-serve change; every old session dies. */
  changePassword(currentPassword: string, newPassword: string): Promise<void>
  /** GET /api/v1/admin/users — every account, hash stripped. */
  listUsers(): Promise<AccountView[]>
  /** PATCH /api/v1/admin/users/:id — role and/or disabled flag. */
  updateUser(id: string, update: AccountUpdate): Promise<AccountView>
  /** POST /api/v1/admin/users/:id/reset-password — admin-set password; old sessions die. */
  resetPassword(id: string, newPassword: string): Promise<AccountView>
}

/**
 * Extract the double-submit token from one cookie header value. The auth
 * surface mints the non-HttpOnly csrf_token cookie alongside the session
 * cookie; a missing token simply means writes answer csrf_missing.
 * @param cookie - the raw document.cookie value (or undefined off-browser).
 * @returns the token, or null when absent.
 */
export function readCsrfTokenFromCookie(cookie: string | undefined): string | null {
  if (cookie === undefined) return null
  for (const pair of cookie.split(';')) {
    const entry = pair.trim()
    const eq = entry.indexOf('=')
    if (eq <= 0) continue
    if (entry.slice(0, eq) === 'csrf_token') return entry.slice(eq + 1)
  }
  return null
}

/** Same-origin base as the API carrier: the page origin, or a fake authority off-browser. */
function resolveOrigin(): string {
  const loc = (globalThis as { location?: { origin?: string } }).location
  return loc?.origin !== undefined && loc.origin !== 'null' ? loc.origin : 'http://localhost.invalid'
}

/**
 * The real account/auth client over browser fetch. Same-origin by
 * construction: paths are resolved against the page origin exactly like the
 * API carrier, credentials ride the browser's default same-origin cookie
 * policy, and the CSRF header is attached to every write when the cookie is
 * present.
 */
export class AuthClient implements IAuthClient {
  private readonly doFetch: typeof fetch
  private readonly unauthorized: UnauthorizedSignal

  /** @param options - transport and 401-signal seams (both default sensibly). */
  constructor(options: AuthClientOptions = {}) {
    this.doFetch = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.unauthorized = options.unauthorized ?? new UnauthorizedSignal()
  }

  /** @inheritdoc */
  me(): Promise<AccountView> {
    return this.request('GET', '/api/v1/auth/me')
  }

  /** @inheritdoc */
  setupStatus(): Promise<SetupStatus> {
    return this.request('GET', '/api/v1/auth/setup-status')
  }

  /** @inheritdoc */
  login(email: string, password: string, rememberMe = false): Promise<IssuedLogin> {
    return this.request('POST', '/api/v1/auth/login/local', { email, password, rememberMe })
  }

  /** @inheritdoc */
  initialize(email: string, password: string, rememberMe = true): Promise<IssuedLogin> {
    return this.request('POST', '/api/v1/auth/initialize', { email, password, rememberMe })
  }

  /** @inheritdoc */
  async logout(): Promise<void> {
    await this.request('POST', '/api/v1/auth/logout')
  }

  /** @inheritdoc */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await this.request('POST', '/api/v1/auth/change-password', { currentPassword, newPassword })
  }

  /** @inheritdoc */
  async listUsers(): Promise<AccountView[]> {
    const payload = await this.request<{ users: AccountView[] }>('GET', '/api/v1/admin/users')
    return payload.users
  }

  /** @inheritdoc */
  async updateUser(id: string, update: AccountUpdate): Promise<AccountView> {
    const payload = await this.request<{ user: AccountView }>('PATCH', `/api/v1/admin/users/${encodeURIComponent(id)}`, update)
    return payload.user
  }

  /** @inheritdoc */
  async resetPassword(id: string, newPassword: string): Promise<AccountView> {
    const payload = await this.request<{ user: AccountView }>('POST', `/api/v1/admin/users/${encodeURIComponent(id)}/reset-password`, { newPassword })
    return payload.user
  }

  /** Subscribe to 401 session-loss events this client raises. */
  onUnauthorized(listener: (error: AuthError) => void): () => void {
    return this.unauthorized.subscribe(listener)
  }

  /**
   * Shared request leg: JSON in/out, CSRF header on writes from the cookie,
   * error envelope -> AuthError, 401 -> the shared signal (the throw still
   * carries the same error; the signal is purely observational).
   */
  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {}
    if (body !== undefined) headers['content-type'] = 'application/json'
    if (method !== 'GET' && method !== 'HEAD') {
      const doc = (globalThis as { document?: { cookie?: string } }).document
      const token = readCsrfTokenFromCookie(doc?.cookie)
      if (token !== null) headers['x-csrf-token'] = token
    }
    const response = await this.doFetch(new URL(path, resolveOrigin()), {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    const payload = await readJsonBody(response)
    if (!response.ok) {
      const wire = (payload as { error?: { code?: string; message?: string } } | null)?.error
      const error = new AuthError(response.status, wire?.code ?? 'unknown_error', wire?.message ?? `HTTP ${response.status}`)
      if (response.status === 401) this.unauthorized.emit(error)
      throw error
    }
    return payload as T
  }
}

/** Parse one JSON body; an unparseable success body resolves as an empty record. */
async function readJsonBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text === '') return {}
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}
