# Agent Note:account-rbac 策略引擎(accounts/)

Status: implemented

[English](2026-08-28-account-rbac-policy-engine.md) | 中文

## 问题

移植的 S4 步要在 S3 会话面之上叠加基于角色的授权,且不得削弱它已建好的任何栅栏:请求需要单一的单请求 Principal,让所有消费方判定同一身份;旧系统的 plain-user/admin 角色二分要以权限基线重现;资源级 allow/deny 策略(工具、模型、技能、MCP 服务器、路由)要可配置却默认关闭;/api 传输层要在鉴权判定之后增加授权判定——仅服务端。账号栈必须保持分层:本步组合 account-auth 与 account-core,绝不触及 HTTP 面或传输层。

## 决策

`packages/accounts/account-rbac`(`@qilin/account-rbac`)提供可选 cordis 服务 `rbacAuth`(结构契约 `RbacAuthGate` 声明于 client-connection,在 /api 业务路由与专用 RPC 通道路由的 `apiAuth` 判定之后立即按名征询——`apiAuth` 先例保持依赖箭头单向)。授权器每请求只解析一次 Principal(cookie 优先、Bearer 兜底;auth-disabled 逃生阀产出合成 admin;一切失败落到匿名且被拒)并 memoize 在请求对象上,路由判定、属主检查与目录投影共享同一构造点。判定次序为 deny 恒胜:策略 deny,再策略 allow,再角色基线(admin 全通,user 为读类 + `session:*`,未知角色与未解析身份 fail-closed)。资源策略是装配期恰好读取一次的版本化 JSON 文件:文件缺失仅运行基线(与 S3 逐字节一致的默认关闭);文件非法则整个组合拒启(`PolicyConfigError`);`filterCatalog` 用与运行时判定相同的谓词投影真实资源目录——对 user deny 的真实引擎工具会从其目录消失并在分发处被拒,而 admin 段保留。属主检查是可组合的函数式判定(`ownerCheck`),不是路由框架钩子。

## 后果

- 授权是叠加在鉴权之上的组合选择:不挂本插件,引擎的 /api 与 S3 逐字节一致;挂载后栅栏位于鉴权判定之后,绝不改变 401 语义。
- per-file 100% 覆盖率门禁无豁免成立:permissions、策略校验、授权器与插件全部表驱动;集成套件以真实 node:http 组合(webServer + connection + account-http + account-rbac)驱动裸 HTTP——admin 写类请求通过,同一方法对 user 回 403 `permission_denied`,策略 deny 在传输层翻转基线放行的方法。
- 默认 user 基线是记录在 README 的产品决策(开放注册使读类成为可用默认;会话域承载旧 plain-user 路由集;其余在策略授予前一律 fail-closed)。
- 策略修改需重启(装配期读取;热加载与装配期目录过滤不相容)——已在 README 文档化,不是隐性约束。

## 已考虑的替代方案

- **在 webServer 或 account-http 内强制**——否决:webServer 是通用路由器,account-http 只拥有鉴权;把授权叠进去会耦合两个关注点并倒置账号栈。
- **热加载策略文件**——S4 否决:目录在装配期投影,运行中换策略会让已服务的资源被新策略拒绝;在重投影路径出现前,重启生效才是诚实的语义。
- **硬编码 admin 豁免 deny**——否决:deny 恒胜、无角色豁免,正是显式 admin 策略段存在的意义;不可豁免的 admin deny 是运营者给自己设栏的方式。
- **每路由注册式 RBAC 中间件**——否决:逐路由布线会让路由表与策略漂移;以端点→权限映射为键的单点传输级判定,保持唯一强制点与表驱动覆盖。
