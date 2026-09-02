# Agent Note: account-auth session and CSRF services (accounts/)

Status: implemented

English | [中文](2026-08-28-account-auth-session-csrf-services.zh.md)

## Problem

The account phase's HTTP step (S3) needs the session semantics decided in D2 as a callable service, not as logic buried in route handlers: issue on login with a remember-me tier, validate an opaque cookie token with the legacy gateway's typed error classes (EXPIRED / INVALID / MALFORMED), and revoke — single logout plus the token_version kill where a password change or admin kick leaves every older session dead. The same step must carry the legacy CSRF double-submit contract (method matrix, Bearer exemption, path exemptions) and the auth-disabled escape valve with its production refusal. All of it predates any HTTP surface, so it must be testable as pure services against the account store.

## Decision

`packages/accounts/account-auth` (`@qilin/account-auth`) ships four modules. `SessionService` issues (two tiers over one 7-day default lifetime, the account's `session_version` snapshotted at issuance), validates (format gate on the canonical-UUID shape so garbage cookies never reach storage; constant-time token comparison over fixed SHA-256 digests; absolute expiry; issued-version vs account-version comparison), and revokes (idempotent single logout, account-wide delete, and `changePassword` composing the store's version bump with row deletion — version bump first, so a crash between the steps still kills every old session). Validation guards the durable rows it reads — positive integer issued version, finite ordered timestamps, boolean flag, live owner — because the S1 store does not re-read session columns on decode; a corrupted row fails loud as a typed `SessionCorruptError` instead of flowing onward. The CSRF module is pure functions: one minted token per session (never stored server-side), a fixed-digest constant-time comparator, the RFC-safe/write method matrix with fail-closed handling for methods outside both lists, the Bearer exemption, and a caller-owned path exemption list. The escape valve module keeps the legacy `OPENKYLIN_AUTH_DISABLED=1` semantics and the `OPENKYLIN_ENV`/`ENVIRONMENT` production markers: `resolveAuthDisabled` never disables in production, `assertAuthDisabledAllowed` throws a typed error for the production boot that asks for it, and `authDisabledWarning` carries the operator warning.

## Consequences

- The HTTP package composes instead of reimplementing: construct `SessionService` over the `SqliteAccountStore`, call `evaluateCsrfRequest` per request, resolve the valve once at boot and per chain.
- Revocation stays dual-channel exactly as the account-core note promised: row deletion is immediate, and the version comparison is the backstop that no surviving row can escape — both channels have dedicated tests (password change kills old sessions with rows deleted and with rows left behind).
- The per-file 100% coverage gate holds without carve-outs; the empty barrel is v8-ignored with reason like its account-core sibling.
- CSRF decisions are pure and table-driven, so the e2e suite and the route layer consume the same verdicts; the exemption list is caller-owned rather than hardcoded, keeping route knowledge out of this package.

## Alternatives considered

- **Stateless JWT as the D2 token** — rejected: D2 picked server-side sessions for O(1) revocation; the typed error classes survive as `SessionErrorCode` instead.
- **Storing hashed session ids (a derived-id scheme)** — rejected here: the account store assigns session ids in `insertSession`, and changing that seam is an account-core change; the format gate plus the constant-time match plus primary-key lookup cover the same misuse surface without touching S1.
- **Folding CSRF into the HTTP package** — rejected: the method matrix, comparator, and exemptions are exactly the part worth table-driving against the legacy contract; the route layer should read facts off the wire and delegate the verdict.
- **Silently keeping auth on when production asks to disable it (legacy behavior)** — kept for per-request composition (`resolveAuthDisabled`), but paired with the fail-loud `assertAuthDisabledAllowed` for boot so a misconfigured production deploy refuses to start instead of running with an operator belief mismatch.
