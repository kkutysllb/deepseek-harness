---
description: "Account domain core for the multi-user surface: user and session entities, durable validated SQLite storage, and scrypt password hashing."
kind: "package-reference"
---

# @qilin/account-core

English | [中文](README.zh.md)

## Summary

Account domain core for the multi-user surface: user and session entities, durable SQLite storage, and scrypt password hashing. The store owns two tables — users carry the unique email, the closed admin/user role set, the OAuth linkage columns, the setup flag, and the monotonic session version; sessions reference their owning user and record the account's session version at issuance. Nothing here reads or writes HTTP; routing, cookies, and enforcement belong to later account packages.

Password hashing uses node's scrypt with one frozen parameter set (N=16384, r=8, p=1, 32-byte salt, 64-byte key). The stored encoding embeds its parameters (`scrypt$N$r$p$<salt>$<hash>`), so verification re-derives from the encoded costs and a future cost bump can migrate hashes row by row. Verification compares derived keys with a constant-time comparator and answers false — never throws — on any value the module did not produce.

## Table of Contents

- [Storage contract](#storage-contract)
- [Composition](#composition)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="storage-contract"></a>
## Storage contract

One store owns one SQLite database file, by default `qilin-accounts/accounts.db` inside the harness home (`QILIN_HOME`, falling back to `~/.qilin`), or an injected path, or `:memory:`. The constructor creates parent directories, opens the database, and runs the idempotent schema DDL: `CREATE TABLE IF NOT EXISTS` and `CREATE UNIQUE INDEX IF NOT EXISTS` for the users email index and the partial unique index over non-null OAuth identities. The schema version lives in the `user_version` pragma; a fresh database is stamped after creation and a database written by a newer build is refused instead of silently served. Uniqueness collisions surface as `AccountConflictError` with an `email` or `oauth` kind, and reads validate the durable rows they decode, so a hand-corrupted role or flag column fails loud rather than flowing into RBAC.

-----

<a id="composition"></a>
## Composition

This package is a shared domain library, not a Cordis plugin; consumers construct `SqliteAccountStore` directly. Its invariant companion is intentionally empty because every durable relationship it owns (unique email, unique OAuth identity, session ownership) is enforced by schema constraints and re-validated on every read, leaving no cross-plugin relation for a companion to observe.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package's account and session records are server-side durable state that never enters a model request, prompt, or tool result.

#### KV Cache effect

None; the package contributes no model-visible content and therefore no prefix, growth, or invalidation behavior.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **No schema migration path yet** — the store refuses databases from newer builds and no migration step exists for future column additions; the first schema change must introduce one.
- **OAuth columns are storage-only** — the linkage columns and their partial unique index are reserved; no provider flow reads or writes them yet.
- **Exact-string email uniqueness** — emails are unique as written; case folding or normalization is a product decision deferred until a real flow needs it.
- **Wall-clock expiry semantics** — `expiresAt` is absolute epoch milliseconds, so a clock regression expires sessions early rather than extending them.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

`SqliteAccountStore` is the single owner of the schema and the durable row invariants; every read re-validates the decoded rows, so consumers trust the returned entities without re-checking columns.

</details>
