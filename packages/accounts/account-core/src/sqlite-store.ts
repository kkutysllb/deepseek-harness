/**
 * SQLite account storage over `node:sqlite`: idempotent schema creation,
 * users and sessions CRUD, and conflict classification. One store owns one
 * database file; the default location lives under the harness home so the
 * database inherits its backup and isolation semantics.
 * @module @qilin/account-core/sqlite-store
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { resolveDshHome } from '@qilin/home-paths'
import { AccountConflictError } from './errors.ts'
import type {
  AccountStore,
  NewSession,
  NewUser,
  Session,
  SystemRole,
  User,
} from './types.ts'

/** Current schema version recorded in the `user_version` pragma. */
export const ACCOUNTS_SCHEMA_VERSION = 2

/** Directory inside the harness home holding the account database. */
export const ACCOUNTS_DIRECTORY = 'qilin-accounts'

/** Database file name inside {@link ACCOUNTS_DIRECTORY}. */
export const ACCOUNTS_DB_FILENAME = 'accounts.db'

/** Idempotent schema creation. Every statement is safe to re-run on an existing database. */
const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  password_hash TEXT,
  system_role TEXT NOT NULL CHECK (system_role IN ('admin', 'user')),
  needs_setup INTEGER NOT NULL DEFAULT 0 CHECK (needs_setup IN (0, 1)),
  oauth_provider TEXT,
  oauth_id TEXT,
  session_version INTEGER NOT NULL DEFAULT 1 CHECK (session_version >= 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  disabled_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (email);
CREATE UNIQUE INDEX IF NOT EXISTS users_oauth_identity_unique ON users (oauth_provider, oauth_id)
  WHERE oauth_provider IS NOT NULL AND oauth_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  issued_version INTEGER NOT NULL CHECK (issued_version >= 1),
  persistent INTEGER NOT NULL DEFAULT 0 CHECK (persistent IN (0, 1)),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions (user_id);
`

const INSERT_USER = 'INSERT INTO users (id, email, password_hash, system_role, needs_setup, oauth_provider, oauth_id, session_version, created_at, updated_at, disabled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)'
const SELECT_USER_BY_ID = 'SELECT id, email, password_hash, system_role, needs_setup, oauth_provider, oauth_id, session_version, created_at, updated_at, disabled_at FROM users WHERE id = ?'
const SELECT_USER_BY_EMAIL = 'SELECT id, email, password_hash, system_role, needs_setup, oauth_provider, oauth_id, session_version, created_at, updated_at, disabled_at FROM users WHERE email = ?'
const UPDATE_PASSWORD = 'UPDATE users SET password_hash = ?, session_version = session_version + 1, updated_at = ? WHERE id = ?'
const UPDATE_NEEDS_SETUP = 'UPDATE users SET needs_setup = 0, updated_at = ? WHERE id = ?'
const INSERT_SESSION = 'INSERT INTO sessions (id, user_id, issued_version, persistent, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
const SELECT_SESSION_BY_ID = 'SELECT id, user_id, issued_version, persistent, created_at, expires_at FROM sessions WHERE id = ?'
const DELETE_SESSION_BY_ID = 'DELETE FROM sessions WHERE id = ?'
const DELETE_SESSIONS_BY_USER = 'DELETE FROM sessions WHERE user_id = ?'

/** SQLite extended result code for a UNIQUE-constraint violation. */
const SQLITE_CONSTRAINT_UNIQUE = 2067
/** SQLite extended result code for a foreign-key violation. */
const SQLITE_CONSTRAINT_FOREIGNKEY = 787

/** Store construction seams; every field has a production default. */
export interface SqliteAccountStoreOptions {
  /** Database file path, or `:memory:`; defaults to `<harness home>/qilin-accounts/accounts.db`. */
  readonly path?: string
  /** Environment consulted for `OPENKYLIN_HOME` when `path` is omitted; defaults to `process.env`. */
  readonly env?: NodeJS.ProcessEnv
  /** Milliseconds a write waits on a competing SQLite lock; defaults to 5000. */
  readonly busyTimeoutMs?: number
  /** Clock seam returning epoch milliseconds; defaults to `Date.now`. */
  readonly now?: () => number
  /** Identifier seam for account and session ids; defaults to `crypto.randomUUID`. */
  readonly randomId?: () => string
}

/**
 * Resolve the default database location: `qilin-accounts/accounts.db` inside
 * the harness home (`OPENKYLIN_HOME`, falling back to `~/.openkylin`).
 * @param env - environment consulted for `OPENKYLIN_HOME`; defaults to `process.env`.
 * @returns the default database file path.
 */
export function defaultAccountsDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveDshHome(undefined, env), ACCOUNTS_DIRECTORY, ACCOUNTS_DB_FILENAME)
}

/**
 * SQLite implementation of {@link AccountStore}. The constructor opens the
 * database, verifies the schema version, and creates missing tables, so a
 * constructed store is ready for use.
 */
export class SqliteAccountStore implements AccountStore {
  private readonly db: DatabaseSync
  private readonly path: string
  private readonly now: () => number
  private readonly randomId: () => string

  /**
   * Open (creating when absent) the account database and ensure its schema.
   * @param options - location, clock, and identifier seams.
   * @throws when the file is not a database or its schema version is newer than this build supports.
   */
  constructor(options: SqliteAccountStoreOptions = {}) {
    this.path = options.path ?? defaultAccountsDbPath(options.env)
    this.now = options.now ?? Date.now
    this.randomId = options.randomId ?? randomUUID
    const busyTimeoutMs = options.busyTimeoutMs ?? 5000
    if (this.path !== ':memory:') {
      mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    }
    this.db = new DatabaseSync(this.path, { timeout: busyTimeoutMs, enableForeignKeyConstraints: true })
    try {
      this.ensureSchema()
    } catch (error: unknown) {
      this.db.close()
      throw error
    }
  }

  /** @inheritdoc */
  insertUser(user: NewUser): User {
    const id = this.randomId()
    const createdAt = this.now()
    try {
      this.db.prepare(INSERT_USER).run(
        id,
        user.email,
        user.passwordHash,
        user.systemRole,
        user.needsSetup === true ? 1 : 0,
        user.oauthProvider ?? null,
        user.oauthId ?? null,
        1,
        createdAt,
        createdAt,
      )
    } catch (error: unknown) {
      throw asUniqueConflict(error) ?? error
    }
    return {
      id,
      email: user.email,
      passwordHash: user.passwordHash,
      systemRole: user.systemRole,
      needsSetup: user.needsSetup === true,
      oauthProvider: user.oauthProvider ?? null,
      oauthId: user.oauthId ?? null,
      sessionVersion: 1,
      createdAt,
      updatedAt: createdAt,
      disabledAt: null,
    }
  }

  /** @inheritdoc */
  findUserById(id: string): User | undefined {
    return decodeUser(this.db.prepare(SELECT_USER_BY_ID).get(id))
  }

  /** @inheritdoc */
  findUserByEmail(email: string): User | undefined {
    return decodeUser(this.db.prepare(SELECT_USER_BY_EMAIL).get(email))
  }

  /** @inheritdoc */
  countUsers(): number {
    const row = this.db.prepare('SELECT count(*) AS n FROM users').get() as { n: unknown }
    return row.n as number
  }

  /** @inheritdoc */
  updatePassword(userId: string, passwordHash: string): User {
    const updatedAt = this.now()
    const result = this.db.prepare(UPDATE_PASSWORD).run(passwordHash, updatedAt, userId)
    if (result.changes === 0) throw new Error(`account "${userId}" does not exist`, { cause: 'updatePassword' })
    return this.userAfterUpdate(userId)
  }

  /** @inheritdoc */
  clearNeedsSetup(userId: string): User {
    const updatedAt = this.now()
    const result = this.db.prepare(UPDATE_NEEDS_SETUP).run(updatedAt, userId)
    if (result.changes === 0) throw new Error(`account "${userId}" does not exist`, { cause: 'clearNeedsSetup' })
    return this.userAfterUpdate(userId)
  }

  /** @inheritdoc */
  listUsers(): User[] {
    const rows = this.db.prepare('SELECT id, email, password_hash, system_role, needs_setup, oauth_provider, oauth_id, session_version, created_at, updated_at, disabled_at FROM users ORDER BY created_at ASC, id ASC').all() as Array<Record<string, unknown>>
    return rows.map(row => decodeUserRow(row))
  }

  /** @inheritdoc */
  updateRole(userId: string, systemRole: SystemRole): User {
    const result = this.db.prepare('UPDATE users SET system_role = ?, updated_at = ? WHERE id = ?').run(systemRole, this.now(), userId)
    if (result.changes === 0) throw new Error(`account "${userId}" does not exist`, { cause: 'updateRole' })
    return this.userAfterUpdate(userId)
  }

  /** @inheritdoc */
  setDisabled(userId: string, disabledAt: number | null): User {
    const result = this.db.prepare('UPDATE users SET disabled_at = ?, updated_at = ? WHERE id = ?').run(disabledAt, this.now(), userId)
    if (result.changes === 0) throw new Error(`account "${userId}" does not exist`, { cause: 'setDisabled' })
    return this.userAfterUpdate(userId)
  }

  /** @inheritdoc */
  insertSession(session: NewSession): Session {
    const id = this.randomId()
    const createdAt = this.now()
    try {
      this.db.prepare(INSERT_SESSION).run(
        id,
        session.userId,
        session.issuedVersion,
        session.persistent ? 1 : 0,
        createdAt,
        session.expiresAt,
      )
    } catch (error: unknown) {
      throw asMissingAccount(error, session.userId) ?? error
    }
    return {
      id,
      userId: session.userId,
      issuedVersion: session.issuedVersion,
      persistent: session.persistent,
      createdAt,
      expiresAt: session.expiresAt,
    }
  }

  /** @inheritdoc */
  findSession(id: string): Session | undefined {
    return decodeSession(this.db.prepare(SELECT_SESSION_BY_ID).get(id))
  }

  /** @inheritdoc */
  deleteSession(id: string): void {
    this.db.prepare(DELETE_SESSION_BY_ID).run(id)
  }

  /** @inheritdoc */
  deleteSessionsForUser(userId: string): void {
    this.db.prepare(DELETE_SESSIONS_BY_USER).run(userId)
  }

  /** @inheritdoc */
  close(): void {
    this.db.close()
  }

  /**
   * Verify the on-disk schema version and create any missing tables.
   * @throws when the database reports a schema version this build cannot serve.
   */
  private ensureSchema(): void {
    const version = this.userVersion()
    if (version > ACCOUNTS_SCHEMA_VERSION) {
      throw new Error(
        `account database at "${this.path}" uses schema version ${version}, newer than the supported version ${ACCOUNTS_SCHEMA_VERSION}`,
      )
    }
    this.db.exec(SCHEMA_DDL)
    this.migrateDisabledAt()
    if (version < ACCOUNTS_SCHEMA_VERSION) this.db.exec(`PRAGMA user_version = ${ACCOUNTS_SCHEMA_VERSION}`)
  }

  /**
   * Add the S5 `disabled_at` column to a pre-S5 database in place. Detected
   * via PRAGMA table_info (not the schema version alone) so the migration is
   * idempotent and keeps every existing row readable with a null timestamp.
   */
  private migrateDisabledAt(): void {
    const columns = this.db.prepare('PRAGMA table_info(users)').all() as Array<{ name: unknown }>
    if (columns.some(column => column.name === 'disabled_at')) return
    this.db.exec('ALTER TABLE users ADD COLUMN disabled_at INTEGER')
  }

  /** Read the `user_version` pragma. */
  private userVersion(): number {
    const row = this.db.prepare('PRAGMA user_version').get() as { user_version: unknown }
    return row.user_version as number
  }

  /** Load one row by id after an update; the update already proved existence. */
  private userAfterUpdate(userId: string): User {
    const row = this.db.prepare(SELECT_USER_BY_ID).get(userId)
    /* v8 ignore next 3 -- the UPDATE above proved existence; only a concurrent
       delete over a second connection could land here, which no single-store
       caller can trigger. */
    if (row === undefined) throw new Error(`account "${userId}" does not exist`, { cause: 'read-after-update' })
    return decodeUserRow(row)
  }
}

/** Translate a UNIQUE-constraint driver failure into the typed conflict; other failures pass through. */
function asUniqueConflict(error: unknown): AccountConflictError | undefined {
  if ((error as { errcode?: number }).errcode !== SQLITE_CONSTRAINT_UNIQUE) return undefined
  const message = (error as Error).message
  if (message.includes('users.email')) return new AccountConflictError('email', error)
  return new AccountConflictError('oauth', error)
}

/** Translate a foreign-key driver failure into a missing-account failure naming the user id. */
function asMissingAccount(error: unknown, userId: string): Error | undefined {
  if ((error as { errcode?: number }).errcode !== SQLITE_CONSTRAINT_FOREIGNKEY) return undefined
  return new Error(`account "${userId}" does not exist`, { cause: error })
}

/** Human-readable corruption message for one column. */
function corrupt(column: string, value: unknown): Error {
  return new Error(`corrupt account database: column ${column} holds ${JSON.stringify(value)}`)
}

/** Decode the boolean flag columns; any value outside 0/1 reports corruption. */
function decodeFlag(value: unknown, column: string): boolean {
  if (value === 0) return false
  if (value === 1) return true
  throw corrupt(column, value)
}

/** Rebuild a `User` from a durable row, validating the columns RBAC depends on. */
function decodeUser(row: Record<string, unknown> | undefined): User | undefined {
  return row === undefined ? undefined : decodeUserRow(row)
}

/** Decode one present user row. */
function decodeUserRow(row: Record<string, unknown>): User {
  const systemRole = row.system_role
  if (systemRole !== 'admin' && systemRole !== 'user') throw corrupt('system_role', systemRole)
  return {
    id: row.id as string,
    email: row.email as string,
    passwordHash: (row.password_hash as string | null) ?? null,
    systemRole,
    needsSetup: decodeFlag(row.needs_setup, 'needs_setup'),
    oauthProvider: (row.oauth_provider as string | null) ?? null,
    oauthId: (row.oauth_id as string | null) ?? null,
    sessionVersion: row.session_version as number,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    disabledAt: decodeDisabledAt(row.disabled_at),
  }
}

/** Decode the nullable disable timestamp; anything but null or an epoch integer reports corruption. */
function decodeDisabledAt(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value
  throw corrupt('disabled_at', value)
}

/** Rebuild a `Session` from a durable row, validating the flag column. */
function decodeSession(row: Record<string, unknown> | undefined): Session | undefined {
  if (row === undefined) return undefined
  return {
    id: row.id as string,
    userId: row.user_id as string,
    issuedVersion: row.issued_version as number,
    persistent: decodeFlag(row.persistent, 'persistent'),
    createdAt: row.created_at as number,
    expiresAt: row.expires_at as number,
  }
}
