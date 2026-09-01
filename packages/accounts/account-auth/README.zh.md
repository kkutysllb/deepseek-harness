---
description: "账户域之上的会话与请求安全服务:服务端会话签发、校验与吊销(typed 契约 C 会话错误)、纯函数 CSRF 双提交判定,以及 auth-disabled 逃生阀。"
kind: "package-reference"
---

# @qilin/account-auth

[English](README.md) | 中文

## 概述

构建在账户域之上的会话与请求安全服务:签发、校验、吊销服务端会话(不透明 id、绝对过期、按账户的凭证纪元),typed 契约 C 会话错误,纯函数 CSRF 双提交判定,以及 auth-disabled 逃生阀。本包不读写任何 HTTP;cookie、请求头、状态码与装配归路由层所有。

校验按固定顺序裁决一个呈递的令牌:格式门(精确的规范 UUID 形状——其余一律 MALFORMED 且绝不触达存储,即旧网关的垃圾 cookie 规则)、存储查找加恒时令牌比对(INVALID)、持久行不变量(类型化的服务端故障——存储层不会复读这些列,因此服务在每次读取时自行守卫正的签发版本、数值化时间戳与布尔标记)、绝对过期(EXPIRED),最后是签发版本对账户会话版本的比对(INVALID)——它实现旧 token_version 的全灭语义:改密或账户级吊销之后,所有从旧版本签发的会话必死。

## 目录

- [CSRF 双提交](#csrf-double-submit)
- [auth-disabled 逃生阀](#auth-disabled-escape-valve)
- [组合方式](#composition)
- [模型体验](#model-experience)
- [已知限制与顺延工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="csrf-double-submit"></a>
## CSRF 双提交

`mintCsrfToken` 在每次会话签发时铸一枚令牌;服务端从不存储它。`verifyCsrfTokens` 经固定摘要的恒时路径比对 cookie 与头两个值。`evaluateCsrfRequest` 把旧契约折成一个纯函数判定:RFC 安全方法(GET、HEAD、OPTIONS、TRACE)免校验;旧契约的写方法(POST、PUT、DELETE、PATCH)强制校验;落在两张清单之外的方法 fail-closed;以显式呈递的 Bearer 令牌鉴权的请求免校验(没有可供借道的 ambient cookie 凭证——D2 兜底通道);调用方配置的路径豁免(精确匹配、尾斜杠不敏感;前缀匹配、旧 webhook 风格)免校验。

-----

<a id="auth-disabled-escape-valve"></a>
## auth-disabled 逃生阀

`resolveAuthDisabled` 只在显式生产环境(`QILIN_ENV` / `ENVIRONMENT` 取 `prod` 或 `production`)之外认可显式的 `QILIN_AUTH_DISABLED=1`;未配置即鉴权开启。`assertAuthDisabledAllowed` 是启动期的 fail-loud 守卫:在生产环境里请求关闭鉴权的部署会拒绝装配,而不是带着「鉴权已开」的实情静默服务。`authDisabledWarning` 在逃生阀激活期间返回面向运维的警示文案。

-----

<a id="composition"></a>
## 组合方式

本包是共享服务库,不是 Cordis 插件;HTTP 层在一个 `AccountStore`(`@qilin/account-core` 的 `SqliteAccountStore`)之上构造 `SessionService`。其 invariant 伴生插件有意为空:本包不拥有任何持久状态——会话住在 account-core 的存储里,CSRF 令牌是无状态的双提交值,逃生阀读的是进程环境。

-----

<a id="model-experience"></a>
## 模型体验

无,因为本包的会话裁决、CSRF 判定与逃生阀解析都是服务端控制流,绝不会进入模型请求、提示词或工具结果。

#### KV Cache 影响

无;本包不产生任何模型可见内容,因此不存在前缀、增长或失效行为。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与顺延工作

- **令牌落库不做哈希** —— 会话 id 按签发原样存储,因为标识符列归账户存储所有;格式门、恒时比对与主键查找覆盖了派生 id 方案所能覆盖的面,且无需改动 account-core 存储。
- **清单外方法 fail-closed** —— 旧网关豁免了两张方法清单之外的方法;本包对它们强制 CSRF 校验(deny-wins 血统)。
- **过期行不做清扫** —— 校验是只读的;过期行会留存到账户级吊销或未来的维护清扫。
- **无刷新或滑动过期** —— 每个会话只有一个绝对过期,与旧 JWT 语义一致;续期即重新登录。
- **豁免清单归调用方所有** —— 本包不附带默认路径豁免;HTTP 层须显式配置。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

`SessionService`、CSRF 判定与逃生阀都是构建在 `AccountStore` 接口上的无状态模块;不拥有 HTTP 面、不拥有自身持久状态,使本包保持为 HTTP 层所组合的纯决策层。

</details>
