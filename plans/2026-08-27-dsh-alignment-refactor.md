# DSH 对齐重构 · 工作区注册表 + 引擎自主循环 + 侧边栏分组

> 状态：草案（OpenKylin 现状小节待两份子代理分析报告回填）
> 参考源码：本仓库 `deepseek-harness/`（完整 DSH 源码，非安装产物反推）
> 约束：`.qilin/users/<uid>/threads` 既有数据零破坏；旧线程迁移后必须可见且可用。

## 0. 移植范围判定（哪些 DSH 机制进 OpenKylin）

| DSH 机制 | 移植 | 理由 / 裁剪 |
|---|---|---|
| Workspace 实体注册表 | ✅ 全量 | 侧边栏分组的地基；uuid id、canonical path、持久顺序、header 归组 |
| 线程 header cwd 不可变 | ✅ 全量 | 创建时定死；无任何迁移 API |
| sandbox/mode 会话事件折叠 | ✅ 裁剪版 | OpenKylin 沙箱现为单机全放行 → 先实现「事件记录+折叠解析」，执行端分档后接 |
| Ungrouped / archiveSession | ✅ 全量 | UI 分组完备性所需 |
| 手动排序 insertBefore / Last-updated 双模式 | ✅ 全量 | DSH sidebar 核心交互 |
| goal 领域(active/paused/blocked/complete + CAS) | ✅ 全量 | 引擎自主循环的状态地基 |
| activation(armed/disarmed) 进程本地 | ✅ 全量 | 重启后目标保留但不自动续跑——安全红线 |
| goal-round-driver | ✅ 裁剪版 | QiLangGraph 流式循环上按 idle 边界驱动；人工消息不计数照搬 |
| todo_write 整表快照 | ❌ 不移植 | web-demo 已有自有 todo 实现 |
| jobs 注册表 / subagent 森林 | ⏸ 后续 | 本轮不做，接口留缝 |

## 1. DSH 权威语义摘录（移植依据，出处 deepseek-harness/packages/*/src）

### 1.1 workspace/workspace/src/types.ts（全文已核）
- `WorkspaceId = Branded<'WorkspaceId'>`：**uuid，永不使用路径当 id**（路径归一会改写，引用锚点必须稳定）。
- `Workspace { id, path(canonical realpath), title(默认 basename，允许重名), createdAt, updatedAt, sessionIds[] }`。
- `sessionIds`：手动拥有顺序；attach 前插、`insertSessionBefore` 显式移动；**活动永不自动重排**。同步过滤非法成员（缺 header/cwd 失效/不匹配），下次变更时持久修剪。
- `status()`：实时检查 `'ok' | 'missing-dir'`，目录缺失不改记录（可能只是临时移走）。
- `detachSession` 幂等；永不触碰会话日志本体。

### 1.2 workspace/src/index.ts bootstrap（行号锚点 88-363）
- 首启读取 `sessionPersistence.list()` 的 **header id/cwd/createdAt 三字段**做历史归组，写 initialized 标记最后落盘（半写可安全复用）。
- create/delete **先写 pending-mutation 标记**再动记录/顺序；失败回滚先还原记录再清标记；双失败 fail loud。
- `delete(id)` 仅删注册记录+顺序项+会话账户；目录、文件、会话日志不动 → 会话转 Ungrouped。
- 存储域不可用则插件 pending，绝不提交空 initialized 标记。

### 1.3 goal/goal/src/types.ts
- `GoalPhase = active | paused | blocked | complete`；blocked 必带 `{ code(lower-kebab), explanation }`。
- `GoalRef { id, revision }`：一切变更的 CAS 封栏；陈旧引用拒绝。
- `GoalView`：snapshot + `roundsStarted` + 时间戳 + `activation('armed'|'disarmed')`。
- **activation 是进程本地授权，从不持久化、不在投影中**；每次 `session-start` 一律 disarm。
- 投影 `GoalProjection` 故意不含 activation —— 持久面只见 durable 相位。

### 1.4 goal-round-driver
- 续跑 prompt 模板（prompt.ts 全文）：`<goal_round>` 包裹 + objective JSON.stringify 防注入 + `Round: n/max` + 工作区与工具结果为准 + 要求证据后才许 complete。
- 人为消息不消耗轮数配额；混合批次中人优先、自动让位。
- idle 检查点：checkpoint mutation → 预留 n+1 → flush 持久 → 复验 revision 与竞争输入 → 入账才计数。
- 取消不留活口：取消发生时把 armed goal 转 paused，防自动复活。
- 自报 blocked 政策门槛：同条件连续 ≥3 轮（配置值），必须写明具体阻断条件。

### 1.5 client/ui-workspace/src/client/tree.ts（前端推导层权威）
- 全部为纯函数：`deriveGroups(list, workspaces, archivedSessionIds, view): GroupNode[]` / `deriveFlat()`(平铺模式，严格最新在前) / `deriveSearchResults()`(元数据即时匹配+250ms 防抖内容搜索合并去重，上限 20 条)。
- 常量约定：`UNGROUPED_KEY = ''`、`UNGROUPED_LABEL = 'Ungrouped'`。
- GroupNode 含 `{ key, cwd, label, sessionCount, expanded, containsCurrent, sessions[] }` —— expanded 由 view.expandedGroups Set 提供；containsCurrent 用于高亮当前会话所在组。
- 归组排序接受 `view.ungroupedOrder` 注入；会话行按 recency 排（byRecency），Manual 模式顺序来自 workspace sessionIds 账户序。
- 相对时间分桶 `relativeTime(): 'now'|minutes|hours|days|months|years'`。
- 移植形态：web-demo 新建 `src/lib/workspace-tree.ts` 承载同构纯函数（TS 直接可移植，去 subagent 折叠逻辑）。



### 1.6 goal/goal/src/domain.ts（动词与错误码词汇，API 设计直接对齐）
- 七动词：`create | edit | pause | resume | complete | block | clear`。
- 变更事件为**整快照**（post-change 全量 GoalSnapshot + roundsStarted + 时间戳）；clear 是带 `cleared: GoalRef` 的版本化 tombstone；fold=last-wins。
- 轮次归因 `GoalMessageSource { kind:'goal', goalId, revision, round }` —— 计数递增的唯一凭据。
- 九个稳定错误码（移植为 API 错误响应 code）：`GOAL_AGENT_NOT_LIVE / GOAL_NOT_FOUND / GOAL_ALREADY_EXISTS / GOAL_STALE_REVISION / GOAL_INVALID_OBJECTIVE / GOAL_INVALID_MAX_ROUNDS / GOAL_INVALID_BLOCK_REASON / GOAL_INVALID_EDIT / GOAL_INVALID_TRANSITION`。
- `GoalChanged { operation, ref, goal? }` 为变更后广播形态（OpenKylin 对应为 SSE 推送载荷）。

## 2. OpenKylin 现状（待子代理报告回填）

### 2.1 后端（qilin/ + app/）—— 已取证（子代理 08caf106 + 主线复核）

**线程生命周期**：无独立 `/api/threads` CRUD；线程经 `app/gateway/routers/runs.py:38-70` 的 SSE 流式接口在 `start_run()`（`app/gateway/services.py:1204-1388`）中隐式物化——从 `config.configurable.thread_id` 取 ID（缺省生成 UUID），写 threads_meta 首行 + RunRow（部分唯一索引保证每线程一个 pending/running）+ `asyncio.create_task(worker)`。运行循环在 `qilin/runtime/runs/worker.py:568-624`（bridge/manager/context/graph input/checkpoint/journal），RunManager 有心跳与孤儿恢复。

**引擎已有每线程数据目录**：`.qilin/threads/{thread_id}/user-data/{workspace,uploads,outputs}`（`qilin/config/paths.py:104-128`），middleware 注入 ThreadDataState 三路径（`qilin/agents/middlewares/thread_data_middleware.py:81-118`），sandbox 把 `/mnt/user-data/workspace/*` 映射进去、shell 命令以字符串前置 `cd <workspace> &&`（`qilin/sandbox/tools.py:1302-1314`）。**这是暂存区概念，非 DSH「真实外部项目目录」** —— 与注册表分层并存，边界写入 §3.7。

**关键更正**：`user_workspace_path` 在后端 grep 为零命中——它是纯前端状态（threads-api 测试锁定的是前端类型形状）。前端传的 context 到 LangGraph config 之间该字段被丢弃。→ 重设计可自由定义新契约而不破坏后端；旧字段仅作前端兼容读取。

**权限现状**：非全放行但分散——run 级 thread ownership 校验（services.py:1214-1240）、ID 字符集白名单（paths.py:27-37）、ACP workspace 写拒绝（sandbox/tools.py:888-899）、LocalSandbox 杀进程组超时（local_sandbox.py:556-632）。无 DSH 式 read-only/workspace-write 模位 → 沙箱事件化先做记录+折叠层（§0 裁剪理由成立）。

**编排现状**：multi 模式 orchestrator+worker（tests/test_mode_switch.py:128-149）、subagent 并发/失败/共识矩阵（test_orchestration_patterns.py:51-100）——goal 轮次驱动（P6）挂 run worker 的 idle 终态边。

**迁移敏感点清单**（子代理）：所有按 thread_id 查询 runs/threads_meta/checkpoints 的路径不受影响（加列不改键）；SSE stream/wait/cancel 路由按线程语义照旧；run 唯一约束按 thread 而非 workspace（同工作区多线程天然允许）；workspace_sessions 无外键 → 孤儿靠业务修剪（已实现 _prune_account）。


### 2.2 前端（web-demo）—— 已取证（子代理 82c5c3da）

**侧栏现状**：`workspace-sidebar.tsx` → `RecentChatList`；数据来自 TanStack Query `useThreads()`（hooks.ts:1146-1210，LangGraph threads.search 分页 50/页、按 updated_at desc、窗口聚焦不刷新）；分组是**时间桶** recent3/thisWeek/thisMonth/earlier（recent-chat-list.tsx:109-133），非工作区。行操作 rename/share/export/delete；无 archive/拖拽/Show more。

**线程创建流**：无显式 POST；SDK `useStream` 首次 submit 时自建线程（hooks.ts:333-355），thread id 经 onThreadId/onCreated 回填。context 含 `user_workspace_path` 等（:900-915）。→ **cwd 捕获的传参通道 = stream submit 的 configurable**（后端 start_run 从 config.configurable 取值已接线）。

**状态管理基座**：workspace-layout-context 管右面板/历史折叠/settings 节（含 runtime）；侧栏折叠在 SidebarProvider cookie（⌘B），宽度 ResizeHandle 存 localStorage(180-360)。

**无既有 DnD**：需引入 @dnd-kit/core+sortable 或先用上移/下移菜单替代（P3 决策点）。

**P3 改造文件清单**（子代理预估 + 主线校准）：改 recent-chat-list / workspace-layout-context；新建 core/workspaces hooks（getWorkspaces/createWorkspace/moveThread/archive mutations）与 lib/workspace-tree.ts（tree.ts 直译）；command-palette 加「新工作区」动作。

**P3 实施进度（回填于第 7 轮）**：
- ✅ P3a `lib/workspace-tree.ts` 纯函数直译 + 13 用例（3a2d0af）。
- ✅ P3b `core/workspaces/{types,api,hooks}.ts` 注册表数据面 + 9 用例（e167f93）。
- ✅ P3c 侧栏重写：`sidebar-inputs.ts`（线程×树投影组装）/`view-state.ts`（collapsedGroups 折叠记忆，方向取「仅记主动折叠」使新组默认展开）；`recent-chat-list.tsx` 全量替换为 deriveGroups 双级树——组头折叠/计数/containsCurrent 着色、Ungrouped 尾随、行菜单增 归档+移动到工作区 submenu+组内上移/下移（相邻交换语义）、组头菜单 重命名/上移/下移/删除登记（解绑不删目录，hint 文案）、底部 ARCHIVED(n) 管理区配取消归档。i18n 三文件同步加键。vitest：builder/view-state/组件渲染共 15 新用例；Playwright 真机走查 `tests/e2e/workspace-groups.spec.ts`（build+chrome 实渲染断言分组/折叠持久化/归档隐藏 + 截图留证）。顺带修复 playwright.config webServer 注入 PORT 而非 WEB_DEMO_PORT 导致自起服务必撞 28080 的既有缺陷。拖拽按决策点以上移/下移替代。验证基线：vitest 336/336、eslint 0 error、tsc 0 error。

**目标② 沙箱模式事件化（裁剪版，回填于第 8 轮）**：
- ✅ 事件记录层：`sandbox_mode_events` 表（0012 迁移；append-only，自增 id 即折叠序）+ `qilin/persistence/sandbox_mode/{model,sql}.py`（`SANDBOX_MODES` 词表逐字对齐 DSH `SandboxMode`：read-only/workspace-write/danger-full-access；`DEFAULT_SANDBOX_MODE='danger-full-access'` 保持现单机全放行行为）。已修 create_all 注册缺口（models/__init__ 补 SandboxModeEventRow 导出）。
- ✅ 折叠解析：`folded()` 取日志序最后一条 = DSH permission-presets 的 last-write-wins 语义；无事件线程解析为默认值（resolution total，不报错）。
- ✅ REST 面：`/api/threads/{thread_id}/sandbox-mode` GET（折叠值+defaulted 标记）/ POST（追加事件，require_existing 反枚举）/ GET /events（原始日志升序）；GET 读容忍未登记遗留线程、POST 严格拒绝他人线程。权限 threads:read/write，错误码 SANDBOX_MODE_INVALID / SANDBOX_MODE_STORE_UNAVAILABLE。
- ✅ 验证：新增 4 pytest 用例；空库 bootstrap→head 形状核对；纯 Alembic 链 upgrade/downgrade/re-upgrade 往返；仓储往返断言。全后端 706 passed。
- ⏳ 后续：执行端按折叠值分档执行（依赖沙箱执行器分档改造）、前端开关 UI、SSE 变更广播并入 P5 管线。

**P5 goal 领域（回填于第 9 轮，核心已落）**：
- ✅ 持久层 `goal_changes`（0013 迁移）：append-only 整快照 change log，payload 贴 DSH GoalChangeMeta 形态（{"goal":snap,"created_at"} / {"cleared":ref}）；revision 独立成列供 CAS 头校验；自增 id 即 fold 序。
- ✅ 七动词 REST `/api/threads/{tid}/goals`（POST=create、PATCH=edit、/pause /resume /complete /block /delete=clear）：CAS ref 校验在写事务内重读 head；转移矩阵照搬 DSH（pause 仅 active；resume 可 active/paused/blocked 且 activearmed/预算耗尽拒绝；complete 三相可达；block 仅 active 必带 reason{code,message}；clear 出版本化 tombstone）；create 替换 completed 目标为新 id revision 1。错误码九词全接：404 GOAL_NOT_FOUND / 409 ALREADY_EXISTS·STALE·TRANSITION / 400 INVALID_*。
- ✅ activation 进程字典 `app/gateway/goal_activation.py`：create/resume→armed，其余→disarmed，读取缺省即 disarmed（重启红线）。不入库。
- ✅ SSE 整快照广播：`GoalChangeBroker`（app.state.goal_broker，per-(user,thread) 订阅队列、慢消费者丢旧保新）+ GET /goals/stream (text/event-stream)；载荷 {operation, ref, goal|cleared}。
- ✅ 载荷验证：13 个 pytest 用例（创建/重复 create/edit CAS 暴改拒绝/pause-resume 循环/双 resume 409/block reason 校验/clear tombstone 后重建 revision 重置/跨用户 404/SSE 广播整快照）。后端全量 719 passed；ruff clean。
- ⏳ P6 待做：GoalRoundDriver 挂 run worker idle 终态边、prompt 注入模板对齐 DSH prompt.ts、rounds_started 仅由 driver 注入递增、blocked 三连安全阀（GOAL_BLOCK_AFTER_ROUNDS 配置）。

**P6 goal 轮次驱动（回填于第 10 轮，内核已落）**：
- 取证修正：worker 现存旧「评审员式」goal 续跑（qilin/runtime/goal.py + runs/worker.py 的 continuation caps / no-progress 阀），目标③即以 DSH armed-gate + `<goal_round>` 注入语义取代之；DSH `roundsStarted` 记账真相 = fold.ts `applyGoalEvent` 对带 source{kind:'goal',round} 的 user message 入日志时校验 round==counter+1 后递增（消息即凭据）。
- ✅ 存储侧 `admit_round`（sql.py）：active+同 id/revision+round==rounds_started+1+≤cap 全部 fail-closed；引入 `_context` 读法（最近非 round 行=goal 头/全任意行最新计数），所有七动词 guard/CAS/projection 均改为上下文语义，并发 admit 不再可被 mutation 用旧计数回滚（事务内实读 rounds_now）。
- ✅ `app/gateway/goal_round_driver.py`：prompt 渲染逐字移植 prompt.ts（测试锁死段落快照）；`drive()` 静默闸门：无目标/clear/paused/disarmed→drop，预算耗尽→自动 block(round-limit, DSH 同文案)，注入成功后才 admit 记账，投递失败不污染计数。
- ✅ tests/test_goal_round_driver.py 七用例（prompt 快照 parity/三 drop 分支/预算耗尽 block 文案/成功注入两连轮记账/失败不记账）。后端全量 726 passed，ruff clean。
- ✅ P6b（第 11 轮）：idle 终态边接线完成——复用 worker 现有 `ctx.on_run_completed` 单槽钩子，`compose_run_completed` 链式组合 scheduled_task 观察器与 goal driver 观察器（逐环异常隔离）；注入通道走 `launch_scheduled_thread_run`（internal caller），metadata["goal_round"] 携带 {kind, round, id, revision} 归因；轮次成功后经 goal_broker 广播 `operation='round'` SSE；feature flag `OPENKYLIN_GOAL_ROUND_DRIVER`（默认关，观察器无条件装配、flag 运行期可翻）。tests/test_goal_round_wiring.py 6 用例。后端全量 732 passed，ruff clean。

**P6c 终态语义完善 + P6 验收 e2e（第 12 轮）**：
- ✅ 状态闸门（§1.4「取消不留活口」）：仅 success 触发 drive；interrupted 且 armed→自动 pause 并广播，杜绝人离开后被后续 idle 边复活；error/timeout 不驱动不改相位（防错误循环自旋轮次）。
- ✅ blocked-limit 广播补全：driver 自动 block 绕过 REST 层，wiring 补发 operation='block' SSE，否则 UI 停显 active 相位。
- ✅ 安全阀结构钩子 `GOAL_BLOCK_AFTER_ROUNDS`（默认 3，<1 关闭）：change log 连续同 reason.code block 段计数≥阈值即停注；模型端自报通道未接（P8+），当前无 block 行时为无害空转，钩子先行就位。
- ✅ 顺带修复：history() 对 round 行 KeyError；e2e 揭示的广播缺口。
- ✅ **P6 验收达成（计划 §5：模拟 LLM 半途停止→自动续跑）**：tests/test_goal_loop_e2e.py——REST create(armed,cap=1)→observer(success)→`<goal_round>` 注入+归因 metadata+round SSE+rounds_started=1→第二次完成边预算耗尽自动 block(round-limit)+block SSE→此后不再驱动；interrupted 停车/再武装复跑、error 保相位不驱动两配套用例。goal 域合计 29 用例。
- 后端全量 735 passed；本轮触达文件 ruff clean（routers/files·workspaces 存量 lint 债非本轮引入，保持原样）。

**目标③完成判定（第 12 轮）**：存储(0013+context 读法)→七动词 CAS API→activation 进程位→SSE 整快照/round/block 广播→驱动内核(逐字 prompt+静默闸门)→idle 边接线(flag)→终态语义闸门→验收 e2e 全链闭环。裁剪项与既存差异如实登记：prompt 模板逐字一致；事件溯源以表代日志（§5.3）；安全阀信号源待模型端；旧评审员循环仍由 legacy /goal PUT 通道独立驱动（键域不同天然互斥），收敛退役留 P8 清理单。

**M2 回填接线补全（第 12 轮收尾）**：取证发现 `is_initialized/mark_initialized` 原语已备但无调用方——目标⑤「平滑迁移」闭环缺口。✅ `app/gateway/workspace_backfill.py` `ensure_user_backfilled`：首询触发、逐用户 once 标记短路；distinct cwd→幂等 create 登记+attach 挂账；cwd 列缺失时 metadata.cwd 兜底（M3 冻结语义）；NULL-cwd 不虚构，保持 Ungrouped；失败不落标记可重试。挂点=workspaces 列表路由入口（用户首次打开侧栏即完成迁移，等同 DSH 首启 UI 语义）。tests/test_workspace_backfill.py 2 用例（推导分组+Ungrouped 保全 / 二次列表标记短路零重复）。后端全量 737 passed。


### 2.3 已知存量事实（主线取证，含 SQLite 实测）
- 本地键：`kworks.thread-workspace-path.<threadId>`（""=显式默认工作区哨兵）、线程页 onStart 时写入 `saveThreadWorkspacePath`（input-box.tsx:568 已删挂载点，page.tsx:78 保存链仍在）。
- 数据目录：`.qilin/users/<uid>/{threads,agents,skills,memory.json}`、`.qilin/data/qilin.db`(SQLite+WAL)、`.qilin/.qilin/checkpoints.db`、`.qilin/channels`、`.qilin/integrations/skills`。
- 测试锁定：threads-api.test.ts 两断言（AgentThreadContext 含 user_workspace_path 字段；thread.submit context 携带该键）——重构中契约保留。
- **ORM 与迁移工具链：SQLAlchemy + Alembic**（qilin.db 存在 alembic_version 表）→ 所有 schema 变更走 Alembic revision，禁裸 ALTER。
- `threads_meta`：`thread_id PK / assistant_id / user_id(idx) / display_name / status(idle|interrupted|…) / metadata_json(JSON，title 在其中) / created_at / updated_at`。当前 5 行演示数据。
- `runs` 表：run_id/thread_id/operation_kind/model_name/status/stop_reason/message_count/first_human_message…——goal 轮次的天然记账邻居（round 归因可挂 runs.metadata_json）。

## 3. 目标架构（OpenKylin 语境落地）

### 3.1 后端新增表（SQLite，qilin.db）
```sql
-- 工作区注册表（DSH dsh-workspace 对齐）
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,            -- uuid4，非路径
  canonical_path TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE workspace_order (   -- 持久工作区顺序（单列序列）
  ord INTEGER PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id)
);
CREATE TABLE workspace_sessions (-- 会话账户：手动顺序=prepend 语义即 list 反序
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  thread_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  UNIQUE(workspace_id, thread_id)
);
CREATE TABLE workspace_meta (    -- initialized 标记 + archive 全局集合
  key TEXT PRIMARY KEY, value TEXT
);

-- threads 表增列（迁移 M1，ADD COLUMN 兼容旧行）
ALTER TABLE threads ADD COLUMN cwd TEXT;          -- NULL=旧数据未分组
ALTER TABLE threads ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;

-- 自主循环（goal/change 事件的持久形态；OpenKylin 用表而非事件日志裁剪见 §5.3）
CREATE TABLE goals (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(thread_id),
  revision INTEGER NOT NULL,      -- CAS 封栏，初始 1
  objective TEXT NOT NULL,
  phase TEXT NOT NULL CHECK(phase IN ('active','paused','blocked','complete')),
  blocked_code TEXT, blocked_reason TEXT,
  max_goal_rounds INTEGER NOT NULL,
  rounds_started INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
```

### 3.2 线程 cwd 捕获（依后端实证修正）
- 无独立创建 API → cwd 在 **`start_run()` 首次物化 threads_meta 行时一次性写入**：运行请求 body 的 `config.configurable.workspace_id`（推荐，指向注册表实体）→ 服务端解析 canonical path 落 threads_meta.cwd；此后无更新路径。
- 请求未带 workspace_id → cwd=NULL（Ungrouped）。注册表 attach 由服务端在新线程落行后自动执行（cwd 已验证相等）。
- 兼容：已删除的输入框 selector 曾维护的 `user_workspace_path` 前端字段退役；本地存储 `kworks.thread-workspace-path.*` 冻结只读一个版本周期（M3）。

### 3.3 run context 契约保持
- `user_workspace_path` 字段名不变（测试锁定的原因）——语义从「前端临时传」变为「后端 threads.cwd 的影子输出」；过渡期前端缺省不传时由后端以 threads.cwd 补齐。

### 3.4 API 面（P1d 已实现，全部挂 /api/workspaces，权限复用 threads:read/write/delete）
```
GET    /api/workspaces                     # 持久顺序列表(含 position 与 session_ids 账户序)
POST   /api/workspaces                     # {path,title?} realpath 校验、重路径幂等返回既有
PATCH  /api/workspaces/{id}                # {title}
POST   /api/workspaces/{id}/reorder        # {before_id?} DOM-insertBefore, 归位即不写
DELETE /api/workspaces/{id}                # 仅删注册; 线程原样→Ungrouped
GET    /api/workspaces/{id}/threads        # 账户序 thread_ids
POST   /api/workspaces/{id}/threads        # {thread_id} 显式归组(注册表权威, 不复核 cwd)
DELETE /api/workspaces/{id}/threads/{tid}  # 幂等分离; cwd 不可变不动
POST   /api/workspaces/{id}/threads/{tid}/reorder  # {before_thread_id?}
PUT|DELETE /api/workspaces/archive          # {thread_ids[]} 全局归档集合/恢复
GET    /api/workspaces/tree                # 侧栏投影: workspaces(Ungrouped)/archived 三桶 id 列表
```
投影规则：组成员=账户∩存活 header−archived（**只滤 header 消失, 不做 cwd 复核**——注册表权威对齐 DSH 树推导）；Ungrouped=归属且可见且未被任何组认领。

### 3.5 前端（对齐 client-ui-workspace README 描述的行为表）
- 侧边栏两级树：workspace 行（目录 basename + missing-dir 状态点）→ 会话行；顶部 Ungrouped 与「全部平铺」切换。
- 排序双模：Manual（拖拽持久，Host 写 workspace_sessions.position）/ Last updated（完全重排+即时晋升一次）。
- 展开记忆每 workspace 收合态；默认显示 5 条 + Show more。
- Delete workspace 确认框明示保留边界；Archive 无确认（非破坏）+ 可从 Ungrouped 过滤器恢复。
- 会话行 Fork/重命名不在本轮（OpenKylin 无 fork 语义），仅排序+archive。
- 新建会话入口收敛：工作区行 hover 出「+」（替代已删除的输入框 selector）；全局新建按钮走默认(Ungrouped)。

### 3.6 引擎自主循环（Round Driver@OpenKylin）
- 触发边界：SSE 流结束 + 无排队用户输入 = idle 点；gateway 内 GoalRoundDriver 订阅该边界。
- 续跑投递：复用现有 chat 补全通道，以 `<goal_round>` 系统包裹消息注入（模板逐字对齐 DSH prompt.ts）。
- 轮次记账：只有 driver 注入的消息递增 rounds_started；人在循环中的发言零消耗。
- 安全阀：连续 3 轮 blocked 门槛（`GOAL_BLOCK_AFTER_ROUNDS` 配置）；重启后 goals 表相位保留但 driver 不武装——需人类在 UI 按 Resume 才续跑（activation 位保存在 gateway 进程内存字典）。
### 3.7 概念边界：引擎暂存区 vs 注册表工作区（后端取证后新增）
- `.qilin/threads/{tid}/user-data/workspace` = 引擎沙箱暂存区（产物/上传/输出落点，挂载 `/mnt/user-data`）——**不动**。
- 注册表工作区 = 真实外部目录的分组与授权锚点（DSH 语义）。P1-P2 阶段仅承担**归组与 UI**；授权接线（sandbox 增发真实目录读写）留待 §0 jobs/subagent 同批后续。
- 命名纪律：代码中引擎侧沿用 `workspace_path`（既有），注册表侧新名 `registry workspace` / 表前缀 `workspace_*` 已就位。

## 4. 平滑迁移方案（.qilin 零破坏）

M1 schema-additive：全部变更为 Alembic revision（ADD COLUMN / CREATE TABLE），SQLite WAL 在线完成；SCHEMA 单调推进。
M2 回填：首启若无 workspace_meta.initialized → 以扫描 users/<uid>/threads 的会话头（对应 DSH 读 header 三字段的等价物）建索引；cwd 全 NULL → 全部入 Ungrouped，不虚构工作区。threads.cwd 列加 `(user_id, cwd)` 组合索引供分组投影。
M3 localStorage 变迁：`kworks.thread-workspace-path.*` 冻结读取一个版本周期（仅作只读兜底展示），新真源是 threads.cwd；`recent-workspace-paths` 已随组件删除。
M4 回滚安全：迁移前 `.qilin/data/qilin.db.bak-*` 惯例延续，脚本自动备份到 `.bak-pre-dsh-align`。

## 5. 阶段切分（每阶段独立可交付可回归）

| 阶段 | 内容 | 验收 |
|---|---|---|
| P1 后端地基 | workspaces 五表+迁移 M1/M2+API CRUD+threads.cwd 不可变写入 | pytest 迁移用例；旧库升级演练 |
| P2 分组读模型 | GET /api/threads?grouped=1 投影 | api 快照断言 |
| P3 前端侧边栏 | 树形分组/双排序/drag/archive/展开记忆 | Playwright 走查+vitest 组件测试 |
| P4 新建收敛 | 工作区行内新建+默认 Ungrouped；去孤儿入口 | 手动回归 |
| P5 goal 领域 | goals 表+CAS 动词 API+SSE 广播 | pytest 生命周期矩阵 |
| P6 轮次驱动 | idle 驱动+prompt 注入+人消息豁免+blocked 门槛 | e2e：模拟 LLM 半途停止→自动续跑 |
| P7 文档/清理 | README 差异表、验收清单第 9 节、删除 TBD 段 | doc 一致性 |

## 6. 待决问题（不阻塞 P1-P3）
- SQLite 并发写与 gateway 多实例（现单实例假设是否成立？）
- threads.cwd 对历史非空情形是否需要 CLI 手动指定工具？（默认：一律 Ungrouped，人工 GUI 归组即可，量少）


---

## 7. 工作区体验第二轮（第 13 轮起，目标新开）

### 7.1 侧边栏工作区节标题（截图一）—— ✅ 第 13 轮 (79f8b8f)
- 「历史任务」之上新增独立节：标题 + 右侧三个线性图标按钮（搜索🔍 / 排序↕ / 添加工作区⊞）。
- 搜索：就地过滤会话行（大小写不敏感），组名匹配也保留空组；排序：注册表手动序 ↔ 最近更新（组内最新成员降序，Ungrouped 钉尾、平局稳定），`kworks.workspace.sortMode` 持久化；添加：路径+可选标题 Dialog 走既有 create API。
- `sortWorkspacesByRecent` 纯函数 + 2 单测；vitest 338/338。

### 7.2 新任务输入区工作区下拉（截图二）—— ✅ 第 13 轮 (417ead4)
- InputBox 仅 isNewThread 模式渲染 Folder+title+chevron 下拉：已登记工作区清单 / 未分组（清除选择）/「添加工作区…」内联 Dialog。
- 选择走既有 context 管线：AgentThreadContext 新增 `workspace_id`，连同 `user_workspace_path` 一并 localStorage 记忆为新建默认。

### 7.3 引擎目录机制对齐（分析定稿，实施待下轮）
**取证**：前端 hooks 已向 runs.config.context 透传 user_workspace_path；但后端 grep 零消费——即链路在前端完备、后端断开。现状引擎锚点=每线程暂存区 `.qilin/threads/{tid}/user-data/workspace`（容器挂 `/mnt/user-data` + LocalSandbox `cd` 前缀），uploads/outputs 为文件上传下载落点。

**决策（结论）**：
1. 绑定了注册表工作区的线程：**真实外部目录成为执行主目录**（LocalSandbox cd 锚点直接指向 canonical_path）；未绑定线程/无注册表环境保持暂存区行为不变（平滑兼容）。
2. `/mnt/user-data` **降级为兼容隔离层**：uploads/outputs 落点保留；workspace 子目录仅对未绑定线程作为默认 cd 目标。容器执行器 bind-mount 真实目录属运行时改造，单列依赖。
3. 授权分档接入目标②的 sandbox_mode 折叠值：danger-full-access 维持现行为；workspace-write 允许写 cwd；read-only 注入只读约束。深度写监控后置。
4. 落库闭环：start_run 消费 configurable 的 workspace_id/user_workspace_path → threads.cwd 创建时一次性写定（不可变语义）→ 归组投影天然生效。

**验证面**：ThreadDataMiddleware 单测（优先级矩阵：绑定>暂存）、LocalSandbox cd 锚点用例、start_run cwd 落库断言、后端全量门禁。

### 7.4 引擎目录机制实施（第 14 轮，✅ 全链闭环）
- **白名单放行**：`_CONTEXT_CONFIGURABLE_KEYS` 增加 `workspace_id`（客户端仅声明引用；授权在解析端）。刻意不放行 `user_workspace_path`/`workspace_cwd`——路径不可由客户端声明。
- **server-owned 注入**：start_run 读取 configurable.workspace_id → 经 owner 校验从 registry 解析 canonical path → **无条件覆盖**写入 `configurable["workspace_cwd"]` + `context["workspace_cwd"]`（伪造免疫）；未绑定/解析失败写空串=回退暂存区。threads.cwd 落库与 auto-attach 复用既有 `_ensure_thread_metadata`（5 用例矩阵已在）。
- **middleware 锚点**：`workspace_cwd` 指向存在的目录 → `workspace_path` 切换为真实目录（uploads/outputs 保持每线程暂存区）；键缺失/目录不存在/OSError 三态全部静默降级暂存区并 warning。
- **前端无需改动**：B 切片已把 workspace_id 放入 context，spread 后随白名单自然抵达。
- 验证：tests/test_workspace_anchor.py 5 用例（白名单词汇/绑定锚定/unbound 回退/ghost 回退/空值忽略）+ capture 矩阵 5 用例回归；后端全量 **742 passed**；ruff clean。

### 7.5 sandbox_mode 分档执行（第 15 轮，✅ 闭环）
- **gateway**：start_run 经 `SandboxModeRepository.folded(thread_id)` 折叠事件日志 → server-owned 无条件覆盖注入 `configurable["sandbox_mode"]` + `context["sandbox_mode"]`（客户端伪造免疫；store 缺失/失败→默认 danger-full-access）。
- **middleware**：`sandbox_mode` 随 thread_data 一并下发（缺省空串=legacy 语义默认 danger）。
- **tools 门禁**：`_enforce_sandbox_write_gate` —— read-only 拒绝 `bash`（shell 全禁，启发式命令解析不可靠、文档化妥协）与 `write_file` / `str_replace`（可读文案引导切换模式）；workspace-write / danger-full-access 放行。
- 已登记局限：容器执行器 bind-mount 真实目录属运行时改造（前端/网关链路已就绪）；read-only 粒度为工具级而非命令级。
- 验证：tests/test_sandbox_mode_gate.py 8 用例（gate 单元/工具级拒绝/legacy 回退/middleware 透传/锚点共存/wiring 检查）；后端全量 **750 passed**；ruff clean。提交 f3cb62f 之后新增。


---

## 8. 工作区体验第三轮（第 15-16 轮，✅ 四点全部交付）

### 8.1 DSH 取证（live GUI + bundle + 网络面板）
- **侧边栏**：无「历史任务」折叠标签——工作区组与 Ungrouped 会话直接构成顶层树；每会话标题+相对时间+「进行中」徽标。
- **选择本地目录**：`POST /api/host.pickDirectory` → 宿主进程弹**原生 OS 目录选择对话框**（截图证实 macOS "Select Workspace Directory"，含 New Folder）→ 返回绝对路径。
- **composer 解剖**：工作区选择器在输入框**上方外部**（顶部行，仅新会话可见；历史会话实测 `wsPickerVisible=false`）；访问模式菜单在**下方工具行左侧**，三档 `Read Only / Workspace Write / Full access`；新会话切换访问模式**无落库请求**（纯草稿，随 run 提交）。

### 8.2 实施
1. **删除「历史任务」标签**（38415eb）：RecentChatList 去标签/折叠分支/重复 return 死代码；layout context 移除 historyCollapsed 全套（含 localStorage 键）；测试改写为新不变量。
2. **本地目录选择**（b6cee91）：网关 `POST /api/fs/pick-directory`（macOS osascript choose folder / Linux zenity|kdialog / Windows FolderBrowserDialog；空输出=取消）；前端 `pickDirectory` API + hook，两个创建对话框（侧栏/输入区）均加「浏览…」回填。
3. **工作区选择器外移**（febcbf6）：从输入工具行移到 composer 左上角外部顶行（outline 胶囊按钮）；`isNewThread` 条件保持=任务开始即隐藏。
4. **访问模式菜单**（febcbf6）：footer 左下三档菜单（只读/工作区可写/完全访问）走 context 管线并记忆；引擎 `sandbox_mode` 入白名单，**客户端显式值优先于折叠默认**（三词汇校验；fold 仅作回退），工具门禁不变。
- 门禁：后端 **751 passed**、前端 **338 passed**、tsc/eslint/ruff clean。提交链：38415eb → b6cee91 → 65df99a → febcbf6。
