import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  type AccountStore,
  type NewSession,
  type NewUser,
  type Session,
  type SystemRole,
  type User,
  SqliteAccountStore,
  hashPassword,
} from '@qilin/account-core'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionCorruptError, SessionValidationError } from '../src/errors.ts'
import {
  DEFAULT_SESSION_TTL_MS,
  SESSION_ID_PATTERN,
  SessionService,
  type SessionUser,
  projectUser,
} from '../src/session-service.ts'

const dirs: string[] = []

/** Assert one call fails with a SessionValidationError carrying exactly this contract-C code. */
function assertCode(fn: () => unknown, code: 'EXPIRED' | 'INVALID' | 'MALFORMED' | 'DISABLED'): void {
  try {
    fn()
    expect.unreachable(`expected a ${code} failure`)
  } catch (error) {
    expect(error).toBeInstanceOf(SessionValidationError)
    expect((error as SessionValidationError).code).toBe(code)
  }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const T0 = 1_756_339_200_000

function makeUser(store: AccountStore, email = 'a@qilin.dev'): User {
  return store.insertUser({ email, passwordHash: hashPassword('correct horse'), systemRole: 'user' })
}

/**
 * In-memory AccountStore double: same semantics the SQLite store commits to
 * (ids are canonical UUIDs, updatePassword bumps the session version), but
 * every durable row stays directly mutable so corruption cases are injectable.
 */
class FakeAccountStore implements AccountStore {
  readonly users = new Map<string, User>()
  readonly sessions = new Map<string, Session>()
  private seq = 0

  insertUser(user: NewUser): User {
    const id = `user-${++this.seq}`
    const created: User = {
      id,
      email: user.email,
      passwordHash: user.passwordHash ?? null,
      systemRole: user.systemRole,
      needsSetup: user.needsSetup === true,
      oauthProvider: user.oauthProvider ?? null,
      oauthId: user.oauthId ?? null,
      sessionVersion: 1,
      disabledAt: null,
      createdAt: T0,
      updatedAt: T0,
    }
    this.users.set(id, created)
    return created
  }

  listUsers(): User[] {
    return [...this.users.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  }

  updateRole(userId: string, systemRole: SystemRole): User {
    const user = this.users.get(userId)
    if (user === undefined) throw new Error(`account "${userId}" does not exist`)
    const updated: User = { ...user, systemRole }
    this.users.set(userId, updated)
    return updated
  }

  setDisabled(userId: string, disabledAt: number | null): User {
    const user = this.users.get(userId)
    if (user === undefined) throw new Error(`account "${userId}" does not exist`)
    const updated: User = { ...user, disabledAt }
    this.users.set(userId, updated)
    return updated
  }

  findUserById(id: string): User | undefined {
    return this.users.get(id)
  }

  findUserByEmail(email: string): User | undefined {
    for (const user of this.users.values()) if (user.email === email) return user
    return undefined
  }

  countUsers(): number {
    return this.users.size
  }

  updatePassword(userId: string, passwordHash: string): User {
    const user = this.users.get(userId)
    if (user === undefined) throw new Error(`account "${userId}" does not exist`)
    const updated: User = { ...user, passwordHash, sessionVersion: user.sessionVersion + 1, updatedAt: T0 + 1 }
    this.users.set(userId, updated)
    return updated
  }

  clearNeedsSetup(userId: string): User {
    const user = this.users.get(userId)
    if (user === undefined) throw new Error(`account "${userId}" does not exist`)
    const updated: User = { ...user, needsSetup: false, updatedAt: T0 + 1 }
    this.users.set(userId, updated)
    return updated
  }

  insertSession(session: NewSession): Session {
    const id = `00000000-0000-4000-8000-${String(++this.seq).padStart(12, '0')}`
    const created: Session = {
      id,
      userId: session.userId,
      issuedVersion: session.issuedVersion,
      persistent: session.persistent,
      createdAt: T0,
      expiresAt: session.expiresAt,
    }
    this.sessions.set(id, created)
    return created
  }

  findSession(id: string): Session | undefined {
    return this.sessions.get(id)
  }

  deleteSession(id: string): void {
    this.sessions.delete(id)
  }

  deleteSessionsForUser(userId: string): void {
    for (const [id, session] of this.sessions) if (session.userId === userId) this.sessions.delete(id)
  }

  close(): void {}

  /** Replace one stored session row wholesale (corruption injection). */
  putSession(session: Session): void {
    this.sessions.set(session.id, session)
  }
}

function fakeService(clock = T0): { store: FakeAccountStore; service: SessionService; tick: (ms: number) => void } {
  const store = new FakeAccountStore()
  let now = clock
  return {
    store,
    service: new SessionService({ store, now: () => now }),
    tick: (ms: number) => {
      now += ms
    },
  }
}

describe('session issuing (contract A)', () => {
  it('issues an ephemeral session with the default 7-day absolute expiry', () => {
    const { store, service } = fakeService()
    const user = makeUser(store)
    const issued = service.issueSession({ userId: user.id, persistent: false })
    expect(issued.session.expiresAt).toBe(T0 + DEFAULT_SESSION_TTL_MS)
    expect(issued.session.persistent).toBe(false)
    expect(issued.session.issuedVersion).toBe(user.sessionVersion)
    expect(issued.session.userId).toBe(user.id)
    expect(issued.session.id).toMatch(SESSION_ID_PATTERN)
  })

  it('issues the two tiers with independent lifetimes', () => {
    const { store } = fakeService()
    const user = makeUser(store)
    const configured = new SessionService({ store, now: () => T0, sessionTtlMs: 1_000, persistentTtlMs: 2_000 })
    const ephemeral = configured.issueSession({ userId: user.id, persistent: false })
    const persistent = configured.issueSession({ userId: user.id, persistent: true })
    expect(ephemeral.session.expiresAt).toBe(T0 + 1_000)
    expect(persistent.session.expiresAt).toBe(T0 + 2_000)
    expect(persistent.session.persistent).toBe(true)
  })

  it('snapshots the account session version at issuance', () => {
    const { store, service } = fakeService()
    const user = makeUser(store)
    store.updatePassword(user.id, 'h2')
    store.updatePassword(user.id, 'h3')
    const issued = service.issueSession({ userId: user.id, persistent: false })
    expect(issued.session.issuedVersion).toBe(3)
    expect(issued.user.sessionVersion).toBe(3)
  })

  it('rejects issuing for an unknown account', () => {
    const { service } = fakeService()
    expect(() => service.issueSession({ userId: 'nobody', persistent: false })).toThrow(/does not exist/)
  })

  it('refuses to issue against a corrupt account row', () => {
    const { store, service } = fakeService()
    const user = makeUser(store)
    store.users.set(user.id, { ...user, sessionVersion: 0 })
    expect(() => service.issueSession({ userId: user.id, persistent: false })).toThrow(SessionCorruptError)
  })

  it('mints a distinct 64-hex CSRF token per issued session', () => {
    const { store, service } = fakeService()
    const user = makeUser(store)
    const first = service.issueSession({ userId: user.id, persistent: false })
    const second = service.issueSession({ userId: user.id, persistent: true })
    expect(first.csrfToken).toMatch(/^[0-9a-f]{64}$/)
    expect(second.csrfToken).toMatch(/^[0-9a-f]{64}$/)
    expect(first.csrfToken).not.toBe(second.csrfToken)
  })

  it('honors an injected randomness seam for token minting', () => {
    const { store } = fakeService()
    const service = new SessionService({
      store,
      now: () => T0,
      randomToken: length => Buffer.alloc(length, 0xab),
    })
    const user = makeUser(store)
    const issued = service.issueSession({ userId: user.id, persistent: false })
    expect(issued.csrfToken).toBe('ab'.repeat(32))
  })

  it('issues and validates for a pending-setup OAuth-only account', () => {
    const { store, service } = fakeService()
    const user = store.insertUser({ email: 'o@qilin.dev', passwordHash: null, systemRole: 'user', needsSetup: true, oauthProvider: 'github', oauthId: '42' })
    const issued = service.issueSession({ userId: user.id, persistent: false })
    expect(issued.csrfToken).toMatch(/^[0-9a-f]{64}$/)
    const validated = service.validateSession(issued.session.id)
    expect(validated.user.needsSetup).toBe(true)
    expect(validated.user.oauthProvider).toBe('github')
    expect(validated.user).not.toHaveProperty('passwordHash')
  })

  it('rejects a non-positive or fractional lifetime at construction', () => {
    const store = new FakeAccountStore()
    for (const [field, value] of [
      ['sessionTtlMs', 0],
      ['sessionTtlMs', -5],
      ['sessionTtlMs', 1.5],
      ['persistentTtlMs', 0],
      ['persistentTtlMs', -1],
      ['persistentTtlMs', 2.5],
    ] as const) {
      expect(() => new SessionService({ store, [field]: value }), `${field}=${value}`).toThrow(/positive integer/)
    }
  })
})

describe('session validation (contracts C and H)', () => {
  it('classifies garbage cookie shapes as MALFORMED before storage is consulted', () => {
    const { store, service } = fakeService()
    let lookups = 0
    const original = store.findSession.bind(store)
    store.findSession = (id: string) => {
      lookups += 1
      return original(id)
    }
    const garbage = [
      '',
      'not-a-session',
      '44444444444444444444444444444444444444444444444444',
      'z4444444-4444-4444-4444-444444444444',
      '44444444-4444-4444-4444-44444444444444',
      '44444444_4444_4444_4444_444444444444',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig',
      '44444444-4444-4444-4444-444444444444; deleted',
    ]
    for (const token of garbage) {
      try {
        service.validateSession(token)
        expect.unreachable(`${JSON.stringify(token)} must be rejected`)
      } catch (error) {
        expect(error, JSON.stringify(token)).toBeInstanceOf(SessionValidationError)
        expect((error as SessionValidationError).code, JSON.stringify(token)).toBe('MALFORMED')
      }
    }
    expect(lookups).toBe(0)
  })

  it('accepts an uppercase rendering of an issued id through normalization', () => {
    const { store, service } = fakeService()
    const user = makeUser(store)
    const issued = service.issueSession({ userId: user.id, persistent: false })
    expect(service.validateSession(issued.session.id.toUpperCase()).session.id).toBe(issued.session.id)
  })

  it('classifies an unknown but well-formed id as INVALID', () => {
    const { service } = fakeService()
    try {
      service.validateSession('44444444-4444-4444-4444-444444444444')
      expect.unreachable()
    } catch (error) {
      expect((error as SessionValidationError).code).toBe('INVALID')
    }
  })

  it('classifies a logged-out id as INVALID', () => {
    const { store, service } = fakeService()
    const user = makeUser(store)
    const issued = service.issueSession({ userId: user.id, persistent: false })
    service.revokeSession(issued.session.id)
    assertCode(() => service.validateSession(issued.session.id), 'INVALID')
  })

  it('classifies an expired session as EXPIRED in both tiers, honoring the absolute boundary', () => {
    const { store } = fakeService()
    let now = T0
    const service = new SessionService({ store, now: () => now, sessionTtlMs: 1_000, persistentTtlMs: 2_000 })
    const user = makeUser(store)
    const ephemeral = service.issueSession({ userId: user.id, persistent: false })
    const persistent = service.issueSession({ userId: user.id, persistent: true })
    now += 999
    expect(service.validateSession(ephemeral.session.id).session.id).toBe(ephemeral.session.id)
    expect(service.validateSession(persistent.session.id).session.id).toBe(persistent.session.id)
    now += 1
    assertCode(() => service.validateSession(ephemeral.session.id), 'EXPIRED')
    now += 1_000
    assertCode(() => service.validateSession(persistent.session.id), 'EXPIRED')
  })

  it('judges expiry before version, so an expired and revoked session reads EXPIRED', () => {
    const { store, service, tick } = fakeService()
    const user = makeUser(store)
    const issued = service.issueSession({ userId: user.id, persistent: false })
    store.updatePassword(user.id, 'h2')
    tick(DEFAULT_SESSION_TTL_MS)
    assertCode(() => service.validateSession(issued.session.id), 'EXPIRED')
  })

  it('classifies a version-lagged session as INVALID (contract B kill channel)', () => {
    const { store, service } = fakeService()
    const user = makeUser(store)
    const issued = service.issueSession({ userId: user.id, persistent: false })
    store.updatePassword(user.id, 'h2')
    try {
      service.validateSession(issued.session.id)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(SessionValidationError)
      expect((error as SessionValidationError).code).toBe('INVALID')
    }
  })

  it('rejects a row returned under a different id (constant-time match guard)', () => {
    const { store, service } = fakeService()
    const user = makeUser(store)
    const issued = service.issueSession({ userId: user.id, persistent: false })
    const found = store.findSession.bind(store)
    store.findSession = (id: string) => {
      const row = found(id)
      return row === undefined ? undefined : { ...row, id: '44444444-4444-4444-4444-444444444444' }
    }
    assertCode(() => service.validateSession(issued.session.id), 'INVALID')
  })

  it('strips the password hash from the exposed account', () => {
    const { store, service } = fakeService()
    const user = makeUser(store)
    const validated = service.validateSession(service.issueSession({ userId: user.id, persistent: false }).session.id)
    expect(validated.user).not.toHaveProperty('passwordHash')
    expect(validated.user).toMatchObject({ id: user.id, email: user.email, systemRole: 'user', sessionVersion: 1 })
  })
})

describe('durable row invariants (fail-loud server faults)', () => {
  const BASE: Session = {
    id: '00000000-0000-4000-8000-000000000001',
    userId: 'user-1',
    issuedVersion: 1,
    persistent: false,
    createdAt: T0,
    expiresAt: T0 + 1_000,
  }

  const corruptSessions: { name: string; patch: Partial<Session> }[] = [
    { name: 'issued_version 0', patch: { issuedVersion: 0 } },
    { name: 'issued_version negative', patch: { issuedVersion: -1 } },
    { name: 'issued_version fractional', patch: { issuedVersion: 1.5 } },
    { name: 'issued_version NaN', patch: { issuedVersion: Number.NaN } },
    { name: 'persistent string', patch: { persistent: 'yes' as unknown as boolean } },
    { name: 'persistent number', patch: { persistent: 1 as unknown as boolean } },
    { name: 'persistent null', patch: { persistent: null as unknown as boolean } },
    { name: 'created_at NaN', patch: { createdAt: Number.NaN } },
    { name: 'expires_at NaN', patch: { expiresAt: Number.NaN } },
    { name: 'created_at infinite', patch: { createdAt: Number.POSITIVE_INFINITY } },
    { name: 'expires_at not after created_at', patch: { expiresAt: T0 } },
    { name: 'empty user id', patch: { userId: '' } },
    { name: 'non-string user id', patch: { userId: 42 as unknown as string } },
  ]

  for (const { name, patch } of corruptSessions) {
    it(`fails loud on a session row with ${name}`, () => {
      const { store, service } = fakeService()
      const user = makeUser(store)
      const session: Session = { ...BASE, id: `00000000-0000-4000-8000-${'0'.repeat(11)}2`, userId: user.id, ...patch }
      store.putSession(session)
      expect(() => service.validateSession(session.id)).toThrow(SessionCorruptError)
    })
  }

  const corruptAccounts: { name: string; sessionVersion: number }[] = [
    { name: 'session_version 0', sessionVersion: 0 },
    { name: 'session_version fractional', sessionVersion: 2.5 },
    { name: 'session_version NaN', sessionVersion: Number.NaN },
  ]

  for (const { name, sessionVersion } of corruptAccounts) {
    it(`fails loud on an account row with ${name}`, () => {
      const { store, service } = fakeService()
      const user = makeUser(store)
      const issued = service.issueSession({ userId: user.id, persistent: false })
      store.users.set(user.id, { ...user, sessionVersion })
      expect(() => service.validateSession(issued.session.id)).toThrow(SessionCorruptError)
    })
  }

  it('fails loud for an orphan session whose account is gone', () => {
    const { store, service } = fakeService()
    const user = makeUser(store)
    const issued = service.issueSession({ userId: user.id, persistent: false })
    store.users.delete(user.id)
    expect(() => service.validateSession(issued.session.id)).toThrow(/missing account/)
  })

  it('fails loud on a raw-SQL corrupted expiry stored as text', () => {
    const dir = mkdtempSync(join(tmpdir(), 'account-auth-'))
    dirs.push(dir)
    const path = join(dir, 'accounts.db')
    const store = new SqliteAccountStore({ path })
    const user = store.insertUser({ email: 'a@qilin.dev', passwordHash: 'h', systemRole: 'user' })
    const service = new SessionService({ store, now: () => T0 })
    const issued = service.issueSession({ userId: user.id, persistent: false })
    store.close()
    const raw = new DatabaseSync(path)
    raw.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run('garbage', issued.session.id)
    raw.close()
    const reopened = new SqliteAccountStore({ path })
    const revived = new SessionService({ store: reopened, now: () => T0 })
    expect(() => revived.validateSession(issued.session.id)).toThrow(SessionCorruptError)
    reopened.close()
  })
})

describe('revocation (contract B)', () => {
  it('logs out one session and is idempotent, including for garbage tokens', () => {
    const { store, service } = fakeService()
    const user = makeUser(store)
    const issued = service.issueSession({ userId: user.id, persistent: false })
    service.revokeSession(issued.session.id)
    assertCode(() => service.validateSession(issued.session.id), 'INVALID')
    expect(() => { service.revokeSession(issued.session.id) }).not.toThrow()
    expect(() => { service.revokeSession('not-even-shaped') }).not.toThrow()
    expect(() => { service.revokeSession('') }).not.toThrow()
    expect(store.sessions.size).toBe(0)
  })

  it('revokes every session of one account and nothing else (admin kick)', () => {
    const { store, service } = fakeService()
    const alice = makeUser(store, 'alice@qilin.dev')
    const bob = makeUser(store, 'bob@qilin.dev')
    const a1 = service.issueSession({ userId: alice.id, persistent: false })
    const a2 = service.issueSession({ userId: alice.id, persistent: true })
    const b1 = service.issueSession({ userId: bob.id, persistent: false })
    service.revokeAllForUser(alice.id)
    assertCode(() => service.validateSession(a1.session.id), 'INVALID')
    assertCode(() => service.validateSession(a2.session.id), 'INVALID')
    expect(service.validateSession(b1.session.id).user.id).toBe(bob.id)
  })

  it('kills every old session after a password change and lets a fresh login live', () => {
    const { store, service } = fakeService()
    const user = makeUser(store)
    const ephemeral = service.issueSession({ userId: user.id, persistent: false })
    const persistent = service.issueSession({ userId: user.id, persistent: true })
    const updated = service.changePassword(user.id, hashPassword('new horse'))
    assertCode(() => service.validateSession(ephemeral.session.id), 'INVALID')
    assertCode(() => service.validateSession(persistent.session.id), 'INVALID')
    expect(updated).not.toHaveProperty('passwordHash')
    expect(updated.sessionVersion).toBe(2)
    const fresh = service.issueSession({ userId: user.id, persistent: false })
    expect(fresh.session.issuedVersion).toBe(2)
    expect(service.validateSession(fresh.session.id).user.sessionVersion).toBe(2)
    expect(store.sessions.size).toBe(1)
  })

  it('invalidates old sessions through the version bump alone, even when rows survive', () => {
    const { store, service } = fakeService()
    const user = makeUser(store)
    const issued = service.issueSession({ userId: user.id, persistent: false })
    store.updatePassword(user.id, hashPassword('new horse'))
    expect(store.sessions.size).toBe(1)
    assertCode(() => service.validateSession(issued.session.id), 'INVALID')
  })
})

describe('against the sqlite store', () => {
  it('runs issue → validate → revoke end to end over durable rows', () => {
    const store = new SqliteAccountStore({ path: ':memory:', now: () => T0 })
    const service = new SessionService({ store, now: () => T0 })
    const user = store.insertUser({ email: 'a@qilin.dev', passwordHash: hashPassword('one'), systemRole: 'admin', needsSetup: true })
    const issued = service.issueSession({ userId: user.id, persistent: true })
    expect(issued.session.expiresAt).toBe(T0 + DEFAULT_SESSION_TTL_MS)
    const validated = service.validateSession(issued.session.id)
    expect(validated.user.needsSetup).toBe(true)
    expect(validated.user.systemRole).toBe('admin')
    service.changePassword(user.id, hashPassword('two'))
    store.clearNeedsSetup(user.id)
    const again = service.issueSession({ userId: user.id, persistent: false })
    expect(service.validateSession(again.session.id).user.needsSetup).toBe(false)
    service.revokeSession(again.session.id)
    assertCode(() => service.validateSession(again.session.id), 'INVALID')
    store.close()
  })
})

describe('projection helper', () => {
  it('projects a user without its password hash and preserves the remaining fields', () => {
    const { store } = fakeService()
    const user = makeUser(store)
    const projected: SessionUser = projectUser(user)
    expect(projected).toEqual({
      id: user.id,
      email: user.email,
      systemRole: 'user',
      needsSetup: false,
      oauthProvider: null,
      oauthId: null,
      sessionVersion: 1,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      disabledAt: null,
    })
  })
})

describe('disabled accounts (S5-A)', () => {
  it('projects disabledAt and rejects a disabled account session with code DISABLED', () => {
    const { store, service } = fakeService()
    const user = makeUser(store)
    expect(user.disabledAt).toBe(null)
    const issued = service.issueSession({ userId: user.id, persistent: false })
    expect(issued.user.disabledAt).toBe(null)
    store.setDisabled(user.id, T0 + 5)
    expect(store.findUserById(user.id)?.disabledAt).toBe(T0 + 5)
    assertCode(() => service.validateSession(issued.session.id), 'DISABLED')
  })

  it('refuses new sessions for a disabled account at issue time', () => {
    const { store, service } = fakeService()
    const user = makeUser(store)
    store.setDisabled(user.id, T0 + 5)
    expect(() => service.issueSession({ userId: user.id, persistent: false })).toThrow(SessionValidationError)
  })
})
