# @qilin/account-rbac

English | [中文](README.zh.md)

The server-side RBAC layer for the account system: one Principal construction point per request, the role permission baseline, the config-driven resource policy with deny-wins evaluation, assembly-time catalog filtering, and the optional `rbacAuth` fence the transport consults after its `apiAuth` authentication gate. This package composes the session service from `@qilin/account-auth` over the `@qilin/account-core` store; it never imports the HTTP surface or the transport — the enforcement point is a structural by-name service (the `apiAuth` precedent), so the dependency arrow stays one-way.

## The request Principal (contract M)

`RbacAuthorizer.resolvePrincipal` is the single construction point: the session cookie (wire constant `access_token`, cookie-first like the gate) or the Bearer header resolves to a principal carrying the account projection, the system role, and the live session metadata; the auth-disabled escape valve resolves to the synthetic admin without touching the store; anything unresolvable resolves to the anonymous principal, which every judgment refuses. Resolution is memoized per request object, so every consumer of one request — the route judgment, owner checks, catalog projections — shares one Principal.

## The role default matrix (contract L, B1 baseline)

Judgment order: policy deny first (it wins over every role), policy allow next, then the role baseline — admin is a structural full pass, the user role is the matrix below, and an unresolved identity or an unknown role value is refused (fail-closed).

| Role | Default permission set | Rationale |
| --- | --- | --- |
| `admin` | `*:*` | The operator role is created only by the deterministic first-admin initialization (D5-a); the engine is single-instance, so there is no threat model for restricting the admin baseline. Explicit policy denies still bind the admin — deny wins with no role exemption. |
| `user` | `*:read`, `*:list`, `*:get`, `*:status`, `*:search`, `*:stats`, `session:*` | Read-class actions keep the open Web surface usable: D5-B open registration makes `user` the anonymous-visitor default, and a baseline that broke browsing would make open registration worthless. The conversation domain in full is the engine descendant of the legacy plain-user route set (threads read/write/delete + runs create/read/cancel, contract N) — sessions are those threads. Everything else is denied by default, so write access outside the conversation domain (settings, models, credentials, tool invocation surfaces) must be granted explicitly by policy. |
| anonymous / unknown | nothing | Contract L fail-closed: an unresolved identity never passes a judgment. |

Permission strings are `resource:action` pairs (contract N). The /api endpoint namespace maps onto them by splitting at the first dot: `session.list` is judged as `session:list`, `settings.update` as `settings:update`; a dot-less endpoint lands under the `route` domain.

## The resource policy (contract L, B2)

Resource policy is config-driven, default-off, and assembly-time. The plugin reads the file once at boot — the policy never reloads while the process lives (see Known Limitations). A configured path with no file yet runs the baseline alone (the documented default-off state); a file that exists but fails validation refuses the composition outright (fail-closed boot).

```json
{
  "version": 1,
  "roles": {
    "user": {
      "tool": { "deny": ["schedule_create"], "allow": ["schedule_*"] },
      "model": { "allow": ["deepseek-*"], "deny": ["claude-*"] },
      "skill": { "allow": ["*"] },
      "mcp_server": { "deny": ["legacy-*"] },
      "route": { "deny": ["settings:update"], "allow": ["credentials:read"] }
    },
    "admin": { "mcp_server": { "deny": ["legacy-*"] } }
  }
}
```

Rules per resource kind (`tool`, `model`, `skill`, `mcp_server`, `route` — the engine's real catalog surfaces). Patterns are exact names, trailing-'*' prefixes, `*` segments in route permissions, or the bare `*`. Evaluation is deny-wins: any matching deny removes the candidate for every role, explicit admin denies included; a matching allow grants; an unmatched candidate falls through — to the role baseline for routes, and to visibility defaults for catalogs (an allow list narrows non-admin roles; deny-only rules leave the rest visible).

## Assembly-time catalog filtering (the system-prompt waterfall fence)

The plugin registers a `system-prompt/assemble` waterfall listener unconditionally at apply time, so an RBAC boot that precedes the system prompt service (`@qilin/system-prompt`) still ends up attached; a composition that never mounts the service never emits the event at all, so the listener never fires and nothing changes. The listener runs at the END of the chain — it awaits `next()` first, so the tools `@qilin/tools` contributed through its provider are already in `assembly.tools` — and then filters those tools with the same predicate the runtime resource judgment uses. The identity comes from the explicit carrier below; a scope with no bound principal fails closed to an empty tool list. The listener never mutates the registry itself. Restart-to-apply: the listener closes over the policy loaded at boot and never re-reads it.

## The principal carrier (server-side identity for agent scopes)

`bindRbacPrincipal(agentCtx, principal)` is the one sanctioned way a composition tells the RBAC fence which principal owns an agent scope: a deliberate server-side call on a scoped context (the scope tag is the lookup key). Identity is never guessed from client metadata, async-local storage, or a raw cookie; an unscoped context is refused by the binder, and an unbound scope projects an empty catalog. Binding lifecycle: re-binding a scope replaces its previous principal (last bind wins, so a reused scope never keeps a stale identity), and the returned disposer removes the binding — call it when the scope is disposed so no old principal outlives its agent.

With no policy loaded (`policy: null`), a bound principal keeps the full catalog exactly as before RBAC (default parity); only the unbound-scope fail-closed empty projection is added on top.

## The /api fence (the D3 enforcement point)

The plugin provides the optional `rbacAuth` service; the client-connection transport consults it by name immediately after the `apiAuth` authentication verdict on the `/api` business route and on dedicated RPC channel routes — server-side only, the browser is never a security boundary. A refusal answers 403 with the legacy envelope (`{error: {code: 'permission_denied', message}}`). Unauthenticated requests already stop at the authentication fence (401); WebSocket upgrades stay authentication-only because the event streams carry no method surface to authorize.

## Owner check (contract N)

`ownerCheck(principal, ownerId)` is the functional ownership test a route handler composes with its permission check: the owner passes, the admin role (including the valve's synthetic admin) passes, everyone else — and every missing owner referent — fails.

## Model Experience

None, as the package's principal resolution, policy evaluation, and catalog filtering are server-side control flow that never enters a model request, prompt, or tool result.

#### KV Cache effect

None; the package contributes no model-visible content and therefore no prefix, growth, or invalidation behavior.

## Known Limitations and Deferred Work

- **The policy loads once at boot; edits need a restart** — there is no hot reload. Assembly-time catalog filtering makes a live policy swap unsound anyway (a catalog served before the edit would not re-project); restart-to-apply is the defined semantics, and hot reload stays deferred.
- **Mount with the same `dbPath` as `@qilin/account-http`** — the plugin opens its own store connection to resolve sessions; composing both plugins over one account database file is the supported shape (SQLite handles the two connections), while two different paths would silently put RBAC on a different user population.
- **Resource-policy catalogs are name-based** — a deny on a tool name removes the tool, not a specific invocation of it inside Code Mode; restricting what code a user may run inside the sandbox is a different fence and stays deferred.
- **Dedicated channel endpoints name as `route:<endpoint>`** — a dedicated RPC channel endpoint without a dot (`goals/create`) is judged under the `route` domain, so policy authors must write the full prefixed form to grant it.
- **No per-request audit log** — refusals answer 403 with the permission string but are not separately journaled; an audit trail for authorization decisions stays deferred.

## Error semantics

- **Identity faults are not permission refusals.** Only the expected client-side session failures (`SessionValidationError`: unknown/expired/malformed token) fold into the anonymous fail-closed identity. A corrupt durable row or an unknown store fault propagates: the provider logs it at its own logger boundary and the transport maps any thrown gate fault to a stable `500 {error: {code: 'internal_error'}}` — never a 403 dressing store damage up as an authorization decision.
- **Policy load refusals carry stable codes** (`policy-file-unreadable`, `policy-file-json`, `policy-schema`) with sanitized messages: no configured path, no fs errno, no JSON parser excerpt. The raw cause survives on the error's `cause` for the internal logger boundary only.
- **Malformed permission input fails closed.** Empty strings, missing/extra colons, empty segments, whitespace, and non-string runtime values are refused at the authorizer boundary — nothing malformed reaches the pattern matcher.
