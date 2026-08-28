# @qilin/account-rbac

[English](README.md) | 中文

账号体系的服务端 RBAC 层:每请求唯一的 Principal 构造点、角色权限基线、配置驱动的资源策略(deny 恒胜)、装配期目录过滤,以及传输层在 `apiAuth` 鉴权判定之后按名征询的可选 `rbacAuth` 栅栏。本包在 `@qilin/account-core` 存储之上组合 `@qilin/account-auth` 的会话服务;从不 import HTTP 面与传输层——强制点是结构化的按名服务(`apiAuth` 先例),依赖箭头保持单向。

## 请求 Principal(契约 M)

`RbacAuthorizer.resolvePrincipal` 是唯一构造点:会话 cookie(线上常量 `access_token`,与栅栏一致 cookie 优先)或 Bearer 头解析为携带账号投影、系统角色与活会话元数据的 Principal;auth-disabled 逃生阀解析为合成 admin,不触库;任何解析失败都落到匿名 Principal,而所有判定都会拒绝它。解析结果按请求对象 memoize,同一请求的所有消费方——路由判定、属主检查、目录投影——共享同一个 Principal。

## 角色默认矩阵(契约 L,B1 基线)

判定次序:策略 deny 最先(压倒一切角色),策略 allow 次之,然后是角色基线——admin 为结构性全通,user 角色按下表执行,未解析身份与未知角色值一律拒绝(fail-closed)。

| 角色 | 默认权限集 | 依据 |
| --- | --- | --- |
| `admin` | `*:*` | operator 角色只由确定性的首个管理员初始化(D5-a)创建;引擎单实例,对 admin 基线设限没有威胁模型。显式策略 deny 仍绑定 admin——deny 恒胜,无角色豁免。 |
| `user` | `*:read`、`*:list`、`*:get`、`*:status`、`*:search`、`*:stats`、`session:*` | 读类动作保证开放 Web 面可用:D5-B 开放注册使 `user` 成为匿名访客的默认角色,基线若破坏浏览,开放注册就失去意义。会话域全量开放是旧 plain-user 路由集(threads 读写删 + runs 创建/读取/取消,契约 N)在引擎中的后裔——会话就是那些 threads。其余一律默认拒绝,会话域之外的写访问(settings、models、凭据、工具调用面)必须由策略显式授予。 |
| 匿名 / 未知 | 无 | 契约 L fail-closed:未解析身份永不通判。 |

权限串是 `resource:action` 对(契约 N)。/api 端点命名空间在第一个点处切分映射:`session.list` 判为 `session:list`,`settings.update` 判为 `settings:update`;无点端点归入 `route` 域。

## 资源策略(契约 L,B2)

资源策略由配置驱动、默认关闭、装配期读取。插件在启动时一次性读入文件——进程存活期内不热加载(见 Known Limitations)。配置了路径但文件尚不存在时仅运行基线(即文档化的默认关闭状态);文件存在但校验失败则整个组合拒启(fail-closed boot)。

```json
{
  "version": 1,
  "roles": {
    "user": {
      "tool": { "deny": ["schedule_create"], "allow": ["schedule_*"] },
      "model": { "allow": ["deepseek-*"], "deny": ["claude-*"] },
      "skill": { "allow": ["*"] },
      "mcp_server": { "deny": ["legacy-*"] },
      "route": { "deny": ["settings:update"], "allow": ["credentials:read"] }
    },
    "admin": { "mcp_server": { "deny": ["legacy-*"] } }
  }
}
```

每个资源种类(`tool`、`model`、`skill`、`mcp_server`、`route`——引擎的真实目录面)各自一套规则。模式为精确名、尾随 `*` 前缀、route 权限中的 `*` 段,或裸 `*`。求值 deny 恒胜:任一命中的 deny 对所有角色移除候选(显式 admin deny 同样生效);命中的 allow 授予;未命中的候选落入兜底——route 落到角色基线,目录落到可见性默认(allow 列表收窄非 admin 角色;仅有 deny 时其余保持可见)。

## 装配期目录过滤(system-prompt waterfall 栅栏)

插件在 apply 时无条件注册 `system-prompt/assemble` waterfall listener:RBAC 先于 system prompt 服务(`@qilin/system-prompt`)启动也会最终挂上;从不挂载该服务的组合根本不会发出该事件,listener 永不触发,一切不变。listener 在链的末端运行——先 `await next()`,此时 `@qilin/tools` 经 provider 贡献的工具已进入 `assembly.tools`——再用与运行时资源判定相同的谓词过滤这些工具。身份来自下文的显式 carrier;未绑定 principal 的 scope fail-closed 为空工具列表。listener 从不变异注册表本身。重启生效:listener 闭包持有启动时加载的策略,绝不重读。

## Principal carrier(agent scope 的服务端身份)

`bindRbacPrincipal(agentCtx, principal)` 是组合告知 RBAC 栅栏「哪个 principal 拥有该 agent scope」的唯一受认可途径:在 scoped 上下文上的显式服务端调用(scope 标签即查找键)。身份绝不从客户端 metadata、async-local storage 或裸 cookie 猜测;未带 scope 的上下文被绑定器拒绝,未绑定的 scope 投影空目录。绑定生命周期:对同一 scope 重新绑定会替换旧 principal(后绑者胜,复用的 scope 不残留旧身份);返回的 disposer 移除绑定——scope 销毁时调用,旧 principal 不得活得比它的 agent 更久。

未加载策略(`policy: null`)时,已绑定的 principal 保持与 RBAC 之前完全一致的完整目录(默认 parity);唯一新增的是未绑定 scope 的 fail-closed 空投影。

## /api 栅栏(D3 强制点)

插件提供可选的 `rbacAuth` 服务;client-connection 传输层在 `/api` 业务路由与专用 RPC 通道路由的 `apiAuth` 鉴权判定之后立即按名征询——仅服务端,浏览器永不是安全边界。拒绝回答 403 与旧信封(`{error: {code: 'permission_denied', message}}`)。未认证请求在鉴权栅栏处已经止步(401);WebSocket 升级仅做鉴权,因为事件流没有可供授权的方法面。

## 属主检查(契约 N)

`ownerCheck(principal, ownerId)` 是供路由 handler 与权限检查组合的函数式属主判定:属主通过,admin 角色(含逃生阀合成 admin)通过,其余——以及缺失的属主参照——一律失败。

## 模型体验(Model Experience)

无:本包的 Principal 解析、策略求值与目录过滤都是服务端控制流,从不进入模型请求、提示词或工具结果。

#### KV Cache 效应

无;本包不贡献任何模型可见内容,因此无前缀、增量或失效行为。

## Known Limitations 与暂缓工作

- **策略仅在启动时加载,修改需重启**——没有热加载。装配期目录过滤本就使运行中换策略不健全(编辑前服务的目录不会重新投影);重启生效即定义语义,热加载暂缓。
- **与 `@qilin/account-http` 挂载同一 `dbPath`**——插件自行打开一条存储连接以解析会话;两个插件组合在同一账号库文件上是被支持的形态(SQLite 容忍双连接),路径不同会让 RBAC 静默作用于另一批用户。
- **资源策略目录按名匹配**——对工具名的 deny 移除的是工具本身,而非 Code Mode 内对它的某次具体调用;限制用户在沙箱内可运行的代码是另一道栅栏,暂缓。
- **专用通道端点以 `route:<endpoint>` 命名**——无点的专用 RPC 通道端点(如 `goals/create`)在 `route` 域下判定,策略作者须写全前缀形式才能授予。
- **无逐请求审计日志**——拒绝以 403 返回权限串但不单独记账;授权决策的审计轨迹暂缓。

## 错误语义

- **身份故障不是权限拒绝。**只有预期的客户端侧会话失败(`SessionValidationError`:未知/过期/畸形令牌)折叠进匿名 fail-closed 身份。损坏的持久行或未知存储异常向上传播:提供方在自己的 logger 边界记日志,传输层把任何 gate 抛错映射为稳定的 `500 {error: {code: 'internal_error'}}`——绝不以 403 把存储损坏粉饰成授权判定。
- **策略加载拒绝携带稳定码**(`policy-file-unreadable`、`policy-file-json`、`policy-schema`)且消息脱敏:不含配置路径、fs errno、JSON parser 片段。原始 cause 只保留在错误的 `cause` 上供内部 logger 边界使用。
- **非法权限输入 fail-closed。**空串、缺/多冒号、空段、空白与非字符串运行时值在授权器边界即被拒——任何畸形输入都到不了模式匹配器。
