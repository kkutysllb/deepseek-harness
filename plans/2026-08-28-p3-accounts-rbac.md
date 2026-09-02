# P3 账户 BFF + RBAC 子计划(定稿 v1)

> **已定稿(2026-08-28)**:D1–D6 经结构化决策面板由用户逐项拍板(D1/D2/D3/D4/D6 采纳推荐;D5 用户否决推荐、拍板开放注册,附安全适配条款见 §3.D5)。
> 本计划自此可执行;S 系列按序推进。

**目标(一句话):** 为 OpenKylin 引擎(qilin-engine)补齐多用户账户体系(注册/登录/会话)
与服务端 RBAC 强制点,使 Web 表面从「单用户 loopback 信任」演进为「多用户、可鉴权、
可授权」,并为 P4 多服务商模型与 P5 品牌壳提供账户地基。

**架构取向(已定,D1=A):** 在引擎内以 cordis 插件包(
`packages/accounts/*`)扩展既有 `webServer` 路由注册表与 `/api` 传输层,
不新建独立进程;RBAC 语义移植自旧 Python 网关(deny-wins、fail-closed)。

**技术栈:** TypeScript / cordis 插件内核 / node:http(webServer)/ node:sqlite(候选,D6)/
vitest(测试与覆盖率门禁)/ scrypt 或 bcrypt(密码哈希,S1 定)。

---

## 1. 目标与非目标

### 1.1 目标

1. **多用户账户**:注册(D5 决定开放策略)、登录、登出、改密、会话保持与吊销。
2. **服务端强制 RBAC**:账户角色(admin/user 起步)+ 资源级策略,强制点在服务端
   API 面(/api),前端仅做展示性配合。
3. **BFF 边界确立**:明确账户/鉴权逻辑落在引擎哪个组合层(D1),不破坏引擎
   「webServer 只管路由注册、不知道 harness 概念」的分层纪律。
4. **凭证源收口(G1 联动)**:盘点并冻结凭证读取位点,给出统一凭证源的决策依据(D4),
   为 P4 多服务商铺路。
5. **语义沿用**:旧 Python 网关(JWT/CSRF/RBAC/注册开关)的产品行为契约移植为 TS 实现,
   代码不移植、语义移植。

### 1.2 非目标

- **不实现** P4 多服务商模型接入本身(P3 只预留凭证解析扩展点,见 D4)。
- **不实现** P5 商业品牌壳(P3 前端登录页使用现有 ui-primitives 中性皮肤)。
- **不迁移/不退役** P6 的 8 个 IM 渠道(`app/channels/`:dingtalk、discord、feishu、
  github、slack、telegram、wechat、wecom);其语义仅作借鉴。
- **不触碰** 两仓的 `vendor/` 与 OpenKylin 仓 `python/` 目录。
- **不做** 计费/配额/租户隔离(组织级多租户),仅做单实例多用户。
- **不修改** 引擎既有会话(session)持久化格式;用户↔会话的归属关系为 P3 新增映射,
  不改写历史会话数据。

---

## 2. 现状盘点摘要(实测取证)

### 2.1 引擎侧:认证/账户原语现状(qilin-engine @ 795b8dc, tag qilin-engine-v0)

**结论:引擎当前完全没有用户/账户/会话鉴权概念;Web 表面是「loopback + 受信主机名」
信任栅栏下的单用户模型。**

1. **apps/web 是纯 SPA,不是服务端**。入口仅挂载 `@qilin/client-web` 的 `AppWebEntry`
   (`apps/web/src/main.ts:1-9`);服务端能力全部在宿主包里。
2. **Web 服务端 = node:http + 极简路由注册表**。`@qilin/host-webserver`
   (`packages/host/webserver/src/index.ts:1-9`)提供:
   - exact/prefix 两种路由注册(`register`,index.ts:108-115);
   - exact 路径 WebSocket upgrade 注册(`registerUpgrade`,index.ts:123-129);
   - **唯一 fallback 席位**(SPA dist 静态服务,由 frontend-static 占用,
     `packages/host/frontend-static/src/index.ts:1-8`);
   - index.html 注入表与 raw transform(`webserver/index-inject`,index.ts:26-36)。
   - 监听配置只有 host(`'127.0.0.1'` 或 `'0.0.0.0'`)与 port(index.ts:59-64),
     默认 127.0.0.1:3080(`packages/bundle/web-app/cordis.patch.yml` webserver 行)。
   - **没有中间件链、没有 cookie、没有鉴权原语**;全仓 `packages/host|api|client`
     中 grep cookie/authorization/bearer 无一处 HTTP 鉴权语义命中(实测,
     命中均为会话/附件/UI 槽位作用域词)。
3. **组合层**:`packages/bundle/web-app/cordis.patch.yml` 是 Web 表面的 cordis patch:
   - `webserver` 行(host/port 来自 `webStartup` 服务,回退 127.0.0.1:3080);
   - `connection`(`@qilin/client-connection`)注释原文:Owns both ends of the web
     transport: node half binds the gateway to the webserver under **/api**; browser
     half is the fetch/SSE client(同文件 connection 行);
   - `web-runtime` 行提供 `trustedHosts`(LAN 受信主机字面量);
   - `storage-json` 行:`root: dshHomePath('storages')`(按 home 目录而非用户隔离)。
4. **传输信任栅栏(现有唯一「鉴权」)**:ws 升级前做不可信拒绝
   (`packages/client/connection/src/websocket-downlink.ts:141` — Reject an untrusted
   upgrade before protocol negotiation),信任来源是 loopback 主机名与 `trustedHosts`
   字面量(`api-request-trust.ts`、`loopback-hostname.ts`)。
   ⚠️ 引擎配置允许 bind 0.0.0.0,一旦有人开 LAN 部署,现有栅栏只挡主机名不认人——
   P3 必须在此收口。
5. **宿主 API 面**:`@qilin/host-apiproxy` 实现全部宿主侧 RPC
   (`packages/host/apiproxy/src/api-proxy.ts:1-3`,单文件 3642 行,unary +
   rpcId 回显);`@qilin/api-gateway` 是 Typert Remote 分发
   (`packages/api/gateway/src/index.ts:1-8`)。**所有 /api RPC 默认无用户身份。**
6. **身份原语只有一个匿名 ID**:`@qilin/anonymous-user-id` —— per-home 随机 UUID,
   删文件即换新身份(`packages/identity/anonymous-user-id/src/index.ts:1-12`)。
   与「用户账户」无任何关联。
7. **profile 是配置组合,不是用户**:`qilin <profile>` 经 profile-boot 叠加
   patch 层(`apps/cli/src/profile-boot.ts:1-12`);`~/.dsh/profiles/web` 是 Web
   表面的 profile。**profile 与多用户无关,不能复用为账户。**
8. **可复用的既有缝**(P3 的落点资产):
   - **凭证缝**:`ctx.credentials`(records)+ `ctx.authorization`(交互式取凭据流)
     是引擎的两大认证类缝(`packages/llm/llm-pi-ai/src/auth.ts:5-9`);
   - **settings 缝**:`settings.yaml` 单文档、写锁、热发布
     (`packages/settings/settings-file/src/index.ts:1-8`);
   - **存储先例**:session 持久化已有 jsonl 与 **sqlite(node:sqlite)** 两个实现
     (`packages/session/session-persistence-sqlite`),D6 选 SQLite 有先例可依;
   - **测试基建**:vitest 全仓统一,含 e2e 配置与分区覆盖率
     (`vitest.e2e.config.ts`、`scripts/run-coverage-partitions.ts`)。

### 2.2 旧 Python 网关语义盘点(OpenKylin 仓 qilin/ 与 app/,只读)

**结论:旧网关有一套完整、自洽的账户行为契约,值得整体沿用其语义。**

#### 2.2.1 值得沿用的产品语义清单(行为契约,非代码)

| # | 语义 | 旧实现证据 | P3 沿用方式 |
|---|------|-----------|------------|
| A | **JWT 签发**:HS256,claims `sub`(user UUID)/`exp`/`iat`/`ver`(token_version),默认 7 天 | `app/gateway/auth/jwt.py:12-39` | 会话令牌语义(是否沿用 JWT 形态见 D2) |
| B | **token_version 吊销**:改密即 token_version 递增,旧令牌全灭 | `jwt.py:18`、`auth/models.py:36-38` | 会话/令牌吊销模型 |
| C | **typed 令牌错误**:EXPIRED / INVALID_SIGNATURE / MALFORMED 三分类 | `jwt.py:42-57` | 前端可据此区分「重新登录」与「重试」 |
| D | **HttpOnly cookie 优先 + Bearer 兜底**:桌面跨端口 dev 模式从响应体取 token 走 Bearer;仅会话创建端点(login/register/initialize)回传 access_token | `auth_middleware.py:119-139`、`auth/models.py:52-61` | 双轨鉴权(D2) |
| E | **cookie 安全策略**:HttpOnly access_token + qilin_session_persistent(记住我);secure 按 https 判定、loopback 豁免 + 显式环境开关逃生 | `session_cookie.py:18-53`(:20 为逃生开关) | 本地 dev 与部署两态 |
| F | **CSRF 双提交**:state-changing 方法(POST/PUT/DELETE/PATCH)校验 csrf_token cookie + X-CSRF-Token 头;豁免 /auth/me 与 webhook(供应商签名自证);RFC-001 契约 | `csrf_middleware.py:1-5`、`:26-28`、`:41-60` | 引擎 /api 写路径 |
| G | **auth-disabled 逃生阀**:OPENKYLIN_AUTH_DISABLED,显式生产环境禁止禁用 | `auth_disabled.py:8-20` | 本地/E2E 模式 |
| H | **垃圾 cookie 防绕过**:拒绝把任意 cookie 形状字符串当会话 | `auth_middleware.py:137-139` | 安全面细节 |
| I | **用户模型**:UUID、唯一 email、bcrypt 哈希(OAuth 用户可空)、`system_role: admin|user`、oauth_provider/oauth_id 联结、needs_setup(重置账户补全流程) | `app/gateway/auth/models.py:15-38` | 账户实体(D6 存储) |
| J | **注册开关**:POST /auth/register 是否开放由配置即时读取决定(改配置即生效);首用户 initialize 流 + setup-status 探测 | `routers/auth.py:355-408`、`:540`、`:614` | D5 注册策略 |
| K | **端点族**:`/api/v1/auth/` 前缀下 login/local、register、logout、change-password、me、setup-status、initialize、providers、oauth/{provider}、callback/{provider} | `routers/auth.py:53、318、380、424、439、516、540、614、734、761、853` | 路由面形状 |
| L | **双层 RBAC**:(1) 账户级 system_role(admin|user);(2) 配置驱动资源策略:role × resource(tools/models/skills/sandbox/mcp_servers/routes)的 allow/deny,支持通配;**deny 恒胜**;未知/缺失角色抛错→fail_closed 默认真;默认 enabled:false 保留全通过行为 | `qilin/authz/rbac.py:1-10、26-33、82-91`;`qilin/config/authorization_config.py:1-9、29-32` | D3 RBAC 模型 |
| M | **RBAC 双强制层**:装配期能力过滤(工具根本不可见)+ 运行期执行拒绝(guardrails 适配);Principal 由单一 builder 构造保证一致 | `authorization_config.py:4-7`;`qilin/authz/principal.py:1-6` | 强制点设计(D3) |
| N | **路由级权限串**:`resource:action`(threads:read/write/delete、runs:create/read/cancel)+ require_auth / require_permission(owner_check 属主校验) | `app/gateway/authz.py:1-28、56-67` | /api 方法级强制 |
| O | **users 持久化**:SQLAlchemy + alembic;users 表 + oauth 身份部分唯一索引(sqlite/postgresql 双方言) | `qilin/persistence/migrations/versions/0001_baseline.py:185-199` | D6 选型参照 |

#### 2.2.2 仅记录、不沿用的旧语义

- **OIDC/Keycloak SSO 与 GitHub OAuth 登录**(`app/gateway/auth/oidc.py`、
  `github/app_auth.py`):P3 不做第三方登录;引擎侧第三方 OAuth 的正确位置是
  凭证缝(`ctx.authorization` 流),留待 P4 与需求出现再议。
- **webhook 签名通道**(`routers/github_webhooks.py`):属 P6 渠道域,P3 不涉及。
- **langgraph_auth**(跨 SDK Bearer 注入):P3 的 Bearer 兜底语义已含其价值(契约 D)。

### 2.3 G1 凭证现状

**事实(实测):**

1. OpenKylin 仓 `.env` 仅一枚键:`MINIMAX_API_KEY`(值脱敏)。
2. 引擎实际凭证文档 `~/.dsh/.credentials.yaml` 的 refs(仅列键名):
   `DEEPSEEK_API_KEY`、`MINIMAX_CN_API_KEY`、`ZAI_CODING_CN_API_KEY`、
   `QWEN_TOKEN_PLAN_CN_API_KEY`、`OPENAI_CODEX_API_KEY`。
   即:真实 DEEPSEEK key 在 home 凭证文档,与用户陈述一致;且**远不止两枚键,
   多服务商存货已现雏形(P4 前瞻输入)**。
3. **命名不一致疑点**:`.env` 的 `MINIMAX_API_KEY` 与 refs 中 `MINIMAX_CN_API_KEY`
   键名不匹配;凭证分层解析按 ref 名取值,`cwd/.env` 只是只读回退层
   (`packages/credentials/credentials-local/src/index.ts:3-15`),若产品配置引用的是
   `MINIMAX_CN_API_KEY`,`.env` 里那枚键永远不会被读到。**列为 P3-S0 联调核验项。**
   ✅ **S0 已核验(2026-08-28)**:产品实际引用键名为 `MINIMAX_CN_API_KEY`
   (唯一派生点 `deriveKeyRef`(`ui-settings-models/src/client/store.ts:70-72`),
   providerId `minimax-cn` → `MINIMAX_CN_API_KEY`;e2e 与组件测试断言同);
   已按机械风险最小落地:改仓根 `.env` 键名为 `MINIMAX_CN_API_KEY`(值原样保留,
   零代码改动)。详见台账 P3 段 S0-1。
4. **引擎全部凭证读取位点清单**(统一凭证源 D4 的事实基础):
   - 唯一管理面:`LocalCredentialProvider`,默认 `$OPENKYLIN_HOME/.credentials.yaml`
     (即 `~/.dsh/.credentials.yaml`,watch 热发布,跨进程写锁,注释保留的叶子级补丁)
     (`packages/credentials/credentials-local/src/index.ts:43-78`);
   - 信任分层:进程 env > 凭证文档 > `cwd/.env` > `$OPENKYLIN_HOME/.env`
     (同文件 :3-15 文档注释);
   - 消费方:LLM 适配族按 **scope 化 record** 读写(credentialKey(llm-pi-ai, providerId),
     `packages/llm/llm-pi-ai/src/auth.ts:27-44`);OAuth grant 以不透明 JSON 原样入库
     (同文件 :41-45)——**引擎凭证缝天然支持多服务商与 OAuth 形态凭据**;
   - 交互式取凭据:`ctx.authorization` 流缝,按 CredentialKey 注册,UI 无关
     (`packages/credentials/authorization/src/index.ts:1-40`);
   - 旁路读取:`apps/cli` 的分层 env 加载(loadLayeredEnv(qilin),`apps/cli/src/bin.ts:31`);
     除此以外无其他凭证读取位点(实测 grep)。

---

## 3. 决策记录(D 系列,已拍板 2026-08-28)

> 每项保留候选项 + 推荐 + 理由原文,拍板结论以「已拍板」行回填。

### D1 账户体系落点

| 选项 | 说明 | 代价/风险 |
|---|---|---|
| A. **引擎内扩展(推荐)** | 新增 `packages/accounts/*` cordis 插件族 + 扩展 `web-app` bundle patch;账户路由注册到既有 `webServer`,中间件语义实现为 /api 路由包装层 | 需要在 apiproxy/connection 附近加身份传递缝,动引擎面较深 |
| B. 新建 BFF app(`apps/bff`) | 独立进程,前置反代引擎 webserver,自带账户路由,其余转发 /api | 双进程部署/端口/会话共享复杂;引擎单进程组合哲学被打破 |
| C. 独立服务(延续旧网关形态) | FastAPI/Node 独立服务,引擎整体后置 | 与「引擎移植完成、Python 退役」方向相逆;P6 之外的第二个服务面 |

**推荐:A。** 理由:引擎已有干净的路由注册表与 /api 传输,账户是最典型的
「组合级横切面」,cordis patch 层正是为此设计;单进程组合避免了 B/C 的双服务运维、
会话共享与 CORS 问题。风险(A 的身份传递缝)在 S3 以显式 seam 解决。

**已拍板(2026-08-28):A。**

### D2 认证机制

| 选项 | 说明 | 代价/风险 |
|---|---|---|
| A. **服务端会话 + HttpOnly cookie 为主(推荐)** | 会话存服务端(SQLite,可即时吊销),cookie 只存不透明会话 id;Bearer token 作为脚本/API 兜底(契约 D) | 每请求一次会话查表(可内存缓存);需按旧语义做 CSRF |
| B. 无状态 JWT(cookie + Bearer 双轨,完全照搬旧实现) | 服务端无会话表 | 吊销依赖 token_version 全量比对,仍需服务端状态;7 天窗口内改密前的旧令牌风险窗口大 |
| C. 延伸引擎既有机制(仅 loopback/trustedHosts 栅栏强化) | 不引入账户令牌,只加强主机信任 | 无法满足多用户(不认人只认机器),与产品需求直接冲突 |

**推荐:A(cookie 会话为主 + Bearer 兜底)。** 理由:浏览器是唯一主表面,HttpOnly cookie
最安全;服务端会话表让「登出/改密/管理员踢人」成为 O(1) 吊销,语义上等价覆盖旧
token_version 契约(B 项的 ver 语义映射为会话版本字段保留);Bearer 兜底沿用旧
「仅会话创建端点回传 token」的窄口径,服务 P6 渠道与脚本调用。旧 JWT 的 typed 错误
分类(契约 C)原样保留在会话校验的错误面。

**已拍板(2026-08-28):A。**

### D3 RBAC 模型

| 选项 | 说明 | 代价/风险 |
|---|---|---|
| A. 仅 admin/user 双角色 + 属主校验(owner_check) | 最小可用 | 无法表达「某角色禁用某工具/模型」的资源粒度 |
| B. **双层:系统角色 + 配置驱动资源策略(推荐)** | 账户表存 system_role(admin|user|…);策略文件定义 role × resource(以引擎实际资源为准:tool/model/skill/mcp_server/route)allow/deny;通配;**deny 恒胜**;未解析身份/未知角色 → fail_closed;默认关闭、开关开启即生效 | 策略配置面需要校验器(旧实现已给出全部语义,直接移植) |
| C. 完整 RBAC/ABAC(角色/权限/继承表) | 企业级 | P3 规模失控,无当前需求拉动 |

**推荐:B,并分两小步落地**:B1 先做系统角色 + 路由级 resource:action 权限串 +
owner_check(契约 N),B2 再上配置驱动资源策略(契约 L/M)。
**强制点结论(随 B 定):服务端 /api 网关层为唯一强制点**(路由包装层统一校验);
装配期能力过滤(工具从目录摘除)作为 B2 的增强;**前端角色判断仅用于 UI 呈现,
永不作为安全边界**。

**已拍板(2026-08-28):B(双层,B1→B2)。** 注意:受 D5 开放注册影响,B2 资源
策略由「增强」升级为 **P3 范围内必做**(见 §3.D5 适配条款 d),S4 规模 M→L。

### D4 凭证统一源

| 选项 | 说明 | 代价/风险 |
|---|---|---|
| A. 维持全局凭证(home 文档 = 管理员供给)(P3 推荐) | `~/.dsh/.credentials.yaml` 继续作为唯一管理面;账户与凭证解耦:任何登录用户可用服务端已配置的模型键 | 用户间无凭证隔离(单租户下可接受);需在文档/权限上显式声明 |
| B. 用户级凭证库 | CredentialProvider 新增 per-user 实现(如 `~/.dsh/users/<id>/credentials.yaml` 或账户库内加密表);RBAC 决定谁能写 | P3 范围显著膨胀;加密钥匙链(主密钥)是新课题 |
| C. 全部入 .env | 放弃管理面 | 与引擎分层信任语义冲突(该层不可写、热发布丢失),倒退 |

**推荐:P3 采 A,同时把「按用户解析凭证」定义为 P4 的扩展点**——引擎凭证缝
(`CredentialProvider` 可多实例、record 已 scope 化)天然支持后续叠加 per-user
provider,届时只需按会话归属解析,无需改动账户模型。多服务商前瞻:G1 实测 home
文档已有 5 枚键,凭证统一源在引擎侧已事实上完成,**P3 要做的是「不再新增旁路读取点」
+ 修掉 2.3-3 的命名不一致疑点**,而非新建存储。

**已拍板(2026-08-28):A。**

### D5 注册方式

| 选项 | 说明 | 代价/风险 |
|---|---|---|
| A. 首用户 initialize + 默认关闭自注册(推荐) | 第一个注册者成为 admin(needs_setup 流);`/register` 受配置开关即时控制(契约 J);admin 可改配置邀请他人 | 需要一个最小「用户管理」面(admin 查看/禁用/重置) |
| B. 开放注册 | 任何人可注册为 user | 引擎是全功能 agent(可执行代码、读盘),开放注册等于把 shell 交给陌生人,必须叠加强配额/沙箱,超出 P3 |
| C. 纯邀请制(邀请码表) | admin 生成一次性邀请码 | 比 A 多一张表与一个流;可作为 A 的后续增强(S6 顺延项) |

**推荐:A**(完全沿用旧网关语义,行为契约已有实测依据);邀请码(C)列为顺延项。

**已拍板(2026-08-28):B 开放注册(用户否决推荐 A)。** 用户知悉选项 B 标注的
代价(「商用前风险面大,需配额/风控配套」)。随拍板定稿以下**安全适配条款**:

- a) **首管理员不靠注册竞争产生**:`/register` 一律创建 `system_role=user`;
  admin 由 CLI 初始化命令(S3 的 `initialize`,确定性、幂等、仅空库可执行)创建,
  杜绝公网部署被抢注 admin;
- b) `/register` 默认开放;配置开关保留且即时生效(契约 J),可随时收紧为关闭;
- c) S3 范围增列:register/login 端点基础 rate limit(每 IP 计数,P3 内实现);
- d) **D3 的 B2 资源策略升级为 P3 必做**(开放注册下,资源策略是主要风险闸门;
  引擎是全功能 agent,可执行代码/读盘),S4 规模 M→L;
- e) 配额、邮箱验证、captcha 等防滥用配套登记 P5(顺延项,见 §6)。

### D6 数据存储

| 选项 | 说明 | 代价/风险 |
|---|---|---|
| A. 复用引擎文件存储(storages JSON / settings.yaml / 自定义 yaml) | 零新依赖 | users 需要唯一性约束、原子并发写、部分索引(oauth 联结唯一),JSON 文档全部要手搓且易漂移 |
| B. **SQLite(node:sqlite,推荐)** | 单文件(如 `$OPENKYLIN_HOME/qilin-accounts/accounts.db`);users/sessions 两表起步;唯一索引原生支持 | node:sqlite 在 Node 22 需关注版本行为(引擎已有 session-persistence-sqlite 先例,风险已被踩平) |
| C. 完整 DB 服务(postgres 等) | 旧实现(sqlalchemy+alembic)延续 | 引入外部服务依赖,与引擎「单进程、home 自包含」哲学冲突 |

**推荐:B。** 理由:账户数据的形状(唯一 email、唯一 oauth 联结、并发登录写)
本质是关系型;引擎已有 node:sqlite 生产先例;旧实现的 users 表语义
(契约 O)可近乎直译为建表语句,alembic 迁移换成手写幂等 DDL。sqlite 文件
纳入既有 home 备份/隔离语义。

**已拍板(2026-08-28):B(SQLite/node:sqlite)。**

---

## 4. 分步实施计划(S 系列)

> 节奏:**每步 = 实现(spec 先行)→ spec 审(独立子代理对照本计划与引擎 AGENTS 纪律)
→ 质量审(测试/覆盖率/边界)→ commit**。规模:S ≤0.5 天、M ≈1 天、L ≈2 天(单人)。
> ~~S0 完成前(D 系列拍板)后续步骤不得开工。~~ 已满足:D 系列于 2026-08-28 拍板,本文件已定稿。

### S0 决策冻结与 G1 核验(规模:S)✅ 完成(2026-08-28)

- **范围**(定稿后收窄):决策回填已完成(本文件 v1);剩余:核验 `.env MINIMAX_API_KEY` vs
  `MINIMAX_CN_API_KEY` 命名疑点(§2.3-3),确认产品实际引用键名并给出修正
  (改 .env 键名或补 ref 映射,以实测引用方为准);确定密码哈希
  算法(node:crypto scrypt 为默认候选,免新依赖)。
- **验收门禁**:~~本文件去掉 DRAFT 标头;§3 每项有「已拍板」结论~~(已完成,2026-08-28);
  核验项有书面结论。✅ 两项书面结论见台账 P3 段:S0-1 MINIMAX 键名(改 `.env`
  键名落地)、S0-2 密码哈希定 scrypt(node:crypto,参数固化 N=16384/r=8/p=1/
  32B salt/64B key,恒时比较)。
- **审**:用户本人审阅即视为 spec 审(决策面板已履行)。

### S1 账户核心域包 `packages/accounts/account-core`(规模:M)✅ 完成(2026-08-28,引擎仓提交 30e0a97)

- **范围**:用户与会话实体(TS 类型)、存储接口、SQLite 实现(users/sessions 表,
  含 `system_role`、`needs_setup`、会话版本字段(承接 token_version 语义)、oauth 联结列
  预留)、密码哈希(scrypt,参数固化)、幂等建表 DDL。**不含任何 HTTP。**
- **验收门禁**:vitest 单测覆盖实体/存储/哈希(错误口令、并发建表幂等、唯一约束
  冲突分类);覆盖率不低于包所在分区门禁;spec 文档列出表结构与不变量。
  ✅ 47 个表驱动用例全绿,src 全文件 per-file 100%(与全仓门禁一致);并发建表幂等、
  email/oauth 冲突分类、损坏行 fail-loud、错误口令与哈希篡改矩阵均有用例;表结构与
  不变量见包 README 与台账 P3 段 S1 小节。终验与分区挂载方式见台账。
- **审**:spec 审(对照 D5/D6 结论)+ 质量审(测试边界:时区/时钟回拨/损坏 DB 文件)。

### S2 会话与凭据服务包 `packages/accounts/account-auth`(规模:M)✅ 完成(2026-08-28,引擎仓提交 70aba2c)

- **范围**:会话签发/校验/吊销(登录、登出、改密全灭旧会话=契约 B 的 token_version 语义)、
  typed 会话错误(EXPIRED/INVALID/MALFORMED 对齐契约 C)、CSRF 令牌签发与双提交
  校验器(纯函数,不含 HTTP)、auth-disabled 逃生阀(显式生产禁用,契约 G)。
- **验收门禁**:vitest 全语义表驱动测试(对照 §2.2.1 契约 A/B/C/F/G/H 逐条);
  改密后旧会话必死的吊销测试;CSRF 方法矩阵测试。
  ✅ 89 个表驱动用例全绿,契约 A/B/C/F/G/H 逐条映射(映射表见台账 P3 段 S2 小节);
  改密全灭以「行删除」与「版本递增单独通道」双形态覆盖;CSRF 方法矩阵含清单外方法
  fail-closed;src 全文件 per-file 100%。终验与注册面见台账。
- **审**:spec 审(逐条对照契约表)+ 质量审(时序攻击面:比较函数恒时;垃圾
  cookie 防绕过用例,契约 H)。✅ 恒时比较统一走 SHA-256 定长摘要 + timingSafeEqual
  (长度归一消除早退侧信道);垃圾 cookie 形状门在存储探查前拒绝(用例断言零探查);
  上游评审观察项——会话行读取自带不变量守卫、损坏行 fail-loud typed 错误——已实现
  并有 14+3 类损坏矩阵与 raw-SQL 注入用例。

### S3 HTTP 面:`/api/v1/auth` 路由 + /api 强制点(规模:L)✅ 完成(2026-08-28,引擎仓提交 72682c8)

- **范围**:新插件注册到 `webServer`:`/api/v1/auth/*` 路由族(契约 K 的 P3 子集:
  login/local、register(**默认开放**,受 D5 开关可收紧)、logout、change-password、me、setup-status、
  initialize;register/login 基础 rate limit(每 IP 计数,D5 适配条款 c));**/api 其余前缀的统一鉴权包装**(cookie 优先、Bearer 兜底,契约 D);
  ws 升级路径的会话校验接入点(与既有 untrusted-upgrade 栅栏串联);cookie 安全
  策略(契约 E,含 loopback 豁免与逃生开关)。
- **验收门禁**:vitest + webserver 集成测试(真实 node:http 起服):未登录访问
  /api 业务路由 401;CSRF 缺头写请求 403;login→me→logout 全链路;register 开关
  两态;ws 无会话升级被拒;e2e(`vitest.e2e.config.ts`)一条冷启动登录流。
  ✅ 109 个用例全绿(7 spec + 独立 e2e 冷启动流):真实 node:http 集成覆盖未登录
  401、CSRF 缺头/不匹配 403、login→me→logout→change-password 全链路、register 开关
  两态、initialize 幂等与 409、ws 拒升与 Origin 分层、429 + Retry-After;契约
  D/E/F/G/H/J/K 逐条映射(映射表见台账 P3 段 S3 小节)。src 全文件 per-file 100%。
- **审**:spec 审(路由表与状态码契约)✅(路由表与偏差登记见台账:错误信封、
  OPENKYLIN_CORS_ORIGINS 新名、Origin 白名单端点集、rate limit 全尝试计数、login/register 共享每 IP 预算与内存态局限);
  质量审(安全专项:cookie 属性、错误信息不泄露账户存在性——注册重名响应沿用旧语义
  但评估枚举风险)✅(枚举暴露已评估并登记为已知取舍,login 侧统一 401 + 时序垫片)。

### S4 RBAC 包 `packages/accounts/account-rbac`(规模:L,依赖 S1–S3;受 D5 影响 M→L)✅ 完成(2026-08-28,引擎仓提交 cde3b91)

- **范围**:B1 先行:`system_role` 校验 + `resource:action` 权限串 + owner_check
  等价物(函数式,包 route handler);策略配置 schema(校验失败拒启,fail_closed);
  apiproxy 侧身份传递缝(请求 → Principal 单一构造点,对齐契约 M)。
  **B2 资源策略(role × resource allow/deny,deny 恒胜)为本步必做收尾——开放注册
  下的主要风险闸门,不得顺延(D5 适配条款 d);装配期能力过滤(工具目录摘除)随 B2
  一并落地。**
- **验收门禁**:deny-恒胜/未知角色 fail_closed/默认关闭全通过 的表驱动测试;
  一个真实 /api 方法被 admin 放行、user 拒绝的集成测试;覆盖率门禁。
- **审**:spec 审(对照旧契约 L/M/N 逐条)+ 质量审(Principal 构造唯一性、
  策略热加载语义:初期定义为「重启生效」,热加载列顺延)。

✅ **S4 结果(2026-08-28,引擎仓提交 `cde3b91`;修复增量见下)**:

- **交付面**:`packages/accounts/account-rbac`(`@qilin/account-rbac`,src 9 文件)+ client-connection
  强制点接线(`rbac-auth-gate.ts` 新契约文件 + `/api` 主路由与专用通道 `rpc-host` 在 apiAuth 判定后
  按名征询 `rbacAuth`,镜像 S3 apiAuth 结构契约,依赖箭头单向);根 `tsconfig.host.json`、knip.json、
  verify-package-readme-model-experience(none 行)、docs/module-graph 三语均已挂载。
- **契约映射**:L(默认关闭:插件 `enabled` 默认 false 不 provide,行为与 S3 逐字节一致;策略文件装配期
  一次性读取,缺失=warn+仅基线,非法=`PolicyConfigError` 拒启;**deny 恒胜**,显式 admin deny 同样绑定;
  未知角色/未解析身份 fail_closed)✅;M(Principal 单一构造点:`RbacAuthorizer.resolvePrincipal`
  cookie 优先/Bearer 兜底,按请求对象 WeakMap memoize,阀合成 admin 不触库,失败落匿名且全拒)✅;
  N(权限串 `resource:action`,端点首个点转冒号,`session.list`→`session:list`,无点端点归 `route:`;
  owner_check 函数式 `ownerCheck(principal, ownerId)`:属主/阀 admin 通过,其余连缺失参照一律失败)✅。
- **默认权限矩阵(依据)**:admin `*:*`(D5-a 确定性首管,单实例无威胁模型);user `*:read/:list/:get/
  :status/:search/:stats` + `session:*`(读类保开放注册可用;会话域=契约 N 旧 plain-user threads/runs
  路由集的引擎后裔;其余默认拒,写访问须策略显式授予);匿名/未知=无。矩阵全文及逐条依据在包 README
  (md/zh 双语,i18n.yaml 已登记)。
- **B2 资源策略**:version 1 JSON,`role × resource(tool/model/skill/mcp_server/route)allow/deny`,
  模式=精确名/尾 `*` 前缀/`*` 段/裸 `*`;校验器拒未知键/角色/kind、空数组、段内星号错位、route 单冒号
  语法错、非 route 含冒号→拒启;示例与 Known Limitations 在包 README。
- **装配期能力过滤实证**:`filterCatalog` 以运行时同谓词投影真实目录——user 段 `tool.deny
  ["schedule_create"]` 时,真实引擎工具 `schedule_create`(@qilin/schedule)从 user 目录消失而 admin
  保留(catalog.spec 用真实工具注册表实证);运行时同谓词拒分发(表驱动+集成双覆盖)。
- **终验数字**:两包 vitest **258 用例全绿**(account-rbac 136:permissions 33/policy 37/authorizer 22/
  catalog 13/owner 10/plugin 9/principal 4/invariant 1/barrel 1/集成 6;connection 122 含 S4 新增 4 条
  传输层测试);per-file 覆盖率 **100%**(account-rbac/src 与 client-connection/src 双 100/100/100/100);
  oxlint 本包 **0 错**(connection +4 条为 S4 接线新增,与 S3 已登记的 Context 双面解析噪声同族,见
  残差档更新);staged 预提交三钩(whitespace/vendor manifest/lint)全过;verify-translation-pairing
  **1012 对全一致**;verify-package-readme-model-experience 含本包 none 行;knip 本包 0 噪声(存量
  apps/cli、web-app 正则失配 2 hints 另册已登记);**typecheck 与 type-aware lint 为基线既有阻断**
  (clean-HEAD stash 双向对照复现:connection Context 双面不一致,源为 vendor/cordis lib/src 面分裂,
  S3 残差档已登记同族基线,非本步引入;本步新增文件 0 残留)。
- **Known Limitations(已写入 README)**:策略重启生效(热加载与装配期目录过滤不相容,顺延);须与
  account-http 同 `dbPath`(双 SQLite 连接为受支持形态);专用通道无点端点归 `route:` 域须写全前缀;
  ws 升级仅 authN(事件流无可授权方法面);授权决策无逐请求审计(顺延)。
- **清尾**:a. 引擎仓 `packages/typert/generator/tests/.generated-model-Go0yu7/` 已删(未跟踪,直接清除);
  b. OpenKylin 仓 `qilin-engine/` 纯拷贝已删(rsync 校验仅 knip.json/tsbuildinfo 两生成物差异,真仓更新后删);
  c. 本档 S3 段 rate limit 描述补「共享」二字(与引擎包注释逐字对齐,见下);新发现已跟踪历史残渣
  `.generated-model-O7FJNT/`、`.generated-model-qwn8sk/` 仅登记未处置(残差档 R3/R4)。

### S4 修复增量(2026-08-28,引擎仓提交 `7096270`;S4 评审 NEEDS_FIXES 四阻断项全部处置)

- **阻断 1(身份/存储故障不得降级 403)**:`constructPrincipal` 只捕预期客户端侧
  `SessionValidationError`(归一匿名→403);`SessionCorruptError` 与未知存储异常向上传播,
  provider 侧(logger 边界,plugin 持有 ctx.logger)记日志后重抛,client-connection 的 /api 主路由与
  专用通道 gate 调用点捕获映射为稳定 `500 {error:{code:'internal_error'}}`(契约常量
  `RBAC_GATE_FAULT_RESPONSE`),依赖单向保持(connection 不 import account-rbac)。回归:corrupt
  行/未知异常抛出断言、SessionValidationError 仍归一匿名(不回归)、provider 侧真实 SQLite 注入
  幽灵 session 抛 `SessionCorruptError`、集成层真实 node:http 更新 sessions 行(FK pragma 关闭)
  断言 HTTP 500 而非 403、传输层注入 gate 抛错断言 500 信封且非 permission_denied(两通道)。
- **阻断 2(策略文件错误脱敏)**:`PolicyConfigError` 增稳定码 `policy-file-unreadable /
  policy-file-json / policy-schema`;message 不含配置路径、fs errno、JSON parser 片段;原始 cause
  仅挂错误 `cause` 供内部 logger。回归:绝对路径/ENOENT/Unexpected token/position 三类不泄露断言 +
  code 断言 + schema 拒绝消息保留内容原因(ghost)但不含路径。README 双语补「错误语义」节。
- **阻断 3(权限输入边界)**:新增 `isPermissionString / isValidResourceName`(barrel 导出);
  `authorize / authorizeResource / baselineAllows` 对空串、缺/多冒号、空段、空白、非字符串运行时
  输入一律 false(fail-closed);`routePermissionForEndpoint` 对非字符串/空返回空串(dispatch 404 路径),
  合法映射(session.list→session:list、health/probe→route:health/probe、多点段)回归不破。
- **阻断 4(目录接缝必须真实消费)**:推翻 visibleTools-only 方案,改为 **system-prompt/assemble
  waterfall 末端过滤**——插件挂 `system-prompt/assemble` listener,先 `await next()`(此时
  @qilin/tools 经 provider 贡献的工具已进 assembly.tools)再按策略过滤;身份经新增显式服务端绑定契约
  `bindRbacPrincipal(scopedCtx, principal)`(`src/carrier.ts`,scope 标签为键,未带 scope 拒绑;
  **未绑定 scope fail-closed 为空目录**,不默认 admin/user,不从客户端 metadata/ALS/cookie 猜身份);
  listener 不变异注册表;无 systemPrompt 服务则不挂 listener、默认行为不变;依赖方向:account-rbac
  dev/peer 依赖 @qilin/system-prompt、@qilin/scope(类型级),core/tools 零改动,未用 tools.restrict。
  回归(真实组合):真实 Context + SystemPrompt + ToolRuntime + 两个真实 defineTool,listener 在
  ToolRuntime 挂载**之前**注册(顺序覆盖),`ctx.systemPrompt.assemble({scope})` 断言绑 user 移除
  schedule_create、绑 admin 保留、未绑定 scope 空、无 scope 空、policy null 绑定合法 principal 全量
  可见(默认 parity)、注册表 schemas 本身不变异;另覆盖 bind 拒绝未绑定上下文。
- **文档修正**:README.md/zh.md 权限矩阵未闭合反引号已修(双侧),pairing 重录;
  verify-translation-pairing 全仓 **1012 对全一致**。
- **修复后门禁**:两包 vitest **278 用例全绿**(account-rbac 155 + connection 123);per-file 覆盖率
  双包 **100/100/100/100**;oxlint account-rbac **0 错**;单包 `tsc --noEmit` 干净;staged 预提交
  三钩全过;knip 本包 0 噪声(存量 apps/cli、web-app 2 hints 维持另册登记);typecheck 与 type-aware
  lint 的基线既有阻断(vendor/cordis lib/src 双面,残差档已登记)维持原状,非本步引入。R3/R4 维持
  「未处置(登记)」状态不变,本步未触碰 generator 域。

### S4 修复增量二(2026-08-28,引擎仓提交 `3e07fa6`、`594228b`;评审二轮两点 + README 语义补强)

- **listener 挂载改 `ctx.inject(['systemPrompt'], ...)`**:废除 apply 时一次性
  `readOptionalService`(RBAC 先于 systemPrompt 启动时会永久漏挂 listener)。inject 语义下:
  RBAC 先启动 → 回调等服务就绪后才挂 listener;永不挂载 → 回调永不执行(无 listener、默认行为
  不变)。回归:「晚加载」测试(apply 时无 systemPrompt,之后挂 SystemPrompt+ToolRuntime,deny
  策略下真实 assemble 断言被拒工具消失)——先行验证为红(一次性 get 漏挂、未过滤),改后绿。
- **`bindRbacPrincipal` 返回 disposer**:同一 scope 重新绑定替换旧 principal(后绑者胜,复用
  scope 不残留旧身份);返回的 disposer 携 generation token,仅清除仍属于自己的绑定,供 scope teardown 调用。回归:
  绑定→assemble 全量可见→unbind→同一 scope assemble 空目录(fail-closed 恢复)。
- **policy=null 语义钉死(README 双语)**:未加载策略时,已绑定 principal 保持与 RBAC 之前完全
  一致的完整目录(默认 parity);唯一新增是未绑定 scope 的 fail-closed 空投影。
- **顺带清账**:本包测试 4 处 `toThrowError`→`toThrow`、5 处冗余 double 断言改 unknown 中转单步
  断言(oxlint type-aware 规则;此前轮次的 tail-only 读取漏报,本轮按 0 错复核口径修净)。
- **门禁**:两包 vitest **286 全绿**(account-rbac 163 + connection 123);双包 per-file
  覆盖率 **100×4**;oxlint 本包 **0 错**;单包 tsc 干净;staged 四钩全过(含 whitespace);pairing
  **1012 对全一致**。R3/R4 维持「未处置(登记)」。

### S4 修复增量三(2026-08-28,引擎仓提交 `2b9cfc7`、`ebd267c`、`a407521`;专项补充审查)

- **未知资源域 fail-closed**:新增 `isResourceKind` 并纳入包 barrel;`authorizeResource`、
  `resourceRulesFor`、`evaluatePolicy`、`resourceVisible` 与公开 `filterCatalog` 对未知字符串、数字、
  null、对象等运行时 `kind` 不再落入“无规则=允许”,而是分别返回 false/undefined/undecided/空目录。
- **输入边界稳定化**:`parsePermission` 对非字符串抛稳定 permission error;`matchesPattern` 对非字符串
  pattern/candidate 返回 false;`evaluatePolicy` 对非法 candidate 返回 `undecided`;合法权限、route 映射、
  deny-wins 语义不变。新增边界回归与 barrel 导出契约,覆盖 policy-null 和有策略两条路径。
- **生命周期与目录接缝回归延续**:与上一增量合并后,真实 Context/SystemPrompt/ToolRuntime/assemble、
  late-load、scope disposer generation 隔离均保持通过。
- **新鲜门禁证据**:affected account-rbac + connection 测试 **188 全绿**;完整两包测试 **286 全绿**;
  CI 同口径 `OPENKYLIN_COVERAGE_EXEMPT_HEAVY=1 OPENKYLIN_COVERAGE_PARTITIONS=4 pnpm run
  test:coverage:partitioned` **exit 0**, account-rbac/src 与 client/connection/src per-file
  statement/branch/function/line 均 100%;串行全仓 `pnpm test -- --fileParallelism=false --maxWorkers=1`
  **exit 0**;source snapshot **126 passed/2 skipped**。
- **登记的非本步基线**:完整 `pnpm run typecheck`/`pnpm run build` 仍被
  `client/connection` 与 vendor Cordis `Context` 双类型面既有错误阻断;lib snapshot 唯一失败仍为
  `apps/web/tests/built-boot.snapshot.ts:45` 的既有 `DSH Local Build` 标识差异,本轮无 web 改动。
- **提交前纪律**:`a407521` staged lint、whitespace、vendor manifest hooks 全过;R3/R4 继续登记未处置。

### S4 修复增量三(2026-08-28,引擎仓提交 `d948d08`;评审最终口径:无条件注册 waterfall listener)

- `system-prompt/assemble` listener 改为 **apply 时无条件注册**(撤去上轮的 `ctx.inject` 门):
  RBAC 先于 systemPrompt 启动也必然最终挂上 listener;从不挂载 systemPrompt 的组合根本不会发出
  该事件,listener 永不触发,默认组合两种顺序下都不变。晚加载回归(apply enabled → plugin
  SystemPrompt → plugin ToolRuntime → assemble 按绑定 Principal 过滤,deny 工具消失)维持绿灯。
- `bindRbacPrincipal` disposer 与未绑定 fail-closed 空目录维持增量二(`3e07fa6`)形态;policy=null
  时已绑定 principal 保持完整目录(默认 parity)的 README 双语语义不变,仅把挂载表述同步为无条件注册。
- 顺带:policy.spec 两处同族冗余 double 断言按 unknown 中转改写,oxlint 本包维持 0/0。
- 文档对齐修正(引擎仓 `77762fe`,主控亲自修复):增量三初稿在 README 双语末句与 plugin.ts
  注释残留「未挂服务则不挂 listener」旧口径,与新开头「无条件注册、无事件则不触发」自相矛盾;
  已删除/合并改写,pairing 重录后全仓仍 **1012 对全一致**,staged 四钩全过。
- 门禁:两包 vitest **286 全绿**(含他方新增 policy 输入测试);双包 per-file 覆盖率 **100×4**;
  单包 tsc 干净;staged 三钩全过;pairing **1012 对全一致**。R3/R4 维持「未处置(登记)」。

### S4 修复增量四(2026-08-28,引擎仓提交 `aa54e41`;late-load 断言对照强化)

- late-load 测试补 **schedule_list 对照工具**:deny schedule_create 的 user assemble 后断言
  **不含** schedule_create **且含** schedule_list——消除 `toEqual([])` 的歧义(空 assembly 可能
  只是注册表为空)。红绿实证:临时移除 listener → 红,错误信息为 expected
  ['schedule_create','schedule_list'] to not include 'schedule_create'(对照在场、过滤缺席);
  恢复无条件注册 listener → 绿。plugin.ts 与 HEAD 逐字节一致,本轮纯测试强化。
- 门禁:两包 vitest **286 全绿**;双包 per-file 覆盖率 **100×4**;oxlint 本包 **0/0**;单包 tsc
  干净;staged 三钩全过;pairing **1012 对一致**。R3/R4 维持「未处置(登记)」。

### S4 修复增量五(2026-08-28,引擎仓提交 `61b4dd0`;carrier disposer 世代边界)

- 实现:carrier 绑定改为 `{ principal, token }` 世代结构(`594228b`,评审代理先行落地)——
  disposer 仅在**当前绑定 token === 自己 token** 时删除,旧 disposer 在重绑后不再误删新 principal
  (fail-closed 可用性问题,非提权);readBoundRbacPrincipal 读 `?.principal`。
- 本轮补齐评审点名的回归测试(`61b4dd0`):bind(A)→bind(B)→旧 disposer 触发 → 同 scope assemble
  断言 **B 仍生效**(被拒工具仍被过滤、对照工具在场),而非 fail-closed 空目录;再 unbind(B) → 空目录
  (正常清理路径)。该测试在无条件 delete 旧实现语义下必然为红,token 守卫下绿。
- 门禁:两包 vitest **287 全绿**;双包 per-file 覆盖率 **100×4**;oxlint 本包 **0/0**;单包 tsc
  干净;git diff --check 干净;staged 三钩全过;pairing **1012 对一致**。R3/R4 维持「未处置(登记)」。

### S5 前端账户面(规模:M,依赖 S3)

- **范围**:`packages/client/ui-accounts`:登录页、注册页(D5 开放注册,含开关关闭时的
  隐藏/禁用态)、会话态(client-runtime 侧会话
  store 与 401 拦截)、设置内「账户/用户管理」卡(admin 可见)、CSRF 头自动附带
  (connection 层 fetch 包装);401→登录页跳转。
- **验收门禁**:apps/web vitest 组件测试(登录表单校验、错误分类文案对齐契约 C);
  手动验收脚本写进 PR 描述(浏览器全流程);不破坏既有 client-plugin HMR。
- **审**:spec 审(UI 流对照契约 D/E)+ 质量审(a11y 与空态)。

#### S5 设计定稿(2026-08-28,用户拍板「完整管理员管理」)

- **后端存储与会话(account-core/account-auth)**:users 增 `disabled_at`(可空 epoch 毫秒;新建库直含列,旧库以 PRAGMA 探测后 ALTER 迁移,非法值 corrupt 拒载);store 新增 `listUsers`、`updateRole`、`setDisabled`;`projectUser` 与 `GET /me` 透出 `disabledAt`;`validateSession` 对禁用账户抛码为 DISABLED 的 `SessionValidationError`,auth 面映射 401 `account_disabled`,connection gate 与 RBAC 沿既有匿名折叠。
- **管理契约(全新稳定码,非旧契约移植)**:`GET /api/v1/admin/users`;`PATCH /api/v1/admin/users/:id`(body `systemRole` 或 `disabled`,至少一项);`POST /api/v1/admin/users/:id/reset-password`(body `newPassword` ≥8 字符)。三者均在服务端要求 live session 且 `systemRole=admin`(403 `forbidden`);写操作 cookie 态走 CSRF 双提交、Bearer 沿 change-password 先例豁免;auth-disabled 阀按合成 admin 直通。禁止自降级/自禁用(400 `self_protected`);最后一个启用 admin 被降级或禁用拒(409 `last_admin_protected`);重置密码复用 `updatePassword` 即升 sessionVersion 吊销旧会话,不强制下次改密;无硬删除、无 OAuth/邀请制;列表响应为无 `passwordHash` 投影。
- **前端传输(connection)**:新增浏览器安全 auth client——同源 fetch、自动读非 HttpOnly `csrf_token` cookie 附 `X-CSRF-Token`、非 2xx 抛稳定 `AuthError(status/code/message)`、401 触发可观察 auth-required 信号;`WebApiClient.doFetch` 对 401 发同一信号;`ConnectionHandle` 增量暴露 `auth` 与 `onUnauthorized`(fixture 模式提供确定性 stub)。
- **前端界面(ui-accounts 新包)**:登录/注册/initialize 全屏 overlay(`shell.overlay` 席位)+ settings「账户」section(当前账户改密/登出卡 + admin 用户管理卡);启动 probe `setup-status`+`me`;空库仅提供 initialize(注册不得抢先创建 user),非空库按注册开关显隐注册入口;401→匿名 overlay;错误码→中英文案(契约 C 对齐);loading/空态/a11y(aria-live、焦点管理、label 关联)。会话 store 归属 ui-accounts(对计划原文「client-runtime 侧 store」的偏差:本步无第二消费者,不扩平台服务面,此处登记)。
- **组合顺延**:web-app bundle patch 的 `account-http`/`ui-accounts` 行归 S6(默认 profile 行为不变、auth-disabled 全透明在 S6 验收);S5 手动验收以 `--patch` overlay 组合真实服务执行,步骤写入本台账。
- **门禁**:每包新 src 文件四项 per-file 覆盖 100%;account-core/account-auth/account-http/connection/ui-accounts 目标测试全绿;oxlint 新文件 0 错;单包 tsc 干净;staged 预提交钩全过;`verify-translation-pairing` 保持全一致(新包 README 双语 + i18n yaml);收尾跑 CI 同口径分区 coverage 与串行全仓 test;不触碰 `vendor/` 与 `python/`。

### S6 组合、文档与收口(规模:S,依赖 S1–S5)

- **范围**:`web-app` bundle patch 增补账户行(默认 profile 行为不变、auth-disabled
  时全透明);README/AGENTS 增量;D4 声明的「凭证不再新增旁路读取点」复查
  (grep 复验);发布说明草稿。
- **验收门禁**:全仓 `pnpm test`、`test:coverage`、`test:e2e` 绿;默认
  profile 冷启动不登出可用(auth-disabled 模式);文档审。
- **审**:总体 spec 终审(对照本计划 §1 目标逐条勾稽)。

---

## 5. 测试与验收策略

1. **框架**:沿用引擎 vitest 体系(单测/集成/e2e/snapshot 分配置文件);新包纳入
   既有覆盖率分区(`scripts/run-coverage-partitions.ts`),**新增分区 accounts**,
   门禁线与相邻 host 包对齐(实施时以包内既有配置为准,不另立标准)。
2. **语义回归锚**:§2.2.1 契约表 A–O 每行至少一条可执行测试(S2/S3/S4 的
   表驱动用例直接以契约编号命名,如 contract-F-csrf-double-submit),
   使「语义移植自旧网关」成为可审计断言。
3. **集成面**:真实 node:http 起服的 webserver 集成测试(S3);一条
   built-bin/冷启动 e2e(S3/S6)。
4. **安全用例最低集**:恒时比较、垃圾 cookie、注册枚举、CSRF 方法矩阵、
   ws 未授权升级、auth-disabled 在显式生产环境被拒绝。
5. **验收定义(DoD)**:S6 门禁全绿 + 本文件 DRAFT 摘除 + 契约表全行有对应
   测试引用。

---

## 6. 风险与顺延项

**风险**

| 风险 | 影响 | 缓解 |
|---|---|---|
| 引擎 apiproxy 单文件 3642 行,身份缝插入点若草率会加剧腐化 | S3/S4 复杂度失控 | 身份以显式 seam(请求上下文字段)传入,不在 apiproxy 内散布检查;S4 spec 审专项 |
| 0.0.0.0 部署 + 弱口令 = 全功能 agent 暴露 | 高危安全 | S3 起 cookie secure 策略强制;文档声明 LAN 部署责任;admin 强制改初始口令(needs_setup) |
| node:sqlite 在目标 Node 版本的行为差异 | D6 选型返工 | 引擎已有先例包;S1 首日先跑通最小 DDL 冒烟再展开 |
| CSRF 与 SSE/ws 的边界(SSE 读不受 CSRF 管,ws 升级需独立校验) | 安全缝隙 | S3 验收门禁已含 ws 未授权升级用例 |
| auth-disabled 逃生阀被误用于生产 | 高危安全 | 沿用旧契约 G:显式生产环境变量探测时拒绝禁用(S2 测试覆盖) |
| 账户库与既有 home 数据(sessions/storages)的归属映射未定义 | 多用户体验割裂 | P3 只建 user↔session 归属表(非目标里已限定不改历史数据),完整数据面隔离归 P4/P6 顺延评审 |

**顺延项(不在 P3)**

1. 邀请码注册(D5-C)、用户级凭证库与加密(D4-B)、策略热加载(S4)、
   资源策略装配期过滤增强(D3-B2 深化)。
2. 第三方 OAuth 登录(引擎侧归 `ctx.authorization` 流缝,需求出现再立项)。
3. 8 IM 渠道的账户联结(P6 退役时统一评审渠道身份语义)。
4. 计费/配额/组织多租户。
5. 品牌壳(P5)对登录页的视觉接管。

---

## 7. 证据索引(快照)

- 引擎仓:`/Users/libing/kk_Projects/qilin-engine` @ main `795b8dc`(tag
  `qilin-engine-v0`,工作区干净)。
- OpenKylin 仓:`/Users/libing/kk_Projects/OpenKylin`;旧 Python 代码仅只读盘点
  (`qilin/`、`app/`),`vendor/`、`python/` 未触碰。
- 本文件引用的全部 文件:行 号以两仓上述提交为快照基准;后续提交若移动行号,
  以语义描述为准。
---

## 8. S5 执行日志(滚动)

### S5-A 账户核与会话(已收口)
- 引擎提交 `0902b2d` feat(engine): account disabled_at with admin store ops and DISABLED sessions (p3-s5-a)。
- 要点:users.disabled_at 可空列 + PRAGMA 探测幂等迁移(schema v2);store 增 listUsers/updateRole/setDisabled;
  SessionService 禁用账户 issue 拒发/validate 抛 DISABLED;projectUser 透出 disabledAt;decodeDisabledAt 走 corrupt 通道。
- 亲测证据:vitest account-core 35 + account-auth 44 = 79/79 绿;pairing 1012 一致;oxlint 0 错。

### S5-B 管理路由(已收口)
- 引擎提交 `b62f46e` feat(engine): admin user management routes (p3-s5-b)。
- 实现:admin-users-router(GET 列表/PATCH 角色启停/POST reset-password),plugin.ts 注册 /api/v1/admin/users;
  服务端 admin 强制(403 forbidden)、cookie 写 CSRF 双提交(Bearer 豁免)、auth-disabled 合成 admin 直通;
  self_protected(400) 先于 last_admin_protected(409);未知 id 404;weak_password 400;重置走 updatePassword 吊销旧会话。
- 实现者注:该包原委派代理产出密集写法(26 oxlint 错)且误剥离 principal.ts 文档,已由主代理接管重写:
  路由展开式+完整 JSDoc,principal.ts 恢复文档仅增 disabledAt:null。
- 亲测证据:admin-users-router.spec 全矩阵 20/20;account-http 12 文件 128/128;accounts 三包 435/435;
  tsc -b 干净;oxlint 0;diff-check 干净;pairing 1012;pre-commit 四钩绿。

### S5-C 浏览器 AuthClient(已收口)
- 引擎提交 `3bdec6f` feat(engine): browser auth client with shared 401 signal (p3-s5-c)。
- 实现:client-connection 新 auth-client.ts(AuthError/UnauthorizedSignal/AuthClient:同源 fetch、
  csrf_token cookie 双提交头、typed 错误、401 可观测信号;login/logout/me/changePassword/setupStatus/initialize
  + 管理面 listUsers/updateUser/resetPassword);WebApiClient 增 401 tap 与注入式 fetch;
  ConnectionHandle 增 auth + onUnauthorized;FixtureAuthClient 桩(登出态起步,带 self_protected 语义)。
- 已知基线:client/connection 双面 Context 类型债(18 tsc 错)与 lint error-typed 误报类维持原样,未新增同类以外的错误;
  新增 lint 仅 1 处同基线类(tests 程序对 index 类型链解析)。
- 亲测证据:auth-client spec 9/9;connection 套件 11 文件 132/132;tsc -b 仅余基线 18 错且 src/client 零新增;钩全绿。

### S5-D ui-accounts(进行中)
- 设计:新包 packages/client/ui-accounts 镜像 ui-settings-plugin-inventory 脚手架;
  shell.overlay 注册账户遮罩(未登录全屏登录/needsSetup 仅 initialize);settings 段管理员用户管理
  (列表+改角色+启停+重置口令);locales zh/en;消费 connection handle 的 auth。
- 状态:未开始编码。

### S5-D ui-accounts(已收口)
- 引擎提交 \`02cdefa\` feat(engine): ui-accounts overlay and admin settings section (p3-s5-d)。
- 实现:新包 @qilin/client-ui-accounts(镜像 ui-settings-plugin-inventory 脚手架):
  shell.overlay 条目(id account)未登录遮罩——needsSetup 仅 initialize 表单,匿名见登录表单,
  已登录渲染 null,401 信号翻转回登录并提示会话结束;settings.section(id accounts)管理员账户管理——
  账户表格+逐行角色切换/启停/重置口令(内联确认行),self_protected/last_admin_protected/weak_password/forbidden
  本地化内联呈现,非管理员见 adminRequired 态;locales zh/en 平面词典;注入面延读连接句柄(激活期零连接访问)。
- 实现注:ui-slots 的 InjectFace<I>=I 为平铺组合,组件 props 以平铺成员声明;
  401 订阅走 handle.onUnauthorized 注入面(IAuthClient 不含订阅);shell.overlay 槽型声明在 ui-layout,
  类型增强经 tsconfig 引用 + client 面空导入引入。
- 亲测证据:3 spec 11/11(遮罩状态机 4、管理面 4、注册与词典 3);oxlint 0 错;tsc -b 零新增
  (仅余 connection 包既有 18 错基线);pairing 1013 全一致(新增包 README 对);pre-commit 四钩绿。

### S5-E 覆盖率与回归(进行中)
- 提交 \`41bf935\` fix(engine): ui-accounts branch coverage and submit re-entry latch (p3-s5-e):
  遮罩 submit 增 useRef 再入门闩(状态守卫受渲染闭包陈旧化影响,回车连提可穿透——顺带修复的真实缺陷);
  section retry 改 attempt 计数重跑 effect(原为无效双 setState);补遮罩分支用例 4、管理面分支用例 3、
  connection 401-emit 分支用例 1;ui-accounts 18/18、connection client-apply 14/14。
- RBAC 禁用会话回归双层面既有:auth 层 session-service.spec(§553 validate 拒 DISABLED)、
  HTTP 层 admin-users-router.spec(§86 401 account_disabled)。
- 门禁:串行全量首轮 exit 0;4 分区覆盖率首轮卡 4 文件 100% 阈值(见上修复),复跑中。

### S5-E 覆盖率门禁(移交快照——轮次预算将尽)
- 当前门禁状态:串行全量 \`pnpm test -- --fileParallelism=false --maxWorkers=1\` 通过(唯一失败为
  boot/app-boot user-patches HMR 监视器 10s 超时的既有 flaky,单独复跑 16/16 绿,与 S5 无关);
  ui-accounts 22/22、connection auth-client 13/13、account-http admin 30/30、plugin 6/6 全绿;
  pairing 1013;oxlint 双包 0(仅余 connection 既有 error-typed 基线类)。
- 4 分区覆盖率门禁尚红,余 4 文件未达 per-file 100%(完整未覆盖行清单见
  引擎仓 /tmp/cov-solo2.log 或复跑输出 "Uncovered locations" 段,共 41 处):
  admin-users-router.ts(余 97/135/148/189/237/268/287 附近分支:URL 兜底、405/404 臂、
  非 DISABLED 校验错、promotion 组合臂、reset 缺参/未知 id 组合);
  auth-client.ts(余 144 eq<=0 两臂、249 401-emit 臂、253 空 body 成功臂);
  AccountOverlay.tsx(余 61/63 卸载竞态两臂、156:58 busy-true 标签臂、158 notice 臂);
  AccountsSettingsSection.tsx(余 29:58 非 AuthError 臂、30/33 卸载竞态臂、56 apply busy 臂、
  69/85 confirm 空值臂、76 map FALSE 臂、132/143 busy 禁用臂)。
- 复跑指令:\`OPENKYLIN_COVERAGE_EXEMPT_HEAVY=1 OPENKYLIN_COVERAGE_PARTITIONS=4 pnpm run test:coverage:partitioned\`
  (务必独占运行,与串行全量并行会因 CPU 争用污染分区报告,见 21:06 一轮的假阳性 hooks-codex)。
- 断言注意:jsdom 下 fireEvent.click 会穿透 disabled 按钮,勿依赖 disabled 阻止第二次提交;
  弱口令/缺参用例的桩需在 fake 内复现服务端语义;plugin.warn 接缝一次故障记两条 warn 属正常。
- 引擎 HEAD @ main 34cd398(工作区干净);本文件 OpenKylin 侧同步。
