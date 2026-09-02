# OpenKylin Web Demo 右侧工作台（对齐 DSH-better-sidebar）· 设计文档

> 日期：2026-08-27 · 状态：草案 v1，待用户逐节审阅

## 0. 设计背景与裁剪范围

参考仓库 [`omdsh-dev/DSH-better-sidebar`](https://github.com/omdsh-dev/DSH-better-sidebar)
是 DSH 桌面客户端的 Cordis 插件，提供**右侧 VSCode 风格多 tab 工作台**（文件/编辑器/终端/Git/浏览器/任务/侧边对话），
整套契约假设了 `@deepseek-ai/cordis` 运行时 + 14 个 DSH 宿主服务（webServer / sessions / workspaces /
subagents / agents / jobs …）与 `node-pty` 真实 PTY。

OpenKylin web-demo 是 Next.js 16 + 本地 gateway 的纯 Web 工作台，**没有 Cordis 宿主、没有 node-pty**，
无法直接装包或照搬源码。v1 的目标是：在 web-demo 内**重新构建一个等效形态的右侧工作台**，
对齐 better-sidebar 的 **UI 行为模式与扩展协议**，而非复刻其宿主服务契约。

### v1 范围（已与用户确认）

| 项 | 状态 |
|---|---|
| 右侧栏壳 + tab 隔离 + tab 拖拽分栏 | ✅ v1 |
| Markdown / HTML / 图片 / PDF viewer | ✅ v1 |
| CodeMirror 编辑器（可写） | ✅ v1 |
| 懒加载文件浏览树（限 thread workspace，可写保存） | ✅ v1 |
| `registerPanel` / `registerFileViewer` 扩展协议 | ✅ v1 |
| 真实终端（WebSocket + xterm.js） | ❌ v2+ |
| Git 面板（需后端 git CLI 封装） | ❌ v2+ |
| 侧边对话 / 子代理拓扑 | ❌ v2+ |
| 自由窗口（拖出浮窗） | ❌ v2+ |
| 主机全局 FS 直读 | ❌ 永久不做（Web 安全边界） |

### 与既有计划的关系

- `plans/2026-08-27-dsh-alignment-refactor.md` P1（workspaces 注册表 + threads.cwd 不可变）：**正交**。
  本设计走「线程 user-data workspace」路径（`.openkylin/threads/{tid}/user-data/workspace/`），
  不依赖注册表——注册表后续可成为更高层的工作区容器。
- 既有 `workspace-layout-context.tsx` 的右侧面板（`rightPanelOpen` / `rightPanelWidth` / `PanelSectionId`）
  与本设计**不冲突**，本设计是新增「右侧工作台」作为独立面板，受 `workspace-layout-context` 的宽度/开关管理。

---

## 1. 目标与决策记录

| 决策点 | 结论 |
|---|---|
| 形态 | 右侧多 tab 工作台，独立于现有左侧会话栏 |
| 挂载位置 | workspace 主区域右侧，与现有 rightPanel 同列；可与 rightPanel 共存或替换 |
| Tab 隔离粒度 | **per-thread**（每个会话一份 tab 布局）；切换 thread 自动恢复 |
| 数据持久化 | per-thread tab 状态走 gateway 持久化（`/api/threads/{tid}/sidebar-tabs`） |
| 协议层 | 自定义 `SidebarPanelRegistry` + `FileViewerRegistry`（不依赖 Cordis） |
| 文件浏览根 | thread 的 `user_workspace_dir`（`.openkylin/threads/{tid}/user-data/workspace/`） |
| 文件访问授权 | 后端 `require_permission("threads", "read|write")` + 路径白名单校验 |
| 编辑器可写范围 | 仅限已存在的相对路径文本文件（< 1 MB，二进制拒绝） |
| Tab 拖拽分栏 | v1 仅"垂直/水平分栏"切换，不做自由悬浮（v2+） |
| 移动端 | < 768px 时右侧栏自动折叠为底部抽屉（与 better-sidebar 行为一致） |
| 主题与品牌 | 复用 `qilin-brand.css` token 层（玄金麒麟），不引入新色变量 |

---

## 2. 整体架构

```
                       浏览器 (Next.js 16)
 ┌──────────────────────────────────────────────────────────────────┐
 │ LeftSidebar          Workspace Main              RightSidebar    │
 │ (会话列表)  ─►  thread 对话区域  ◄─  Better Sidebar (本设计)      │
 │                                  ├─ TabBar (多 tab + 拖拽分栏)   │
 │                                  ├─ TabPanel (per tab)            │
 │                                  │   ├─ FileExplorer              │
 │                                  │   ├─ FileViewer (协议调度)     │
 │                                  │   │   ├─ MarkdownViewer        │
 │                                  │   │   ├─ HtmlViewer (sandbox)  │
 │                                  │   │   ├─ PdfViewer             │
 │                                  │   │   ├─ ImageViewer           │
 │                                  │   │   └─ CodeMirrorViewer      │
 │                                  │   └─ 自定义 panel (registerPanel) │
 │                                  └─ BottomPanel (留 v2)           │
 │                                                                   │
 │ PanelRegistry ◄──► registerPanel({id,title,icon,render})         │
 │ ViewerRegistry ◄──► registerFileViewer({exts,component})         │
 └──────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
                       Next API Route → /api/* (proxy)
                                  │
                                  ▼
                       OpenKylin Gateway (Python) :28081
                                  │
                  ┌───────────────┼───────────────┐
                  ▼               ▼               ▼
           /api/files/*    /api/threads/{tid} /sidebar-tabs
           (新加 router)   (已有)            (新加 router)
                  │               │               │
                  ▼               ▼               ▼
           thread_data.workspace_dir   threads_meta (持久化)
```

**核心模块边界**：

1. **`web-demo/src/core/sidebar/`**（新增）—— 协议层 + 注册表
   - `panel-registry.ts` —— `SidebarPanelRegistry`（registerPanel / unregister / list）
   - `viewer-registry.ts` —— `FileViewerRegistry`（registerFileViewer / matchExt / list）
   - `protocol.ts` —— `SidebarPanelSpec` / `FileViewerSpec` / `SidebarTabState` / `SidebarScope`
   - `panel-host.tsx` —— `<PanelHost scope=... />` 调度组件
   - `viewer-host.tsx` —— `<FileViewerHost path=... />` 调度组件

2. **`web-demo/src/components/better-sidebar/`**（新增）—— UI 层
   - `BetterSidebarRoot.tsx` —— 右侧栏壳（折叠、宽度、移动端抽屉）
   - `TabBar.tsx` —— tab 切换条 + 关闭 + 拖拽手柄
   - `TabContent.tsx` —— 单 tab 渲染区
   - `panels/FileExplorer.tsx` —— 懒加载树
   - `panels/FileViewer.tsx` —— viewer 调度
   - `viewers/MarkdownViewer.tsx` 等 5 个内置 viewer

3. **`web-demo/src/core/files/`**（新增）—— FS API 客户端
   - `api.ts` —— `listDir / readFile / writeFile` 的 TanStack Query 封装
   - `tree.ts` —— 客户端树推导（懒加载、扩展名匹配 viewer）

4. **`app/gateway/routers/files.py`**（新增）—— 后端 FS 路由
5. **`app/gateway/routers/sidebar_tabs.py`**（新增）—— per-thread tab 状态持久化
6. **`web-demo/src/app/workspace/`** 集成入口：把 `BetterSidebarRoot` 挂到现有右侧栏容器

---

## 3. 后端 API 设计

### 3.1 文件 API（`/api/files`，新建 `app/gateway/routers/files.py`）

| 方法 | 路径 | 权限 | 描述 |
|---|---|---|---|
| GET | `/api/files/list` | threads:read | 列出 thread workspace 内的目录/文件（懒加载，一次一层） |
| GET | `/api/files/read` | threads:read | 读文件内容（文本按行 / 二进制走 `/api/files/raw`） |
| GET | `/api/files/raw` | threads:read | 原始字节（图片 / PDF / 二进制预览） |
| POST | `/api/files/write` | threads:write | 写文件（仅文本，< 1 MB） |
| POST | `/api/files/mkdir` | threads:write | 新建子目录 |
| DELETE | `/api/files/delete` | threads:delete | 删除文件/空目录 |

**统一请求体参数**：
```python
class FilePathRequest(BaseModel):
    thread_id: str = Field(pattern=r"^[A-Za-z0-9_\-]{1,128}$")
    path: str = Field(min_length=1, max_length=4096)  # 相对 thread_workspace_dir 的相对路径
```

**路径校验三道防线**（后端必须按顺序执行）：
1. **正则白名单**：`thread_id` 字符集限定（已有 `paths.py` 第 27-37 行）；
2. **realpath 钉死**：解析 `thread_workspace_dir(thread_id)` → `realpath`，与请求 path 拼接后再 `realpath`，
   验证结果以 `thread_workspace_dir` 为前缀；
3. **符号链接处理**：解析后若任一中间段是 symlink，必须 realpath 后仍落在 workspace 根下，
   否则 400 + `path_outside_workspace` 错误码。

**`GET /api/files/list` 响应**：
```python
class FileEntry(BaseModel):
    name: str
    type: Literal["file", "dir", "symlink", "broken"]
    size: int          # 字节；dir 为 0
    mtime: float       # unix epoch
    mime: str | None   # 由 mimetypes.guess_type 推断

class FileListResponse(BaseModel):
    entries: list[FileEntry]
    parent: str | None  # 上一层相对路径；根为 None
```

**`POST /api/files/write` 校验**：
- 文本判断：`mimetypes.guess_type(name)[0]` 必须以 `text/` 开头，
  或命中已知代码扩展名白名单（`.md / .json / .yaml / .yml / .toml / .ini / .csv / .tsv / .sql / .sh / .py / .js / .ts / .tsx / .jsx / .vue / .css / .scss / .html / .xml / .env / .gitignore / .gitattributes / .editorconfig / Makefile / Dockerfile`）；
- 大小上限：1 MB（超过 413）；
- 父目录必须存在；否则 400 `parent_not_found`。

### 3.2 Tab 状态持久化（`/api/threads/{tid}/sidebar-tabs`，新建 `app/gateway/routers/sidebar_tabs.py`）

```python
class SidebarTabState(BaseModel):
    tabs: list[SidebarTabSpec]   # 打开中的 tab 列表
    active: str | None           # 当前活动 tab key
    split: Literal["single", "vertical", "horizontal"] = "single"

class SidebarTabSpec(BaseModel):
    key: str                     # 全局唯一；"<plugin_id>:<local_id>"
    panel: str                   # 注册的 panel id
    title: str
    icon: str | None = None
    payload: dict[str, Any] = {}  # panel 自己的状态（如文件路径、滚动位置）
    pinned: bool = False         # 是否固定 tab
    created_at: float
```

| 方法 | 路径 | 权限 | 描述 |
|---|---|---|---|
| GET | `/api/threads/{tid}/sidebar-tabs` | threads:read | 读该 thread 的 tab 状态；缺省空 |
| PUT | `/api/threads/{tid}/sidebar-tabs` | threads:write | 写该 thread 的 tab 状态（整表快照） |

**存储**：复用 `threads_meta.metadata_json`（现有 Pydantic 模型 `metadata_json: dict`），
新增 `sidebar_tabs` 键；不新建表，避免 Alembic 迁移。

### 3.3 权限与错误码

- 复用 `require_permission("threads", "read|write|delete")` 装饰器（与 `workspaces.py` 同模式）。
- 错误响应统一形态：`{"error": {"code": "<kebab-code>", "message": "<human>"}}`，
  代码词汇：`thread_not_found / path_outside_workspace / parent_not_found / not_text_file /
  file_too_large / binary_not_editable / symlink_broken`。

---

## 4. 前端协议与组件

### 4.1 `SidebarPanelRegistry` —— 自定义 plugin 协议

**设计动机**：DSH-better-sidebar 通过 `ctx.betterSidebar.registerTab({id, title, icon, component, scope})`
 暴露扩展点，第三方插件可注册侧边栏页。我们不复用 Cordis，但**保留同样的扩展语义**。

**契约类型**（`web-demo/src/core/sidebar/protocol.ts`）：
```typescript
export interface SidebarPanelSpec<P = unknown> {
  /** 全局唯一 panel id，命名空间 '<plugin>:<id>' */
  id: string;
  /** 显示标题（i18n key 或字面量） */
  title: string | (() => string);
  /** lucide-react 图标名或 SVG 字符串 */
  icon?: ReactNode;
  /** 默认挂载顺序（数字越小越靠前） */
  order?: number;
  /** 是否可作为文件 viewer 触发（用户从 FileTree 双击打开文件） */
  fileViewer?: { exts: readonly string[]; match: (entry: FileEntry) => boolean };
  /** 该 panel 渲染函数，payload 由打开 tab 时携带 */
  render: (props: SidebarPanelProps<P>) => ReactNode;
  /** 推断初始 payload（用户点击 panel 触发按钮时） */
  defaultPayload?: () => P;
}

export interface SidebarPanelProps<P> {
  scope: SidebarScope;       // 当前 thread scope
  payload: P;                // 持久化的 panel 状态
  onPayloadChange: (next: P) => void;  // 状态变更回写到 tab
  api: SidebarPanelApi;      // 公共 API（openFile / openPanel / closeSelf / toast）
}
```

**注册 API**：
```typescript
// web-demo/src/core/sidebar/panel-registry.ts
class SidebarPanelRegistry {
  register<P>(spec: SidebarPanelSpec<P>): () => void;  // 返回反注册
  unregister(id: string): boolean;
  list(): readonly SidebarPanelSpec[];
  get(id: string): SidebarPanelSpec | undefined;
  matchFileViewer(entry: FileEntry): SidebarPanelSpec | undefined;
}
export const sidebarPanelRegistry = new SidebarPanelRegistry();
```

**调用示例**（在 web-demo 初始化或生态包内）：
```typescript
sidebarPanelRegistry.register({
  id: "openkylin:files",
  title: () => "Files",
  icon: <Folder />,
  order: 10,
  render: ({ scope, payload }) => <FileExplorerPanel scope={scope} rootPath={payload.root} />,
});
```

### 4.2 `FileViewerRegistry` —— 文件预览器协议

```typescript
export interface FileViewerSpec {
  id: string;
  /** 文件扩展名集合（含点号小写，如 [".md", ".markdown"]） */
  exts: readonly string[];
  /** 自定义匹配（优先级高于 exts） */
  match?: (entry: FileEntry, head?: string) => boolean;
  /** 预览渲染组件 */
  component: React.ComponentType<FileViewerProps>;
  /** 是否支持编辑（CodeMirror viewer 支持） */
  editable?: boolean;
}

export interface FileViewerProps {
  entry: FileEntry;
  content: string | Uint8Array;  // 文本为 string，二进制为 Uint8Array
  scope: SidebarScope;
  onSave?: (next: string) => Promise<void>;  // 仅 editable=true 时存在
}
```

**内置 5 个 viewer**（全部在 web-demo 内，与 better-sidebar 同名/同语义）：

| ID | exts | 技术 | 是否可写 |
|---|---|---|---|
| `openkylin:markdown` | `.md .markdown` | `streamdown`（已在 deps）+ `rehype-raw` + `rehype-katex` + `@streamdown/mermaid` | ❌ |
| `openkylin:html` | `.html .htm` | `<iframe sandbox="allow-same-origin">` + DOMPurify 渲染 | ❌ |
| `openkylin:pdf` | `.pdf` | `pdfjs-dist`（新增依赖） | ❌ |
| `openkylin:image` | `.png .jpg .jpeg .gif .webp .svg .bmp` | 原生 `<img>` / `<object>` | ❌ |
| `openkylin:editor` | `.txt .json .yaml .yml .toml .py .js .ts ...`（§3.1 白名单） | `@uiw/react-codemirror` + 语言包 | ✅ |

### 4.3 组件清单

| 文件 | 行数估算 | 职责 |
|---|---|---|
| `core/sidebar/protocol.ts` | 120 | 类型契约 |
| `core/sidebar/panel-registry.ts` | 80 | 注册表 |
| `core/sidebar/viewer-registry.ts` | 60 | 文件 viewer 注册表 |
| `core/sidebar/panel-host.tsx` | 100 | `<PanelHost>` 调度 |
| `core/sidebar/viewer-host.tsx` | 60 | `<FileViewerHost>` 调度 |
| `core/sidebar/scope.ts` | 80 | `<SidebarScopeProvider>` 提供 thread/cwd/api |
| `core/sidebar/use-sidebar-tabs.ts` | 120 | TanStack Query 持久化 hook |
| `core/files/api.ts` | 100 | 后端调用 |
| `core/files/tree.ts` | 80 | 树推导/排序 |
| `components/better-sidebar/BetterSidebarRoot.tsx` | 180 | 栏壳 + 折叠 + 移动端抽屉 |
| `components/better-sidebar/TabBar.tsx` | 200 | tab 条 + 关闭 + 拖拽手柄 |
| `components/better-sidebar/TabContent.tsx` | 100 | 单 tab 渲染 |
| `components/better-sidebar/SidebarResizeHandle.tsx` | 90 | 拖拽宽度（沿用现有 `sidebar-resize-handle.tsx` 风格） |
| `components/better-sidebar/panels/FileExplorer.tsx` | 320 | 树 + 软链接 + 右键菜单 |
| `components/better-sidebar/panels/FileViewerTab.tsx` | 150 | viewer 调度封装（带"在侧栏打开"按钮） |
| `components/better-sidebar/viewers/MarkdownViewer.tsx` | 120 | streamdown 渲染 + 目录大纲 |
| `components/better-sidebar/viewers/HtmlViewer.tsx` | 60 | iframe sandbox |
| `components/better-sidebar/viewers/PdfViewer.tsx` | 80 | pdfjs-dist |
| `components/better-sidebar/viewers/ImageViewer.tsx` | 50 | 原生 |
| `components/better-sidebar/viewers/CodeMirrorViewer.tsx` | 180 | 编辑器 + 保存 |
| `components/better-sidebar/built-in-panels.ts` | 50 | 内置 5 个 panel 注册调用 |

总前端约 2,180 行（不含测试），后端约 450 行。

### 4.4 关键交互

- **打开文件**：用户从 FileExplorer 双击/回车 → `viewerRegistry.matchFileViewer(entry)` →
  `onPayloadChange({ path })` + `openTab({ panel: matched.id, payload: { path } })`。
- **保存**：`CodeMirrorViewer` 的 `onSave` 调用 `POST /api/files/write` → 乐观更新本地 + invalidate
  `['files', threadId, dir]` 缓存 → 失败 toast + 回滚。
- **Tab 隔离**：切换 thread 时 `useSidebarTabs(threadId)` 重新加载对应 tabs；当前未持久化的 panel
  payload 丢失（与 better-sidebar 行为一致——这是 per-session 隔离的设计）。
- **拖拽分栏**：v1 仅单栏/垂直分栏切换（点击 split 按钮），不做拖拽分裂（v2+）。
- **移动端抽屉**：< 768px 时 `BetterSidebarRoot` 转为 fixed bottom sheet（顶栏往下拉出现）；与 better-sidebar 行为对齐。

---

## 5. 集成入口

### 5.1 与现有 `workspace-layout-context` 的关系

- 复用 `rightPanelOpen` / `rightPanelWidth` 控制 BetterSidebarRoot 的可见度与宽度。
- 新增 `rightPanelMode: 'context' | 'sidebar'` 切换：现有 rightPanel 内容是「子代理/技能/文件变更」摘要；
  模式切到 `'sidebar'` 时，整个右栏换为 BetterSidebarRoot（同一宽度状态）。
- 设置页增加「右侧面板模式」单选项（context / sidebar）。

### 5.2 挂载位置

`web-demo/src/app/workspace/workspace-content.tsx` 是 workspace 主区域壳；
在右侧栏容器内根据 `rightPanelMode` 分支渲染 `<ContextPanel />` 或 `<BetterSidebarRoot />`。

### 5.3 服务端 tab 状态持久化时机

- 关闭/打开/重排 tab → debounce 500ms 后 PUT `/api/threads/{tid}/sidebar-tabs`。
- 切换 thread → 旧 thread 立即 flush 一次（防丢）。
- SSR 阶段：不持久化（与 LangGraph thread 物化时机对齐——sidebar-tabs 仅在 first human message 之后落库）。

---

## 6. 验证策略

### 6.1 后端测试

新增 `tests/gateway/test_files_router.py` 与 `tests/gateway/test_sidebar_tabs_router.py`：

- 路径穿越 / 符号链接逃逸 / 大文件写入 / 二进制拒绝（错误码矩阵）。
- thread 不存在 / 无权限（与现有 `test_threads.py` 模式一致）。

### 6.2 前端测试

- 单测：`panel-registry.test.ts`（注册/反注册/查重）、`viewer-registry.test.ts`（ext 匹配/优先级）、`tree.test.ts`（排序/虚拟根）。
- 组件测试（happy-dom）：`<FileExplorer>` 渲染 + 懒加载 mock；`<CodeMirrorViewer>` 编辑保存（mock fetch）。
- e2e（Playwright）：登录 → 进 workspace → 点 Files panel → 看到树 → 双击 README.md → markdown 渲染；
  改 CodeMirror 内容 → 刷新页面 → 内容保留。

### 6.3 手工验收

- 设置"右侧模式 = sidebar" → 进 workspace → 看到右侧栏（默认打开 Files + 选中 README.md 两个 tab）。
- 切到另一个 thread → 看到不同 tab 集合；切回 → 恢复。
- 移动端 viewport（< 768px）→ 右侧栏折叠为底栏；点击展开为抽屉。
- 输入框 @file 引用 → 点引用 → 在 sidebar 打开对应文件（与 better-sidebar 行为一致）。

### 6.4 性能与体积

- Markdown viewer 用 `streamdown`（已装）按需渲染大文档；> 5000 字符启用虚拟滚动。
- PDF 用 `pdfjs-dist` 按需 `import()`（避免主包膨胀）。
- FileTree 一次拉一层（懒加载），最大深度不限。

---

## 7. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| `pdfjs-dist` 主包膨胀（~ 800KB） | 首屏加载慢 | 动态 `import()`，仅在打开 PDF tab 时拉取 |
| 后端路径校验漏洞 → 文件穿越 | 安全 | realpath + 父前缀双重校验 + 单测覆盖符号链接逃逸 |
| CodeMirror 语言包未装 | 不能高亮 | v1 只装 `lang-javascript / lang-python / lang-markdown / lang-html / lang-css / lang-json / lang-yaml / lang-sql / lang-rust / lang-go / lang-java / lang-cpp / lang-xml`（已在 deps） |
| 浏览器 iframe sandbox 对本地 HTML 限制 | HTML viewer 渲染失败 | 用 `srcdoc` + `sandbox="allow-same-origin"`；明确告知用户外链 JS 不执行 |
| 注册表 API 与未来 Cordis 集成冲突 | v3 切换成本 | 把 `SidebarPanelRegistry` 设计成可替换——v3 切换到 Cordis 时仅替换实现，组件层不变 |
| 移动端抽屉与右栏共存冲突 | 视觉混乱 | < 768px 时强制 only-one：右栏 = 抽屉，关闭时 session 右栏 |

---

## 8. 阶段切分（每步独立可交付可验证）

| 阶段 | 内容 | 验收 |
|---|---|---|
| **P1 后端 FS 路由** | `app/gateway/routers/files.py`（6 个端点）+ 单测（路径校验 + 错误码矩阵） | `pytest tests/gateway/test_files_router.py` 全绿 |
| **P2 后端 tab 状态持久化** | `app/gateway/routers/sidebar_tabs.py` + 写 `threads_meta.metadata_json.sidebar_tabs` 字段 | 手动 curl PUT/GET 验证；旧库无该字段走缺省空 |
| **P3 前端协议层** | `core/sidebar/{protocol,panel-registry,viewer-registry,scope}.ts` + 单测 | vitest 全绿；类型导出 web-demo 编译通过 |
| **P4 前端 viewer 5 件套** | `viewers/{Markdown,Html,Pdf,Image,CodeMirror}Viewer.tsx` + viewer-host 调度 | happy-dom 测试通过；手动打开不同扩展名文件 |
| **P5 前端 FileExplorer + tab 持久化** | `panels/FileExplorer.tsx` + `use-sidebar-tabs` + `BetterSidebarRoot` + TabBar | Playwright e2e 全绿；切 thread 状态恢复 |
| **P6 集成 + 设置项 + 移动端** | `workspace-content.tsx` 挂载；设置页"右侧模式"；< 768px 抽屉 | 截图三档 viewport 存档 |
| **P7 文档** | README + design spec 增量段 + `@deprecated` 旧 rightPanel 上下文保留（不删除） | doc 一致性 |

预估工作量：**P1-P7 共 8-10 个工作日**（单人）。

## 9. 实施状态（持续更新）
- 2026-08-27：v1 P1-P7 全部完成；测试见 `tests/test_files_router.py`、
  `tests/test_sidebar_tabs_router.py`、`web-demo/tests/unit/core/sidebar/`、
  `web-demo/tests/unit/components/better-sidebar/`、`web-demo/tests/e2e/better-sidebar.spec.ts`。
