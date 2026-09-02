# OpenKylin Web-Demo 品牌 VI 独立化设计规格（landing + auth）

- 日期：2026-08-27
- 状态：已获用户确认（方向：黑金·麒麟品牌风；国风浓度：克制内敛；实现方式：方案甲）
- 范围：仅 `web-demo` 的 landing 页与登录/注册/初始化页面的视觉层。业务逻辑、API、workspace 全部不动。

## 1. 背景与目标

web-demo 前端此前为对齐 KWorks 而建，landing 与登录页沿用了 KWorks 的视觉遗产：
Galaxy WebGL 星空、FlickeringGrid 科技网格、彩虹渐变（cyan→purple→pink）按钮与 ShineBorder 流光卡片。
作为「引擎」的 web-demo，这两处门面需要有自己的品牌识别度。

目标：建立 **玄金麒麟（Warm Obsidian × Gold）** 的自主视觉语言——
暖玄黑基底 + 鎏金强调 + 极淡中式母题（篆印、鳞纹、菱形结线），克制内敛、耐看不炫技。

非目标：

- 不改 workspace 及任何功能页的样式（与 KWorks 的对齐保留在 workspace 层）。
- 不改任何认证/初始化业务逻辑（fetch、重定向、open-redirect 校验、desktop headers 等）。
- 不引入新 npm 依赖。

## 2. 设计 Token

新增独立 token 文件 `src/styles/qilin-brand.css`，仅在 root layout import；
不修改现有 shadcn/Tailwind 变量（`--background` 等），避免波及其他页面。

| Token | 值 | 用途 |
| --- | --- | --- |
| `--ql-bg` | `#0d0b09` 暖玄黑 | 两类页面共用的基底色 |
| `--ql-surface` | `#16130f` | 卡片底 |
| `--ql-raised` | `#1d1915` | 悬浮层/嵌套面 |
| `--ql-gold-300` | `#f3dc9e` | 金高光（hover、渐变亮端） |
| `--ql-gold-500` | `#c9a24a` | 主金（CTA 实底、图标描边、细线） |
| `--ql-gold-700` | `#8f6f2e` | 暗金（边框、弱线） |
| `--ql-ink-hi` / `--ql-ink-mid` / `--ql-ink-low` | 暖白 `#efe9df` / 暖灰 `#a89f90` / 暗灰 `#6b6459` | 三级文字 |
| `--ql-cinnabar` | `#c3402f` | 印章底色 |
| `--ql-cinnabar-hi` | `#e0684f` | 暗底上的错误文案/印章描边亮化变体 |

金色使用纪律：只做强调（细线、关键词、主按钮），面积占比小；
不再出现任何彩虹多色渐变与 blur 光晕堆砌。

Tailwind 映射方式（定死）：`qilin-brand.css` 内先在 `:root` 定义上述变量，
再用 Tailwind v4 的 `@theme inline { --color-ql-*: var(--ql-*); }` 映射为语义工具类
（如 `bg-ql-bg`、`text-ql-gold-500`、`border-ql-gold-700`），组件内一律使用这些语义类，
不散落 arbitrary value。

## 3. 国风母题组件

新建 `src/components/brand/qilin-mark.tsx`（含配套样式），提供三个小组件，纯静态 SVG/CSS，零 JS 动效、零依赖：

1. `OpenKylinSeal` —— 篆书风格的方印「麟」（SVG，朱砂红底白字或描边版两种 variant），用于 header logo 上标、auth 卡片顶部、footer 收尾。
2. `ScalePattern` —— 半圆叠瓦鳞纹 SVG pattern，透明度 ~4%，仅作背景角落点缀（landing 右下角），不做大面积铺陈。
3. `GoldDivider` —— 「◆──」中点菱形金色分隔细线，用于 footer、区块之间。

可访问性：装饰性元素一律 `aria-hidden="true"`；印章作为 logo 使用时配 `role="img"` + aria-label。

## 4. Landing 页改动清单

文件：`src/app/page.tsx`、`src/components/landing/{header,hero,footer}.tsx`（就地改造，目录结构不变）。

### 背景（page.tsx）

- 移除 `AnimatedBackground`（连带 Galaxy WebGL 引用）。
- 新静态背景层：顶部弱金 radial 顶光 + 极淡基线网格（CSS gradient 实现）+ 右下角 `ScalePattern`。零 JS 动效。
- 页面基底从冷黑 `#0a0a0a` 换为 `var(--ql-bg)`。

### Header

- 保留 `kworks-landing-header` class 与桌面拖拽区约束（`[-webkit-app-region:drag]`、macOS `pl-[80px]`、Windows 无红灯的 `.kworks-win-titlebar` 兼容逻辑全部原样）。
- 左侧：「OpenKylin」衬线字（暖白色）+ 右上标小号 `OpenKylinSeal`。
- 新增右侧 mono 小字链「进入控制台 →」（`text-[var(--ql-ink-mid)]`，hover 转 gold-300）。
  实现备注：为避免链接贴视口右缘，头部追加水平内边距 `px-6 md:px-10`（macOS 段
  `pl-[calc(80px+1rem)]`，Windows/浏览器随平台 class 收窄）——属计划外的最小 UX 补全，经评审确认保留。

### Hero

- 左列从上到下：mono 金色 eyebrow 一行（`OPENKYLIN · AUTONOMOUS AGENT ENGINE`，宽字距）→
  白色大标题（保留 `WordRotate` 轮换交互；「就用 OpenKylin」改为鎏金文字渐变 gold-300→gold-500）→
  副文案不变 → 主 CTA 改**金色实底黑字**（gold-500 底、hover 提亮至 gold-300，移除渐变+blur 光晕+scale 特效）→
  三个 tag 改 mono 方括号标注风格（如 `[ 多沙箱隔离 ]`，hairline 边框）。
- 右列六卡改「引擎模块清单」风：每卡左上角金色等宽编号 `01`–`06`，
  图标统一金描边单色（替换现有六种彩色 text-purple/blue/…），hairline 边框（gold-700 低透明度）hover 提亮。
- 六个特性条目的文案内容原样保留。

### Footer

- 分隔线改 `GoldDivider` 菱形结金线；衬线口号与 MIT 版权行文案不变；
  行末加一枚小号 `OpenKylinSeal` 收尾。

## 5. 登录/注册页 + 初始化页改动清单

现状问题：login 与 setup 各自手写同一套 Galaxy 星空 + FlickeringGrid + 彩虹 ShineBorder 外壳，代码重复且视觉是 KWorks 遗产。

方案：提炼公共外壳组件 **`src/components/auth/auth-shell.tsx`（`AuthShell`）**，
login (`src/app/(auth)/login/page.tsx`) 与 setup (`src/app/(auth)/setup/page.tsx`) 共用：

- **AuthShell 背景**：`var(--ql-bg)` 基底 + 弱金顶光（与 landing 同语言但更收敛）+
  中央极淡 radial 提亮，无星空无网格无紫色 blur orbs。
- **AuthShell 卡片容器**：窄体 `max-w-sm`、`rounded-xl`（替代原 rounded-3xl）、
  暖黑半透明 backdrop-blur 底、hairline 边框（gold-700）、
  顶部一条 2px 鎏金渐变饰条（替代 ShineBorder 流光）点睛。
- **表单控件规范**：label 小号 mono 宽字距；
  input 透明底 hairline 边框、focus 金色 ring；主按钮金色实底黑字；错误文案用亮朱砂红变体。
- **login 页结构差异保留**：logo 区改为 OpenKylinSeal + "OpenKylin" 衬线字组合，
  标题按 isLogin 切换「登录控制台 / 创建账户」，底部「返回首页」链接保留。
- **setup 页三模式（loading / init_admin / change_password）状态机与其余 300 行业务逻辑完全不动**，仅替换 JSX 视觉壳与控件 className。

明确退役且不再被引用的组件（删除前跑全站 grep 复核零引用）：

- `src/components/ui/galaxy.tsx` + `galaxy.css`
- `src/components/ui/flickering-grid.tsx`
- `src/components/ui/shine-border.tsx`
- `src/components/ui/spotlight-card.tsx` + `spotlight-card.css`
- `src/components/ui/animated-background.tsx`

## 6. 安全边界（不可破坏项）

- `kworksDesktop` bridge key、`kwins.*`/`kworks.*` storage keys、`kworks.*` CSS hook classes、`kworks.sandbox.*` provider ids：一律保留、拼写不改。
- `globals.css` 只追加品牌段，不修改既有规则（尤其 `.kworks-*` 相关）。
- `(auth)/layout.tsx` 中 Windows frameless 标题栏 div 与 AuthProvider 结构不动。
- backend/gateway 代码零改动。

## 7. 测试与验收

1. Playwright 截图：`/`、`/login`、`/setup` 在 1440px 与 390px 两档下渲染正常、无明显布局破损；
   `/workspace` 截图确认未受影响（需 admin 登录态）。
2. 用 admin@example.com 真实走一遍 login → workspace 路由（验证改版未破坏登录链路）。
3. `pnpm vitest run` 保持基线 257 pass / 1 fail（既有 thread-stream-cache worker OOM，允许）。
4. `pnpm build` 通过、tsc/lint 无新增报错。
5. 删除退役组件后 grep 复核：`galaxy`、`flickering-grid`、`shine-border`、`spotlight-card`、`animated-background` 在 src 下零引用。
6. 更新 `web-demo/README.md` 差异表，补一行「landing/auth 视觉自主化（玄金麒麟 VI）」。
7. 验收记录追加到 `docs/web-demo-acceptance-checklist.md`（新开一节）。

## 8. 已确认的取舍记录

- 设计方向候选了深色引擎控制台风（推荐落选）、浅色工程图纸风；用户选定**黑金·麒麟品牌风**。
- 国风浓度候选浓郁国风；用户选定**克制内敛**档：保留小尺寸篆印与角落鳞纹点缀，不做大面积传统纹样背景、不加瑞兽剪影主视觉。
- 实现方式候选乙（无 token 直写 arbitrary value，弃——色值散落难维护）与丙（全局主题换肤，弃——超范围）；选定**甲：独立 token 文件 + 复用组件 + 就地换皮**。
