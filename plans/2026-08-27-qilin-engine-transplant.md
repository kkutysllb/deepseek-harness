# QiLin 引擎移植(qilin 化 DSH 基座)Implementation Plan

**Goal:** 把 deepseek-harness/ 快照整体移植为 @qilin/* 自有引擎代码库,上游快照转为只读跟踪参照;QiLin 品牌壳与账号体系架于其上;Python 引擎(qilin/ + app/ + web-demo 非品牌部分)退役删除。

**Architecture:** 四层结构——① QiLin 商业壳(landing/登录注册/玄金麒麟 VI + 账号 BFF);② @qilin/* 引擎包树(DSH 快照移植产物,一切皆插件);③ vendored Cordis 内核(保留原名,见 D6);④ 只读上游参照 reference/dsh-upstream/(gitignore,永不提交修改),更新走「diff → 移植清单 → 手工移植」。

**Tech Stack:** TypeScript(ESM, strict)/ pnpm workspaces / Node ^22.19||>=24 / vitest / vendored Cordis 插件内核 / Next.js(仅品牌壳来源,不进入引擎)

**依据数字(2026-08-27 实测):** 引擎非测试 src 1,397 文件 ≈ 246,244 行;测试 696 文件 ≈ 238,375 行(接近 1:1,100% 覆盖率门禁的沉淀);@deepseek-ai/dsh- 作用域字符串分布 1,710 文件;vendor/ 含 cordis、cosmokit、hmr、include、loader、group、logger-console。

---

## 决策记录(2026-08-27,已与所有者确认)

| # | 决策 | 内容 |
|---|------|------|
| D1 | 上游策略 | 方案1(fork + rescope);上游 clone 只读,不做任何提交修改;更新 = diff 上游 → 移植清单 → 手工移植 |
| D2 | 所有权口径 | 不做商业套壳——引擎代码 100% 归 QiLin。执行方式 = 整体移植改造(§0),不是从零重打 |
| D3 | 旧数据 | 不迁移。Python 侧 .qilin 线程/账号/检查点随退役一并废弃 |
| D4 | V1 能力 | 多 Provider 模型 + 多用户 RBAC(含登录/JWT/CSRF);IM 渠道进 backlog;TUI 放弃(DSH 有 CLI) |
| D5 | 仓库形态 | 已定案(2026-08-27):双仓。新建 /Users/libing/kk_Projects/qilin-engine 承载 @qilin/* 引擎树,自原貌基线提交起独立 git 历史;QiLin 仓保留品牌壳/文档/plans;上游 diff 移植在引擎仓内进行 |
| D6 | cordis 内核 | 不改名。vendored pinned 上游 + rescope 映射 + verify-cordis-* 门禁全系依赖原名;产品品牌在 QiLin 层完成(类比 Edge 不改名 Chromium)。所有者可推翻,代价是断开 vendor 同步机制 |

---

## §0 口径论证:「整体移植改造」,不是「从零重打」

所有权目标(非套壳、代码全自有、上游只读跟踪)与执行方式是两件事:

- **从零重打**:246k 行 src + 238k 行测试,按可持续手写速度(含调试)是多人年级别;更致命的是丢掉 238k 行测试资产——那是 DSH 100% 覆盖率门禁沉淀的回归安全网,重写等于把引擎质量归零重启。
- **整体移植改造**:快照复制 + 脚本化 rescope + 残差手工修正,天级完成;测试资产原样保留;产物是纯粹 qilin 代码树,每一行从此归我们修改。上游跟踪用只读 clone diff 实现——与重打方案的所有权结果完全一致。

结论:D2 的「重写」按「整体移植改造」执行。本计划 P0–P2 覆盖可直接执行的移植与验证;P3–P5 依 writing-plans 的 scope-check 拆为独立子计划(各自前置取证后另立文档,见 §5)。

---

## §1 命名与结构映射表

| 原(DSH) | 新(QiLin) | 说明 |
|---|---|---|
| @deepseek-ai/dsh-<pkg> | @qilin/<pkg> | npm scope 全量;1,710 文件内的 import/package.json/tsconfig paths |
| @deepseek-ai/dsh-root | @qilin/engine-root | 根包名 |
| dsh CLI bin | qilin | apps/cli bin 名与命令自标识字符串 |
| @deepseek-ai/cordis、cordis-plugin-*、cosmokit | 保留原名 | D6:vendor 同步映射依赖 |
| DSH_ 环境变量前缀 | QILIN_ | DSH_SNAPSHOT / DSH_BUILD_FACE 等;P1 第二批 codemod |
| window.__DSH_BOOT__ | 暂保留 | web 壳引导契约,深标识符;P1 不动,列残差观察项 |
| MIT LICENSE / third-party notices | 保留 | 版权与许可文本必须留存;移植后跑 gen-third-party-notices 重生成 |
| 用户可见文案中的 "DeepSeek Harness / DSH" | "QiLin" | README/UI 字符串;内部代号性注释不强求 |

---

## §2 Phase 0 — 基线固定(约半天)

**Files:**
- Create: reference/dsh-upstream/(gitignore 的只读参照副本)
- Create: plans/assets/dsh-qilin-mapping.md(包级映射表)
- Modify: .gitignore(追加 reference/)

- [x] **Step 1: 固化快照指纹**

Run:

```bash
find deepseek-harness -type f -not -path "*/node_modules/*" -not -path "*/.git/*" | sort | xargs shasum -a 256 | shasum -a 256
```

把输出哈希与日期回填至本计划附录(上游无 git 历史可依,以内容指纹定基线)。

- [x] **Step 2: 建只读参照副本**

Run: `cp -R deepseek-harness reference/dsh-upstream`(剔除内嵌 .git;快照内无 node_modules),随后 `chmod -R a-w reference/dsh-upstream`

预期:目录存在且只读;.gitignore 增加 reference/ 后 git status 干净。

- [x] **Step 3: 生成包级映射表初稿**

Run:

```bash
find deepseek-harness/packages -maxdepth 2 -mindepth 2 -type d | sort
```

把全部包逐一填入 plans/assets/dsh-qilin-mapping.md 表格(旧名/新名/分组/备注),vendor/* 标注「保留原名」。

- [x] **Step 4: 定案 D5(仓库形态)并落档**

在映射表头部写明选定的仓库方案与理由。

## §3 Phase 1 — 移植落地(约 2–4 天)

> **✅ P1 完成(2026-08-28,S8 收官)**:S2–S8 八步全部执行完毕,引擎仓 main @ 795b8dc,附注标签 `qilin-engine-v0`;终态五门禁 + translation-pairing + archived-agent-notes 七门禁全绿(test 14593 passed / 失败 0)。残差与顺延全景、全链 SHA 表见 plans/assets/transplant-residuals.md 的 S8 段与 P1 总结段。**P2(引擎实跑验证)待启**,触发条件与冒烟口径:`pnpm qilin` CLI + `pnpm run dev:web`(总计划 §4)。

**Files:**
- Create: 新引擎仓(或仓内 engine/ 目录,依 D5 定案)
- 来源: reference/dsh-upstream/ 整树复制

- [x] **Step 1: 复制整树**

`cp -R reference/dsh-upstream/ <目标根>/`(剔除 node_modules 后复制);目标仓 `git init` 并首次提交——此提交即 100% dsh 原貌基线。

- [x] **Step 2: 第一批 codemod——npm scope 与包名**

Run(macOS):

```bash
rg -l '@deepseek-ai/dsh-' --glob '!vendor/**' | xargs sed -i '' 's|@deepseek-ai/dsh-|@qilin/|g'
```

再处理根 package.json 的 name 与 workspace 声明;vendor/ 目录与 @deepseek-ai/cordis、cosmokit 字样一律跳过。

- [x] **Step 3: CLI 与用户可见字符串**

apps/cli 的 bin 名、pnpm dsh 脚本别名、README 首屏品牌段。逐文件 sed 后 git diff --stat 复核无 vendor/ 误伤。

- [x] **Step 4: 安装与门禁**

Run:

```bash
pnpm install && pnpm run build && pnpm run typecheck
```

预期:全绿。失败项进入残差清单(Step 6),不顺手改语义。

- [x] **Step 5: 测试基线**

Run:

```bash
pnpm run test
```

预期:与上游同版本行为一致(snapshot fixture 内含旧名字符串属预期残差)。test:coverage 门禁留到残差清零后跑一次确认。

- [x] **Step 6: 残差清单 triage**

把 Step 4/5 全部失败按四类登记到 plans/assets/transplant-residuals.md:import 名漏改 / fixture 期望串 / 脚本硬编码 / 真回归。逐条修复;每修一类跑一次对应包的 vitest filter。

- [x] **Step 7: 第二批 codemod——环境变量前缀**

```bash
rg -l 'DSH_' --glob '!vendor/**' --glob '!*.env*' | xargs sed -i '' 's/DSH_/QILIN_/g'
```

同步更新 README 环境变量表;重跑 pnpm run test。

- [x] **Step 8: 许可合规与 tag**

核对各包 LICENSE 头保留;Run: `pnpm run gen-third-party-notices`;然后 `git tag qilin-engine-v0`,tag message 记录 §2 Step 1 的上游指纹哈希。

## §4 Phase 2 — 引擎实跑验证(约 1 天)

- [x] **Step 1: CLI 冒烟**

Run: `pnpm run build && pnpm qilin --profile headless "echo smoke"`(API key 就位)。预期:会话完整跑通并产出 transcript。

- [x] **Step 2: Web GUI 冒烟**

Run: `pnpm run dev:web`,浏览器打开终端给出的 URL,验证会话/工具调用/侧栏分组可用。预期:与 DSH 上游体验一致。

- [x] **Step 3: Gap 记录**

实跑中发现的商业差距(IM 渠道、多 Provider、账号)逐条登记,作为 P3–P5 子计划输入。

> **✅ P2 完成(2026-08-28,双口冒烟)**:Step 1–3 全部执行。CLI 实跑 `pnpm qilin --profile headless` 通过(会话建立 / 模型完成 / 内置 read 工具真实执行,transcript 落盘);Web GUI 冒烟经 `pnpm run dev:web`(仅 watch 构建)+ 另起 `pnpm qilin web`(web profile 服务器,`qilin web: http://127.0.0.1:3080`)通过(加载 / 新建会话 / 发消息 / Read 工具行与模型回复渲染 / 侧栏工作区分组)。Step 2 口径修正:`dev:web` 依设计仅启动 watch 构建链(tsc/tsdown/vite),不打印 URL、不启动服务器,web 服务器需另起 `qilin web`,已在台账 P2 段登记为观察项。详情、Gap 清单与截图路径见 plans/assets/transplant-residuals.md 的 P2 段;日志与截图归档 plans/assets/p2-logs/。

## §5 Phase 3–5 — 子计划登记(各自独立立计划,前置取证后产出)

| 子计划 | 前置取证 | 产出计划文件 | 验收 |
|---|---|---|---|
| P3 账号 BFF + RBAC | 对照 app/gateway/auth(JWT/CSRF/弱密码黑名单语义)× DSH packages/{identity,credentials,api,interaction} | plans/<date>-qilin-account-bff.md | 登录/注册/会话签发/资源授权在 qilin-engine 上全流程通过 |
| P4 多 Provider | 取证 packages/llm/ Service Definition/Provider 契约 | plans/<date>-qilin-llm-providers.md | openai/anthropic/gemini/ollama 四适配器过真实 API e2e |
| P5 品牌壳落地 | web-demo 中 qilin-brand.css/landing/auth 组件清单;DSH apps/web 栈对照 | plans/<date>-qilin-brand-shell.md | landing/登录注册在 DSH web 栈渲染通过,品牌 token 零改动迁移 |

## §6 Phase 6 — Python 退役(品牌壳可用后)

- [ ] 删除 qilin/、app/、tests/(py)、pyproject.toml、uv.lock、ruff.toml、web-demo 非品牌部分;保留 web-demo 品牌资产至 P5 迁移完成。
- [ ] git 历史完整保留,单 commit 退场,commit message 附本计划链接。

## §7 上游跟踪机制(常态化,移植完成后生效)

- 更新检测:diff reference/dsh-upstream/ 与新获取的上游快照 → 生成按包分组的变更清单。
- 移植原则:按子系统选择性移植;结构克制(非必要不重构,降低后续 diff 失配);映射表随包增删同步维护。
- 每次移植附 Agent Note(上游版本、移植范围、残差)。

## §8 风险登记

| 风险 | 对策 |
|---|---|
| snapshot fixture 内嵌旧名导致测试红 | Step 6 残差四分类 triage;禁止为绿改语义 |
| rescope 误伤 vendor/ | sed 排除 vendor 路径;git diff --stat 逐批复核 |
| 上游 diff 因分叉逐渐失配 | 结构克制 + 包级映射表 + 按子系统移植 |
| 深标识符(__DSH_BOOT__ 等)遗漏 | 列观察项,P1 不求全清 |
| MIT 合规 | LICENSE/NOTICE 保留 + notices 重生成(P1 Step 8) |

---

## 附录:上游快照指纹

- 指纹哈希(嵌套 SHA-256): `c15a87543aa533b879d1b1159c3cbe966bc673f3466e2c5334183f5b2c209dfe`
- 快照文件总数: 7895(口径:`deepseek-harness/` 下全部文件,排除 `node_modules` 与 `.git` 路径)
- 目录体积:`du -sh deepseek-harness` = 194M(全目录口径,含内嵌 .git 目录 126M;快照内无 node_modules,含/不含 node_modules 口径一致);文件内容合计(排除 node_modules/.git)= 51,116,148 bytes ≈ 48.75 MB
- 采集命令原文:`find deepseek-harness -type f -not -path "*/node_modules/*" -not -path "*/.git/*" | sort | xargs shasum -a 256 | shasum -a 256`
- 采集日期: 2026-08-27
- 副本自校验指纹(2026-08-27 实跑): `189b87a4e308314fdb574db21e13227a7dcf79b0b24535479203f709731ea15f`
- 副本自校验命令原文:`cd reference/dsh-upstream && find . -type f | sort | xargs shasum -a 256 | shasum -a 256`