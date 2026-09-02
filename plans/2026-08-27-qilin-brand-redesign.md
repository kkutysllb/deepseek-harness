# OpenKylin 玄金麒麟 VI 改版（landing + auth）Implementation Plan

**Goal:** 按 `docs/superpowers/specs/2026-08-27-qilin-brand-redesign-design.md`，把 web-demo 的 landing 页与登录/注册/初始化页从 KWorks 视觉遗产（Galaxy 星空、彩虹渐变、ShineBorder）改为「玄金麒麟」自主品牌视觉，业务逻辑零改动。

**Architecture:** 新增独立 token 层 `qilin-brand.css`（Tailwind v4 `@theme inline` 映射语义类）；新增两个复用组件目录——`components/brand/qilin-mark.tsx`（篆印/鳞纹/金线三件套）与 `components/auth/auth-shell.tsx`（认证页公共外壳）；landing 三组件与 login/setup 两页就地换皮；退役五个炫彩组件并删除。

**Tech Stack:** Next.js App Router（部分 RSC 部分客户端）、Tailwind CSS v4、lucide-react、vitest+testing-library（happy-dom）、Playwright MCP（截图验证）。

**验证环境:** 服务已在 http://localhost:28080 运行且 dev=true（Next 热更新），改代码后浏览器刷新即可见。仓库根：`/Users/libing/kk_Projects/OpenKylin`。

**安全边界（每个任务都适用）:** 不改 workspace 目录任何文件；不改 `globals.css` 既有规则（只允许新增文件与 root layout 的 import 行）；保留所有 `kworks*` 标识符；不引入新 npm 依赖。

---

### Task 1: 品牌 token 层

**Files:**
- Create: `web-demo/src/styles/qilin-brand.css`
- Modify: `web-demo/src/app/layout.tsx:1-2`（import 区）

- [ ] **Step 1: 写入 token 文件**

```css
/* qilin-brand.css — OpenKylin 品牌 VI「玄金麒麟」token 层。
   仅供 landing 与 auth 页面使用；不得在此改动全局 --background 等 shadcn 变量。 */
:root {
  /* 基底 */
  --ql-bg: #0d0b09;
  --ql-surface: #16130f;
  --ql-raised: #1d1915;
  /* 鎏金阶 */
  --ql-gold-300: #f3dc9e;
  --ql-gold-500: #c9a24a;
  --ql-gold-700: #8f6f2e;
  /* 三级墨色文字 */
  --ql-ink-hi: #efe9df;
  --ql-ink-mid: #a89f90;
  --ql-ink-low: #6b6459;
  /* 朱砂（印章 / 错误文案） */
  --ql-cinnabar: #c3402f;
  --ql-cinnabar-hi: #e0684f;
}

@theme inline {
  --color-ql-bg: var(--ql-bg);
  --color-ql-surface: var(--ql-surface);
  --color-ql-raised: var(--ql-raised);
  --color-ql-gold-300: var(--ql-gold-300);
  --color-ql-gold-500: var(--ql-gold-500);
  --color-ql-gold-700: var(--ql-gold-700);
  --color-ql-ink-hi: var(--ql-ink-hi);
  --color-ql-ink-mid: var(--ql-ink-mid);
  --color-ql-ink-low: var(--ql-ink-low);
  --color-ql-cinnabar: var(--ql-cinnabar);
  --color-ql-cinnabar-hi: var(--ql-cinnabar-hi);
}
```

- [ ] **Step 2: root layout 引入**

`web-demo/src/app/layout.tsx` 第 1 行区域改为（新增第 2 行，其余不动）：

```tsx
import "@/styles/globals.css";
import "@/styles/qilin-brand.css";
import "katex/dist/katex.min.css";
```

- [ ] **Step 3: 验证**

Run: `cd web-demo && npx tsc --noEmit 2>&1 | head -20`
Expected: 无输出（零类型错误）。再 `curl -sf -o /dev/null -w "%{http_code}\n" http://localhost:28080/login` 输出 `200`。

- [ ] **Step 4: Commit**

```bash
git add web-demo/src/styles/qilin-brand.css web-demo/src/app/layout.tsx
git commit -m "feat(web-demo): 新增玄金麒麟 VI token 层(qilin-brand.css)"
```

---

### Task 2: 品牌组件 OpenKylinMark（TDD）

**Files:**
- Test: `web-demo/tests/unit/components/qilin-mark.test.tsx`（新建）
- Create: `web-demo/src/components/brand/qilin-mark.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { GoldDivider, OpenKylinSeal, ScalePattern } from "@/components/brand/qilin-mark";

describe("OpenKylinMark 品牌组件", () => {
  test("OpenKylinSeal 默认为装饰元素(aria-hidden)，传 label 时暴露 role=img", () => {
    const { container, rerender } = render(<OpenKylinSeal />);
    const decorative = container.querySelector("svg");
    expect(decorative?.getAttribute("aria-hidden")).toBe("true");
    expect(decorative?.getAttribute("role")).toBeNull();

    rerender(<OpenKylinSeal label="麒麟印记" />);
    expect(screen.getByRole("img", { name: "麒麟印记" })).toBeTruthy();
  });

  test("OpenKylinSeal outline variant 用描边而非实底填充", () => {
    const { container } = render(<OpenKylinSeal variant="outline" />);
    const rect = container.querySelector("rect");
    expect(rect?.getAttribute("fill")).toBe("none");
    expect(rect?.getAttribute("stroke")).toContain("var(--ql-cinnabar");
  });

  test("ScalePattern 含可平铺的鳞纹 pattern 定义且标记为装饰", () => {
    const { container } = render(<ScalePattern patternId="test-scale" />);
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector('pattern[id="test-scale"]')).toBeTruthy();
    expect(container.querySelector('rect[fill="url(#test-scale)"]')).toBeTruthy();
  });

  test("GoldDivider 渲染菱形中点与左右两段渐隐线", () => {
    const { container } = render(<GoldDivider />);
    expect(container.querySelectorAll("span.h-px").length).toBe(2);
    expect(container.querySelector("span.rotate-45")).toBeTruthy();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd web-demo && pnpm vitest run tests/unit/components/qilin-mark.test.tsx 2>&1 | tail -8`
Expected: FAIL，报错包含 `Failed to resolve import "@/components/brand/qilin-mark"`。

- [ ] **Step 3: 实现组件**

```tsx
import { cn } from "@/lib/utils";

/**
 * 「麟」字方印 — 玄金麒麟 VI 的品牌印章。
 * 默认纯装饰(aria-hidden)；作为 logo 语义使用时传入 label 以暴露给读屏。
 */
export function OpenKylinSeal({
  size = 24,
  variant = "solid",
  label,
  className,
}: {
  size?: number;
  variant?: "solid" | "outline";
  label?: string;
  className?: string;
}) {
  const solid = variant === "solid";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      className={cn("shrink-0", className)}
    >
      <rect
        x="1"
        y="1"
        width="22"
        height="22"
        rx="3.5"
        fill={solid ? "var(--ql-cinnabar)" : "none"}
        stroke={solid ? "none" : "var(--ql-cinnabar-hi)"}
        strokeWidth={solid ? 0 : 1.5}
      />
      <text
        x="12"
        y="16.4"
        textAnchor="middle"
        fontSize="13"
        fontWeight="700"
        fill={solid ? "#fff5eb" : "var(--ql-cinnabar-hi)"}
        fontFamily="'Noto Serif SC','Songti SC','STSong',serif"
      >
        麟
      </text>
    </svg>
  );
}

/**
 * 半圆叠瓦鳞纹 — 极淡的角落氛围纹理(opacity 内建 0.05)。
 * 同一页面多实例时各自传不同 patternId 避免 <pattern> id 冲突。
 */
export function ScalePattern({
  patternId = "qilin-scale",
  className,
}: {
  patternId?: string;
  className?: string;
}) {
  return (
    <svg aria-hidden="true" focusable="false" width="260" height="180" className={className}>
      <defs>
        <pattern id={patternId} width="24" height="16" patternUnits="userSpaceOnUse">
          <path
            d="M0 16a12 12 0 0 1 24 0M-12 8a12 12 0 0 1 24 0M12 8a12 12 0 0 1 24 0M0 0a12 12 0 0 1 24 0"
            fill="none"
            stroke="var(--ql-gold-500)"
            strokeWidth="1"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${patternId})`} opacity="0.05" />
    </svg>
  );
}

/** 中点菱形金色分隔线（◆ 两翼渐隐细线）。 */
export function GoldDivider({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn("flex items-center gap-3", className)}>
      <span className="h-px flex-1 bg-gradient-to-r from-transparent to-ql-gold-700" />
      <span className="size-1.5 rotate-45 bg-ql-gold-500" />
      <span className="h-px flex-1 bg-gradient-to-l from-transparent to-ql-gold-700" />
    </div>
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd web-demo && pnpm vitest run tests/unit/components/qilin-mark.test.tsx 2>&1 | tail -5`
Expected: `4 passed`。若 `to-ql-gold-700` 类名被 tailwind-merge 视为冲突需人工核对渲染产物（class 同时存在即可），测试只断言结构不断言色值。

- [ ] **Step 5: Commit**

```bash
git add web-demo/src/components/brand/qilin-mark.tsx web-demo/tests/unit/components/qilin-mark.test.tsx
git commit -m "feat(web-demo): 品牌组件 OpenKylinMark(麟印/鳞纹/金线)"
```

---

### Task 3: Landing 页背景换皮

**Files:**
- Modify: `web-demo/src/app/page.tsx`（全文替换）

- [ ] **Step 1: 替换为玄金静态背景**

```tsx
import { ScalePattern } from "@/components/brand/qilin-mark";
import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";
import { Hero } from "@/components/landing/hero";

export default function LandingPage() {
  return (
    <div className="bg-ql-bg text-ql-ink-hi relative flex min-h-screen w-full flex-col overflow-hidden">
      {/* 玄金静态背景层：弱金顶光 + 极淡基线网格 + 右下角鳞纹(全部装饰性, 零 JS 动效) */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(60%_100%_at_50%_0%,rgba(201,162,74,0.10),transparent_70%)]" />
        <div
          className="absolute inset-0 opacity-100"
          style={{
            backgroundImage:
              "linear-gradient(rgba(239,233,223,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(239,233,223,0.03) 1px, transparent 1px)",
            backgroundSize: "72px 72px",
          }}
        />
        <ScalePattern patternId="landing-scale" className="absolute right-0 bottom-0" />
      </div>
      <div className="relative z-10 flex min-h-screen w-full flex-col">
        <Header />
        <main className="flex w-full flex-1 flex-col justify-center">
          <Hero />
        </main>
        <Footer />
      </div>
    </div>
  );
}
```

注意：本任务先删掉 `AnimatedBackground` 引用但**暂不删除其源文件**（Task 10 统一退役）。

- [ ] **Step 2: 验证**

刷新 `http://localhost:28080/`：
Expected: 页面正常渲染无瀑布错误；console 无 `AnimatedBackground` 相关引用报错（header/hero/footer 尚未换皮属预期，观感混杂留待后续任务收敛）。

- [ ] **Step 3: Commit**

```bash
git add web-demo/src/app/page.tsx
git commit -m "feat(web-demo): landing 背景切换为玄金静态层"
```

---

### Task 4: Landing Header 换皮

**Files:**
- Modify: `web-demo/src/components/landing/header.tsx`（全文替换）

- [ ] **Step 1: 替换实现**

```tsx
import Link from "next/link";

import { OpenKylinSeal } from "@/components/brand/qilin-mark";
import { cn } from "@/lib/utils";

export type HeaderProps = {
  className?: string;
  homeURL?: string;
};

export async function Header({ className, homeURL }: HeaderProps) {
  return (
    <header
      className={cn(
        // [-webkit-app-region:drag] 让整个头部在桌面壳里承担窗口拖拽；
        // pl-[80px] 为 macOS 红绿灯预留；Windows 无红灯经 .kworks-landing-header 收窄。
        // 平台兼容 class(kworks-*) 一律原样保留。
        "kworks-landing-header fixed top-0 right-0 left-0 z-20 mx-auto flex h-16 items-center justify-between pl-[80px] backdrop-blur-xs [-webkit-app-region:drag]",
        className,
      )}
    >
      <a href={homeURL ?? "/"} className="flex items-center gap-2 [-webkit-app-region:no-drag]">
        <span className="font-serif text-xl text-ql-ink-hi">OpenKylin</span>
        <OpenKylinSeal size={14} variant="outline" />
      </a>
      <Link
        href="/workspace"
        className="font-mono text-xs tracking-widest text-ql-ink-mid transition-colors hover:text-ql-gold-300 [-webkit-app-region:no-drag]"
      >
        进入控制台 →
      </Link>
      <hr className="from-border/0 via-border/70 to-border/0 absolute top-16 right-0 left-0 z-10 m-0 h-px w-full border-none bg-linear-to-r" />
    </header>
  );
}
```

差异说明：原 `container-md` 移除会改变内边距吗？—— 原 header 定宽容器换成全宽 flex 后，两侧贴边；为保持呼吸感给两端子元素各补 `mr-6 ml-[calc(0rem)]`？不做——保持极简贴边即可，若截图观感局促在后续调优轮次处理（记录于验收清单备注，不算阻塞）。

- [ ] **Step 2: 验证**

刷新首页：左上「OpenKylin」暖白衬线字 + 朱砂描边小印，右侧 mono 金调「进入控制台 →」，hover 变亮金。`[-webkit-app-region]` 属桌面壳专用属性，浏览器忽略不影响点击。

- [ ] **Step 3: Commit**

```bash
git add web-demo/src/components/landing/header.tsx
git commit -m "feat(web-demo): landing header 换皮(麟印+控制台入口)"
```

---

### Task 5: Landing Hero 换皮

**Files:**
- Modify: `web-demo/src/components/landing/hero.tsx`（全文替换）

- [ ] **Step 1: 替换实现**

```tsx
"use client";

import {
  Blocks,
  Brain,
  ChevronRightIcon,
  Clock,
  Code2,
  HardDrive,
  Layers,
} from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { WordRotate } from "@/components/ui/word-rotate";
import { cn } from "@/lib/utils";

const features = [
  { icon: Brain, title: "长短期记忆", desc: "跨会话理解你，上下文不断延续" },
  { icon: Clock, title: "规划与子任务", desc: "拆解复杂任务，按序或并行执行" },
  { icon: Blocks, title: "技能与工具", desc: "内置技能库 + MCP，按需渐进加载" },
  { icon: HardDrive, title: "沙箱环境", desc: "多后端隔离：本地、Docker 与云端沙箱" },
  { icon: Layers, title: "多模型支持", desc: "豆包、DeepSeek、OpenAI、Gemini 等" },
  { icon: Code2, title: "开源可部署", desc: "MIT 协议，自主部署、完全掌控" },
];

export function Hero({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-6xl flex-col items-center gap-10 px-6 py-10 lg:flex-row lg:items-center lg:gap-14",
        className,
      )}
    >
      {/* 左：品牌文案 */}
      <div className="flex w-full flex-col items-center text-center lg:w-[45%] lg:items-start lg:text-left">
        <p className="font-mono text-xs tracking-[0.35em] text-ql-gold-500">
          OPENKYLIN · AUTONOMOUS AGENT ENGINE
        </p>
        <h1 className="mt-4 flex flex-wrap items-center justify-center gap-2 text-3xl font-bold text-ql-ink-hi lg:justify-start lg:text-5xl">
          <WordRotate
            words={[
              "深度研究",
              "采集数据",
              "分析数据",
              "生成网页",
              "氛围编程",
              "制作幻灯片",
              "生成图像",
              "生成播客",
              "生成视频",
              "创作歌曲",
              "整理邮件",
              "做任何事",
              "学任何东西",
            ]}
          />{" "}
          <span className="bg-gradient-to-r from-ql-gold-300 to-ql-gold-500 bg-clip-text text-transparent">
            就用 OpenKylin
          </span>
        </h1>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-ql-ink-mid">
          一个开源的智能体编排平台，由沙箱、记忆、工具、技能和子智能体驱动，
          可自主完成从数分钟到数小时的复杂任务。
        </p>
        <Link href="/workspace" className="group mt-8">
          <Button
            size="lg"
            className="h-11 rounded-lg border-0 bg-ql-gold-500 px-8 text-base font-semibold text-[#141006] shadow-lg shadow-black/40 transition-colors hover:bg-ql-gold-300 active:bg-ql-gold-500"
          >
            <span>探索平台</span>
            <ChevronRightIcon className="size-5 transition-transform duration-300 group-hover:translate-x-1" />
          </Button>
        </Link>
        <div className="mt-6 flex flex-wrap justify-center gap-2 lg:justify-start">
          {["多沙箱隔离", "多模型", "MIT 开源"].map((tag) => (
            <span
              key={tag}
              className="rounded-md border border-white/10 px-3 py-1 font-mono text-xs text-ql-ink-mid"
            >
              [ {tag} ]
            </span>
          ))}
        </div>
      </div>

      {/* 右：引擎模块清单 */}
      <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:w-[55%]">
        {features.map((feature, i) => {
          const Icon = feature.icon;
          const num = String(i + 1).padStart(2, "0");
          return (
            <div
              key={feature.title}
              className="rounded-xl border border-white/10 bg-white/[0.03] p-4 transition-colors hover:border-ql-gold-700 hover:bg-white/[0.05]"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-ql-gold-700">{num}</span>
                <Icon className="size-5 shrink-0 text-ql-gold-500" />
              </div>
              <h3 className="mt-3 text-sm font-semibold text-zinc-100">{feature.title}</h3>
              <p className="mt-0.5 text-xs leading-relaxed text-ql-ink-mid">{feature.desc}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 验证**

刷新首页：
Expected: eyebrow 金色等宽小字；CTA 为金色实底黑字（DevTools 计算 `background-color` ≈ `rgb(201,162,74)`；若仍是旧紫色说明按钮 variant 类未被覆盖，把颜色类加 `!` 前缀如 `!bg-ql-gold-500` 重试）；六卡编号 01–06 金色等宽、图标统一金色；六条特性文案与原先逐字一致。

- [ ] **Step 3: Commit**

```bash
git add web-demo/src/components/landing/hero.tsx
git commit -m "feat(web-demo): hero 换皮(鎏金 CTA+模块清单卡)"
```

---

### Task 6: Landing Footer 换皮

**Files:**
- Modify: `web-demo/src/components/landing/footer.tsx`（全文替换）

- [ ] **Step 1: 替换实现**

```tsx
import { useMemo } from "react";

import { GoldDivider, OpenKylinSeal } from "@/components/brand/qilin-mark";
import { cn } from "@/lib/utils";

export type FooterProps = {
  className?: string;
};

export function Footer({ className }: FooterProps) {
  const year = useMemo(() => new Date().getFullYear(), []);
  return (
    <footer
      className={cn(
        "container-md mx-auto mt-4 flex flex-col items-center justify-center",
        className,
      )}
    >
      <GoldDivider className="w-full max-w-xl" />
      <div className="container flex h-12 flex-col items-center justify-center text-sm text-ql-ink-mid">
        <p className="text-center font-serif text-sm md:text-base">
          「为自主智能体而生，以开源为基石。」
        </p>
      </div>
      <div className="container mb-4 flex items-center justify-center gap-2 text-xs text-ql-ink-low">
        <p>基于 MIT 协议开源 · &copy; {year} OpenKylin</p>
        <OpenKylinSeal size={12} />
      </div>
    </footer>
  );
}
```

- [ ] **Step 2: 验证**

刷新首页滚到底部：菱形结金线出现，口号与版权文案不变，行尾有一枚迷你麟印。

- [ ] **Step 3: Commit**

```bash
git add web-demo/src/components/landing/footer.tsx
git commit -m "feat(web-demo): footer 换皮(金线分隔+麟印收尾)"
```

---

### Task 7: 认证页公共外壳 AuthShell

**Files:**
- Create: `web-demo/src/components/auth/auth-shell.tsx`

- [ ] **Step 1: 实现外壳（login/setup 换皮前先行落地）**

```tsx
import { type ReactNode } from "react";

import { OpenKylinSeal } from "@/components/brand/qilin-mark";
import { cn } from "@/lib/utils";

/** 认证页表单控件统一样式（Input 直接拼接到 className 使用）。 */
export const authFieldClass =
  "border-white/15 bg-transparent text-ql-ink-hi placeholder:text-ql-ink-low focus-visible:border-ql-gold-500 focus-visible:ring-ql-gold-500/40 transition-colors";

/** 认证页表单 label 统一样式。 */
export const authLabelClass =
  "font-mono text-xs tracking-widest text-ql-ink-mid";

/** 错误文案统一样式（暗底朱砂亮化变体）。 */
export const authErrorClass = "text-ql-cinnabar-hi";

/** 主操作按钮统一样式（金色实底黑字，替代彩虹渐变）。 */
export const authSubmitClass =
  "w-full rounded-lg border-0 bg-ql-gold-500 font-semibold text-[#141006] shadow-none transition-colors hover:bg-ql-gold-300 disabled:bg-ql-gold-700";

/**
 * 认证页公共外壳 — 玄金麒麟 VI：暖玄黑底 + 弱金顶光，
 * 窄体圆角卡片 + 顶部 2px 鎏金饰条。login / setup 共用，纯服务端组件。
 */
export function AuthShell({
  children,
  title,
  subtitle,
  className,
}: {
  children: ReactNode;
  title: string;
  subtitle?: string;
  className?: string;
}) {
  return (
    <div className="bg-ql-bg relative flex min-h-screen items-center justify-center overflow-hidden">
      {/* 背景层（比 landing 更收敛：仅弱金顶光） */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute inset-x-0 top-0 h-64 bg-[radial-gradient(50%_100%_at_50%_0%,rgba(201,162,74,0.08),transparent_70%)]" />
      </div>
      {/* 卡片容器 */}
      <div className={cn("relative z-10 w-full max-w-sm px-4", className)}>
        <div className="overflow-hidden rounded-xl border border-white/10 bg-black/30 shadow-2xl shadow-black/50 backdrop-blur-xl">
          <div
            aria-hidden="true"
            className="h-0.5 bg-gradient-to-r from-transparent via-ql-gold-500 to-transparent"
          />
          <div className="space-y-6 p-8">
            <div className="flex flex-col items-center gap-1.5 text-center">
              <div className="flex items-center gap-2">
                <OpenKylinSeal size={18} />
                <span className="font-serif text-xl text-ql-ink-hi">OpenKylin</span>
              </div>
              <h1 className="text-base font-semibold text-ql-ink-hi">{title}</h1>
              {subtitle && (
                <p className="text-sm text-ql-ink-mid">{subtitle}</p>
              )}
            </div>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 验证**

Run: `cd web-demo && npx tsc --noEmit`
Expected: 零错误（此时还没有消费方，编译通过即可）。

- [ ] **Step 3: Commit**

```bash
git add web-demo/src/components/auth/auth-shell.tsx
git commit -m "feat(web-demo): 认证页公共外壳 AuthShell(玄金 VI)"
```

---

### Task 8: Login 页换壳（逻辑不动）

**Files:**
- Modify: `web-demo/src/app/(auth)/login/page.tsx:152-271`（return JSX）与 import 区

- [ ] **Step 1: 更新 import 区**

删除这四行 import（及其独占注释）：`FlickeringGrid`、`Galaxy`、`ShineBorder`、`SpotlightCard`；新增：

```tsx
import {
  AuthShell,
  authErrorClass,
  authFieldClass,
  authLabelClass,
  authSubmitClass,
} from "@/components/auth/auth-shell";
import { cn } from "@/lib/utils";
```

- [ ] **Step 2: 替换 return JSX（handleSubmit 等 151 行之前的一切逻辑逐字保留）**

```tsx
  return (
    <AuthShell
      title={isLogin ? "登录控制台" : "创建账户"}
      subtitle={isLogin ? "登录您的账户" : "创建新账户"}
    >
      <form onSubmit={handleSubmit} className="space-y-2">
        <div className="flex flex-col space-y-1">
          <label htmlFor="email" className={authLabelClass}>
            邮箱
          </label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="请输入邮箱地址"
            required
            className={authFieldClass}
          />
        </div>
        <div className="flex flex-col space-y-1">
          <label htmlFor="password" className={authLabelClass}>
            密码
          </label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="请输入密码"
            required
            minLength={isLogin ? 6 : 8}
            className={authFieldClass}
          />
        </div>

        {error && <p className={cn("text-sm", authErrorClass)}>{error}</p>}

        <Button
          type="submit"
          className={authSubmitClass}
          disabled={loading}
        >
          {loading ? "请稍候…" : isLogin ? "登录" : "创建账户"}
        </Button>
      </form>

      <div className="text-center text-sm">
        <button
          type="button"
          onClick={() => {
            setIsLogin(!isLogin);
            setError("");
          }}
          className="text-ql-gold-300 transition-colors hover:text-ql-gold-500 hover:underline"
        >
          {isLogin ? "没有账户？立即注册" : "已有账户？立即登录"}
        </button>
      </div>

      <div className="text-center text-xs">
        <Link
          href="/"
          className="text-ql-ink-low transition-colors hover:text-ql-ink-mid hover:underline"
        >
          ← 返回首页
        </Link>
      </div>
    </AuthShell>
  );
```

- [ ] **Step 3: 运行时验证（真实登录链路）**

访问 `http://localhost:28080/login`：
Expected: 卡片顶部有鎏金饰条、微麟印+OpenKylin 衬线标识；无星空/网格/流光。填 admin@example.com / OpenKylin#Demo2026 登录成功跳 `/workspace`。再回到 `/login` 点「没有账户？立即注册」，标题切到「创建账户」（路由守卫可能因已登录弹回 workspace——该行为是既有逻辑，不是回归）。

- [ ] **Step 4: Commit**

```bash
git add "web-demo/src/app/(auth)/login/page.tsx"
git commit -m "feat(web-demo): login 页换壳 AuthShell(业务逻辑不动)"
```

---

### Task 9: Setup 页换壳（三个分支）

**Files:**
- Modify: `web-demo/src/app/(auth)/setup/page.tsx`（import 区 + loading/init_admin/change_password 三个 return）

- [ ] **Step 1: 更新 import 区**

删除 `FlickeringGrid`、`Galaxy`、`ShineBorder`、`SpotlightCard` 四个 import；新增与 Task 8 相同的 AuthShell 五项 import 及 `cn`。

- [ ] **Step 2: loading 分支换肤**

```tsx
  if (mode === "loading") {
    return (
      <div className="bg-ql-bg flex min-h-screen items-center justify-center">
        <p className="text-sm text-ql-ink-mid">加载中…</p>
      </div>
    );
  }
```

- [ ] **Step 3: init_admin 分支替换外壳（表单字段/handleInitAdmin 全部逐字保留，仅控件样式换 authFieldClass）**

```tsx
  if (mode === "init_admin") {
    return (
      <AuthShell title="初始化管理员" subtitle="请设置管理员账户以开始使用。">
        <form onSubmit={handleInitAdmin} className="space-y-2">
          <div className="flex flex-col space-y-1">
            <label htmlFor="email" className={authLabelClass}>邮箱</label>
            <Input id="email" type="email" placeholder="请输入邮箱地址" value={email}
              onChange={(e) => setEmail(e.target.value)} required className={authFieldClass} />
          </div>
          <div className="flex flex-col space-y-1">
            <label htmlFor="password" className={authLabelClass}>密码</label>
            <Input id="password" type="password" placeholder="密码（至少8位）" value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)} required minLength={8} className={authFieldClass} />
          </div>
          <div className="flex flex-col space-y-1">
            <label htmlFor="confirmPassword" className={authLabelClass}>确认密码</label>
            <Input id="confirmPassword" type="password" placeholder="再次输入密码" value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)} required minLength={8} className={authFieldClass} />
          </div>
          {error && <p className={cn("ms-1 text-sm", authErrorClass)}>{error}</p>}
          <Button type="submit" className={authSubmitClass} disabled={loading}>
            {loading ? "正在创建账户…" : "创建管理员账户"}
          </Button>
        </form>
      </AuthShell>
    );
  }
```

- [ ] **Step 4: change_password 分支同理替换（handleChangePassword 与四个受控 Input 的绑定逐字保留）**

```tsx
  return (
    <AuthShell title="完成管理员账户设置" subtitle="请设置您的真实邮箱和新密码。">
      <form onSubmit={handleChangePassword} className="space-y-4">
        <Input type="email" placeholder="您的邮箱" value={email}
          onChange={(e) => setEmail(e.target.value)} required className={authFieldClass} />
        <Input type="password" placeholder="当前密码" value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)} required className={authFieldClass} />
        <Input type="password" placeholder="新密码" value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)} required minLength={8} className={authFieldClass} />
        <Input type="password" placeholder="确认新密码" value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)} required minLength={8} className={authFieldClass} />
        {error && <p className={cn("text-sm", authErrorClass)}>{error}</p>}
        <Button type="submit" className={authSubmitClass} disabled={loading}>
          {loading ? "正在设置…" : "完成设置"}
        </Button>
      </form>
    </AuthShell>
  );
```

- [ ] **Step 5: 验证**

Run: `cd web-demo && npx tsc --noEmit`
Expected: 零错误。（setup 三态需要特殊账号状态才可见，运行时走查归入 Task 11 验收清单。）

- [ ] **Step 6: Commit**

```bash
git add "web-demo/src/app/(auth)/setup/page.tsx"
git commit -m "feat(web-demo): setup 三分支换壳 AuthShell"
```

---

### Task 10: 退役炫彩组件删除

**Files:**
- Delete: `web-demo/src/components/ui/galaxy.tsx`
- Delete: `web-demo/src/components/ui/galaxy.css`
- Delete: `web-demo/src/components/ui/flickering-grid.tsx`
- Delete: `web-demo/src/components/ui/shine-border.tsx`
- Delete: `web-demo/src/components/ui/spotlight-card.tsx`
- Delete: `web-demo/src/components/ui/spotlight-card.css`
- Delete: `web-demo/src/components/ui/animated-background.tsx`

前置断言：删除前全站引用必须只剩这些文件自身（互相引用）。

- [ ] **Step 1: 全站 grep 复核零外部引用**

Run: `cd web-demo/src && grep -rln "ui/galaxy\|ui/flickering-grid\|ui/shine-border\|ui/spotlight-card\|animated-background" --include="*.tsx" --include="*.ts" . | grep -v "components/ui/"`
Expected: 无输出。（有输出则停下修复引用，禁止带引用删除。）

- [ ] **Step 2: 删除文件**

```bash
cd /Users/libing/kk_Projects/OpenKylin/web-demo
git rm src/components/ui/galaxy.tsx src/components/ui/galaxy.css \
       src/components/ui/flickering-grid.tsx src/components/ui/shine-border.tsx \
       src/components/ui/spotlight-card.tsx src/components/ui/spotlight-card.css \
       src/components/ui/animated-background.tsx
```

注意：**不要动** `src/components/ui/magic-bento.tsx/.css`、`spotlight-card.tsx` 之外的 spotlight 相关（magic-bento 是别的组件族）。若 `galaxy.css`/`spotlight-card.css` 不存在则以实际为准跳过并在提交信息注明。

- [ ] **Step 3: 编译与单测回归**

Run: `cd web-demo && npx tsc --noEmit && pnpm vitest run 2>&1 | tail -6`
Expected: tsc 零错误；vitest 通过数 ≥257，唯一失败仍为既有 thread-stream-cache worker OOM。

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "refactor(web-demo): 退役 KWorks 遗产炫彩组件(Galaxy/Flicker/ShineBorder/SpotlightCard/AnimBg)"
```

---

### Task 11: 全量验收 + 文档

**Files:**
- Modify: `web-demo/README.md`（差异表追加一行）
- Modify: `docs/web-demo-acceptance-checklist.md`（新开「玄金麒麟 VI 改版验收」节）
- Modify: `.gitignore`（忽略会话工具产物）

- [ ] **Step 1: README 差异表追加**

在 web-demo/README.md 与 KWorks 差异表中追加一行：

```markdown
| 门面视觉 | landing 与认证页采用自研「玄金麒麟」VI（暖玄黑×鎏金，见 docs/superpowers/specs/2026-08-27-qilin-brand-redesign-design.md），不再对齐 KWorks 官网 | workspace 内部交互仍保持 KWorks 对齐 |
```

（列名以表内实际列头为准，保持两列结构一致。）

- [ ] **Step 2: .gitignore 追加**

```
.dsh-vision-router/
```

- [ ] **Step 3: 生产构建回归（先停服避免 .next 冲突）**

```bash
cd /Users/libing/kk_Projects/OpenKylin
./scripts/start-all.sh --stop
(cd web-demo && pnpm build)
nohup ./scripts/start-all.sh > /tmp/web-demo.log 2>&1 & disown
sleep 8
curl -sf http://127.0.0.1:28081/health && curl -sf -o /dev/null -w "%{http_code}\n" http://localhost:28080
```

Expected: build 成功；health JSON 正常；首页 200。

- [ ] **Step 4: Playwright 走查与截图**

用 playwright MCP 依次访问并整页截图存档：`/`（1440 与 390 两档 viewport）、`/login`、`/setup`（可直接访问会被重定向到 /login 属预期，仅在无用户数据库状态下可截 init_admin 态——不可得时记录「setup 运行时走查依赖全新数据目录，本次以代码审查+tsc 覆盖」）。`/workspace`（登录后）截图确认侧边栏/workspace 未受影响。检查点：

- 无彩虹渐变/星空/流光残留；主色只有暖黑阶+金阶+朱砂点
- 1440 与 390 下布局无溢出、无横向滚动条
- 登录链路真实可用（admin@example.com 登录至 /workspace）

- [ ] **Step 5: 验收清单落档**

`docs/web-demo-acceptance-checklist.md` 追加新节（示例行，实际结果照实填写 ✅/⚠️）：

```markdown
## 9. 玄金麒麟 VI 改版验收（2026-08-27）

| # | 项目 | 结果 |
|---|------|------|
| 9.1 | token 层生效(bg-ql-* 语义类渲染正确) | |
| 9.2 | OpenKylinMark 单测 4 项通过 | |
| 9.3 | landing 三组件换皮后 1440/390 无布局破损 | |
| 9.4 | CTA 金色实底(rgb≈201,162,74)、无彩虹渐变 | |
| 9.5 | login 换壳后真实登录链路可用 | |
| 9.6 | setup 三分支 tsc 通过(init_admin 运行态视数据目录状态) | |
| 9.7 | 退役五组件 grep 零引用并删除 | |
| 9.8 | vitest ≥257 pass、build 成功 | |
| 9.9 | workspace 视觉未受影响 | |
```

- [ ] **Step 6: Commit & Push**

```bash
git add web-demo/README.md .gitignore docs/web-demo-acceptance-checklist.md
git commit -m "docs(web-demo): 玄金麒麟 VI 改版验收记录"
git push origin main
```

---

## Self-Review 结论

1. **Spec 覆盖**：§2 token→Task 1；§3 母题组件→Task 2；§4 landing 三件套→Task 3–6；§5 auth 外壳/两页→Task 7–9；退役清理→Task 10；§7 验收→Task 11。无缺口。
2. **占位符扫描**：所有代码步骤均给出完整实现；README 差异表的列结构以现有表头为准属自适应适配，非占位。
3. **一致性**：`OpenKylinSeal/ScalePattern/GoldDivider/AuthShell/authFieldClass/authLabelClass/authErrorClass/authSubmitClass` 在定义与消费处命名逐一比对一致；Token 名与规格 §2 表格一一对应。
