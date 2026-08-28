# accounts/ — multi-user accounts

English | [中文](README.zh.md)

Account and session domain packages for the multi-user surface. The domain core owns entities, durable storage, and password hashing; HTTP surfaces and RBAC enforcement live in sibling packages as they land.

| Package | Role | ctx key |
|---|---|---|
| [`account-core/`](account-core/README.md) | User/session entities, SQLite storage with idempotent schema creation, and scrypt password hashing | — |
| [`account-auth/`](account-auth/README.md) | Session lifecycle (issue/validate/revoke), typed session errors, CSRF double-submit decisions, and the auth-disabled escape valve | — |
