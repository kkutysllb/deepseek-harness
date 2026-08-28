# accounts/ — 多用户账户

[English](README.md) | 中文

面向多用户表面的账户与会话域包。域核心持有实体、持久化存储与密码哈希;HTTP 面与 RBAC 强制点由后续兄弟包承接。

| 包 | 职责 | ctx key |
|---|---|---|
| [`account-core/`](account-core/README.zh.md) | 用户/会话实体、幂等建表的 SQLite 存储与 scrypt 密码哈希 | — |
| [`account-auth/`](account-auth/README.zh.md) | 会话生命周期(签发/校验/吊销)、typed 会话错误、CSRF 双提交判定与 auth-disabled 逃生阀 | — |