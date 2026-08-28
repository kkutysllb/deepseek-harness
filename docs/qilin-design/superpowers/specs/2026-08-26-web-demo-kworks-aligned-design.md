# QiLin Web Demo —— 与 KWorks Web 端全面对齐 · 设计文档

> 日期：2026-08-26 · 状态：已评审通过
>
> 取代此前所有旧方案（旧 Phase 0-3 计划与设计文档已于同日删除，见 commit `5ef2e63`）。

## 1. 目标与决策记录

在 QiLin 仓库内构建 `web-demo/`：一个真实可运行、浏览器直连本地 QiLin gateway 的 Web 工作台，
与本地项目 KWorks（`/Users/libing/kk_Projects/KWorks`）的 web 端**全面对齐**，作为麒麟引擎 v2.0
多智能体框架的官方 Web 演示。

已确认的关键决策：

| 决策点 | 结论 |
|---|---|
| 对齐方式 | **直接移植** KWorks `frontend/` 代码，剥离 Electron 专属层，保留全部页面与组件 |
| 移植范围 | **全量**：登录/初始化、工作台全部页面、全套设置、落地页、nextra 文档站 |
| 品牌 | **QiLin（麒麟）品牌**：只换文案/Logo/主题主色，不改布局与交互 |
| 连接架构 | **同源自定义代理**（方案 A）：`server.js` + `http-proxy-middleware`，SSE 不缓冲、支持 WebSocket |
| 硬约束 | **不影响本机已安装的 KWorks 应用**：端口、数据目录、进程管理全部隔离 |

## 2. 整体架构与隔离

```
浏览器 ──► web-demo (Next.js 自定义服务) :28080
              │  同源 /api/* ── http-proxy-middleware ──► QiLin gateway :28081
              │  （SSE 不缓冲，支持 WebSocket 升级）
              └─ 其余请求由 Next 处理（页面 / nextra 文档 / 静态资源）
```

- **代码位置**：`QiLin/web-demo/`，由 KWorks `frontend/` 整体移植；与 QiLin Python 主包解耦。
- **端口规划**（均可 env 覆盖；避开 KWorks 的 19987/18569 与旧方案的 8081/3000）：

  | 进程 | 默认端口 | 环境变量 |
  |---|---|---|
  | web-demo（Next 自定义服务） | 28080 | `WEB_DEMO_PORT` |
  | QiLin gateway | 28081 | `GATEWAY_PORT` |

- **数据隔离**：gateway 使用 `QILIN_HOME=<QiLin仓库>/.qilin/`（QiLin 引擎默认行为），
  与 KWorks 应用的 `~/.kworks/` 完全隔离；脚本不接管、不杀掉任何已有进程。
- **前端运行模式**：纯 web 模式。KWorks 前端原生内置 `isDesktop()` 分支
  （检测不到 `window.kworksDesktop` 即走 web 分支），共 48 处分支**一行不改**；
  `components/desktop` / `core/desktop` 纯桌面组件（标题栏同步、更新检查、backend-splash 等
  12 个文件）在 web 模式下天然不渲染，代码保留以便后续与 KWorks 上游同步。
- **代理层**：新增 `web-demo/server.js`（约 100 行）——自定义 Next 服务 +
  `http-proxy-middleware`，转发 `/api/*`（含 langgraph SDK 路由），`ws: true`，
  禁用响应缓冲保证 SSE 逐字流式。
  > 背景：KWorks 源码注释明确指出 Next.js rewrites 代理会缓冲 SSE（流式会退化为整段输出），
  > 这是不采用内置 rewrites（方案 C）与纯 rewrites 直连的原因。

## 3. 移植范围与品牌处理

### 3.1 移植清单（全量，与 KWorks web 端一一对应）

| 模块 | 来源路径 | 说明 |
|---|---|---|
| 登录 / 初始化 | `app/(auth)/login`、`app/(auth)/setup` | 首次使用向导 + 账号登录 |
| 聊天工作台 | `app/workspace/chats/[thread_id]` | 消息分段渲染、思考/工具交错、澄清卡、审批门、队列、重新生成/编辑重发 |
| 交付物预览 | `components/workspace/artifacts` | HTML/MD/XLSX/DOCX/PPTX/PDF/图片/代码 + 全屏预览 |
| 右侧上下文面板 | `components/workspace/right-context-panel` | 子代理时间线、技能、文件变更审计 |
| Agents / 自动化 / MCP / Token 用量 | `app/workspace/{agents,crons,mcp,token-usage}` | 完整保留 |
| 全屏设置 | `components/workspace/settings/*` | 常规/模型/记忆/MCP/工具沙箱/数据持久化/附件/Web 工具等全菜单 |
| 落地页 | `components/landing/*` | hero + 4 个 section，文案换成 QiLin |
| Nextra 文档站 | `content/{zh,en}` | web 模式自带，保留 |
| i18n | 中/英双语 | 保留；`defaultLocale` 由 KWorks 的 `en` 改为 `zh`（demo 面向中文用户，明确变更点） |

### 3.2 品牌处理（KWorks → QiLin）

- 范围：52 个含 "KWorks/kworks" 文案的文件 + `public/favicon.svg` + `package.json` name + 落地页文案。
- 原则：**只换文案、Logo、主题主色变量，不改任何布局与交互**。
- 主色：沿用 QiLin 绿色系，`--primary` 等 CSS 变量统一调整；具体色值实现时对照
  `docs/assets/qilin-hero.png` 品牌色微调。
- 文案基线："麒麟 QiLin —— 生产级多智能体引擎的 Web 工作台"；落地页各 section 按引擎能力
  （多智能体编排 / 沙箱 / 技能生态 / 渠道接入）重写。

### 3.3 显式裁剪项

- Electron 专属：托盘、窗口拖拽区、自动更新、`backend-splash` —— 代码保留但 web 下不渲染。
- `NEXT_PUBLIC_STATIC_WEBSITE_ONLY` 静态官网模式：不启用。
- `gateway-unavailable.tsx`：适配为 web 版"网关未就绪"提示（含启动命令指引）。

## 4. 工程交付

### 4.1 启动与脚本

- 重写 `scripts/start-all.sh`（现有版本为旧方案遗留，端口 8081/3000）：一键拉起
  gateway(28081) + web-demo(28080)；启动前做端口占用检测，冲突时报错退出，绝不杀已有进程。
- `scripts/start-gateway.sh`：默认端口 8081 → 28081；`GATEWAY_CORS_ORIGINS` 默认值更新为
  `http://localhost:28080`。
- 新增 `web-demo/.env.example`：`GATEWAY_TARGET_URL=http://127.0.0.1:28081`、`WEB_DEMO_PORT=28080`。

### 4.2 验证策略（移植型项目以回归为主，不造新测试）

1. 保留并跑通 KWorks 前端自带的 vitest 单测与 typecheck / lint。
2. 新增 1 个代理冒烟测试：`/api/health` 经 28080 代理可达、SSE 流首字节延迟 < 500ms（确认代理不缓冲）。
3. 手工验收清单：登录/初始化 → 新建会话 → 流式回复逐字出现 → 工具调用卡片 → 交付物预览 →
   设置页保存 → agents/crons/mcp/token-usage 页面可达。
4. KWorks 自带 Playwright e2e 一并移植，但**不作为验收门禁**（原用例绑定桌面环境假设，
   先标记 skip，后续再修）。

### 4.3 里程碑（每步独立 commit）

- **M1 脚手架可运行**：拷贝代码、pnpm install、`server.js` 代理、`/api/health` 打通、首页可访问。
- **M2 核心闭环**：登录 → 聊天 → SSE 流式 → 交付物预览全流程跑通（对齐 28081 gateway）。
- **M3 全量页面**：设置全菜单 + agents/crons/mcp/token-usage + 落地页 + 文档站逐一验证修复。
- **M4 品牌与收尾**：KWorks→QiLin 全量换标、脚本定稿、README、验收清单归档。

### 4.4 主要风险与对策

| 风险 | 对策 |
|---|---|
| QiLin 主仓 API 与 KWorks 前端假设漂移（KWorks 锁定 qilin 子模块版本） | M2 阶段以实际联调为准，接口差异在 web-demo 内做适配层，不改 QiLin 后端 |
| nextra + i18n + 自定义 server 三者兼容 | M1 先验证文档站路由；不兼容则在 web-demo 关闭 nextra（一行配置） |
| SSE/WS 经代理异常 | M1 冒烟测试即覆盖；兜底可切 `NEXT_PUBLIC_LANGGRAPH_BASE_URL` 直连模式 |
| 依赖安装体积大（three.js / pptx viewer 等） | 原样保留，不裁剪，保证预览能力完整 |

## 5. 参考

- KWorks 仓库：`/Users/libing/kk_Projects/KWorks`（frontend / desktop / CHANGELOG）
- QiLin gateway 路由清单：`app/gateway/routers/`（27 个 router，含 threads/runs/skills/mcp/agents 等）
- KWorks 前端 web 模式证据：`frontend/src/core/config/index.ts`（`isDesktop()` 分支）、
  `frontend/next.config.js`（web dev rewrites + SSE 缓冲注释）
