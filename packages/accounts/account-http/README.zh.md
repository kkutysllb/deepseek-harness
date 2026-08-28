# @qilin/account-http

[English](README.md) | 中文

引擎 webServer 之上的账户 HTTP 面：`/api/v1/auth` 路由族（login、register、logout、change-password、me、setup-status、initialize），所有业务路由与 WebSocket 升级都会咨询的 `/api` 鉴权栅栏，旧版 cookie 安全策略，auth 端点 Origin 白名单，以及凭证端点的按 IP 限流。路由族在 `@qilin/account-core` 存储之上组合 `@qilin/account-auth` 的会话与 CSRF 服务；本包只拥有 cookie、头、状态码与接线——这里不重新决定任何会话语义。

## 管理路由

`/api/v1/admin/users` 路由族允许管理员列出用户、修改角色、启用或禁用账户以及重置密码。响应会投影账户并移除 `passwordHash`；使用 cookie 的状态变更请求必须通过 CSRF 双提交校验，Bearer 请求免除此校验。auth-disabled 阀提供合成管理员访问。

## 栅栏

插件提供一个名为 `apiAuth` 的可选 cordis 服务：`checkRequest`（先鉴权，再对 cookie 认证的写请求做 CSRF 双提交判定；Bearer 链跳过 CSRF）与 `checkUpgrade`（活会话或 auth-disabled 逃生阀放行；匿名升级在协议协商前以 401 拒绝）。client-connection 传输层在与浏览器信任栅栏相同的位置按名咨询该服务，缺省时行为与现状完全一致——挂载账户插件即是打开这道栅栏。

## 路由族

`login/local` 校验凭证（账户不存在时走时序垫片比较，未知账户与错误密码不可区分）；`register` 遵循注册开关文件（默认开放、逐请求即时重读、一律普通 `user` 账户）；`logout` 服务端吊销并清除全部三枚 cookie；`change-password` 校验当前密码、经账户版本号提升杀灭全部旧会话并重发新会话；`me` 返回去掉密码哈希的账户本体；`setup-status` 报告空库状态与开关；`initialize` 仅在空库时确定性地创建首个 admin（此后 409）。会话签发按 `resolveSessionCookiePolicy` 应答三枚旧版 cookie——`access_token`（HttpOnly）、JS 可读的 `csrf_token` 与持久化标志——策略取自 secure、loopback、显式会话意愿或操作员逃生开关。

## 纵深防御

旧版 Origin 白名单恰好守护凭证类 POST（`login/local`、`register`、`logout`、`initialize`）——跨站 Origin 直接拒绝。凭证端点共享一个按 IP 的固定窗口预算（默认 10 次 / 300 秒，时钟可注入，表有界并带清扫与驱逐），超限应答 429 附 `Retry-After`。`QILIN_AUTH_DISABLED=1`（生产环境之外）让合成 `default` admin 透明通过所有链路，同时停用改密、CSRF 与白名单——并带有 `account-auth` 的生产启动拒绝与操作员警告。

## Model Experience

无：本包的路由、cookie 序列化与执行判定都是服务端控制流，从不进入模型请求、提示或工具结果。

#### KV Cache effect

无；本包不贡献任何模型可见内容，因此不存在前缀、增长或失效行为。

## 已知限制与后续工作

- **限流状态在内存中** —— 按 IP 预算随重启清零且按进程独立；多进程部署需要共享存储才能合并为一个预算。
- **统计全部尝试** —— 与旧版仅计失败的计数器不同，预算统计每一次 login/register 尝试（更严格也更简单）；成功登录同样消耗预算。
- **Origin 白名单读取代理头** —— 与旧网关完全一致地采纳 `X-Forwarded-*` / `Forwarded`；前端代理不可信的部署必须在请求到达本服务前剥离这些头。
- **Bearer token 在响应中回传** —— 会话创建与改密会为非 cookie 客户端回传 `accessToken`；无 cookie 的 API 消费方须以与密码同等级的谨慎保管。
- **无账户锁定与 CAPTCHA** —— 固定窗口预算是唯一的暴力破解控制；锁定通知与 CAPTCHA 集成暂缓。
