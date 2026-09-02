# Agent Note: account-core domain package (accounts/)

Status: implemented

English | [中文](2026-08-28-account-core-domain-package.zh.md)

## Problem

The multi-user account phase (P3) needs a domain base before any HTTP surface exists: user and session entities, durable storage, and password hashing. The engine had no account concept at all — its only identity primitive is the anonymous telemetry UUID — and the product contract it must serve is fixed elsewhere: server-side sessions with O(1) revocation, an account-level role for RBAC, a pending-setup flow for the initialize path, reserved OAuth linkage, and a credential epoch (session version) that invalidates every session when a password changes. Storage choice matters because account data is relational (unique email, unique OAuth identity, concurrent logins) and the engine already ships a production `node:sqlite` precedent.

## Decision

`packages/accounts/account-core` (`@qilin/account-core`) ships the domain core as a shared library, not a Cordis plugin: entity and store interfaces in `src/types.ts`, `AccountConflictError`, frozen-parameter scrypt hashing, and `SqliteAccountStore` over `node:sqlite` with idempotent `CREATE ... IF NOT EXISTS` DDL. One store owns one database file — by default `qilin-accounts/accounts.db` under the harness home — and records its schema version in the `user_version` pragma, refusing databases from newer builds. Uniqueness failures are translated from the driver's extended result code (2067) into typed `email`/`oauth` conflicts; foreign-key failures become missing-account errors; every read re-validates the columns RBAC depends on, so a hand-corrupted row fails loud. The scrypt parameter set (N=16384, r=8, p=1, 32-byte salt, 64-byte key) is a frozen constant, and the stored encoding embeds its parameters so verification reads costs from the value, keeping a future cost bump a per-row migration instead of a re-key.

## Consequences

- Sessions revocation is dual-channel from day one: deleting a row revokes immediately, and the account's `session_version` bump (password change) invalidates every session whose issued version lags — the later auth package consumes both without storage changes.
- The package counts fully under the per-file 100% coverage gate with table-driven suites over schema idempotency, conflict classification, corrupt durable rows, and hash tampering; no coverage carve-out was added.
- The OAuth columns are storage-only until a provider flow exists; email uniqueness is exact-string; expiry is absolute epoch milliseconds, so clock regressions shorten sessions rather than extend them.
- Future account packages (auth service, HTTP routes, RBAC) build on this store and its types; the store interface is the only storage seam they need.

## Alternatives considered

- **bcrypt (or argon2) via a new dependency** — rejected: node's built-in scrypt needs no dependency, meets the cost targets, and the self-describing encoding keeps verification parameter-driven; a native dependency buys nothing the contract needs.
- **JSON document storage over the existing storages seam** — rejected: uniqueness, partial unique indexes, and concurrent writes are exactly what hand-rolled JSON drifts on; SQLite gives them as constraints.
- **The session-persistence-sqlite `resources/sql/*.sql` loader** — rejected here: that package carries 39 statement files for hot-path packing and repair; two tables with idempotent DDL inline stay auditable in one place, and the loader's cache machinery would be uncovered code the 100% gate would have to carry.
- **A generated id inside `NewUser`** — rejected: identity and timestamps are assigned by the store behind injected seams, so tests stay deterministic without leaking generation into the caller's contract.
