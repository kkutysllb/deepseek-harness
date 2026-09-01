---
description: "Web 外壳的账户面：在会话建立前遮罩应用的会话遮罩（带“记住我”的登录、首个管理员初始化）与供管理员管理账户的设置分区。"
kind: "package-reference"
---

# @qilin/client-ui-accounts

[English](README.md) | 中文

## 概述

Web 外壳的**账户**面。浏览器插件在 client-connection 暴露的 HTTP 账户接口之上做两处注册：`shell.overlay` 条目（id `account`），在会话建立前遮罩整个应用；以及一个 `settings.section` 页面（id `accounts`），供管理员管理账户。两处注册在插件激活期间都不会触碰连接——注入面都延迟到首次使用时才读取连接句柄。

遮罩在挂载时探测会话（先 `setupStatus()` 再 `me()`）。全新安装（`needsSetup`）只显示确定性的管理员初始化表单；匿名访客看到带“记住我”的登录表单；已登录用户什么也看不到。连接的共享 401 信号会把已登录的遮罩翻转回登录表单，并提示会话已结束。提交失败时将服务端错误码映射为本地化文案，不暴露传输细节。

设置分区渲染账户表格（邮箱、角色、启停状态），并提供逐行的角色切换、启用/禁用与重置密码操作，重置由内联确认行保护。所有保护均以服务端为准：客户端把 `self_protected`、`last_admin_protected`、`weak_password` 与 `forbidden` 呈现为本地化的内联提示；非管理员看到的是“需要管理员权限”状态而非表格。注册使用 `ctx.slots.inject()`，因此两个条目都能跟随延迟声明、重新声明、本地化变化与 teardown，而无需 import 槽位拥有方。

## 目录

- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="model-experience"></a>
## 模型体验

无；本包只通过 Host 的 HTTP 认证 API 呈现账户面。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓事项

- **会话探测仅在挂载时进行** —— 遮罩在每次挂载时探测一次，之后只响应 401 信号；它不会自行轮询会话过期。
- **个人自助能力暂缺** —— 自改密码与登出控件属于账户面契约，但顺延到外壳头部工作（S6）；本分区仅覆盖管理员管理。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

两处注册都是惰性槽位注入（`ctx.slots.inject()`）：注入面只在首次使用时读取连接，所有保护决策都以 Host 的 HTTP 认证 API 为准、留在服务端。

</details>
