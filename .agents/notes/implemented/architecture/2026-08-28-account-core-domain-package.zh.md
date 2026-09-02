# Agent Note:account-core 域包(accounts/)

Status: implemented

[English](2026-08-28-account-core-domain-package.md) | 中文

## Problem

多用户账户阶段(P3)在任何 HTTP 面出现之前需要一个域基座:用户与会话实体、持久化存储、密码哈希。引擎此前完全没有账户概念——唯一的身份原语是匿名遥测 UUID——而它必须服务的产品契约已在别处定死:服务端会话与 O(1) 吊销、供 RBAC 使用的账户级角色、initialize 路径的待补全流、预留的 OAuth 联结,以及改密时使全部会话失效的凭证纪元(会话版本)。存储选型关键在于账户数据是关系型的(唯一 email、唯一 OAuth 身份、并发登录),而引擎已有生产级 `node:sqlite` 先例。

## Decision

`packages/accounts/account-core`(`@qilin/account-core`)以共享库形态交付域核心,而非 Cordis 插件:`src/types.ts` 的实体与存储接口、`AccountConflictError`、参数固化的 scrypt 哈希,以及基于 `node:sqlite` 的 `SqliteAccountStore`(幂等 `CREATE ... IF NOT EXISTS` DDL)。一个 store 持有一个数据库文件——默认位于 harness home 下的 `qilin-accounts/accounts.db`——并把模式版本记录在 `user_version` pragma,拒绝来自更新构建的数据库。唯一性失败按驱动扩展结果码(2067)翻译为类型化的 `email`/`oauth` 冲突;外键失败翻译为账户缺失;每次读取都会重新校验 RBAC 依赖的列,手工改坏的行会大声失败。scrypt 参数组(N=16384、r=8、p=1、32 字节盐、64 字节密钥)为固化常量,存储编码内嵌其参数,校验从值中读取代价,未来的代价升级保持为逐行迁移而非重置钥匙。

## Consequences

- 会话吊销自第一日起即双通道:删除行立即吊销,账户 `session_version` 递增(改密)使所有签发版本滞后的会话失效——后续鉴权包无需存储变更即可同时消费两者。
- 本包完整落入 per-file 100% 覆盖率门禁,以表驱动用例覆盖建表幂等、冲突分类、损坏持久行与哈希篡改;未新增任何覆盖豁免。
- OAuth 列在出现 provider 流程前仅为存储预留;email 唯一性按原文精确比较;到期为绝对 epoch 毫秒,时钟回拨只会缩短会话而非延长。
- 后续账户包(鉴权服务、HTTP 路由、RBAC)构建于本 store 及其类型之上;store 接口是它们唯一需要的存储缝。

## Alternatives considered

- **经新依赖引入 bcrypt(或 argon2)** —— 否决:node 内置 scrypt 无需依赖,满足代价目标,自描述编码使校验由参数驱动;原生依赖换不来契约所需的任何东西。
- **经既有 storages 缝走 JSON 文档存储** —— 否决:唯一性、部分唯一索引与并发写正是手搓 JSON 最易漂移之处;SQLite 以约束形式直接给出。
- **沿用 session-persistence-sqlite 的 `resources/sql/*.sql` 加载器** —— 此处否决:该包为热路径打包与修复承载 39 个语句文件;两张表的内联幂等 DDL 单点可审计,加载器的缓存机构反会成为 100% 门禁必须背负的未覆盖代码。
- **在 `NewUser` 内生成 id** —— 否决:身份与时间戳由 store 在注入缝后分配,测试保持确定性,又不把生成逻辑泄入调用方契约。
