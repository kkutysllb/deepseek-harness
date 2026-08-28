# Agent Note: account-http 路由与 /api 栅栏（accounts/）

Status: implemented

[English](2026-08-28-account-http-routes-and-gate.md) | 中文

## 问题

移植的 S3 步骤要把 D2 会话服务变成用户可见的 HTTP 面，同时不放弃引擎已有的栅栏：旧 Python 网关的 `/api/v1/auth` 路由族必须在引擎 webServer 上重现，所有 `/api` 业务路由与 WebSocket 升级必须要求会话，而三道旧版防线——cookie 安全策略、auth 端点 Origin 白名单、按 IP 限流——必须带着精确语义一起过来。webServer 本身必须对鉴权保持无知，且未挂载账户插件时 client-connection 传输层必须原样工作。

## 决策

`packages/accounts/account-http`（`@qilin/account-http`）提供可选 cordis 服务 `apiAuth`（结构契约 `ApiAuthGate` 声明在 client-connection 侧，按名咨询——提供方从不导入传输层，依赖箭头保持单向）。`checkRequest` 先以 cookie 优先、Bearer 兜底完成鉴权，再对 cookie 认证的写请求判定 CSRF；`checkUpgrade` 放行活会话或逃生阀，匿名升级在协议协商前以原生 401 拒绝。connection 的路由与升级处理器在自身浏览器信任栅栏之后立即咨询该服务，`rejectWebSocketUpgrade` 增加了可选的 status/reason 参数，使信任栅栏保持其精确的 403 线上字节。路由族在账户存储之上组合 `SessionService`，背后是一个有体积上限、校验媒体类型的分发器：凭证端点挂按 IP 固定窗口限流器（时钟可注入、表有界、清扫加驱逐），凭证类 POST 恰好施加旧版 Origin 白名单（感知代理头），auth-disabled 逃生阀全链路接线——`me` 返回合成 admin、拒绝改密、跳过 CSRF 与白名单，并带生产启动拒绝。注册开关是逐请求重读的 JSON 文件，翻转即时生效。`issueSession` 的未知账户裸 Error 在路由层归一（login → 401，provision → 500）而不改会话服务，因为响应上下文只存在于这一层。

## 后果

- 执行是组合选择：不挂 `@qilin/account-http` 时引擎照旧服务 `/api`；挂载插件后所有业务路由与升级都受会话门控，webServer 零改动。
- 每文件 100% 覆盖率门禁无豁免成立；栅栏、cookie 策略、白名单与限流器全部表驱动，集成测试用真实 node:http 组合（webServer + connection + account-http）配原生 socket 驱动。
- 错误保持旧信封形状（`{error: {code, message}}`）与 snake_case 码，旧客户端无需翻译即可读新面；新增的 `rate_limited`、`csrf_missing`、`csrf_mismatch` 码是对旧集合的扩展而非重释。
- 限流统计全部尝试（比旧版仅计失败更严格）且状态在内存——这是登记在案的限制而非疏忽。

## 备选方案

- **在 webServer 内执行** —— 否决：webServer 是通用路由器；把账户知识放进去会反转依赖方向并迫使所有部署携带账户栈。
- **account-http 导入 client-connection 以复用其栅栏** —— 否决：会跨层成环；结构化 `apiAuth` 契约加字符串键 provide 保持单向箭头、零运行时耦合。
- **Bearer 豁免一切** —— 否决：只有 CSRF 判定豁免 Bearer 链，token 只从创建会话的端点回传，与 D2 兜底通道决策一致。
- **为静态哈希改会话或改 account-core 存储** —— 此处否决：S2 的 account-auth 笔记已权衡过；S3 只消费服务。
