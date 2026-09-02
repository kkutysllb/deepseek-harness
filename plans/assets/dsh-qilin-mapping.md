# DSH → OpenKylin 包级映射表

- 生成日期:2026-08-27
- 用途:P1 rescope codemod 与《plans/2026-08-27-qilin-engine-transplant.md》§7 上游移植的对照依据;「原 npm 名」一律逐包实测自各包 package.json 的实际 name 字段(非目录名推断);「新 npm 名」按 D1 rescope 规则生成:@qilin/<去掉 @deepseek-ai/dsh- 前缀后的名字>;vendor 按 D6 保留原名。例外:根包→@qilin/engine-root(总计划 §1 定案);apps/cli→@qilin/cli(P1-S2 定案);取值列含括注者均非机械改名,codemod 须跳过。
- 备注=原 description 原文(超长以…截断,全文见各包 package.json);中文备注为编辑标注/推断。
- 决策 D1–D6 见 plans/2026-08-27-qilin-engine-transplant.md『决策记录』表。

## 主表:packages 二级包目录(227 行)

| 包路径 | 原 npm 名 | 新 npm 名 | 备注 |
|---|---|---|---|
| deepseek-harness/packages/acp/acp | @deepseek-ai/dsh-acp | @qilin/acp | Automation-only Agent Client Protocol server for driving DeepSeek Harness agents over JSON-RPC stdio |
| deepseek-harness/packages/api/gateway | @deepseek-ai/dsh-api-gateway | @qilin/api-gateway | Typert Remote Host dispatcher and Client API endpoint |
| deepseek-harness/packages/api/remotes | @deepseek-ai/dsh-api-remotes | @qilin/api-remotes | Remote BFF assembly and Host Agent/Session lookup policy |
| deepseek-harness/packages/attachment/attachment | @deepseek-ai/dsh-attachment | @qilin/attachment | Durable immutable attachment storage seam for the DeepSeek Harness |
| deepseek-harness/packages/attachment/attachment-local | @deepseek-ai/dsh-attachment-local | @qilin/attachment-local | Private content-addressed DSH_HOME attachment storage |
| deepseek-harness/packages/boot/app-boot | @deepseek-ai/dsh-app-boot | @qilin/app-boot | Shared boot glue for the app bins: .env loading, fail-loud Loader guards, snapshot-aware config resolution,… |
| deepseek-harness/packages/boot/cmdline | @deepseek-ai/dsh-cmdline | @qilin/cmdline | Immutable command-line handoff from a dsh launcher to any app plugin that injects cmdlineArgs |
| deepseek-harness/packages/bundle/base | @deepseek-ai/dsh-base | @qilin/base | The shared dsh core as a profile bundle: every profile's first patch layer, inserting the base plugin rows… |
| deepseek-harness/packages/bundle/headless | @deepseek-ai/dsh-headless | @qilin/headless | The dsh one-shot bundle: a direct core Agent/Session runner over dsh-base with no Host, HTTP, or browser layer |
| deepseek-harness/packages/bundle/web-app | @deepseek-ai/dsh-web-app | @qilin/web-app | The dsh browser-surface bundle: the web patch layer over dsh-base plus the runtime glue plugin (frontend dist… |
| deepseek-harness/packages/client/connection | @deepseek-ai/dsh-client-connection | @qilin/client-connection | Wire consumer layer: HTTP-up/WebSocket-down client, ConnectionController dual streams with reconnect, and… |
| deepseek-harness/packages/client/hmr | @deepseek-ai/dsh-client-hmr | @qilin/client-hmr | Dev-only hot-reload driver for script-loaded client entries: SSE rebuilt frames → invalidate/prefetch → fiber… |
| deepseek-harness/packages/client/locale | @deepseek-ai/dsh-client-locale | @qilin/client-locale | Locale plugin: Host-backed zh/en preference, browser-derived fallback, locale snapshots, and typed namespace… |
| deepseek-harness/packages/client/modules | @deepseek-ai/dsh-client-modules | @qilin/client-modules | Client module system, dual-face: node half composes the __DSH_BOOT__ entry graph (incremental dsh.client… |
| deepseek-harness/packages/client/runtime | @deepseek-ai/dsh-client-runtime | @qilin/client-runtime | Client core services: SlotRegistry, SessionRuntime (scope tree + object layer) |
| deepseek-harness/packages/client/ui-agent-preset | @deepseek-ai/dsh-client-ui-agent-preset | @qilin/client-ui-agent-preset | Agent-preset surfaces: the default for later sessions, this session's seat, and the composition editor |
| deepseek-harness/packages/client/ui-attachment | @deepseek-ai/dsh-client-ui-attachment | @qilin/client-ui-attachment | Dynamic attachment presentation plugin for conversation input and message-image slots |
| deepseek-harness/packages/client/ui-brand-official | @deepseek-ai/dsh-client-ui-brand-official | @qilin/client-ui-brand-official | Official DeepSeek Harness brand occupants for the Web client's sidebar and conversation Hero slots |
| deepseek-harness/packages/client/ui-commands | @deepseek-ai/dsh-client-ui-commands | @qilin/client-ui-commands | Client command surface: global directory cache, '/' source, three command UI kinds, popupSelect registry |
| deepseek-harness/packages/client/ui-conversation | @deepseek-ai/dsh-client-ui-conversation | @qilin/client-ui-conversation | Conversation domain: skeleton, ordered chat flow, composer with the Host-backed busy-Enter preference, and… |
| deepseek-harness/packages/client/ui-deliverables | @deepseek-ai/dsh-client-ui-deliverables | @qilin/client-ui-deliverables | Produced-files turn tail and clickable final-response file references for Web |
| deepseek-harness/packages/client/ui-directory-picker-browse | @deepseek-ai/dsh-client-ui-directory-picker-browse | @qilin/client-ui-directory-picker-browse | In-app directory browsing surface: the workspace directory-flow owner rendering the host's listing and… |
| deepseek-harness/packages/client/ui-directory-picker-native | @deepseek-ai/dsh-client-ui-directory-picker-native | @qilin/client-ui-directory-picker-native | Native directory-picker surface: the renderless workspace directory-flow occupant driving the host's OS… |
| deepseek-harness/packages/client/ui-goal | @deepseek-ai/dsh-client-ui-goal | @qilin/client-ui-goal | Session goal surface: GoalBar docked above the composer, read from the goal session projection |
| deepseek-harness/packages/client/ui-input-trigger | @deepseek-ai/dsh-client-ui-input-trigger | @qilin/client-ui-input-trigger | Input trigger pipeline: '/' and '@' detection, candidate menu, pick routing to registered sources |
| deepseek-harness/packages/client/ui-jobs | @deepseek-ai/dsh-client-ui-jobs | @qilin/client-ui-jobs | Session-header background-job list: live registry state mirrored from session/jobs frames |
| deepseek-harness/packages/client/ui-layout | @deepseek-ai/dsh-client-ui-layout | @qilin/client-ui-layout | Shell plugin: three-column AppFrame with drag handles, ctx.layout viewing-state service (navigation + panels) |
| deepseek-harness/packages/client/ui-message-feedback | @deepseek-ai/dsh-client-ui-message-feedback | @qilin/client-ui-message-feedback | Per-message feedback controls contributed to the assistant-message action strip, backed by the… |
| deepseek-harness/packages/client/ui-model-selection | @deepseek-ai/dsh-client-ui-model-selection | @qilin/client-ui-model-selection | Model selection: the /model popupSelect over session.models / session.selectModel |
| deepseek-harness/packages/client/ui-permission-presets | @deepseek-ai/dsh-client-ui-permission-presets | @qilin/client-ui-permission-presets | Permission surfaces: a new-session default in General settings and a current-session /permission popup over… |
| deepseek-harness/packages/client/ui-plan | @deepseek-ai/dsh-client-ui-plan | @qilin/client-ui-plan | Plan-mode composer control: the conversation.input.plan seat over the plan projection and the /plan command… |
| deepseek-harness/packages/client/ui-primitives | @deepseek-ai/dsh-client-ui-primitives | @qilin/client-ui-primitives | Pure React atoms for the dsh web UI: controls, icons, markdown, and JSON inspectors (zero cordis) |
| deepseek-harness/packages/client/ui-reference | @deepseek-ai/dsh-client-ui-reference | @qilin/client-ui-reference | Unified Web @file and @session reference source |
| deepseek-harness/packages/client/ui-renderer | @deepseek-ai/dsh-client-ui-renderer | @qilin/client-ui-renderer | Browser UI renderer: React slot bindings, ctx.uiRenderer, and the assembled application root |
| deepseek-harness/packages/client/ui-settings | @deepseek-ai/dsh-client-ui-settings | @qilin/client-ui-settings | Settings domain base plugin: the settings-namespace scope service and the canonical settings slot-type… |
| deepseek-harness/packages/client/ui-settings-general | @deepseek-ai/dsh-client-ui-settings-general | @qilin/client-ui-settings-general | Settings ownerless-copy and product onboarding plugin: the General section, shell trigger/header chrome… |
| deepseek-harness/packages/client/ui-settings-models | @deepseek-ai/dsh-client-ui-settings-models | @qilin/client-ui-settings-models | Models settings and shared product-onboarding dialogs over existing settings and credential joins |
| deepseek-harness/packages/client/ui-settings-plugin-inventory | @deepseek-ai/dsh-client-ui-settings-plugin-inventory | @qilin/client-ui-settings-plugin-inventory | Read-only Cordis Loader inventory tab in Web Plugins settings |
| deepseek-harness/packages/client/ui-settings-plugins | @deepseek-ai/dsh-client-ui-settings-plugins | @qilin/client-ui-settings-plugins | Plugins settings section with feature-owned tabs and configurable host-plane plugin cards |
| deepseek-harness/packages/client/ui-sidebar | @deepseek-ai/dsh-client-ui-sidebar | @qilin/client-ui-sidebar | Sidebar plugin: session multi-level tree, search, grouping, state dots |
| deepseek-harness/packages/client/ui-skill | @deepseek-ai/dsh-client-ui-skill | @qilin/client-ui-skill | Web skill references and the dedicated skill tool row |
| deepseek-harness/packages/client/ui-slots | @deepseek-ai/dsh-client-ui-slots | @qilin/client-ui-slots | Slot registry pure core: SlotMap declaration merging, single register composition API, four-share props… |
| deepseek-harness/packages/client/ui-subagent | @deepseek-ai/dsh-client-ui-subagent | @qilin/client-ui-subagent | Subagent conversation catalog, continuation routing UI, and '@' reference source |
| deepseek-harness/packages/client/ui-theme | @deepseek-ai/dsh-client-ui-theme | @qilin/client-ui-theme | Theme plugin: Host bootstrap for the pre-plugin palette; DOM-free ThemeRuntime for light/dark/system state;… |
| deepseek-harness/packages/client/ui-tool | @deepseek-ai/dsh-client-ui-tool | @qilin/client-ui-tool | Client Tool call-tree renderer and keyed per-tool presentation slot |
| deepseek-harness/packages/client/ui-trajectory | @deepseek-ai/dsh-client-ui-trajectory | @qilin/client-ui-trajectory | Trajectory event ledger with an interactive timing overview: pure-consumer plugin registering into the… |
| deepseek-harness/packages/client/ui-user-questions | @deepseek-ai/dsh-client-ui-user-questions | @qilin/client-ui-user-questions | Web ask_user_question feature: host tool mount plus composer-takeover question UI |
| deepseek-harness/packages/client/ui-workflow-run | @deepseek-ai/dsh-client-ui-workflow-run | @qilin/client-ui-workflow-run | Durable workflow-run Conversation Node and nested member disclosure for dsh web |
| deepseek-harness/packages/client/ui-workspace | @deepseek-ai/dsh-client-ui-workspace | @qilin/client-ui-workspace | Workspace picker plugin: one WorkspacePicker registered into the sidebar and empty-state workspace slots |
| deepseek-harness/packages/client/web | @deepseek-ai/dsh-client-web | @qilin/client-web | Web boot kernel: static module table, Cordis loader, framework-free boot page, and UI-renderer handoff |
| deepseek-harness/packages/code-runtime/code-runtime | @deepseek-ai/dsh-code-runtime | @qilin/code-runtime | Abstract code-execution seam (ctx.codeRuntime) for the DeepSeek Harness |
| deepseek-harness/packages/code-runtime/code-runtime-python | @deepseek-ai/dsh-code-runtime-python | @qilin/code-runtime-python | CPython subprocess implementation of the DeepSeek Harness code-execution seam |
| deepseek-harness/packages/code-runtime/code-runtime-worker-thread | @deepseek-ai/dsh-code-runtime-worker-thread | @qilin/code-runtime-worker-thread | Worker-thread implementation of the DeepSeek Harness code-execution seam |
| deepseek-harness/packages/compaction/command-compact | @deepseek-ai/dsh-command-compact | @qilin/command-compact | Human-facing slash command for explicit session compaction |
| deepseek-harness/packages/compaction/compaction | @deepseek-ai/dsh-compaction | @qilin/compaction | Abstract compaction service seam (ctx.compaction) for the DeepSeek Harness |
| deepseek-harness/packages/compaction/compaction-basic | @deepseek-ai/dsh-compaction-basic | @qilin/compaction-basic | Token-meter-driven compaction policy and LLM summarization backend for the DeepSeek Harness |
| deepseek-harness/packages/compaction/compaction-tool-result-pruner | @deepseek-ai/dsh-compaction-tool-result-pruner | @qilin/compaction-tool-result-pruner | Replay-safe model-free head/middle/tail pruning for tool-result surface nodes |
| deepseek-harness/packages/context/agent-instructions | @deepseek-ai/dsh-agent-instructions | @qilin/agent-instructions | Workspace context loader for AGENTS.md/CLAUDE.md instruction files |
| deepseek-harness/packages/context/file-reference | @deepseek-ai/dsh-file-reference | @qilin/file-reference | File-reference discovery contract and shared @file grammar |
| deepseek-harness/packages/context/file-reference-local | @deepseek-ai/dsh-file-reference-local | @qilin/file-reference-local | Local-filesystem ctx.fileReferences provider with bounded fuzzy indexes |
| deepseek-harness/packages/context/session-reference | @deepseek-ai/dsh-session-reference | @qilin/session-reference | Cross-session snapshot references and durable untrusted model context (ctx.sessionReferenceResolver) |
| deepseek-harness/packages/context/time-context | @deepseek-ai/dsh-time-context | @qilin/time-context | Opt-in durable per-step context with the current time and elapsed time |
| deepseek-harness/packages/context/tmux-context | @deepseek-ai/dsh-tmux-context | @qilin/tmux-context | Opt-in durable per-step context with this agent's tmux pane and window location |
| deepseek-harness/packages/core/agent | @deepseek-ai/dsh-agent | @qilin/agent | Agent interface, registry, initiator scope, and event vocabulary for the DeepSeek Harness |
| deepseek-harness/packages/core/agent-default-model | @deepseek-ai/dsh-agent-default-model | @qilin/agent-default-model | Default model selection shared by Agent entry points |
| deepseek-harness/packages/core/agent-loop | @deepseek-ai/dsh-agent-loop | @qilin/agent-loop | The concrete agent loop plugin for the DeepSeek Harness |
| deepseek-harness/packages/core/agent-tool-presentation | @deepseek-ai/dsh-agent-tool-presentation | @qilin/agent-tool-presentation | Agent-plane presentation selector: composes one agent's tools as Code Mode, native, or both |
| deepseek-harness/packages/core/scope | @deepseek-ai/dsh-scope | @qilin/scope | Scoped-context registration primitive (scope tags, scope-filtered event dispatch) for the DeepSeek Harness |
| deepseek-harness/packages/core/session | @deepseek-ai/dsh-session | @qilin/session | Event-sourced session store for the DeepSeek Harness |
| deepseek-harness/packages/core/system-prompt | @deepseek-ai/dsh-system-prompt | @qilin/system-prompt | System prompt assembly registry for the DeepSeek Harness |
| deepseek-harness/packages/core/tools | @deepseek-ai/dsh-tools | @qilin/tools | Tool registry and execution pipeline for the DeepSeek Harness |
| deepseek-harness/packages/credentials/authorization | @deepseek-ai/dsh-authorization | @qilin/authorization | Authorization seam (ctx.authorization): plugin-owned flows that obtain a credential through a conversation… |
| deepseek-harness/packages/credentials/credentials | @deepseek-ai/dsh-credentials | @qilin/credentials | Abstract credential seam (ctx.credentials): settings carry references to secrets, providers own the values |
| deepseek-harness/packages/credentials/credentials-local | @deepseek-ai/dsh-credentials-local | @qilin/credentials-local | File-backed credentials provider ($DSH_HOME/.env under the live process environment) for the DeepSeek Harness |
| deepseek-harness/packages/e2b/e2b | @deepseek-ai/dsh-e2b | @qilin/e2b | Shared E2B sandbox lifecycle for DeepSeek Harness provider adapters |
| deepseek-harness/packages/e2b/fs-e2b | @deepseek-ai/dsh-fs-e2b | @qilin/fs-e2b | E2B filesystem implementation for DeepSeek Harness |
| deepseek-harness/packages/e2b/subprocess-e2b | @deepseek-ai/dsh-subprocess-e2b | @qilin/subprocess-e2b | E2B subprocess implementation for DeepSeek Harness |
| deepseek-harness/packages/examples/acp-demo | @deepseek-ai/dsh-acp-demo | @qilin/acp-demo | ACP automation server app: agent spine + JSONL persistence + ACP transport, with a JSON-RPC stdio bin |
| deepseek-harness/packages/examples/agent-spine-demo | @deepseek-ai/dsh-agent-spine-demo | @qilin/agent-spine-demo | The default executor-less/UI-less agent spine with fallback session titles, provider-routed retry, and… |
| deepseek-harness/packages/examples/jsonrpc-demo | @deepseek-ai/dsh-sdk-jsonrpc-demo | @qilin/sdk-jsonrpc-demo | Bin that boots an external Cordis config for the stdio JSON-RPC SDK runtime |
| deepseek-harness/packages/experimental/agent-team | @deepseek-ai/dsh-experimental-agent-team | @qilin/experimental-agent-team | Implicit-root Agent Teams roster, durable peer mailbox, and shared task DAG |
| deepseek-harness/packages/experimental/tool-agent-team | @deepseek-ai/dsh-experimental-tool-agent-team | @qilin/experimental-tool-agent-team | Scoped model-facing Agent Teams tools over ctx.agentTeams |
| deepseek-harness/packages/extensions/cordis-client-runner | @deepseek-ai/dsh-cordis-client-runner | @qilin/cordis-client-runner | Browser half of dynamic dual-half plugin packages: event subscription, closure evaluation, guard facade, and… |
| deepseek-harness/packages/extensions/cordis-host-runner | @deepseek-ai/dsh-cordis-host-runner | @qilin/cordis-host-runner | Dynamic package definition registry, host-half sandbox lifecycle, and invoke handler table for model-mounted… |
| deepseek-harness/packages/extensions/tool-cordis | @deepseek-ai/dsh-tool-cordis | @qilin/tool-cordis | Self-referential cordis toolset: inspect the live runtime, mount and dispose model-written plugins |
| deepseek-harness/packages/extensions/ui-cordis | @deepseek-ai/dsh-client-ui-cordis | @qilin/client-ui-cordis | Cordis dynamic-plugin definition card: the keyed cordis_define tool row with its run/stop switch |
| deepseek-harness/packages/feedback/command-feedback | @deepseek-ai/dsh-command-feedback | @qilin/command-feedback | Log-only session feedback producer and human-facing slash command |
| deepseek-harness/packages/feedback/message-feedback | @deepseek-ai/dsh-message-feedback | @qilin/message-feedback | Lifecycle-bound per-message rating and note sidecar for the DeepSeek Harness |
| deepseek-harness/packages/fs/fs | @deepseek-ai/dsh-fs | @qilin/fs | Abstract filesystem capability seam (ctx.fs) for the DeepSeek Harness — vocabulary types, the FileSystem… |
| deepseek-harness/packages/fs/fs-local | @deepseek-ai/dsh-fs-local | @qilin/fs-local | Local-filesystem implementation of the DeepSeek Harness filesystem seam (ctx.fs) |
| deepseek-harness/packages/fs/fs-observation-policy | @deepseek-ai/dsh-fs-observation-policy | @qilin/fs-observation-policy | File-context policy plugin for the DeepSeek Harness — observed-state, read-before-edit, and version-guarded… |
| deepseek-harness/packages/fs/fs-sandbox | @deepseek-ai/dsh-fs-sandbox | @qilin/fs-sandbox | Sandbox-enforcing implementation of the DeepSeek Harness filesystem seam: fences write/edit by the per-call… |
| deepseek-harness/packages/fs/tool-fs | @deepseek-ai/dsh-tool-fs | @qilin/tool-fs | Model-facing filesystem tools (read, write, edit) over the DeepSeek Harness filesystem seam (ctx.fs) |
| deepseek-harness/packages/fs/tool-fs-search | @deepseek-ai/dsh-tool-fs-search | @qilin/tool-fs-search | Model-facing filesystem discovery tools (glob, grep) backed by the packaged ripgrep binary (@vscode/ripgrep) |
| deepseek-harness/packages/fs/tool-str-replace-editor | @deepseek-ai/dsh-tool-str-replace-editor | @qilin/tool-str-replace-editor | Model-facing view, create, literal replace, and line insert tool over the Harness filesystem service |
| deepseek-harness/packages/goal/command-goal | @deepseek-ai/dsh-command-goal | @qilin/command-goal | Human-facing slash command for persisted same-session goals |
| deepseek-harness/packages/goal/goal | @deepseek-ai/dsh-goal | @qilin/goal | Event-sourced same-session goal state and lifecycle service for the DeepSeek Harness |
| deepseek-harness/packages/goal/goal-round-driver | @deepseek-ai/dsh-goal-round-driver | @qilin/goal-round-driver | Race-fenced same-session goal-round driver |
| deepseek-harness/packages/goal/tool-goal | @deepseek-ai/dsh-tool-goal | @qilin/tool-goal | Model-facing same-session goal tools with execution-time authority checks |
| deepseek-harness/packages/guard/repeat-tool-reminder | @deepseek-ai/dsh-repeat-tool-reminder | @qilin/repeat-tool-reminder | Repeat-tool-call guard plugin: advisory reminders when an agent loops on identical tool calls |
| deepseek-harness/packages/guard/timeout-policy | @deepseek-ai/dsh-tool-call-timeout-policy | @qilin/tool-call-timeout-policy | Tool-call timeout policy: a tools/execute wrapper that arms a per-tool deadline on exec.signal and returns… |
| deepseek-harness/packages/hooks/hook-protocol | @deepseek-ai/dsh-hook-protocol | @qilin/hook-protocol | Shared Claude Code / Codex hook wire protocol: matcher engine, stdin/exit-code/stdout codec, multi-hook… |
| deepseek-harness/packages/hooks/hooks-claude-code | @deepseek-ai/dsh-hooks-claude-code | @qilin/hooks-claude-code | Bridge plugin: run a Claude Code hooks.json / settings hook config on the DeepSeek Harness interception seams |
| deepseek-harness/packages/hooks/hooks-codex | @deepseek-ai/dsh-hooks-codex | @qilin/hooks-codex | Bridge plugin: run a Codex hooks.json hook config on the DeepSeek Harness interception seams |
| deepseek-harness/packages/host/apiproxy | @deepseek-ai/dsh-host-apiproxy | @qilin/host-apiproxy | API gateway: the ApiProxy contract (api/), the fetch carrier pair (fetch/), and the host-side gateway plugin… |
| deepseek-harness/packages/host/directory-picker | @deepseek-ai/dsh-host-directory-picker | @qilin/host-directory-picker | Abstract workspace-directory picking seam (ctx.directoryPicker) for the DeepSeek Harness web GUI host |
| deepseek-harness/packages/host/directory-picker-auto | @deepseek-ai/dsh-host-directory-picker-auto | @qilin/host-directory-picker-auto | Adaptive chooser of the directory-picker seam: resolves the host situation at boot and mounts the native or… |
| deepseek-harness/packages/host/directory-picker-browse | @deepseek-ai/dsh-host-directory-picker-browse | @qilin/host-directory-picker-browse | In-app browsing backend of the directory-picker seam (listing/creation primitives over the host filesystem) |
| deepseek-harness/packages/host/directory-picker-native | @deepseek-ai/dsh-host-directory-picker-native | @qilin/host-directory-picker-native | Native-OS-chooser backend of the directory-picker seam for the DeepSeek Harness web GUI host |
| deepseek-harness/packages/host/frontend-static | @deepseek-ai/dsh-host-frontend-static | @qilin/host-frontend-static | SPA dist server for the Web shell: owns the webserver fallback seat, serving explicit index entries and… |
| deepseek-harness/packages/host/plugin-inventory | @deepseek-ai/dsh-host-plugin-inventory | @qilin/host-plugin-inventory | Read-only Remote projection of current Cordis Loader plugin state |
| deepseek-harness/packages/host/webserver | @deepseek-ai/dsh-host-webserver | @qilin/host-webserver | Web route-registration plugin: HTTP and upgrade routes, index transform taps, and static dist fallback; knows… |
| deepseek-harness/packages/identity/anonymous-user-id | @deepseek-ai/dsh-anonymous-user-id | @qilin/anonymous-user-id | Shared anonymous user identity for DeepSeek Harness telemetry and feedback correlation |
| deepseek-harness/packages/interaction/commands | @deepseek-ai/dsh-commands | @qilin/commands | Plugin-owned human command registry for DeepSeek Harness UIs |
| deepseek-harness/packages/interaction/permission-presets | @deepseek-ai/dsh-permission-presets | @qilin/permission-presets | User-facing permission presets (ctx.permissionPresets) for the DeepSeek Harness: one product-level… |
| deepseek-harness/packages/interaction/tool-ask-user | @deepseek-ai/dsh-tool-ask-user | @qilin/tool-ask-user | Model-facing ask_user_question tool over the ctx.userQuestions seam |
| deepseek-harness/packages/interaction/user-approval | @deepseek-ai/dsh-user-approval | @qilin/user-approval | User-approval seam (ctx.approval) for the DeepSeek Harness: one-shot permission decisions dispatched to… |
| deepseek-harness/packages/interaction/user-questions | @deepseek-ai/dsh-user-questions | @qilin/user-questions | Abstract user-questions seam (ctx.userQuestions) for asking the human during agent runs |
| deepseek-harness/packages/jobs/jobs | @deepseek-ai/dsh-jobs | @qilin/jobs | Background job registry (ctx.jobs) for the DeepSeek Harness — shared ids, owner isolation, polling,… |
| deepseek-harness/packages/jobs/jobs-local | @deepseek-ai/dsh-jobs-local | @qilin/jobs-local | Process-local implementation of the DeepSeek Harness background job registry seam |
| deepseek-harness/packages/jobs/tool-jobs | @deepseek-ai/dsh-tool-jobs | @qilin/tool-jobs | Model-facing background job control tools (job_output, job_list, job_kill) over the ctx.jobs registry |
| deepseek-harness/packages/llm/llm | @deepseek-ai/dsh-llm | @qilin/llm | Provider-neutral LLM service interface for the DeepSeek Harness |
| deepseek-harness/packages/llm/llm-deepseek | @deepseek-ai/dsh-llm-deepseek | @qilin/llm-deepseek | DeepSeek chat-completions adapter for the DeepSeek Harness LLM seam |
| deepseek-harness/packages/llm/llm-pi-ai | @deepseek-ai/dsh-llm-pi-ai | @qilin/llm-pi-ai | pi-ai-backed DeepSeek adapter for the DeepSeek Harness LLM seam (design-verification twin of dsh-llm-deepseek) |
| deepseek-harness/packages/llm/llm-retry | @deepseek-ai/dsh-llm-retry | @qilin/llm-retry | Provider-routed LLM request retry policy for the DeepSeek Harness |
| deepseek-harness/packages/llm/token-meter | @deepseek-ai/dsh-token-meter | @qilin/token-meter | Replay-aware token measurement service (ctx.tokenMeter) for the DeepSeek Harness |
| deepseek-harness/packages/lsp/lsp | @deepseek-ai/dsh-lsp | @qilin/lsp | Abstract LSP capability seam (ctx.lsp) for the DeepSeek Harness — language-server provider registry keyed by… |
| deepseek-harness/packages/lsp/lsp-stdio | @deepseek-ai/dsh-lsp-stdio | @qilin/lsp-stdio | Generic stdio language-server provider for the DeepSeek Harness LSP capability seam (ctx.lsp) — spawns… |
| deepseek-harness/packages/lsp/tool-lsp | @deepseek-ai/dsh-tool-lsp | @qilin/tool-lsp | Model-facing lsp tool over the DeepSeek Harness LSP capability seam (ctx.lsp) — one read-only tool with… |
| deepseek-harness/packages/mcp/mcp-client | @deepseek-ai/dsh-mcp-client | @qilin/mcp-client | MCP client bridge: connects to MCP servers and registers their tools on ctx.tools |
| deepseek-harness/packages/plan/plan-mode | @deepseek-ai/dsh-plan-mode | @qilin/plan-mode | Logged per-agent plan mode with deployment guidance, a direct slash command, and a user-reviewed exit |
| deepseek-harness/packages/preset/agent-presets | @deepseek-ai/dsh-agent-presets | @qilin/agent-presets | Per-session agent composition from preset cordis.yml files for the DeepSeek Harness |
| deepseek-harness/packages/preset/persona | @deepseek-ai/dsh-persona | @qilin/persona | Composition-authored deployment persona section for the DeepSeek Harness |
| deepseek-harness/packages/runtime-diagnostics/invariants | @deepseek-ai/dsh-invariants | @qilin/invariants | Registry service for package-owned DeepSeek Harness runtime invariants |
| deepseek-harness/packages/sandbox/sandbox | @deepseek-ai/dsh-sandbox | @qilin/sandbox | Abstract process-sandbox seam (ctx.sandbox) for the DeepSeek Harness: same-world confinement vocabulary and… |
| deepseek-harness/packages/sandbox/sandbox-local | @deepseek-ai/dsh-sandbox-local | @qilin/sandbox-local | Local process-sandbox backends for the DeepSeek Harness sandbox seam: bwrap, the npm-distributed landlock-run… |
| deepseek-harness/packages/sandbox/sandbox-policy | @deepseek-ai/dsh-sandbox-policy | @qilin/sandbox-policy | Per-call sandbox policy resolver and current model context: deployment fallbacks plus each session's mode and… |
| deepseek-harness/packages/sandbox/sandbox-windows-acl | @deepseek-ai/dsh-sandbox-windows-acl | @qilin/sandbox-windows-acl | Windows ACL write-restriction sandbox backend (restricted-token spawn with capability-SID write allowlist)… |
| deepseek-harness/packages/schedule/schedule | @deepseek-ai/dsh-schedule | @qilin/schedule | Agent-scoped durable after, at, and fixed-rate reminders over the session event log |
| deepseek-harness/packages/sdk/client | @deepseek-ai/dsh-sdk-client | @qilin/sdk-client | TypeScript client SDK for driving a DeepSeek Harness runtime subprocess over stdio JSON-RPC: the… |
| deepseek-harness/packages/sdk/protocol | @deepseek-ai/dsh-sdk-protocol | @qilin/sdk-protocol | Shared wire protocol for the DeepSeek Harness SDK runtime: the newline-delimited JSON-RPC stdio transport and… |
| deepseek-harness/packages/sdk/server | @deepseek-ai/dsh-sdk-jsonrpc-server | @qilin/sdk-jsonrpc-server | Stdio JSON-RPC server plugin for out-of-process DeepSeek Harness SDK clients |
| deepseek-harness/packages/session-query/session-log-export | @deepseek-ai/dsh-session-log-export | @qilin/session-log-export | Web Session-log export command and shared download dialog |
| deepseek-harness/packages/session-query/session-query | @deepseek-ai/dsh-session-query | @qilin/session-query | Combined session query service contract with concrete reads, traces, and filters |
| deepseek-harness/packages/session-query/session-query-sqlite | @deepseek-ai/dsh-session-query-sqlite | @qilin/session-query-sqlite | Concrete ctx.sessionQuery backend with SQLite FTS5 search |
| deepseek-harness/packages/session-query/tool-session-query | @deepseek-ai/dsh-tool-session-query | @qilin/tool-session-query | Workspace-authorized model-facing session history search, trace, and event read tools |
| deepseek-harness/packages/session/session-checkpoint-policy | @deepseek-ai/dsh-session-checkpoint-policy | @qilin/session-checkpoint-policy | Semantic session durability checkpoints before model requests and tool side effects |
| deepseek-harness/packages/session/session-persistence | @deepseek-ai/dsh-session-persistence | @qilin/session-persistence | Abstract durable session persistence seam (ctx.sessionPersistence) for the DeepSeek Harness |
| deepseek-harness/packages/session/session-persistence-jsonl | @deepseek-ai/dsh-session-persistence-jsonl | @qilin/session-persistence-jsonl | JSONL durable session persistence backend for the DeepSeek Harness |
| deepseek-harness/packages/session/session-persistence-sqlite | @deepseek-ai/dsh-session-persistence-sqlite | @qilin/session-persistence-sqlite | SQLite durable session persistence with physical chunk-row packing |
| deepseek-harness/packages/session/session-projection | @deepseek-ai/dsh-session-projection | @qilin/session-projection | Session-projection seam: the merge-extensible projection type table, the provider contract, and the… |
| deepseek-harness/packages/session/session-projection-cache | @deepseek-ai/dsh-session-projection-cache | @qilin/session-projection-cache | Persisted projection cache (ctx.sessionProjectionCache): durable per-session projection checkpoints over the… |
| deepseek-harness/packages/session/session-stats | @deepseek-ai/dsh-session-stats | @qilin/session-stats | Whole-log conversation counts and wall times projection (sessionStats) for the DeepSeek Harness |
| deepseek-harness/packages/session/session-telemetry | @deepseek-ai/dsh-session-telemetry | @qilin/session-telemetry | SessionTelemetryBackend seam for the DeepSeek Harness: session-event capture, projection, redaction, and… |
| deepseek-harness/packages/session/session-telemetry-otel | @deepseek-ai/dsh-session-telemetry-otel | @qilin/session-telemetry-otel | OpenTelemetry backend for the DeepSeek Harness telemetry seam: hands captured session records to the OTel JS… |
| deepseek-harness/packages/session/session-title | @deepseek-ai/dsh-session-title | @qilin/session-title | Log-backed session title service and provider registry for the DeepSeek Harness |
| deepseek-harness/packages/session/session-title-all-prompts-llm | @deepseek-ai/dsh-session-title-all-prompts-llm | @qilin/session-title-all-prompts-llm | All-user-messages LLM provider plugin for DeepSeek Harness session titles |
| deepseek-harness/packages/session/session-title-first-prompt-llm | @deepseek-ai/dsh-session-title-first-prompt-llm | @qilin/session-title-first-prompt-llm | First-message LLM provider plugin for DeepSeek Harness session titles |
| deepseek-harness/packages/session/session-title-llm | @deepseek-ai/dsh-session-title-llm | @qilin/session-title-llm | Shared LLM generation policy for DeepSeek Harness session-title providers |
| deepseek-harness/packages/settings/settings | @deepseek-ai/dsh-settings | @qilin/settings | Abstract user-settings seam (ctx.settings) for the DeepSeek Harness |
| deepseek-harness/packages/settings/settings-file | @deepseek-ai/dsh-settings-file | @qilin/settings-file | File-backed settings provider (settings.yaml) for the DeepSeek Harness |
| deepseek-harness/packages/shell/bash-local | @deepseek-ai/dsh-bash-local | @qilin/bash-local | Local-subprocess implementation of the DeepSeek Harness bash executor seam |
| deepseek-harness/packages/shell/bash-sandbox | @deepseek-ai/dsh-bash-sandbox | @qilin/bash-sandbox | Sandbox-consuming implementation of the DeepSeek Harness bash executor seam (confines every command via… |
| deepseek-harness/packages/shell/pwsh-local | @deepseek-ai/dsh-pwsh-local | @qilin/pwsh-local | Local PowerShell implementation of the DeepSeek Harness bash executor seam |
| deepseek-harness/packages/shell/pwsh-sandbox | @deepseek-ai/dsh-pwsh-sandbox | @qilin/pwsh-sandbox | Sandbox-consuming implementation of the DeepSeek Harness PowerShell executor seam (confines every command via… |
| deepseek-harness/packages/shell/shell | @deepseek-ai/dsh-shell | @qilin/shell | Abstract bash executor seam (ctx.shell) for the DeepSeek Harness |
| deepseek-harness/packages/shell/shell-env | @deepseek-ai/dsh-shell-env | @qilin/shell-env | Tool-independent managed DSH_* shell environment registry |
| deepseek-harness/packages/shell/tool-bash | @deepseek-ai/dsh-tool-bash | @qilin/tool-bash | Model-facing bash tool with optional generic background-job and sandbox-escalation support |
| deepseek-harness/packages/shell/tool-bash-persistent | @deepseek-ai/dsh-tool-bash-persistent | @qilin/tool-bash-persistent | Model-facing owner-scoped persistent Bash tool backed by the Harness PTY service |
| deepseek-harness/packages/shell/tool-pwsh | @deepseek-ai/dsh-tool-pwsh | @qilin/tool-pwsh | Model-facing pwsh tool over the bash executor seam |
| deepseek-harness/packages/shell/tool-pwsh-persistent | @deepseek-ai/dsh-tool-pwsh-persistent | @qilin/tool-pwsh-persistent | Model-facing owner-scoped persistent PowerShell tool backed by the Harness PTY service |
| deepseek-harness/packages/skill/skill | @deepseek-ai/dsh-skill | @qilin/skill | Agent skill provider registry for the DeepSeek Harness |
| deepseek-harness/packages/skill/skill-badge | @deepseek-ai/dsh-skill-badge | @qilin/skill-badge | Bundled dsh badge skill provider for DeepSeek Harness |
| deepseek-harness/packages/skill/skill-filesystem | @deepseek-ai/dsh-skill-filesystem | @qilin/skill-filesystem | Local filesystem skill provider for the DeepSeek Harness |
| deepseek-harness/packages/skill/tool-skill | @deepseek-ai/dsh-tool-skill | @qilin/tool-skill | Model-facing skill loading tool for the DeepSeek Harness |
| deepseek-harness/packages/spill/spill | @deepseek-ai/dsh-spill | @qilin/spill | Abstract spill storage seam (ctx.spillStore) for the DeepSeek Harness — save oversized tool text and return a… |
| deepseek-harness/packages/spill/spill-local | @deepseek-ai/dsh-spill-local | @qilin/spill-local | Local-filesystem implementation of the DeepSeek Harness spill storage seam (private session-scoped files) |
| deepseek-harness/packages/spill/spill-policy | @deepseek-ai/dsh-spill-policy | @qilin/spill-policy | Tool-result spill policy for the DeepSeek Harness — replaces oversized plain-text tool results with a… |
| deepseek-harness/packages/storage/storage | @deepseek-ai/dsh-storage | @qilin/storage | Storage hub (ctx.storage): named backend registry plus mounted data-form facilities for the DeepSeek Harness |
| deepseek-harness/packages/storage/storage-domain | @deepseek-ai/dsh-storage-domain | @qilin/storage-domain | Domain data form (ctx.storage.domain): schema-validated, event-emitting KV domains over storage backends for… |
| deepseek-harness/packages/storage/storage-json | @deepseek-ai/dsh-storage-json | @qilin/storage-json | JSON file KV storage backend for the DeepSeek Harness storage hub |
| deepseek-harness/packages/storage/storage-sqlite | @deepseek-ai/dsh-storage-sqlite | @qilin/storage-sqlite | SQLite storage backend (kv facet) for the DeepSeek Harness storage hub |
| deepseek-harness/packages/subagent/subagent | @deepseek-ai/dsh-subagent | @qilin/subagent | Abstract subagent seam (ctx.subagents): named-provider registry for delegating to child agents |
| deepseek-harness/packages/subagent/subagent-acp | @deepseek-ai/dsh-subagent-acp | @qilin/subagent-acp | Out-of-process ACP subagent backend: drives a child agent in a spawned subprocess over the Agent Client… |
| deepseek-harness/packages/subagent/subagent-claude-code | @deepseek-ai/dsh-subagent-claude-code | @qilin/subagent-claude-code | One-shot Claude Code subagent provider over the official Agent SDK |
| deepseek-harness/packages/subagent/subagent-codex | @deepseek-ai/dsh-subagent-codex | @qilin/subagent-codex | One-shot Codex subagent provider over the official app-server protocol |
| deepseek-harness/packages/subagent/subagent-dsh-sdk | @deepseek-ai/dsh-subagent-dsh-sdk | @qilin/subagent-dsh-sdk | Out-of-process SDK subagent backend: drives a child DeepSeek Harness runtime subprocess over stdio JSON-RPC… |
| deepseek-harness/packages/subagent/subagent-fork-in-process | @deepseek-ai/dsh-subagent-fork-in-process | @qilin/subagent-fork-in-process | In-process fork subagent backend: runs a child agent seeded with a prefix of the parent's log |
| deepseek-harness/packages/subagent/subagent-in-process-driver | @deepseek-ai/dsh-subagent-in-process-driver | @qilin/subagent-in-process-driver | Shared in-process subagent run driver: drives a child agent on ctx.agents (used by the spawn and fork… |
| deepseek-harness/packages/subagent/subagent-spawn-in-process | @deepseek-ai/dsh-subagent-spawn-in-process | @qilin/subagent-spawn-in-process | In-process spawn subagent backend: runs a fresh child agent on ctx.agents |
| deepseek-harness/packages/subagent/tool-subagent | @deepseek-ai/dsh-tool-subagent | @qilin/tool-subagent | Model-facing subagent delegation tool over the ctx.subagents seam |
| deepseek-harness/packages/subagent/tool-subagent-control | @deepseek-ai/dsh-tool-subagent-control | @qilin/tool-subagent-control | Globally named send_message, interrupt_agent, and list_agents tools over ctx.subagents continuations |
| deepseek-harness/packages/subagent/tool-subagent-report | @deepseek-ai/dsh-tool-subagent-report | @qilin/tool-subagent-report | Child-scoped report tool over ctx.subagents continuations |
| deepseek-harness/packages/subprocess/subprocess | @deepseek-ai/dsh-subprocess | @qilin/subprocess | Subprocess seam (ctx.subprocess) for the DeepSeek Harness — managed process groups, bounded spill-backed… |
| deepseek-harness/packages/subprocess/subprocess-local | @deepseek-ai/dsh-subprocess-local | @qilin/subprocess-local | Local-subprocess implementation of the DeepSeek Harness subprocess seam |
| deepseek-harness/packages/terminal/terminal | @deepseek-ai/dsh-terminal | @qilin/terminal | Persistent PTY session seam for the DeepSeek Harness — owner-scoped ids, backend registry, interactive sends,… |
| deepseek-harness/packages/terminal/terminal-bash | @deepseek-ai/dsh-terminal-bash | @qilin/terminal-bash | Persistent shell PTY backend over the DeepSeek Harness subprocess terminal primitive |
| deepseek-harness/packages/terminal/tool-terminal | @deepseek-ai/dsh-tool-terminal | @qilin/tool-terminal | Six model-facing persistent PTY tools with owner isolation and generic background-job integration |
| deepseek-harness/packages/test-support/acp-snapshot | @deepseek-ai/dsh-acp-snapshot | @qilin/acp-snapshot | ACP test kit: shared subprocess launcher, snapshot scenario harness, expected-output normalizers, and suite… |
| deepseek-harness/packages/test-support/agent-loop-testkit | @deepseek-ai/dsh-agent-loop-testkit | @qilin/agent-loop-testkit | Shared prerequisite mounting for tests that exercise the concrete agent loop |
| deepseek-harness/packages/test-support/client-runtime | @deepseek-ai/dsh-client-test-runtime | @qilin/client-test-runtime | jsdom slot test runtime: real Cordis Context + SlotRegistry + UI renderer with test-owned session/workspace… |
| deepseek-harness/packages/test-support/llm-mock-server | @deepseek-ai/dsh-llm-mock-server | @qilin/llm-mock-server | Scriptable OpenAI-compatible HTTP/SSE fault server for LLM recovery tests |
| deepseek-harness/packages/test-support/llm-replay | @deepseek-ai/dsh-llm-replay | @qilin/llm-replay | Replay LLM plugin: short-circuits llm/stream with model chunks reconstructed from a recorded session JSONL… |
| deepseek-harness/packages/test-support/loader-smoke | @deepseek-ai/dsh-loader-smoke | @qilin/loader-smoke | Shared subprocess and direct-agent harness for keyless real-Loader example smoke tests |
| deepseek-harness/packages/todo/tool-todo | @deepseek-ai/dsh-tool-todo | @qilin/tool-todo | Model-facing todo_write tool over the DeepSeek Harness event-sourced session log |
| deepseek-harness/packages/typert/generator | @deepseek-ai/dsh-typert-generator | @qilin/typert-generator | TypeScript project analyzer and model-driven Typert artifact generator |
| deepseek-harness/packages/typert/loader | @deepseek-ai/dsh-typert-loader | @qilin/typert-loader | Loader integration for generated Typert package contributions |
| deepseek-harness/packages/typert/protocol | @deepseek-ai/dsh-typert-protocol | @qilin/typert-protocol | Compiler-independent Remote metadata and Typert provider protocols |
| deepseek-harness/packages/typert/registry | @deepseek-ai/dsh-typert-registry | @qilin/typert-registry | Runtime registry for generated package reflection and Zod schemas |
| deepseek-harness/packages/util/atomic-write | @deepseek-ai/dsh-atomic-write | @qilin/atomic-write | Zero-dependency atomic file replacement: exclusive-create random-suffix temp + rename carrying the… |
| deepseek-harness/packages/util/brand | @deepseek-ai/dsh-brand | @qilin/brand | Type-only Branded<B> nominal-typing primitive for the DeepSeek Harness |
| deepseek-harness/packages/util/home-paths | @deepseek-ai/dsh-home-paths | @qilin/home-paths | Shared filesystem path helpers for the DeepSeek Harness |
| deepseek-harness/packages/util/launch-environment | @deepseek-ai/dsh-launch-environment | @qilin/launch-environment | Immutable DeepSeek Harness launch environment that records which layer supplied each value |
| deepseek-harness/packages/util/native-command | @deepseek-ai/dsh-native-command | @qilin/native-command | Zero-dependency no-shell execFile runner for host-native OS integrations: utf8 stdio capture, abort… |
| deepseek-harness/packages/util/output-retention | @deepseek-ai/dsh-output-retention | @qilin/output-retention | Zero-dependency bounded-retention primitive: ItemRetainer/TextRetainer + neutral notice helpers (what did we… |
| deepseek-harness/packages/util/timeout | @deepseek-ai/dsh-timeout | @qilin/timeout | Zero-dependency timeout/deadline primitive: clampTimeout, deadline, timeoutOf, TimeoutReason (timing +… |
| deepseek-harness/packages/web/tool-web | @deepseek-ai/dsh-tool-web | @qilin/tool-web | Model-facing web tools (web_search, web_fetch) over the DeepSeek Harness web capability seam (ctx.web) |
| deepseek-harness/packages/web/web | @deepseek-ai/dsh-web | @qilin/web | Abstract web access capability seam (ctx.web) for the DeepSeek Harness — search/fetch provider registry,… |
| deepseek-harness/packages/web/web-fetch-http | @deepseek-ai/dsh-web-fetch-http | @qilin/web-fetch-http | Anonymous public HTTP(S) fetch provider for the DeepSeek Harness web capability seam (ctx.web) |
| deepseek-harness/packages/web/web-search-deepseek | @deepseek-ai/dsh-web-search-deepseek | @qilin/web-search-deepseek | DeepSeek-backed search provider (native web_search via the Anthropic-compatible API) for the DeepSeek Harness… |
| deepseek-harness/packages/web/web-search-exa | @deepseek-ai/dsh-web-search-exa | @qilin/web-search-exa | Exa-backed search provider for the DeepSeek Harness web capability seam (ctx.web) |
| deepseek-harness/packages/web/web-search-perplexity | @deepseek-ai/dsh-web-search-perplexity | @qilin/web-search-perplexity | Perplexity-backed search provider for the DeepSeek Harness web capability seam (ctx.web) |
| deepseek-harness/packages/workflow/tool-ralph | @deepseek-ai/dsh-tool-ralph | @qilin/tool-ralph | Model-facing fresh-agent Ralph loop over the workflow and subagent seams |
| deepseek-harness/packages/workflow/tool-workflow | @deepseek-ai/dsh-tool-workflow | @qilin/tool-workflow | Model-facing workflow tool: run a JavaScript orchestration script over ctx.workflowEngine |
| deepseek-harness/packages/workflow/workflow | @deepseek-ai/dsh-workflow | @qilin/workflow | Workflow capability seam: ctx.workflowEngine service, run vocabulary, and workflow/* events |
| deepseek-harness/packages/workflow/workflow-worker-thread | @deepseek-ai/dsh-workflow-worker-thread | @qilin/workflow-worker-thread | worker-thread workflow engine: executes model-written orchestration scripts off the host event loop, bridging… |
| deepseek-harness/packages/workspace/workspace | @deepseek-ai/dsh-workspace | @qilin/workspace | Workspace entity registry (ctx.workspaceRegistry): durable workspace records with validated session… |

## 根包

| 包路径 | 原 npm 名 | 新 npm 名 | 备注 |
|---|---|---|---|
| deepseek-harness | @deepseek-ai/dsh-root | @qilin/engine-root | DSH monorepo 根包(工作区与发布编排;package.json 无 description,目录用途推断) |

## apps

| 包路径 | 原 npm 名 | 新 npm 名 | 备注 |
|---|---|---|---|
| deepseek-harness/apps/cli | @deepseek-ai/dsh | @qilin/cli(P1-S2 定案) | dsh CLI: profile boot, plugin management, and the browser UI alias。原名为裸 @deepseek-ai/dsh(无 dsh- 后缀可去),机械 sed 规则不命中,须与根包一起人工改名 |
| deepseek-harness/apps/web | @deepseek-ai/dsh-web-frontend | @qilin/web-frontend | Web application entry: vite build over the @deepseek-ai/dsh-client-web shell library; dist/ served by… |

## vendor(vendored 上游,保留原名)

| vendor 目录 | 原 npm 名(实测) | 新 npm 名 | 备注 |
|---|---|---|---|
| deepseek-harness/vendor/cordis | @deepseek-ai/cordis | 保留原名(D6) | vendored 上游快照:Meta-Framework for Modern JavaScript Applications |
| deepseek-harness/vendor/cosmokit | @deepseek-ai/cosmokit | 保留原名(D6) | vendored 上游快照:A collection of common utilities |
| deepseek-harness/vendor/group | @deepseek-ai/cordis-plugin-group | 保留原名(D6) | vendored 上游快照:Nested plugin group for cordis |
| deepseek-harness/vendor/hmr | @deepseek-ai/cordis-plugin-hmr | 保留原名(D6) | vendored 上游快照:Hot Module Replacement Plugin for Cordis |
| deepseek-harness/vendor/include | @deepseek-ai/cordis-plugin-include | 保留原名(D6) | vendored 上游快照:Include files in cordis configurations |
| deepseek-harness/vendor/loader | @deepseek-ai/cordis-plugin-loader | 保留原名(D6) | vendored 上游快照:Plugin loader for cordis |
| deepseek-harness/vendor/logger-console | @deepseek-ai/cordis-plugin-logger-console | 保留原名(D6) | vendored 上游快照:Console logger exporter for cordis |
| deepseek-harness/vendor/schemastery | @deepseek-ai/schemastery | 保留原名(D6) | vendored 上游快照:Type driven schema validator |
| deepseek-harness/vendor/timer | @deepseek-ai/cordis-plugin-timer | 保留原名(D6) | vendored 上游快照:Timer service for cordis |

## 统计

- packages 二级包目录:227 个(find deepseek-harness/packages -maxdepth 2 -mindepth 2 -type d | sort 实测)
- 主表映射行数:227(packages)+ 1(根包)+ 2(apps)= 230 行
- vendor 行数:9 行
- name 字段实测自 239 个 package.json(packages 227 + apps 2 + 根包 1 + vendor 9);packages/apps/根包无一缺 package.json

## D5 仓库形态(已定案)

已定案双仓,引擎树落位 /Users/libing/kk_Projects/qilin-engine(独立仓库),本映射表是引擎仓内 rescope 与上游移植的对照依据。上游跟踪采用 git fetch 方式(已在 P0 评审中确认):deepseek-harness/ 内嵌上游仓库(remote deepseek-ai/deepseek-harness,基线 b150a551 = 0.1.1-rc.2),更新时 git fetch origin 后 diff b150a551..origin/master 生成移植清单;deepseek-harness/ 保持只读纪律,永不 commit。
