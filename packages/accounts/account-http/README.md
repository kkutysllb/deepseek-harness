# @qilin/account-http

English | [中文](README.zh.md)

The account HTTP surface on the engine's webServer: the `/api/v1/auth` route family (login, register, logout, change-password, me, setup-status, initialize), the `/api` authentication gate every business route and WebSocket upgrade consults, the legacy cookie security policy, the auth-endpoint Origin whitelist, and per-IP rate limiting on the credential endpoints. The route family composes the session and CSRF services from `@qilin/account-auth` over the `@qilin/account-core` store; this package owns cookies, headers, statuses, and wiring — nothing here re-decides session semantics.

## Admin routes

The `/api/v1/admin/users` route family lets administrators list users, change roles, enable or disable accounts, and reset passwords. Responses project accounts without `passwordHash`; state-changing cookie requests require the CSRF double-submit token, while Bearer requests are exempt. The auth-disabled valve provides synthetic admin access.

## The gate

The plugin provides an optional cordis service named `apiAuth` with `checkRequest` (authentication first, then the CSRF double-submit judgment on cookie-authenticated writes; Bearer chains skip CSRF) and `checkUpgrade` (a live session or the auth-disabled valve passes; anonymous upgrades are refused with 401 before protocol negotiation). The client-connection transport consults the gate by name at the same fence points as its browser-trust check, and stays fully functional without it — mounting the accounts plugin is what turns the fence on.

## Route family

`login/local` verifies credentials (a timing-guard comparison when the account is unknown, so unknown and wrong-password logins are indistinguishable), `register` honors the registration switch file (open by default, live re-read per request, always plain `user` accounts), `logout` revokes server-side and clears all three cookies, `change-password` verifies the current credential, kills every older session through the account version bump, and re-issues a fresh session, `me` answers the live account without its password hash, `setup-status` reports emptiness plus the switch, and `initialize` deterministically creates the first admin on an empty store (409 afterwards). Session issuance responds with the three legacy cookies — `access_token` (HttpOnly), the JS-readable `csrf_token`, and the persistence flag — per `resolveSessionCookiePolicy` (secure, loopback, explicit session intent, or the operator escape for an insecure persistent cookie).

## Defense in depth

The legacy Origin whitelist guards exactly the credential POSTs (`login/local`, `register`, `logout`, `initialize`) — a cross-site origin is denied outright. The credential endpoints share one per-IP fixed-window budget (default 10 attempts / 300s, injectable clock, bounded table with sweep-and-evict), answering 429 with `Retry-After`. `QILIN_AUTH_DISABLED=1` (outside production) passes every chain with the synthetic `default` admin and disables password changes, CSRF, and the whitelist — with the boot-time production refusal and operator warning from `account-auth`.

## Model Experience

None, as the package's routing, cookie serialization, and enforcement decisions are server-side control flow that never enters a model request, prompt, or tool result.

#### KV Cache effect

None; the package contributes no model-visible content and therefore no prefix, growth, or invalidation behavior.

## Known Limitations and Deferred Work

- **Rate-limit state is in memory** — the per-IP budget resets on restart and is per-process; a multi-process deployment would need a shared store to enforce one budget.
- **Counting all attempts** — unlike the legacy failure-only counter, the budget counts every login/register attempt (stricter, simpler); successful logins spend budget too.
- **The Origin whitelist reads proxy headers** — `X-Forwarded-*` / `Forwarded` are honored exactly like the legacy gateway; a deployment with an untrusted front proxy must strip them before this server.
- **Bearer tokens are returned in responses** — session creation and password change answer with `accessToken` for non-cookie clients; cookie-less API consumers must store them with the same care as passwords.
- **No account lockout or CAPTCHA** — the fixed-window budget is the only brute-force control; lockout notifications and CAPTCHA integration stay deferred.
