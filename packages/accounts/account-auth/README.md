# @qilin/account-auth

English | [中文](README.zh.md)

Session and request-safety services over the account domain: issue, validate, and revoke server-side sessions (opaque ids, absolute expiry, per-account credential epoch), typed contract-C session errors, pure CSRF double-submit decisions, and the auth-disabled escape valve. Nothing here reads or writes HTTP; the route layer owns cookies, headers, statuses, and wiring.

Validation judges one presented token in a fixed order: format gate (the exact canonical-UUID shape — anything else is MALFORMED and never reaches storage, the legacy garbage-cookie rule), storage lookup plus a constant-time token match (INVALID), durable-row invariants (a typed server fault — the store does not re-read these columns, so the service guards the positive issued version, numeric timestamps, and the boolean flag on every read), absolute expiry (EXPIRED), and finally the issued-version vs account session-version comparison (INVALID) that implements the legacy token_version kill: after a password change or an account-wide revoke, every session issued from an earlier version is dead.

## CSRF double submit

`mintCsrfToken` mints one token per session issuance; the server never stores it. `verifyCsrfTokens` compares the cookie and header values through a fixed-digest constant-time path. `evaluateCsrfRequest` turns the legacy contract into one pure decision: RFC-safe methods (GET, HEAD, OPTIONS, TRACE) skip; the legacy write methods (POST, PUT, DELETE, PATCH) force the check; methods outside both lists fail closed; a request authenticated by an explicitly presented Bearer token skips (no ambient cookie credential to ride — the D2 fallback channel); and caller-supplied path exemptions (exact, trailing-slash-insensitive; prefixes, legacy webhook style) skip.

## Auth-disabled escape valve

`resolveAuthDisabled` honors an explicit `QILIN_AUTH_DISABLED=1` outside an explicit production environment (`QILIN_ENV` / `ENVIRONMENT` holding `prod` or `production`) and nothing else; unconfigured means authentication is on. `assertAuthDisabledAllowed` is the boot-time fail-loud guard: a production deployment that asks to disable authentication refuses to compose instead of silently serving with auth on. `authDisabledWarning` returns the operator-facing warning text while the valve is active.

## Composition

This package is a shared service library, not a Cordis plugin; the HTTP layer constructs `SessionService` over an `AccountStore` (`SqliteAccountStore` from `@qilin/account-core`). Its invariant companion is intentionally empty because the package owns no durable state — sessions live in the account-core store, CSRF tokens are stateless double-submit values, and the escape valve reads process environment.

## Model Experience

None, as the package's session verdicts, CSRF decisions, and valve resolution are server-side control flow that never enters a model request, prompt, or tool result.

#### KV Cache effect

None; the package contributes no model-visible content and therefore no prefix, growth, or invalidation behavior.

## Known Limitations and Deferred Work

- **No token hashing at rest** — session ids are stored as issued because the account store owns the identifier column; the format gate, the constant-time match, and the primary-key lookup cover the surface a derived-id scheme would, without an account-core storage change.
- **Unknown methods fail closed** — the legacy gateway exempted methods outside its two method lists; this package requires the CSRF check for them (deny-wins heritage).
- **Expired rows are not swept** — validation is read-only; expired rows persist until an account-wide revoke or a future maintenance sweep.
- **No refresh or sliding expiry** — a session carries one absolute expiry, matching the legacy JWT semantics; renewal is a fresh login.
- **The exemption list is caller-owned** — the package ships no default path exemptions; the HTTP layer configures them explicitly.
