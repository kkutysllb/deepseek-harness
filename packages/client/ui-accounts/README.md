# @qilin/client-ui-accounts

English | [中文](README.zh.md)

**Accounts** surface for the web shell. The browser plugin contributes two registrations over the HTTP account surface exposed by client-connection: a `shell.overlay` entry (id `account`) that blocks the app until a session exists, and one `settings.section` page (id `accounts`) for administrator account management. Neither registration touches the connection during plugin activation — both inject faces read the connection handle lazily on first use.

The overlay probes the session on mount (`setupStatus()` then `me()`). A fresh installation (`needsSetup`) shows only the deterministic administrator initialize form; an anonymous visitor sees the sign-in form with a remember-me option; an authenticated user sees nothing. The connection's shared 401 signal flips a signed-in overlay back to the sign-in form with a session-ended notice. Submit failures map server error codes to localized prose and never expose transport details.

The settings section renders the account table (email, role, enabled state) with per-row role toggle, enable/disable, and reset-password actions guarded by an inline confirm row. Every protection stays server-authoritative: the client surfaces `self_protected`, `last_admin_protected`, `weak_password`, and `forbidden` as localized inline messages, and a non-administrator sees the administrator-required state instead of the table. The registration uses `ctx.slots.inject()`, so both entries follow late declaration, redeclaration, locale changes, and teardown without importing the seat owners.

## Model Experience

None; this package only presents the account surface over the Host's HTTP auth API.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Session probing is mount-scoped** — the overlay probes once per mount and reacts to 401 signals afterwards; it does not poll session expiry on its own.
- **No profile self-service yet** — password self-change and sign-out controls are part of the account surface contract but are deferred to the shell-header work (S6); the section covers administrator management only.
