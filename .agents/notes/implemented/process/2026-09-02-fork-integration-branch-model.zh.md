# Agent Note：上游基线经由 fork 集成分支进入本仓

Status: implemented

[English](2026-09-02-fork-integration-branch-model.md) | 中文

## 问题

本仓的历史始于对上游树的一次压缩导入，git 与 `deepseek-ai/deepseek-harness` 之间不存在共同祖先。升级基线只能人工重对齐：把整树与新上游 tag 做差、手工重放品牌层、靠肉眼断言完整性。没有任何机械手段把我们的树与上游历史连接起来，品牌 delta——包 scope、env 前缀、CLI 词、散文 id、产品名——每次升级都要从零重推。

上游迭代还很快：仅 0.1.2-alpha.3 → 0.1.2-alpha.4 就是 297 提交、2371 文件，且改动穿越品牌层（改名 scope 的 import、嵌入产品名的快照期望、被移除的 invariant 伴随物与整个工具）。

## 决策

本仓经由名为 `openkylin/<baseline>` 的**按基线集成分支**消费上游；集成分支维护在共享 fork `kkutysllb/deepseek-harness` 中，遵循其 `FORK-WORKFLOW.md` 约定；本仓 `main` 快进到集成分支尖端。KCoder 的 `kcoder/<baseline>` 分支为该产品遵循同一模型；各产品分支互不触碰，也不触碰 fork 的纯净 `master`。

- **基线采用是合并提交，不是重对齐。** `openkylin/alpha.4` 指向一个合并提交，其父为上游 tag 提交 `dsh-v0.1.2-alpha.4` 与先前的产品头。合并树以先行上游 tag `dsh-v0.1.2-alpha.3` 为 merge base 做三方合并：我们从未触碰的文件整体取上游版本，上游从未触碰的文件保留我方版本。由于合并提交的祖先包含真实上游 tag，下一次基线升级就是一次普通的 `git merge <next-tag>`——git 自行推导 merge base，只重放增量。无改写、无 force push；旧产品历史作为合并提交的第二父保持可达。
- **品牌层先字节验证再信任，全程机械。** 改名映射——`@deepseek-ai/dsh-*` → `@qilin/*`、CLI 词 `dsh` → `openkylin`、`DSH_*` env → `OPENKYLIN_*`、散文 `dsh-*` id → `qilin-*`、"DeepSeek Harness" → "OpenKylin"——带两处保护：`.agents/skills/dsh-*` 目录引用保留原名（仅链接文本改名），`-dsh-sdk` provider 后缀在内部连字符重写中存活。冲突文件只有在「重写 merge base 后与我方逐字节一致（`rw(base) == ours`）」时才自动解决；其余逐行解决，且品牌 token 只在「先前产品状态也包含该行」时被接受。该规则保住了有意的归属表述（"forked and rebranded from DeepSeek Harness"）与归档笔记，同时把升级带入的其余内容全部品牌化。
- **上游删除胜过我方触碰。** 上游移除的 invariant 伴随物（omit-unneeded-invariants）与被相邻 Agent steer 通道取代的子代理 `report` 工具，即便品牌层编辑过也保持移除。上游以符号链接去重的快照期望采用符号链接形态，指向合并后的目标内容。

## 曾考虑的替代方案

**保留压缩树、按基线人工重对齐** —— 否决：放弃 git 的合并机制（无共同祖先），每一次品牌 token 碰撞与上游删除都靠手工解决、无字节级验证，完整性也无法机械断言。

**把品牌层 cherry-pick 到各上游 tag 上（kcoder 式）** —— 对本仓否决：kcoder fork 的产品 delta 只有两个提交，而本仓 delta 跨数千文件；cherry-pick 重放会在几乎每个改名 import 上冲突。合并提交形态给出同样的按基线分支结构，而品牌层由合并本身承载。

**把产品历史 rebase 到上游 tag 上** —— 否决：每次基线改写已发布的产品历史会破坏所有克隆，也违反 fork 的禁改写约定；合并提交把旧产品头保留为父提交。

## 后果

- **完整性靠断言，不靠肉眼**：`diff(先前产品头 ↔ 新集成尖端)` 的文件列表必须等于上游 tag 到 tag 差异的文件列表，升级记录中列出的条目除外。偏差必须进升级记录，绝不静默合并。
- **基线仪式**：fetch 上游 tag → 在当前集成分支 `git merge <tag>` → 用字节验证的品牌映射解决冲突 → `pnpm install` → typecheck、coverage、lint、doc 门禁 → 行级品牌 token 扫描 → 完整性断言 → 合并提交 → 推 `openkylin/<baseline>` 到 fork 并快进 `main`。
- 生成式目录、模块图与双语配对记录绝不手工合并：占位取品牌化的上游文本，由各自的生成器（`gen-*-catalog`、`verify-translation-pairing --write`）从合并后的源重新生成。
