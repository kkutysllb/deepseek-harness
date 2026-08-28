import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { SystemRole } from '../src/types.ts'
import { afterEach, describe, expect, it } from 'vitest'
import { AccountConflictError } from '../src/errors.ts'
import {
  ACCOUNTS_SCHEMA_VERSION,
  SqliteAccountStore,
  defaultAccountsDbPath,
} from '../src/index.ts'

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'account-core-'))
  dirs.push(dir)
  return dir
}

function tempDbPath(): string {
  return join(tempDir(), 'nested', 'accounts.db')
}

function userVersionAt(path: string): number {
  const db = new DatabaseSync(path)
  try {
    const row = db.prepare('PRAGMA user_version').get() as { user_version: unknown }
    return row.user_version as number
  } finally {
    db.close()
  }
}


afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('schema creation', () => {
  it('creates the users and sessions tables and records the schema version on first open', () => {
    const path = tempDbPath()
    const store = new SqliteAccountStore({ path })
    store.insertUser({ email: 'a@qilin.dev', passwordHash: null, systemRole: 'admin', needsSetup: true })
    store.close()
    expect(userVersionAt(path)).toBe(ACCOUNTS_SCHEMA_VERSION)
  })

  it('reopens idempotently: data survives and the version stays put', async () => {
    const path = tempDbPath()
    const first = new SqliteAccountStore({ path })
    const created = first.insertUser({ email: 'a@qilin.dev', passwordHash: 'h', systemRole: 'user' })
    first.close()
    const second = new SqliteAccountStore({ path })
    expect(second.findUserById(created.id)).toMatchObject({ email: 'a@qilin.dev' })
    expect(userVersionAt(path)).toBe(ACCOUNTS_SCHEMA_VERSION)
    second.close()
  })

  it('lets concurrent first opens converge on one schema', async () => {
    const path = tempDbPath()
    const stores = await Promise.all([
      Promise.resolve(new SqliteAccountStore({ path, busyTimeoutMs: 10_000 })),
      Promise.resolve(new SqliteAccountStore({ path, busyTimeoutMs: 10_000 })),
    ])
    const created = stores[0].insertUser({ email: 'a@qilin.dev', passwordHash: 'h', systemRole: 'user' })
    expect(stores[1].findUserByEmail('a@qilin.dev')).toMatchObject({ id: created.id })
    for (const store of stores) store.close()
  })

  it('serves an in-memory store', () => {
    const store = new SqliteAccountStore({ path: ':memory:' })
    expect(store.countUsers()).toBe(0)
    store.close()
  })

  it('defaults to the harness home location when no path is given', () => {
    expect(defaultAccountsDbPath({ QILIN_HOME: '/tmp/some-home' })).toBe('/tmp/some-home/qilin-accounts/accounts.db')
  })

  it('defaults to the harness home database when constructed without a path', () => {
    const home = tempDir()
    const store = new SqliteAccountStore({ env: { QILIN_HOME: home } })
    const created = store.insertUser({ email: 'a@qilin.dev', passwordHash: 'h', systemRole: 'user' })
    store.close()
    expect(defaultAccountsDbPath({ QILIN_HOME: home })).toBe(join(home, 'qilin-accounts', 'accounts.db'))
    expect(userVersionAt(join(home, 'qilin-accounts', 'accounts.db'))).toBe(ACCOUNTS_SCHEMA_VERSION)
    expect(created.email).toBe('a@qilin.dev')
  })

  it('lets the schema CHECK reject a system role outside the closed set', () => {
    const store = new SqliteAccountStore({ path: ':memory:' })
    const bogus = 'root' as SystemRole
    expect(() => store.insertUser({ email: 'a@qilin.dev', passwordHash: 'h', systemRole: bogus })).toThrow(/CHECK constraint failed/)
    store.close()
  })

  it('lets the schema CHECK reject a non-positive issued version', () => {
    const store = new SqliteAccountStore({ path: ':memory:' })
    const created = store.insertUser({ email: 'a@qilin.dev', passwordHash: 'h', systemRole: 'user' })
    expect(() =>
      store.insertSession({ userId: created.id, issuedVersion: 0, persistent: false, expiresAt: 1 }),
    ).toThrow(/CHECK constraint failed/)
    store.close()
  })


  it('rejects a file that is not a database', () => {
    const path = join(tempDir(), 'accounts.db')
    writeFileSync(path, 'definitely not sqlite', 'utf8')
    expect(() => new SqliteAccountStore({ path })).toThrow()
  })

  it('rejects a database written by a newer schema version', () => {
    const path = tempDbPath()
    const store = new SqliteAccountStore({ path })
    store.close()
    const raw = new DatabaseSync(path)
    raw.exec('PRAGMA user_version = 99')
    raw.close()
    expect(() => new SqliteAccountStore({ path })).toThrow(/newer than the supported version/)
  })
})

describe('users', () => {
  it.each([
    {
      name: 'local admin pending setup',
      input: { email: 'admin@qilin.dev', passwordHash: 'hash', systemRole: 'admin' as const, needsSetup: true },
      expected: { needsSetup: true, oauthProvider: null, oauthId: null, sessionVersion: 1 },
    },
    {
      name: 'local user',
      input: { email: 'user@qilin.dev', passwordHash: 'hash', systemRole: 'user' as const },
      expected: { needsSetup: false, oauthProvider: null, oauthId: null, sessionVersion: 1 },
    },
    {
      name: 'oauth-only user',
      input: {
        email: 'oa@qilin.dev',
        passwordHash: null,
        systemRole: 'user' as const,
        oauthProvider: 'github',
        oauthId: '42',
      },
      expected: { needsSetup: false, oauthProvider: 'github', oauthId: '42', sessionVersion: 1 },
    },
  ])('round-trips $name through insert and lookup', async ({ input, expected }) => {
    const store = new SqliteAccountStore({ path: ':memory:' })
    const nowValues = [1000, 2000]
    const created = store.insertUser(input)
    expect(created).toMatchObject({ ...input, ...expected, createdAt: created.createdAt, updatedAt: created.createdAt })
    expect(store.findUserById(created.id)).toMatchObject({ email: input.email })
    expect(store.findUserByEmail(input.email)).toMatchObject({ id: created.id })
    expect(store.findUserById('missing')).toBeUndefined()
    expect(store.findUserByEmail('missing@qilin.dev')).toBeUndefined()
    expect(created.createdAt).toBeGreaterThan(0)
    expect(nowValues).toHaveLength(2)
    store.close()
  })

  it('counts users from zero upward', () => {
    const store = new SqliteAccountStore({ path: ':memory:' })
    expect(store.countUsers()).toBe(0)
    store.insertUser({ email: 'a@qilin.dev', passwordHash: 'h', systemRole: 'user' })
    store.insertUser({ email: 'b@qilin.dev', passwordHash: 'h', systemRole: 'user' })
    expect(store.countUsers()).toBe(2)
    store.close()
  })

  it('classifies a duplicate email as an email conflict', () => {
    const store = new SqliteAccountStore({ path: ':memory:' })
    store.insertUser({ email: 'a@qilin.dev', passwordHash: 'h', systemRole: 'user' })
    expect(() =>
      store.insertUser({ email: 'a@qilin.dev', passwordHash: 'h', systemRole: 'admin' }),
    ).toThrow(AccountConflictError)
    try {
      store.insertUser({ email: 'a@qilin.dev', passwordHash: 'h', systemRole: 'admin' })
    } catch (error) {
      expect((error as AccountConflictError).kind).toBe('email')
    }
    store.close()
  })

  it('classifies a duplicate OAuth identity as an oauth conflict', () => {
    const store = new SqliteAccountStore({ path: ':memory:' })
    store.insertUser({
      email: 'a@qilin.dev',
      passwordHash: null,
      systemRole: 'user',
      oauthProvider: 'github',
      oauthId: '42',
    })
    expect(() =>
      store.insertUser({
        email: 'b@qilin.dev',
        passwordHash: null,
        systemRole: 'user',
        oauthProvider: 'github',
        oauthId: '42',
      }),
    ).toThrow(/already exists/)
    store.close()
  })

  it('accepts several users without any OAuth linkage', () => {
    const store = new SqliteAccountStore({ path: ':memory:' })
    store.insertUser({ email: 'a@qilin.dev', passwordHash: 'h', systemRole: 'user' })
    store.insertUser({ email: 'b@qilin.dev', passwordHash: 'h', systemRole: 'user' })
    expect(store.countUsers()).toBe(2)
    store.close()
  })

  it('updatePassword stores the new hash and advances the session version', () => {
    let tick = 0
    const store = new SqliteAccountStore({ path: ':memory:', now: () => ++tick * 1000 })
    const created = store.insertUser({ email: 'a@qilin.dev', passwordHash: 'old', systemRole: 'user' })
    const updated = store.updatePassword(created.id, 'new')
    expect(updated.passwordHash).toBe('new')
    expect(updated.sessionVersion).toBe(created.sessionVersion + 1)
    expect(updated.updatedAt).toBe(created.updatedAt + 1000)
    store.close()
  })

  it('clearNeedsSetup completes the initialize flow', () => {
    const store = new SqliteAccountStore({ path: ':memory:' })
    const created = store.insertUser({ email: 'a@qilin.dev', passwordHash: 'h', systemRole: 'admin', needsSetup: true })
    const cleared = store.clearNeedsSetup(created.id)
    expect(cleared.needsSetup).toBe(false)
    store.close()
  })

  it.each([
    { name: 'updatePassword', run: (store: SqliteAccountStore) => () => store.updatePassword('missing', 'h') },
    { name: 'clearNeedsSetup', run: (store: SqliteAccountStore) => () => store.clearNeedsSetup('missing') },
  ])('fails loud on an unknown account: $name', ({ run }) => {
    const store = new SqliteAccountStore({ path: ':memory:' })
    expect(run(store)).toThrow(/does not exist/)
    store.close()
  })
})

describe('sessions', () => {
  async function seed(store: SqliteAccountStore): Promise<{ admin: string; user: string }> {
    const admin = store.insertUser({ email: 'admin@qilin.dev', passwordHash: 'h', systemRole: 'admin' })
    const user = store.insertUser({ email: 'user@qilin.dev', passwordHash: 'h', systemRole: 'user' })
    return { admin: admin.id, user: user.id }
  }

  it.each([true, false])('round-trips a session (persistent: %s)', async (persistent) => {
    const store = new SqliteAccountStore({ path: ':memory:' })
    const { user } = await seed(store)
    const created = store.insertSession({
      userId: user,
      issuedVersion: 3,
      persistent,
      expiresAt: 5_000_000,
    })
    expect(created).toMatchObject({
      userId: user,
      issuedVersion: 3,
      persistent,
      expiresAt: 5_000_000,
    })
    expect(store.findSession(created.id)).toMatchObject({ id: created.id, persistent })
    store.close()
  })

  it('returns undefined for an unknown session id', () => {
    const store = new SqliteAccountStore({ path: ':memory:' })
    expect(store.findSession('missing')).toBeUndefined()
    store.close()
  })

  it('rejects a session for an unknown account', () => {
    const store = new SqliteAccountStore({ path: ':memory:' })
    expect(() =>
      store.insertSession({ userId: 'ghost', issuedVersion: 1, persistent: false, expiresAt: 1 }),
    ).toThrow(/account "ghost" does not exist/)
    store.close()
  })

  it('deleteSession removes exactly one session', async () => {
    const store = new SqliteAccountStore({ path: ':memory:' })
    const { user } = await seed(store)
    const first = store.insertSession({ userId: user, issuedVersion: 1, persistent: false, expiresAt: 1 })
    const second = store.insertSession({ userId: user, issuedVersion: 1, persistent: false, expiresAt: 1 })
    store.deleteSession(first.id)
    expect(store.findSession(first.id)).toBeUndefined()
    expect(store.findSession(second.id)).toBeDefined()
    store.close()
  })

  it('deleteSessionsForUser wipes only the target account sessions', async () => {
    const store = new SqliteAccountStore({ path: ':memory:' })
    const { admin, user } = await seed(store)
    const userSession = store.insertSession({ userId: user, issuedVersion: 1, persistent: false, expiresAt: 1 })
    const adminSession = store.insertSession({ userId: admin, issuedVersion: 1, persistent: false, expiresAt: 1 })
    store.deleteSessionsForUser(user)
    expect(store.findSession(userSession.id)).toBeUndefined()
    expect(store.findSession(adminSession.id)).toBeDefined()
    store.close()
  })
})

describe('durable reads', () => {
  /** Build a database without the CHECK guards, so corrupt rows can be inserted by hand. */
  function looseDatabase(path: string): DatabaseSync {
    mkdirSync(dirname(path), { recursive: true })
    const db = new DatabaseSync(path)
    db.exec(`
CREATE TABLE users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL, password_hash TEXT, system_role TEXT NOT NULL,
  needs_setup INTEGER NOT NULL, oauth_provider TEXT, oauth_id TEXT,
  session_version INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users (id), issued_version INTEGER NOT NULL,
  persistent INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
`)
    return db
  }

  function insertUserRow(db: DatabaseSync, overrides: Record<string, string | number>): void {
    const row = {
      id: 'u1', email: 'a@qilin.dev', password_hash: 'h', system_role: 'user',
      needs_setup: 0, oauth_provider: null, oauth_id: null,
      session_version: 1, created_at: 1, updated_at: 1, ...overrides,
    }
    db.prepare('INSERT INTO users (id, email, password_hash, system_role, needs_setup, oauth_provider, oauth_id, session_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      row.id,
      row.email,
      row.password_hash,
      row.system_role,
      row.needs_setup,
      row.oauth_provider,
      row.oauth_id,
      row.session_version,
      row.created_at,
      row.updated_at,
    )
  }

  it('fails loud on a system role outside the closed set', () => {
    const path = tempDbPath()
    const raw = looseDatabase(path)
    insertUserRow(raw, { id: 'u1', system_role: 'root' })
    raw.close()
    const reader = new SqliteAccountStore({ path })
    expect(() => reader.findUserById('u1')).toThrow(/corrupt account database/)
    reader.close()
  })

  it('fails loud on a needs_setup value outside 0/1', () => {
    const path = tempDbPath()
    const raw = looseDatabase(path)
    insertUserRow(raw, { id: 'u1', needs_setup: 2 })
    raw.close()
    const reader = new SqliteAccountStore({ path })
    expect(() => reader.findUserById('u1')).toThrow(/needs_setup/)
    reader.close()
  })

  it('fails loud on a persistent value outside 0/1', () => {
    const path = tempDbPath()
    const raw = looseDatabase(path)
    insertUserRow(raw, { id: 'u1' })
    raw.prepare('INSERT INTO sessions (id, user_id, issued_version, persistent, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      's1', 'u1', 1, 2, 1, 1,
    )
    raw.close()
    const reader = new SqliteAccountStore({ path })
    expect(() => reader.findSession('s1')).toThrow(/persistent/)
    reader.close()
  })
})

describe('disabled_at column (S5-A)', () => {
  it('creates the column in fresh databases and defaults users to null', () => {
    const path = tempDbPath()
    const store = new SqliteAccountStore({ path })
    const user = store.insertUser({ email: 'a@qilin.dev', passwordHash: 'h', systemRole: 'user' })
    expect(user.disabledAt).toBe(null)
    expect(store.findUserById(user.id)?.disabledAt).toBe(null)
    store.close()
    const db = new DatabaseSync(path)
    try {
      const columns = db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>
      expect(columns.map(column => column.name)).toContain('disabled_at')
    } finally {
      db.close()
    }
  })

  it('migrates a pre-disabled_at database in place and keeps rows readable', () => {
    const path = tempDbPath()
    mkdirSync(dirname(path), { recursive: true })
    const legacy = new DatabaseSync(path)
    try {
      legacy.exec('CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL, password_hash TEXT, system_role TEXT NOT NULL CHECK (system_role IN (\'admin\', \'user\')), needs_setup INTEGER NOT NULL DEFAULT 0 CHECK (needs_setup IN (0, 1)), oauth_provider TEXT, oauth_id TEXT, session_version INTEGER NOT NULL DEFAULT 1 CHECK (session_version >= 1), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)')
      legacy.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users (id), issued_version INTEGER NOT NULL CHECK (issued_version >= 1), persistent INTEGER NOT NULL DEFAULT 0 CHECK (persistent IN (0, 1)), created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)')
      legacy.prepare('INSERT INTO users (id, email, password_hash, system_role, needs_setup, oauth_provider, oauth_id, session_version, created_at, updated_at) VALUES (?, ?, ?, ?, 0, NULL, NULL, 1, ?, ?)').run('legacy-1', 'old@qilin.dev', 'h', 'user', 1756339200000, 1756339200000)
      legacy.exec('PRAGMA user_version = 1')
    } finally {
      legacy.close()
    }
    const store = new SqliteAccountStore({ path })
    const migrated = store.findUserById('legacy-1')
    expect(migrated?.email).toBe('old@qilin.dev')
    expect(migrated?.disabledAt).toBe(null)
    expect(store.listUsers()).toHaveLength(1)
    store.close()
    expect(userVersionAt(path)).toBe(ACCOUNTS_SCHEMA_VERSION)
  })

  it('rejects a corrupt disabled_at through the corrupt channel', () => {
    const path = tempDbPath()
    const store = new SqliteAccountStore({ path })
    const user = store.insertUser({ email: 'a@qilin.dev', passwordHash: 'h', systemRole: 'user' })
    store.close()
    const db = new DatabaseSync(path)
    db.prepare('UPDATE users SET disabled_at = ?').run('soon')
    db.close()
    const reopened = new SqliteAccountStore({ path })
    expect(() => reopened.findUserById(user.id)).toThrow(/corrupt account database: column disabled_at/)
    reopened.close()
  })

  it('lists users in a stable creation order', () => {
    let tick = 1000
    const store = new SqliteAccountStore({ path: tempDbPath(), now: () => (tick += 1) })
    store.insertUser({ email: 'c@qilin.dev', passwordHash: null, systemRole: 'user' })
    store.insertUser({ email: 'a@qilin.dev', passwordHash: null, systemRole: 'admin' })
    store.insertUser({ email: 'b@qilin.dev', passwordHash: null, systemRole: 'user' })
    expect(store.listUsers().map(user => user.email)).toEqual(['c@qilin.dev', 'a@qilin.dev', 'b@qilin.dev'])
    store.close()
  })

  it('updates role and disabled state, refusing unknown ids', () => {
    const store = new SqliteAccountStore({ path: tempDbPath() })
    const user = store.insertUser({ email: 'a@qilin.dev', passwordHash: 'h', systemRole: 'user' })
    const promoted = store.updateRole(user.id, 'admin')
    expect(promoted.systemRole).toBe('admin')
    expect(store.findUserById(user.id)?.systemRole).toBe('admin')
    const disabled = store.setDisabled(user.id, 12345)
    expect(disabled.disabledAt).toBe(12345)
    expect(store.findUserById(user.id)?.disabledAt).toBe(12345)
    expect(store.setDisabled(user.id, null).disabledAt).toBe(null)
    expect(() => store.updateRole('ghost', 'admin')).toThrow(/does not exist/)
    expect(() => store.setDisabled('ghost', null)).toThrow(/does not exist/)
    store.close()
  })
})
