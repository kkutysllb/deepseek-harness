# Agent Note：OpenKylin 改名与 alpha.3 上游对齐

Status: implemented

[English](2026-09-02-openkylin-rebrand-and-alpha3-alignment.md) | 中文

## 问题

引擎是 DeepSeek Harness 在 `dsh-v0.1.1-rc.2` 的 token 映射移植产物，带着 QiLin 品牌、一个从未编译通过的未竟 P3 账户面，以及五个版本的上游漂移。所有者拍板：产品线更名 **OpenKylin**，引擎必须精确落在 fork 的 `dsh-v0.1.2-alpha.3` 基线上，且改名要覆盖全表面而非停留在名号。

## 决策

**上游增量以三方移植落地，改名是有名册残差的脚本化通道。** `rc.2 -> alpha.3` 增量（3,591 修改 / 748 新增 / 260 删除）先对"规范化影子树"逐文件分类，再以复制、删除、直采与 `git merge-file` 三方合并落地；每个移植字节都经过 token 映射（`@deepseek-ai/dsh-*` → `@qilin/*`、裸词 `dsh` → `qilin`、`DSH_` → `QILIN_`、带引号的 `"dsh"` manifest 键、`Dsh*` 类型；vendor 名、`~/.dsh`、`window.__DSH_BOOT__` 保护不动）。

**OpenKylin 改名覆盖操作者表面、保留包命名空间。** CLI bin 与脚本为 `openkylin`，产品环境变量前缀为 `OPENKYLIN_`，用户可见的 QiLin 措辞改为 OpenKylin，Python SDK 以 `openkylin-sdk` 发行（模块 `openkylin_runtime`），终端受控提示符为 `openkylin> `。`@qilin/*` npm scope、vendored `@deepseek-ai/*` 内核名、`~/.dsh` 默认主目录、`window.__DSH_BOOT__` 按既定决策保留。

**映射盲点在夹具层修复，绝不削弱门禁。** 机械规则漏掉转义相邻（`\x07dsh`）、连字符相邻与大写形态；每处漏网都对齐到 src 与测试共用同一字面量，session-snapshot 的 spill 清洗器接受改名后的 tmpdir 前缀。

**半移植状态以完工收场而非遮掩。** 从未编译的 P3 面就此完工：ui-accounts 加入 client 聚合并带上 ui-renderer 增广触发，其跨插件 `AuthError` 改为仅类型导入加结构判定，account README 进入文档骨架，`/api` RBAC 栅栏与其它消费者一致地经 `endpointFromPath` 推导端点，`OWNED_FILE_PREFIX` 与 pi-ai 钉（`0.84.2`）跟随 reference 基准。

## 验证

`pnpm run build`、`pnpm run typecheck` 与全量 vitest 达到与纯净 reference 树在本机的同等水平，每个 spawn 时序文件单跑皆绿。`verify-client-packages`、`verify-translation-pairing`（全部配对重录）、`verify-archived-agent-notes`（冻结树字节级镜像）、`doc-standard` 与再生成的目录全部通过。headless CLI 与 web profile 经改名后的命令做 keyless 快照回放。

## 备选方案

**npm 包再 scope 为 `@openkylin/*`。** 所有者否决：再写 1.8 万处换不来产品价值，`@qilin/*` 已完全自有。

**重写引擎而非移植。** 否决：23.8 万行测试语料才是资产；移植在新基线上逐字节保住了它。

**提示词与夹具字面量保留上游 token。** 否决：提示符用户可见；转义相邻漏网按修复处理而非豁免。

## 后果

- 上游跟踪继续走 reference diff；下一次对齐以 `dsh-v0.1.2-alpha.3` 为基准重复"分类再移植"循环。
- `OPENKYLIN_*` 环境变量改名需在启用 CI 时同步部署侧的 GitHub runner 标签与仓库 secrets（workflows 已引用新名）。
- Python 发行名随 wheel 发布流变更；`deepseek-harness-sdk` 的消费者迁移到 `openkylin-sdk`。
