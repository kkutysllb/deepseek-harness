# Agent Note: account-rbac policy engine (accounts/)

Status: implemented

English | [中文](2026-08-28-account-rbac-policy-engine.zh.md)

## Problem

The transplant's S4 step adds role-based authorization on top of the S3 session surface without weakening any fence it built: requests need a single per-request Principal so every consumer judges the same identity, the legacy plain-user/admin role split must reappear as a permission baseline, resource-level allow/deny policy (tools, models, skills, MCP servers, routes) must be configurable yet default-off, and the /api transport must gain an authorization verdict after its authentication gate — server-side only. The account stack must stay layered: this step composes account-auth and account-core, never the HTTP surface or the transport.

## Decision

`packages/accounts/account-rbac` (`@qilin/account-rbac`) provides the optional cordis service `rbacAuth` (structural contract `RbacAuthGate` declared in client-connection, consulted by name immediately after the `apiAuth` verdict on the /api business route and on dedicated RPC channel routes — the `apiAuth` precedent keeps the dependency arrow one-way). The authorizer resolves the Principal once per request (cookie-first, Bearer fallback; auth-disabled valve yields the synthetic admin; every failure lands anonymous and refused) and memoizes it on the request object, so route judgments, owner checks, and catalog projections share one construction point. Judgment order is deny-wins: policy deny, then policy allow, then the role baseline (admin full pass, user read-class + `session:*`, unknown roles and unresolved identities fail closed). The resource policy is a versioned JSON file read exactly once at assembly: a missing file runs the baseline alone (default-off parity with S3), an invalid file refuses the composition (`PolicyConfigError`), and `filterCatalog` projects the real resource catalogs with the same predicate the runtime decision uses — a real engine tool denied for users disappears from their catalog and refuses at dispatch while the admin section keeps it. Owner checks are a functional composable (`ownerCheck`) rather than a route-framework hook.

## Consequences

- Authorization is a composition choice layered on authentication: without this plugin the engine serves /api byte-identically to S3; with it, the fence sits behind the auth verdict and never changes 401 semantics.
- The per-file 100% coverage gate holds without carve-outs: permissions, policy validation, the authorizer, and the plugin are table-driven, and the integration suite drives a real node:http composition (webServer + connection + account-http + account-rbac) over raw HTTP — admin write-class requests pass, the same method for a user answers 403 `permission_denied`, and a policy deny flips a baseline-allowed method at the transport.
- The default user baseline is a product decision recorded in the README (open registration makes read-class the usable default; the session domain carries the legacy plain-user route set; everything else fails closed until policy grants it).
- Policy edits require a restart (assembly-time read; hot reload is unsound with assembly-time catalog filtering) — documented in the README, not a hidden constraint.

## Alternatives considered

- **Enforcing in webServer or account-http** — rejected: the webServer is a generic router and account-http owns authentication; layering authorization there would couple the two concerns and invert the account stack.
- **Hot reloading the policy file** — rejected for S4: catalogs are projected at assembly, so a live swap would serve resources the new policy refuses; restart-to-apply is the honest semantics until a re-projection path exists.
- **Hard-coding an admin exemption from denies** — rejected: deny-wins with no role exemption is the whole point of the explicit admin policy section; an un-exemptable admin deny is how an operator fences even themselves.
- **Middleware-style per-route RBAC registration** — rejected: per-route wiring invites drift between the route table and the policy; the single transport-level verdict keyed by the endpoint-to-permission mapping keeps one enforcement point with table-driven coverage.
