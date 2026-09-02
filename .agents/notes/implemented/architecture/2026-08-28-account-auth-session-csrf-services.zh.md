# Agent Note:account-auth 会话与 CSRF 服务(accounts/)

Status: implemented

[English](2026-08-28-account-auth-session-csrf-services.md) | 中文

## Problem

账户阶段的 HTTP 步骤(S3)需要把 D2 拍板的会话语义做成可调用的服务,而不是埋在路由处理器里的逻辑:登录时按记住我两档签发;按旧网关的 typed 错误分类(EXPIRED / INVALID / MALFORMED)校验不透明的 cookie 令牌;吊销——单会话登出,加上 token_version 全灭(改密或管理员踢人后,所有更旧的会话必死)。同一步还要承载旧 CSRF 双提交契约(方法矩阵、Bearer 豁免、路径豁免)与带生产拒绝的 auth-disabled 逃生阀。这一切先于任何 HTTP 面存在,因此必须能作为纯服务对账户存储做表驱动测试。

## Decision

`packages/accounts/account-auth`(`@qilin/account-auth`)交付四个模块。`SessionService`:签发(单一 7 天默认寿命上的两档;签发时快照账户 `session_version`)、校验(对规范 UUID 形状做格式门,垃圾 cookie 绝不触达存储;经固定 SHA-256 摘要的恒时令牌比对;绝对过期;签发版本对账户版本的比对)、吊销(幂等单会话登出、账户级删除,以及把存储的版本递增与行删除组合起来的 `changePassword`——版本递增在前,两步之间崩溃仍能全灭旧会话)。校验对读到的持久行自带守卫——正整数签发版本、有限且有序的时间戳、布尔标记、在册属主——因为 S1 存储在解码时不复读 session 列;损坏行以类型化的 `SessionCorruptError` 大声失败,而不是继续下流。CSRF 模块是纯函数:每会话一枚铸出的令牌(服务端从不存储)、固定摘要恒时比较器、RFC 安全/写方法矩阵(两清单之外的方法 fail-closed)、Bearer 豁免,以及归调用方所有的路径豁免清单。逃生阀模块保留旧 `OPENKYLIN_AUTH_DISABLED=1` 语义与 `OPENKYLIN_ENV`/`ENVIRONMENT` 生产标记:`resolveAuthDisabled` 在生产环境绝不放行禁用;`assertAuthDisabledAllowed` 对请求禁用的生产启动抛类型化错误;`authDisabledWarning` 承载运维警示。

## Consequences

- HTTP 包做组合而非重实现:在 `SqliteAccountStore` 之上构造 `SessionService`,每请求调用 `evaluateCsrfRequest`,启动时解析一次逃生阀并贯穿全链。
- 吊销保持 account-core 注记承诺的双通道:删行立即生效,版本比对是任何存活行都逃不掉的后盾——两条通道都有专属用例(改密后行已删除与行尚存留两种形态下旧会话必死)。
- per-file 100% 覆盖率门禁无豁免达成;空 barrel 与 account-core 兄弟一样带理由 v8 ignore。
- CSRF 判定是纯函数且表驱动,e2e 与路由层消费同一裁决;豁免清单归调用方所有而非硬编码,把路由知识挡在本包之外。

## Alternatives considered

- **无状态 JWT 充当 D2 令牌** —— 否决:D2 为 O(1) 吊销选择了服务端会话;typed 错误分类以 `SessionErrorCode` 形态存活。
- **落库哈希会话 id(派生 id 方案)** —— 此处否决:账户存储在 `insertSession` 里分配会话 id,改动该缝属于 account-core 变更;格式门加恒时比对加主键查找在不触碰 S1 的前提下覆盖同样的误用面。
- **把 CSRF 折进 HTTP 包** —— 否决:方法矩阵、比较器与豁免恰是值得对照旧契约表驱动的部分;路由层应从线上读取事实并把裁决委托出去。
- **生产请求禁用时静默保持鉴权开启(旧行为)** —— 逐请求组合保留它(`resolveAuthDisabled`),但为启动期配上 fail-loud 的 `assertAuthDisabledAllowed`,让误配置的生产部署拒绝启动,而不是带着运维的认知错位运行。
