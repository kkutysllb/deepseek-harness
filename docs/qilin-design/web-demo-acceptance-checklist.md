# QiLin Web Demo 验收清单

> 分支 `feat/web-demo-kworks-aligned` · 生成日期 2026-08-26 · 依据实测证据（Playwright 浏览器验证 + smoke 脚本 + curl）
>
> 设计文档：`docs/superpowers/specs/2026-08-26-web-demo-kworks-aligned-design.md`
> 实施计划：`plans/2026-08-26-web-demo-kworks-aligned.md`

## 1. 基础设施

| # | 项目 | 结果 | 证据 |
|---|---|---|---|
| 1.1 | gateway 直连健康检查 `:28081/health` | ✅ | `{"status":"healthy","service":"qilin-gateway"}` |
| 1.2 | 同源代理 `:28080/health` | ✅ | 200，经 server.js → gateway |
| 1.3 | SSE 代理不缓冲 | ✅ | smoke 实测首字节 19-135ms（阈值 500ms） |
| 1.4 | 端口隔离（不碰 KWorks 19987/18569） | ✅ | 全部脚本只检测不杀进程；端口 28080/28081 |
| 1.5 | 数据隔离（`.qilin/` vs `~/.kworks/`） | ✅ | QILIN_HOME 默认仓库内 `.qilin/` |
| 1.6 | `pnpm smoke` 全绿 | ✅ | PASS（登录分支复跑通过） |

## 2. 认证与初始化

| # | 项目 | 结果 | 证据 |
|---|---|---|---|
| 2.1 | 未登录访问 /workspace 重定向 /login | ✅ | 401 → `/login?next=%2Fworkspace` |
| 2.2 | 邮箱密码登录（form-encoded） | ✅ | 登录成功跳转 `/workspace/chats/new` |
| 2.3 | 首次初始化向导（initialize） | ✅ | smoke 走 initialize 分支建号成功 |
| 2.4 | 登出 / 用户菜单 | ✅ | 菜单含 设置 / 退出登录 |

## 3. 聊天核心闭环

| # | 项目 | 结果 | 证据 |
|---|---|---|---|
| 3.1 | 流式逐字回复 | ✅ | 真实模型回复渲染（MiniMax-M3） |
| 3.2 | 思考过程折叠（已思考） | ✅ | 折叠卡片可展开 |
| 3.3 | 工具调用卡片（中文标签、折叠） | ✅ | "2 个工具调用 写入文件、执行命令" |
| 3.4 | 文件写入工具闭环 | ✅ | demo.html 生成，路径 `/mnt/user-data/outputs/demo.html` |
| 3.5 | 交付物预览（HTML iframe） | ✅ | 面板含文件名/全屏预览/收起 + iframe 实时渲染 |
| 3.6 | 代码块 Download/Copy | ✅ | 按钮存在可用 |
| 3.7 | 消息操作（复制/编辑/重新生成） | ✅ | 用户与 assistant 消息均带操作按钮 |
| 3.8 | Token 统计（输入/输出/缓存命中） | ✅ | 输入 18.9K · 输出 1,080 · 命中 34% |
| 3.9 | 会话标题自动生成 | ✅ | "用一句话介绍你自己" 自动命名 |
| 3.10 | 历史侧边栏分组（近三天/本周/本月/更早） | ✅ | 4 条会话按时间分组+计数 |

## 4. 全量页面

| # | 项目 | 结果 | 证据 |
|---|---|---|---|
| 4.1 | 落地页 `/` | ✅ | hero + 4 特性卡 + footer（品牌 QiLin） |
| 4.2 | 新会话页 `/workspace/chats/new` | ✅ | 欢迎语 + 输入框 + 推理深度/模型选择 |
| 4.3 | 自动化 `/workspace/crons` | ✅ | 空态 + 添加任务 |
| 4.4 | MCP 管理 `/workspace/mcp` | ✅ | 空态 + 添加 + 常用服务器推荐 |
| 4.5 | token-usage 路由 | ✅ | 上游即 redirect 占位 → /workspace |
| 4.6 | agents 列表页 | ✅ | 上游无此路由（仅 [agent_name]/chats 动态路由），404 与上游一致 |
| 4.7 | 设置·常规（账户/外观/系统） | ✅ | 修改密码/主题/语言/日志级别/调度器开关 |
| 4.8 | 设置·模型 | ✅ | M3 卡片（思考/视觉标记）+ 供应商模板 |
| 4.9 | 设置·Token 统计与预算 | ✅ | 真实数据（57.4K/2.3K/61.3% 命中）+ 图表 |
| 4.10 | 设置·全部 12 菜单 | ✅ | 个人/智能体/工具与数据/引擎 四组全渲染 |
| 4.11 | i18n 中英切换 | ✅ | 设置语言切 English 全 UI 生效，可切回 |
| 4.12 | console 错误 | ✅ | 0 errors（4 条 recharts 隐藏容器尺寸 warning，无功能影响） |

## 5. 品牌（M4）

| # | 项目 | 结果 | 证据 |
|---|---|---|---|
| 5.1 | 展示文案 KWorks→QiLin | ✅ | 89 文件替换，src 残留 0 |
| 5.2 | favicon 绿色渐变+「麒」 | ✅ | public/favicon.svg 全量替换 |
| 5.3 | 主色 QiLin 绿（亮/暗） | ✅ | --primary/--ring oklch 值 |
| 5.4 | 页面标题 | ✅ | `<title>QiLin</title>` |
| 5.5 | 分享链接用当前 origin | ✅ | 移除 kworks.com 硬编码（086a40b） |
| 5.6 | 内部标识符保留 | ✅ | kworksDesktop bridge / storage key / sandbox provider id（刻意保留，见 README 差异表） |

## 6. 工程质量

| # | 项目 | 结果 | 证据 |
|---|---|---|---|
| 6.1 | typecheck | ✅ | 0 error |
| 6.2 | vitest 回归 | ✅ | 257 过 / 1 败 = 基线（thread-stream-cache worker OOM，移植前即存在） |
| 6.3 | shell 语法 | ✅ | bash -n 通过 |
| 6.4 | server.js 健壮性 | ✅ | 端口校验/升级 socket 销毁/语义状态码（504/502） |
| 6.5 | Next 缓存损坏恢复 | ✅ | 清 .next 冷重启即恢复（已记录 README 排障） |

## 7. 生命周期管理命令（2026-08-27 修复验收）

> 背景：`start-all.sh` 曾无参数解析，`--stop` 被静默忽略并直接走启动流程
> （用户实测"前后端整体重启了一遍"）。已重写为完整子命令并实测。

| # | 项目 | 结果 | 证据 |
|---|---|---|---|
| 7.1 | `--help` | ✅ | 输出 usage，exit 0 |
| 7.2 | 未知参数（`--bogus`） | ✅ | ❌ 报错 + usage，exit 1，端口进程不变（不再静默启动） |
| 7.3 | `--status`（运行中） | ✅ | gateway PID + web-demo PID + 端口，exit 0 |
| 7.4 | `--stop`（运行中） | ✅ | gateway 走 PID 文件；web-demo 无 PID 文件走端口+命令行兜底；双端口释放，exit 0 |
| 7.5 | `--stop` 幂等 | ✅ | 再次执行输出"没有运行中的"，exit 0 |
| 7.6 | `--status`（停止态） | ✅ | 双"未运行"，exit 0 |
| 7.7 | `--restart` | ✅ | 先各停一次（无重复消息）→ gateway healthy → 首页 HTTP 200 |
| 7.8 | web-demo PID 文件 | ✅ | `/tmp/qilin-web-demo.pid` 与 28080 监听进程一致 |
| 7.9 | start-gateway.sh `--stop` 端口兜底 | ✅ | PID 文件丢失场景按"端口 + uvicorn/app.gateway.app 命令行特征"定位 |
| 7.10 | 误杀防护 | ✅ | 停止只 kill 命令行匹配 `node*server.js` / `uvicorn` 的进程；陌生占用者只报告 |
| 7.11 | `set -e` 健壮性 | ✅ | web_pids_on_port 显式 return 0（端口被陌生进程占用时 status/stop 不中断） |

## 8. 玄金麒麟 VI 改版验收（2026-08-27）

| # | 项目 | 结果 | 证据 |
|---|------|------|------|
| 8.1 | 品牌 token 层生效 | ✅ | `@theme inline` 段落在 globals.css 尾部后语义类正常生成；landing 背景 computed=`rgb(13,11,9)`=#0d0b09 |
| 8.2 | QilinMark 组件单测 | ✅ | vitest 7/7（aria 边界/outline/pattern id 唯一性/GoldDivider 结构） |
| 8.3 | landing 双档布局 | ✅ | 1440 与 390 下无横向滚动；小屏 eyebrow 与固定 header 重叠已修（main pt-16，实测 eyebrowTop 104 > headerBottom 64） |
| 8.4 | CTA 与旧视觉清除 | ✅ | CTA computed=`rgb(201,162,74)` 金色实底；视觉复查确认彩虹渐变/星空/流光零残留 |
| 8.5 | login 卡片与登录链路 | ✅ | 窄卡 352px + rounded-xl + hairline + 顶部 2px 金渐变饰条；admin 真实登录直达 /workspace |
| 8.6 | setup 三分支换壳 | ✅/⚠️ | tsc 零错误；change_password 补齐可见 label；init_admin 运行态需全新数据目录，未做浏览器实测 |
| 8.7 | 退役组件清理 | ✅ | Galaxy/FlickeringGrid/ShineBorder/SpotlightCard/AnimatedBackground 共 7 文件 grep 零引用后 `git rm` |
| 8.8 | 回归基线 | ✅ | vitest 264 pass / 1 fail（既有 thread-stream-cache worker OOM）；`pnpm build` 成功；tsc 零错误 |
| 8.9 | workspace 不受影响 | ✅ | 生产构建下登录后侧边栏 header padding-top=8px（pt-10 移除修复保持有效），布局无异常 |
| 8.10 | 质量评审整改 | ✅ | ink-low 提亮 #857c6c(WCAG AA≥4.5:1)；ScalePattern useId 防冲突；hero 改 Button asChild 消除嵌套交互元素 |
| 8.11 | 设置页「运行时」架构图菜单 | ✅ | archify 导出 HTML 字节级原样拷贝至 `public/architecture/`；设置-引擎组新增「运行时」首位菜单，iframe **全功能加载**（仅钉初始主题，不裁剪）：主题/视觉预设/演示/PNG·SVG·WebM 导出按钮、引导导览与底部卡片介绍（三段分层/纵深防御等 4 卡）均可滚动查看；tsc 零错 / 浏览器走查深色融合无异常 |

截图存档：`.playwright-mcp/vi-{landing-1440,landing-390,login-1440}-v2.png`（kcoder-runtime 目录）。

## 9. 未验收 / 已知限制（与上游一致或环境约束）

- 交付物预览抽查了 HTML；XLSX/DOCX/PPTX/PDF 预览路径未逐一实测（上游组件未改动）
- browser_* 工具组未启用（QiLin 主仓未装 playwright extra，README 已记录启用方法）
- 澄清卡 / 危险工具审批门 UI 未触发实测（需要特定工具调用场景）
- KWorks 桌面应用并行运行验证：端口/数据隔离为设计保证 + 脚本约束，未做双开实测
