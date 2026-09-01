---
description: "Accounts surface for the web shell: a session overlay that blocks the app until a session exists (sign-in with remember-me, first-admin initialize) and an administrator account-management settings page."
kind: "package-reference"
---

# @qilin/client-ui-accounts

English | [中文](README.zh.md)

## Summary

**Accounts** surface for the web shell. The browser plugin contributes two registrations over the HTTP account surface exposed by client-connection: a `shell.overlay` entry (id `account`) that blocks the app until a session exists, and one `settings.section` page (id `accounts`) for administrator account management. Neither registration touches the connection during plugin activation — both inject faces read the connection handle lazily on first use.

The overlay probes the session on mount (`setupStatus()` then `me()`). A fresh installation (`needsSetup`) shows only the deterministic administrator initialize form; an anonymous visitor sees the sign-in form with a remember-me option; an authenticated user sees nothing. The connection's shared 401 signal flips a signed-in overlay back to the sign-in form with a session-ended notice. Submit failures map server error codes to localized prose and never expose transport details.

The settings section renders the account table (email, role, enabled state) with per-row role toggle, enable/disable, and reset-password actions guarded by an inline confirm row. Every protection stays server-authoritative: the client surfaces `self_protected`, `last_admin_protected`, `weak_password`, and `forbidden` as localized inline messages, and a non-administrator sees the administrator-required state instead of the table. The registration uses `ctx.slots.inject()`, so both entries follow late declaration, redeclaration, locale changes, and teardown without importing the seat owners.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="model-experience"></a>
## Model Experience

None; this package only presents the account surface over the Host's HTTP auth API.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **Session probing is mount-scoped** — the overlay probes once per mount and reacts to 401 signals afterwards; it does not poll session expiry on its own.
- **No profile self-service yet** — password self-change and sign-out controls are part of the account surface contract but are deferred to the shell-header work (S6); the section covers administrator management only.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Both registrations are lazy slot injections (`ctx.slots.inject()`): the inject faces read the connection only on first use, and every protection decision stays server-side over the Host HTTP auth API.

</details>
