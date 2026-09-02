# OpenKylin 品牌改命 + 上游 dsh-v0.1.2-alpha.3 全面对齐 实施计划

**Goal:** 仓库全面改命 OpenKylin（CLI bin→`openkylin`、env 前缀 `OPENKYLIN_`→`OPENKYLIN_`、用户可见品牌文案→OpenKylin、python SDK 改名；**保留** `@qilin/*` npm scope 与 vendor 原名），并以 fork `kkutysllb/deepseek-harness` 的 `dsh-v0.1.2-alpha.3` 为基线全面对齐（含 UI/client），顺带修复 R1/R2 快照残差与 `docs/qilin-design` 历史标注。

**Architecture:** 三方树合并移植。ours=工作树；base=`reference/dsh-0.1.1-rc.2`（即移植时固定的上游基线 b150a551）；theirs=`reference/dsh-0.1.2-alpha.3`（目标 tag dd6322d6）。脚本化分类 + 逐类处置 + 少量手工三方合并；品牌改命作为移植后的独立统一 codemod 提交。

**Tech Stack:** Python 分类/移植脚本（/tmp/align/{classify,port,resolve}.py）、`git merge-file` 三方合并、pnpm workspaces、gen-* 生成器全套。

**决策记录（2026-09-02,用户拍板）:**

| # | 决策 | 内容 |
|---|------|------|
| D1 | npm scope | 保留 `@qilin/*`（不做二次 rescope），vendor 名不动 |
| D2 | CLI bin | `qilin` → `openkylin` |
| D3 | env 前缀 | `OPENKYLIN_` → `OPENKYLIN_` |
| D4 | P3 accounts 装配 | 不纳入本轮 |
| D5 | 提交形态 | main 上连续提交（不重写历史） |

**映射规则（theirs→ours，fwd）：** `@deepseek-ai/dsh-root`→`@qilin/engine-root`；`@deepseek-ai/dsh(?![\w-])`→`@qilin/cli`；`@deepseek-ai/dsh-`→`@qilin/`；`DSH_`→`OPENKYLIN_`（保护 `__DSH_BOOT__`）；裸词 `dsh`→`qilin`（保护 `~/.dsh`）；manifest 键 `"dsh"`→`"qilin"`；vendor 名不动。**保留物：** `window.__DSH_BOOT__`、`~/.dsh` 默认主目录、vendor/ 原名。

---

## Phase A — 取证与分类 ✅

- [x] 克隆 `dsh-v0.1.1-rc.2` 与 `dsh-v0.1.2-alpha.3` 浅克隆到 `reference/`（.gitignore 已加 `reference/`）
- [x] `diff -rq`（排除 `.git`/`.claude`）生成 delta：**3,591 修改 / 748 新增 / 260 删除**（上游 rc.2→alpha.3 三个版本演进）
- [x] classify.py 分类（norm 逆映射 + brand 兜底）：A_copy 2,476 / M_take+brandonly 3,081 / D_delete 1,266 / D_review 69 / M_conflict 511
- [x] port.py 落盘：复制 5,411+2,936、删除 1,263、`git merge-file` 清洁合并 54
- [x] resolve.py 批量处置：文档/notes/i18n.yaml/README/expected 快照 take-theirs-fwd 585，上游删除跟随 69，生成物 keep-for-regen 8
- [x] `ours == fwd(theirs)` 过滤后真冲突 **46 个**，分 4 组委派三方合并（connection/modules、bundle/app-boot、scripts/根配置、CLI/CI/杂项）

## Phase B — 上游对齐收尾（进行中）

- [ ] 46 个手工合并文件全部落盘并自检（无 `@deepseek-ai/dsh-`/裸词 dsh 残留）
- [ ] `pnpm install` 重生成 pnpm-lock.yaml（上游依赖演进：pi-ai 升级等）
- [ ] 全套 gen-* 再生成：cordis-catalog、tool-catalog、config-catalog、module-graph、doc-graphs、scoped-events、persistence-catalog、third-party-notices、client-catalog、cordis-api、composition.md、translation-prompt expected
- [ ] `pnpm run build && pnpm run typecheck` 全绿
- [ ] 提交 1：`feat: align engine to upstream dsh-v0.1.2-alpha.3 (rescope-applied)`

## Phase C — OpenKylin 品牌改命

- [ ] env 前缀 codemod：`OPENKYLIN_` → `OPENKYLIN_`（代码/文档/测试/快照期望）
- [ ] CLI bin：apps/cli package.json `bin`、根 package.json 脚本、`pnpm qilin`→`pnpm openkylin`、CLI 自标识字符串、文档命令
- [ ] 品牌文案：README*/CONTRIBUTING*/BRAND_GUIDELINES*/website/locale/ui-brand-official 等 "OpenKylin"→"OpenKylin"（用户可见面）；python SDK 发行名 `deepseek-harness-*`→`openkylin-*`（模块名/发行名/CI workflow/.gitignore 路径同步）
- [ ] 版本号：随上游 alpha.3 package.json 已带入；根包对齐 0.1.2-alpha.3
- [ ] 快照期望刷新：`pnpm run test:snapshot:refresh`（keyless replay 驱动）
- [ ] 提交 2：`feat: rebrand engine to OpenKylin (bin openkylin, env OPENKYLIN_)`

## Phase D — 修复已发现问题

- [x] R1/R2 translation-prompt 快照残差（随 take-theirs-fwd + 再生成收敛）
- [ ] docs/qilin-design/architecture.md 头部加「已退役 Python 引擎历史参考」标注
- [ ] README 仓库链接口径（kkutysllb/OpenKylin；上游 deepseek-ai 链接改为 fork 谱系说明）
- [ ] 提交 3：`docs: mark retired python-engine design docs; fix repository links`

## Phase E — 验证与收尾

- [ ] `pnpm run test`（全量单元）+ `test:snapshot`
- [ ] `pnpm run lint` / `hygiene` / `doc-sync`
- [ ] Agent Note（.agents/notes/implemented/process/，按 verify-agent-note-format）：上游对齐移植 + 品牌改命 两篇
- [ ] plans/assets/ 留档：inventory/port/resolve 报告 JSON 拷贝
- [ ] 更新 plans/assets/transplant-residuals.md（R1/R2 状态）

## 风险登记

| 风险 | 对策 |
|---|---|
| 上游重构（client 注入协议、bundle patch 行、application-launch 规则）与 P3 auth gate 文件交叉 | 手工合并组保留 ours 独有行；build/typecheck 验证 |
| 快照期望内嵌 bin 名/环境变量 | refresh 模式 keyless 重录；禁为绿改语义 |
| gen-* 与 verify-* 失配 | 先 gen 全套再跑 doc-sync |
| python SDK 改名牵连 CI 与 .gitignore 产物路径 | 同步改 workflows 与 ignore 规则，pytest 冒烟 |
