# Agent Note: account-http routes and /api gate (accounts/)

Status: implemented

English | [中文](2026-08-28-account-http-routes-and-gate.zh.md)

## Problem

The transplant's S3 step turns the D2 session services into the user-visible HTTP surface without giving up the fences the engine already has: the legacy Python gateway's `/api/v1/auth` route family must reappear on the engine's webServer, every `/api` business route and WebSocket upgrade must demand a session, and the three legacy defenses — the cookie security policy, the auth-endpoint Origin whitelist, and per-IP rate limiting — must come along with their exact semantics. The webServer itself must stay ignorant of authentication, and the client-connection transport must keep working unchanged when no accounts plugin is mounted.

## Decision

`packages/accounts/account-http` (`@qilin/account-http`) provides the optional cordis service `apiAuth` (structural contract declared in client-connection as `ApiAuthGate`, consulted by name — the provider never imports the transport, so the dependency arrow stays one-way). `checkRequest` authenticates cookie-first with the Bearer fallback, then judges CSRF for cookie-authenticated writes; `checkUpgrade` admits live sessions or the valve and refuses anonymous upgrades with a raw 401 before protocol negotiation. The connection's route and upgrade handlers consult the gate immediately after their browser-trust fence, and `rejectWebSocketUpgrade` gained optional status/reason parameters so the trust fence keeps its exact 403 wire bytes. The route family composes `SessionService` over the account store behind a body-size-capped, media-type-checked dispatcher with a per-IP fixed-window limiter (injectable clock, bounded table with sweep-and-evict) on the credential endpoints, the legacy Origin whitelist (proxy-header-aware) on exactly the credential POSTs, and the auth-disabled valve wired through: synthetic admin on `me`, password changes refused, CSRF and the whitelist skipped, with the boot-time production refusal. The registration switch is a JSON file re-read per request so flipping it takes effect immediately. `issueSession`'s unknown-account bare Error is normalized at the route layer (login → 401, provision → 500) instead of changing the session service, because the response context only exists here.

## Consequences

- Enforcement is a composition choice: without `@qilin/account-http` the engine serves `/api` exactly as before; mounting the plugin turns every business route and upgrade session-gated with no webServer changes.
- The per-file 100% coverage gate holds without carve-outs; the gate, cookie policy, whitelist, and limiter are all table-driven, and the integration suite drives a real node:http composition (webServer + connection + account-http) over raw sockets.
- Errors keep the legacy envelope shape (`{error: {code, message}}`) with snake_case codes, so legacy clients read the new surface without translation; the new `rate_limited`, `csrf_missing`, and `csrf_mismatch` codes extend rather than reinterpret the legacy set.
- Rate limiting counts every attempt (stricter than the legacy failure-only counter) and keeps state in memory — a documented limitation, not an oversight.

## Alternatives considered

- **Enforcing inside webServer** — rejected: the webServer is a generic router; putting account knowledge there would invert the dependency and force every deployment to carry the account stack.
- **Importing client-connection from account-http to reuse its fence** — rejected: it would create a package cycle across layers; the structural `apiAuth` contract plus the string-keyed provide keeps the arrow one-way with no runtime coupling.
- **Bearer-token exemption everywhere** — rejected: only the CSRF judgment exempts Bearer chains, and tokens are returned only from session-creating endpoints, matching the D2 fallback-channel decision.
- **Rehashing sessions or changing account-core storage for hashing-at-rest** — rejected here: S2's account-auth note already weighed it; S3 only consumes the service.
