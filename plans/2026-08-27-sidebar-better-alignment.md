# OpenKylin 侧边栏与 DSH-better-sidebar 对齐 — 调研与方案甄别

> 状态：**等待用户澄清「替换范围」**。
> 本计划只整理事实、设计冲突、可能方案；不动任何源码。

## 0. 用户原话
> 根据这个仓库的侧边栏插件代码 https://github.com/omdsh-dev/DSH-better-sidebar，修改我们项目的侧边栏功能，可以根据仓库的具体实现进行全面替换

## 1. 事实陈述（两侧都已读取）

### 1.1 参考仓库 `omdsh-dev/DSH-better-sidebar`
- 仓库类型：DSH 桌面客户端插件（`dsh web` 内部加载），**不是** Next.js 组件库。
- 入口：`lib/index.js` / `lib/client.js`（构建产物）；源码 `src/` 下 `agent-opens.ts / agent-pty.ts / config.ts / context-types.ts / fs-operations.ts / fs-search.ts / fs-tree.ts / ...`，并自带 `src/client/`（web 端的运行时注入）。
- `package.json` 关键信号：
  - `"dsh.client.inject": ["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-client-locale", "@deepseek-ai/dsh-client-ui-slots", "@deepseek-ai/dsh-client-ui-conversation", "@deepseek-ai/dsh-client-modules"]`，`platform: "web"`。
  - `peerDependencies` 列举了 `@deepseek-ai/cordis@^4.0.1` 以及一整套 `@deepseek-ai/dsh-*` 工作区包（`dsh-agent / dsh-llm / dsh-session / dsh-subagent / dsh-tools / dsh-settings / dsh-client-*` 等）。
  - `dependencies` 包含 `node-pty@^1.1.0`（真实 shell，靠宿主环境预编译）、`@codemirror/*`、`ws`、`dompurify`、`mermaid`、`react-icons`、`rxjs`、`schemastery`、`xterm.js` 相关（由 `@xterm/*` 提供）。
- README 描述的产品形态：**右侧栏 + 底部面板双工作台**，内置 7 个 tab（文件/编辑器/浏览器/终端/Git/任务/侧边对话）+ 6 个 viewer，向生态开放 `ctx.betterSidebar.registerTab / registerFileViewer`。
- 既有生态：README 列了 28+ 第三方 tab 插件（如 `dsh-file-review-tab / dsh-git-remotes / dh-excel-panel / dsh-sidechat / dsh-ssh-tunnel`）。

### 1.2 OpenKylin 当前侧边栏（web-demo）
- 技术栈：Next.js 16 + React 19 + Tailwind v4 + Radix+shadcn + LangGraph SDK；`pnpm@10.26.2`。
- 入口组件：`web-demo/src/components/workspace/workspace-sidebar.tsx`（44 行）。
- 子件：
  - `WorkspaceHeader`（品牌头）
  - `WorkspaceNavChatList`（导航区）
  - `RecentChatList`（`web-demo/src/components/workspace/recent-chat-list.tsx`，440 行，时间桶分桶 + 重命名/分享/导出/删除）
  - `WorkspaceUserInfo`（用户信息）
  - `SidebarResizeHandle`（拖拽宽度 180–360）
- 行为：左侧栏，列出线程（按时间桶 recent3/thisWeek/thisMonth/earlier）；折叠态 ⌘B；宽度持久化 `kworks.workspace.sidebarWidth`。
- 既有计划 `2026-08-27-dsh-alignment-refactor.md` 已规划：工作区分组注册表 + 线程 cwd 不可变 + 引擎自主循环（不是替换整个 UI，是把线程按工作区分组）。

### 1.3 `deepseek-harness/packages/client/ui-sidebar`（仓库内置 DSH 原版）
- 真正的 DSH 官方 sidebar（与 better-sidebar 不同源）：slot 制（`sidebar.brand.mark / sidebar.brand.name / sidebar.workspaces / sidebar.settings / sidebar.footer.action`），是「左侧会话栏底座」而非右侧 VSCode 风格面板；`SidebarRoot.tsx` 210 行负责几何与折叠过渡。
- 与 better-sidebar 的差别：DSH 官方是「会话/工作区列表面板」底座；better-sidebar 是「右侧多 tab 工作台」扩展。

## 2. 关键冲突（用户原话与现实落差）

| 维度 | DSH-better-sidebar | OpenKylin web-demo | 冲突结论 |
|---|---|---|---|
| 平台 | DSH 桌面客户端插件（注入 `ctx.betterSidebar`） | Next.js 16 Web App（直连本地 gateway） | **不能**直接 `npm install dsh-better-sidebar` 复用——没有 `cordis`/`dsh-runtime` 宿主 |
| 形态 | 右侧多 tab 工作台（文件/编辑器/终端/Git/浏览器/任务/侧边对话） | 左侧会话/线程列表面板 | 两者功能目的不同——better-sidebar 不能直接替代 OpenKylin 的左侧栏 |
| 终端 | `node-pty` 真实 shell，需宿主二进制 + 构建脚本 | 无对应能力（OpenKylin 后端在 `app/` Python gateway 里做沙箱 shell） | 即便做右侧 tab，终端要单独写一个 web-pty 适配 |
| 文件树/Git | 直读宿主机文件系统 + 本地 git CLI | OpenKylin 走 server-side sandbox 文件 API（`qilin/sandbox/tools.py`）；git 在后端非核心能力 | 走 web 直读需新增 Tauri/Electron 通道，纯浏览器内做不到等价 FS 视图 |
| 状态 | 走 DSH session / workspace 实体 | 走 LangGraph threads + 后端 threads_meta | 数据层契约不同 |
| 生态 | 28+ tab 插件 | OpenKylin 暂无对应扩展机制 | 引入会同时引入新加载机制与运行期 |

## 3. 「全面替换」的三种合理诠释（待用户选）

| 方案 | 描述 | 工作量 | 与既有计划的关系 | 风险 |
|---|---|---|---|---|
| A. **整体对齐** | 在 web-demo 内完整复刻 better-sidebar 的右侧双工作台（文件/编辑器/终端/Git/浏览器/侧边对话 7 tab + viewer 协议 + 插件注册 API），作为新右侧栏组件，独立于现有左侧栏 | 大（4–6 周起步） | 与 dsh-alignment-refactor 并行而非冲突，但要新增大量 web-only 适配（web-pty、WebContainer 风格的浏览器内 FS） | 文件系统层在纯 web 下根本走不通（沙箱外 FS）；终端要在浏览器内集成 pty 替代品；范围远超 UI |
| B. **选择性借鉴** | 只提取 better-sidebar 的「会话级 tab 隔离 / tab 拖拽分栏 / 固定到全局 tab」等 UI 行为模式，应用到 OpenKylin web-demo 的左侧会话栏，让 `RecentChatList` 与「会话右侧面板」具备这些能力 | 中（1–2 周） | 替换 `2026-08-27-dsh-alignment-refactor.md` P3 阶段的部分目标（归档/拖拽），其它分组与 cwd 注册表保持 | 视觉/交互质量提升明显，范围可控 |
| C. **新增侧栏 tab 协议** | 在 OpenKylin web-demo 内部定义一个轻量的 `ctx.toolsSidebar`（自命名）服务：暴露 `registerPanel({ id, title, render, scope })`，先用 OpenKylin 自有逻辑内置「文件 / 任务 / 子代理 / 变更 / Todo」5 个面板，右侧栏按会话级隔离 | 中-大（2–3 周） | 与 dsh-alignment-refactor P3「侧栏分组」互补而非替代；可作为后续扩展点 | 需要设计新 API、保持向后兼容 |

## 5. 验证基线
- 现有服务 `http://localhost:28080`（`web-demo/server.js`，dev=true）可热更新 → UI 改动刷新即可见。
- 后端 `localhost:28081`（gateway）健康检查 `GET /health` → `{"status":"healthy","service":"qilin-gateway"}`。
- 截图存档已有：`/.dsh-vision-router/artifacts/.vision-run-mtav784r-.../workspace-sidebar-fixed-...png` 等。

## 6. 待办
- [ ] 用户回复「替换范围」（方案 A / B / C / 其它）
- [ ] 根据回复补全设计章节（架构/数据流/错误处理/测试），并写入 `docs/superpowers/specs/<日期>-<topic>-design.md`
- [ ] 用户书面审过 spec 后再交 `writing-plans` 拆任务