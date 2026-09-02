/**
 * Account and session entities plus the storage seam they resolve against.
 * Types only: every runtime behavior lives in its owning module.
 * @module @qilin/account-core/types
 */

/** System role of an account. `admin` outranks `user`; the list is closed (RBAC input, fail-closed elsewhere). */
export type SystemRole = 'admin' | 'user'

/** One registered account. `passwordHash` is null exactly for OAuth-only users. */
export interface User {
  /** Stable account identifier (random UUID). */
  readonly id: string
  /** Unique sign-in email, stored and compared as written (no case folding). */
  readonly email: string
  /** scrypt encoding from `hashPassword`, or null when the user authenticates through OAuth only. */
  readonly passwordHash: string | null
  /** Account-level role consumed by RBAC checks. */
  readonly systemRole: SystemRole
  /** Whether an initialize flow (password set) is still pending for this account. */
  readonly needsSetup: boolean
  /** OAuth identity linkage; both fields are null for local accounts. */
  readonly oauthProvider: string | null
  /** OAuth identity linkage; both fields are null for local accounts. */
  readonly oauthId: string | null
  /** Monotonic credential epoch: bumping it invalidates every session issued from an earlier value. */
  readonly sessionVersion: number
  /** Creation time as epoch milliseconds (UTC). */
  readonly createdAt: number
  /** Last credential-state change as epoch milliseconds (UTC). */
  readonly updatedAt: number
  /** When the account was disabled (epoch ms), or null while enabled. */
  readonly disabledAt: number | null
}

/** One server-side session. Revocation deletes the row; version comparison invalidates survivors. */
export interface Session {
  /** Opaque session identifier handed to clients; random, carries no account data. */
  readonly id: string
  /** Owning account. */
  readonly userId: string
  /** The owning account's `sessionVersion` at issuance; a mismatch marks the session revoked. */
  readonly issuedVersion: number
  /** Whether the session outlives a browser close (remember-me semantics). */
  readonly persistent: boolean
  /** Creation time as epoch milliseconds (UTC). */
  readonly createdAt: number
  /** Absolute expiry as epoch milliseconds (UTC); wall-clock regressions expire the session early. */
  readonly expiresAt: number
}

/** Input for creating one account; the store assigns identity and timestamps. */
export interface NewUser {
  /** Sign-in email; must not collide with an existing account. */
  readonly email: string
  /** scrypt encoding from `hashPassword`, or null for OAuth-only users. */
  readonly passwordHash: string | null
  /** Account-level role. */
  readonly systemRole: SystemRole
  /** Whether the initialize flow is pending; defaults to false. */
  readonly needsSetup?: boolean
  /** OAuth provider name; pair with `oauthId`. */
  readonly oauthProvider?: string | null
  /** OAuth provider-side identity; pair with `oauthProvider`. */
  readonly oauthId?: string | null
}

/** Input for issuing one session; the store assigns the identifier and creation time. */
export interface NewSession {
  /** Owning account; must exist. */
  readonly userId: string
  /** The account's current `sessionVersion` at issuance. */
  readonly issuedVersion: number
  /** Remember-me semantics. */
  readonly persistent: boolean
  /** Absolute expiry as epoch milliseconds (UTC). */
  readonly expiresAt: number
}

/** Which uniqueness constraint an account write collided with. */
export type AccountConflictKind = 'email' | 'oauth'

/** Durable account and session storage over the synchronous `node:sqlite` API. */
export interface AccountStore {
  /** Insert one account; a uniqueness collision rejects with `AccountConflictError`. */
  insertUser(user: NewUser): User
  /** Return the account with `id`, or undefined when absent. */
  findUserById(id: string): User | undefined
  /** Return the account with `email`, or undefined when absent. */
  findUserByEmail(email: string): User | undefined
  /** Return the number of stored accounts; zero marks an uninitialized install. */
  countUsers(): number
  /** Return every account in stable creation order (created_at, then id). */
  listUsers(): User[]
  /** Change one account's role; an unknown id rejects. */
  updateRole(userId: string, systemRole: SystemRole): User
  /** Disable (epoch ms) or re-enable (null) one account; an unknown id rejects. */
  setDisabled(userId: string, disabledAt: number | null): User
  /** Store a new password hash and advance the account's `sessionVersion`, invalidating its sessions. */
  updatePassword(userId: string, passwordHash: string): User
  /** Mark the account's initialize flow complete. */
  clearNeedsSetup(userId: string): User
  /** Insert one session; an unknown `userId` rejects. */
  insertSession(session: NewSession): Session
  /** Return the session with `id`, or undefined when absent or deleted. */
  findSession(id: string): Session | undefined
  /** Delete one session (logout or explicit revocation). */
  deleteSession(id: string): void
  /** Delete every session owned by `userId` (password-change fallout). */
  deleteSessionsForUser(userId: string): void
  /** Release the database handle; the store is unusable afterwards. */
  close(): void
}
