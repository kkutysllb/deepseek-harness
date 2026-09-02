# OpenKylin Web Demo（KWorks 全面对齐）实施计划

**Goal:** 将 KWorks `frontend/` 整体移植为 `OpenKylin/web-demo/`，纯 web 模式浏览器直连本地 OpenKylin gateway，全量页面 + OpenKylin 品牌，不影响本机已安装的 KWorks 应用。

**Architecture:** 直接移植 + 同源自定义代理。`web-demo/server.js`（Next 自定义服务，端口 28080）把 `/api/*`、`/health` 无缓冲转发到 gateway（端口 28081），支持 SSE 逐字流式与 WebSocket 升级；前端走 KWorks 原生 web 分支（`isDesktop()` 为 false），API 层零改动。数据目录用仓库内 `.qilin/`，与 KWorks 的 `~/.kworks/` 隔离。

**Tech Stack:** Next.js 16 / React 19 / Tailwind 4 / Radix+shadcn / @langchain/langgraph-sdk / streamdown / http-proxy-middleware / pnpm

**设计文档:** `docs/superpowers/specs/2026-08-26-web-demo-kworks-aligned-design.md`（commit `be903e9`）

**关键参考事实（已核实）:**
- gateway 健康检查：`GET /health` → `{"status":"healthy","service":"qilin-gateway"}`
- 认证：`GET /api/v1/auth/setup-status` → `{needs_setup}`；首次 `POST /api/v1/auth/initialize`（JSON `{email,password,remember_me}`，密码需强口令）；之后 `POST /api/v1/auth/login/local`（**form-encoded** `username`=邮箱/`password`）
- CSRF：双提交，cookie 名 `csrf_token`，请求头 `X-CSRF-Token`；login/initialize 豁免
- 线程：`POST /api/threads`（JSON `{metadata:{...}}`）；流式：`POST /api/threads/{id}/runs/stream`（JSON `{input:{messages:[...]}}`，其余字段可省略，`extra="forbid"` 勿加未知字段）
- 前端调用 langgraph SDK 路径为 `/api/langgraph/*`，需代理重写为 `/api/*`（KWorks next.config rewrites 同款映射）
- KWorks 占用端口：19987（gateway）/ 18569（dev）；OpenKylin 旧脚本遗留端口：8081/3000 —— 全部避开

---

## Task 0: 环境与隔离预检

**Files:** 无（纯检查）

- [ ] **Step 1: 工具链版本检查**

```bash
node -v && pnpm -v && python3 -V
```
期望：node ≥ 22，pnpm ≥ 10，python ≥ 3.12。若 pnpm 缺失：`corepack enable` 或 `npm i -g pnpm`。

- [ ] **Step 2: 端口空闲检查（28080/28081，且确认不碰 KWorks 端口）**

```bash
lsof -nP -iTCP:28080 -sTCP:LISTEN; lsof -nP -iTCP:28081 -sTCP:LISTEN; echo "port check done"
```
期望：两条 lsof 均无输出（端口空闲）。

- [ ] **Step 3: KWorks 源目录存在性**

```bash
test -f /Users/libing/kk_Projects/KWorks/frontend/package.json && echo OK
```
期望：输出 `OK`。

- [ ] **Step 4: gateway 依赖可用性**

```bash
cd /Users/libing/kk_Projects/OpenKylin && test -f config.yaml || cp config.example.yaml config.yaml; uv run python -c "import app.gateway.app" && echo "gateway importable"
```
期望：输出 `gateway importable`（若 uv 缺失，先 `brew install uv`）。

---

## Task 1: 代码移植 + .gitignore

**Files:**
- Create: `web-demo/`（整个目录，来自 rsync）
- Modify: `web-demo/package.json`（name）
- Modify: `/Users/libing/kk_Projects/OpenKylin/.gitignore`（追加 web-demo 产物）

- [ ] **Step 1: rsync 拷贝（排除构建产物与本地环境）**

```bash
cd /Users/libing/kk_Projects/OpenKylin
rsync -a \
  --exclude='node_modules' --exclude='.next' --exclude='out' \
  --exclude='test-results' --exclude='playwright-report' \
  --exclude='tsconfig.tsbuildinfo' --exclude='.env*' --exclude='.DS_Store' \
  /Users/libing/kk_Projects/KWorks/frontend/ ./web-demo/
ls web-demo/package.json web-demo/src web-demo/next.config.js
```
期望：三个路径均列出。

- [ ] **Step 2: 改 package.json name**

编辑 `web-demo/package.json`：
```json
  "name": "qilin-web-demo",
```
（原值 `"kworks-frontend"`，只改这一行。）

- [ ] **Step 3: 主仓 .gitignore 追加**

在 `/Users/libing/kk_Projects/OpenKylin/.gitignore` 末尾追加：
```
# web-demo (KWorks-aligned)
web-demo/node_modules/
web-demo/.next/
web-demo/out/
web-demo/test-results/
web-demo/playwright-report/
web-demo/.env.local
web-demo/tsconfig.tsbuildinfo
```

- [ ] **Step 4: 验证 git 只看到源码**

```bash
cd /Users/libing/kk_Projects/OpenKylin && git add .gitignore web-demo && git status --short | grep -c node_modules
```
期望：输出 `0`（node_modules 尚未安装且已被忽略）。

- [ ] **Step 5: 提交**

```bash
git commit -m "chore(web-demo): port KWorks frontend sources (full alignment baseline)"
```

---

## Task 2: 安装依赖 + 基线验证

**Files:**
- Create: `web-demo/pnpm-lock.yaml`（install 生成）

- [ ] **Step 1: 安装依赖**

```bash
cd /Users/libing/kk_Projects/OpenKylin/web-demo && pnpm install 2>&1 | tail -15
```
期望：无 ERR（依赖体积大，预计 3-8 分钟；three.js/pptx viewer 等按设计保留不裁剪）。

- [ ] **Step 2: typecheck 基线**

```bash
cd /Users/libing/kk_Projects/OpenKylin/web-demo && pnpm typecheck 2>&1 | tail -10
```
期望：0 error（KWorks 上游代码是干净的；若报错先排查是否 rsync 遗漏文件）。

- [ ] **Step 3: vitest 基线**

```bash
cd /Users/libing/kk_Projects/OpenKylin/web-demo && pnpm test 2>&1 | tail -20
```
记录通过/失败数作为基线（与 KWorks frontend 当前结果一致即可；新增失败必须在后续任务修复）。

- [ ] **Step 4: 提交**

```bash
cd /Users/libing/kk_Projects/OpenKylin && git add web-demo/pnpm-lock.yaml && git commit -m "chore(web-demo): pnpm install + baseline typecheck/test"
```

---

## Task 3: server.js 同源代理

**Files:**
- Create: `web-demo/server.js`
- Modify: `web-demo/package.json`（scripts + 依赖）

- [ ] **Step 1: 安装 http-proxy-middleware**

```bash
cd /Users/libing/kk_Projects/OpenKylin/web-demo && pnpm add http-proxy-middleware
```
期望：安装成功（v3.x）。

- [ ] **Step 2: 创建 `web-demo/server.js`**

```javascript
/**
 * OpenKylin Web Demo — same-origin custom server.
 *
 * Proxies /api/* and /health to the OpenKylin gateway with NO response
 * buffering (SSE streams token-by-token) and WebSocket upgrade support.
 * next.config.js rewrites remain as fallback for plain `next dev`, but
 * this server intercepts first when running via `pnpm dev`.
 */
import { createServer } from "node:http";
import { parse } from "node:url";
import next from "next";
import { createProxyMiddleware } from "http-proxy-middleware";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.WEB_DEMO_HOST || "127.0.0.1";
const port = Number.parseInt(process.env.WEB_DEMO_PORT || "28080", 10);
const gatewayTarget =
  process.env.GATEWAY_TARGET_URL || "http://127.0.0.1:28081";

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

const apiProxy = createProxyMiddleware({
  target: gatewayTarget,
  changeOrigin: false,
  ws: true, // WebSocket upgrade forwarding
  // Frontend LangGraph SDK calls use /api/langgraph/*; the gateway natively
  // exposes /api/* (same mapping as KWorks next.config rewrites).
  pathRewrite: { "^/api/langgraph": "/api" },
  on: {
    error: (err, req, res) => {
      console.error(`[proxy] ${req.method} ${req.url} ->`, err.message);
      if (res && "writeHead" in res && !res.headersSent) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "gateway_unreachable",
            message: err.message,
          }),
        );
      }
    },
  },
});

function shouldProxy(pathname) {
  return pathname === "/health" || pathname.startsWith("/api/");
}

await app.prepare();

const server = createServer((req, res) => {
  const parsedUrl = parse(req.url || "", true);
  if (shouldProxy(parsedUrl.pathname || "")) {
    apiProxy(req, res, () => handle(req, res, parsedUrl));
    return;
  }
  handle(req, res, parsedUrl);
});

server.on("upgrade", (req, socket, head) => {
  const pathname = parse(req.url || "").pathname || "";
  if (shouldProxy(pathname)) {
    apiProxy.upgrade(req, socket, head);
    return;
  }
  // Non-proxied upgrades (Next dev HMR) must be delegated back to Next,
  // otherwise the dev hot-reload websocket drops.
  app.getUpgradeHandler()(req, socket, head);
});

server.listen(port, hostname, () => {
  console.log(
    `[web-demo] http://${hostname}:${port} -> gateway ${gatewayTarget} (dev=${dev})`,
  );
});
```

- [ ] **Step 3: 更新 `web-demo/package.json` scripts**

把 scripts 块改为：
```json
  "scripts": {
    "dev": "node server.js",
    "dev:next": "next dev --webpack",
    "build": "next build",
    "start": "NODE_ENV=production node server.js",
    "check": "eslint . --ext .ts,.tsx && pnpm run typecheck",
    "format": "prettier --check .",
    "format:write": "prettier --write .",
    "lint": "eslint . --ext .ts,.tsx",
    "lint:fix": "eslint . --ext .ts,.tsx --fix",
    "preview": "next build && pnpm start",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "typecheck": "node scripts/typecheck.mjs",
    "smoke": "node scripts/smoke-proxy.mjs"
  },
```
（差异说明：`dev`/`start` 走 server.js；保留 `dev:next` 作 fallback；新增 `smoke`；移除 KWorks 专属的 `demo:save`、`build:desktop`。）

- [ ] **Step 4: 静态语法验证（不启动服务）**

```bash
cd /Users/libing/kk_Projects/OpenKylin/web-demo && node --check server.js && echo "syntax OK"
```
期望：`syntax OK`。

- [ ] **Step 5: 提交**

```bash
cd /Users/libing/kk_Projects/OpenKylin && git add web-demo/server.js web-demo/package.json web-demo/pnpm-lock.yaml && git commit -m "feat(web-demo): same-origin proxy server (SSE unbuffered + WS upgrade)"
```

---

## Task 4: next.config 与 env 适配

**Files:**
- Modify: `web-demo/next.config.js`
- Create: `web-demo/.env.example`

- [ ] **Step 1: i18n 默认语言改中文**

编辑 `web-demo/next.config.js`：
```javascript
        i18n: {
          locales: ["zh", "en"],
          defaultLocale: "zh",
        },
```
（原值 `locales: ["en", "zh"]`、`defaultLocale: "en"`。）

- [ ] **Step 2: gateway fallback 地址与 env 名**

编辑 `web-demo/next.config.js`：
```javascript
          const gatewayURL = getInternalServiceURL(
            "OPENKYLIN_GATEWAY_URL",
            "http://127.0.0.1:28081",
          );
```
（原值读 `"KWORKS_INTERNAL_GATEWAY_BASE_URL"`，fallback `"http://127.0.0.1:9193"`。此 rewrite 仅作 `pnpm dev:next` fallback；`pnpm dev` 时 server.js 先拦截。）

- [ ] **Step 3: 创建 `web-demo/.env.example`**

```bash
# OpenKylin gateway 地址（server.js 同源代理目标；也是 next.config rewrites 的 fallback）
GATEWAY_TARGET_URL=http://127.0.0.1:28081
OPENKYLIN_GATEWAY_URL=http://127.0.0.1:28081
# web-demo 服务端口 / 主机
WEB_DEMO_PORT=28080
WEB_DEMO_HOST=127.0.0.1
```

- [ ] **Step 4: typecheck 回归**

```bash
cd /Users/libing/kk_Projects/OpenKylin/web-demo && pnpm typecheck 2>&1 | tail -5
```
期望：0 error。

- [ ] **Step 5: 提交**

```bash
cd /Users/libing/kk_Projects/OpenKylin && git add web-demo/next.config.js web-demo/.env.example && git commit -m "feat(web-demo): defaultLocale zh + OPENKYLIN_GATEWAY_URL env (default 28081)"
```

---

## Task 5: gateway 启动脚本 + M1 冒烟（对应里程碑 M1）

**Files:**
- Modify: `scripts/start-gateway.sh`
- Modify: `scripts/start-all.sh`（重写）

- [ ] **Step 1: start-gateway.sh 端口与 CORS 更新**

编辑 `scripts/start-gateway.sh`，三处：
1. `PORT="8081"` → `PORT="28081"`
2. 文件头 Usage 注释中 `(默认端口 8081)` → `(默认端口 28081)`、示例 `8080`→`28083`、提示行 `$0 --daemon 8082` → `$0 --daemon 28083`
3. CORS 默认值：
```bash
export GATEWAY_CORS_ORIGINS="${GATEWAY_CORS_ORIGINS:-http://localhost:28080,http://127.0.0.1:28080,http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,http://127.0.0.1:3001,app://-,tauri://localhost}"
```
（28080 置顶；保留其余来源以免影响他用途。）

- [ ] **Step 2: 重写 `scripts/start-all.sh`**

```bash
#!/usr/bin/env bash
# 一键启动: OpenKylin gateway (28081) + web-demo (28080)
# 硬约束: 不影响本机已安装的 KWorks 应用 (19987/18569/~/.kworks) —— 只检测、不杀进程
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

GATEWAY_PORT="${GATEWAY_PORT:-28081}"
WEB_DEMO_PORT="${WEB_DEMO_PORT:-28080}"

# ── 端口冲突检测: 只报错退出, 绝不杀进程 ──
for P in "$GATEWAY_PORT" "$WEB_DEMO_PORT"; do
  if lsof -nP -iTCP:"$P" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "❌ 端口 $P 已被占用:"
    lsof -nP -iTCP:"$P" -sTCP:LISTEN
    echo "提示: GATEWAY_PORT=28083 WEB_DEMO_PORT=28082 $0   (env 覆盖)"
    exit 1
  fi
done

# ── 依赖检查 ──
[[ -d web-demo/node_modules ]] || { echo "❌ web-demo 未安装依赖: cd web-demo && pnpm install"; exit 1; }
[[ -f config.yaml ]] || { echo "❌ config.yaml 不存在: cp config.example.yaml config.yaml"; exit 1; }

# ── 启动 gateway (daemon, 复用 start-gateway.sh 的 token/CORS 逻辑) ──
"$SCRIPT_DIR/start-gateway.sh" --daemon "$GATEWAY_PORT"

# ── 等待 gateway 健康 ──
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${GATEWAY_PORT}/health" >/dev/null 2>&1; then break; fi
  sleep 1
  if [[ "$i" == "30" ]]; then
    echo "❌ gateway 30s 内未就绪: tail -f /tmp/qilin-gateway.log"
    exit 1
  fi
done
echo "✓ gateway healthy: http://127.0.0.1:${GATEWAY_PORT}/health"

# ── 启动 web-demo (前台; Ctrl+C 仅退出前端, gateway 保持 daemon) ──
export GATEWAY_TARGET_URL="http://127.0.0.1:${GATEWAY_PORT}"
export WEB_DEMO_PORT
echo "✓ web-demo   : http://localhost:${WEB_DEMO_PORT}"
echo "  (Ctrl+C 退出前端; 停 gateway: scripts/start-gateway.sh --stop)"
cd web-demo
exec node server.js
```

- [ ] **Step 3: 启动 gateway 并直连验证**

```bash
cd /Users/libing/kk_Projects/OpenKylin && ./scripts/start-gateway.sh --daemon
sleep 3 && curl -s http://127.0.0.1:28081/health
```
期望：`{"status":"healthy","service":"qilin-gateway"}`。失败则 `tail -30 /tmp/qilin-gateway.log` 排查。
若报 "uvicorn 不在 PATH"：`export UVICORN_BIN="$(uv run which uvicorn)"` 后重试（脚本支持该 env 覆盖）。

- [ ] **Step 4: 启动 web-demo 并验证同源代理**

后台起前端（用本会话的 run_in_background 机制）：
```bash
cd /Users/libing/kk_Projects/OpenKylin/web-demo && pnpm dev
```
等待输出 `[web-demo] http://127.0.0.1:28080 -> gateway http://127.0.0.1:28081`，然后：
```bash
curl -s http://127.0.0.1:28080/health && echo && curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:28080/zh
```
期望：第一条返回 `{"status":"healthy",...}`（代理打通）；第二条 `200`（首页可达，中文默认路由）。

- [ ] **Step 5: nextra 文档路由验证（风险项前置）**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:28080/zh/docs
```
期望：`200`。若非 200（nextra + 自定义 server 不兼容），在 `web-demo/next.config.js` 顶部 `const isDesktopBuild = ...` 下方加入：
```javascript
const disableDocs = process.env.WEB_DEMO_DISABLE_DOCS === "true";
const withNextra = isDesktopBuild || disableDocs ? (config) => config : nextra({});
```
（替换原 `const withNextra = isDesktopBuild ? ...` 定义），删除旧的该行；然后设 `WEB_DEMO_DISABLE_DOCS=true` 重启再验。

- [ ] **Step 6: 提交**

```bash
cd /Users/libing/kk_Projects/OpenKylin && git add scripts/start-gateway.sh scripts/start-all.sh web-demo/next.config.js && git commit -m "feat(web-demo): M1 — gateway/web-demo scripts + same-origin proxy smoke pass"
```

---

## Task 6: 认证 + SSE 流式闭环（对应里程碑 M2）

**Files:**
- Create: `web-demo/scripts/smoke-proxy.mjs`

- [ ] **Step 1: 创建冒烟脚本 `web-demo/scripts/smoke-proxy.mjs`**

```javascript
#!/usr/bin/env node
/**
 * OpenKylin Web Demo 代理冒烟测试
 * 验证: /health 同源可达、认证闭环、SSE 首字节 < 500ms
 * 用法: pnpm smoke   (等价于 BASE=http://127.0.0.1:28080 node scripts/smoke-proxy.mjs)
 * env:  SMOKE_EMAIL / SMOKE_PASSWORD 覆盖默认测试账号
 */
import process from "node:process";

const BASE = process.env.BASE || "http://127.0.0.1:28080";
const EMAIL = process.env.SMOKE_EMAIL || "admin@qilin.local";
const PASSWORD = process.env.SMOKE_PASSWORD || "OpenKylin#Demo2026";

function cookiesFrom(res) {
  const out = {};
  for (const line of res.headers.getSetCookie?.() ?? []) {
    const [pair] = line.split(";");
    const idx = pair.indexOf("=");
    out[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
  return out;
}

async function main() {
  const jar = {};

  // 1. /health 经同源代理
  const health = await fetch(`${BASE}/health`);
  const healthBody = await health.json();
  if (!health.ok || healthBody.status !== "healthy") {
    throw new Error(`/health failed: ${health.status} ${JSON.stringify(healthBody)}`);
  }
  console.log("✓ /health via proxy:", JSON.stringify(healthBody));

  // 2. 认证: 首次 initialize, 之后 login
  const setupRes = await fetch(`${BASE}/api/v1/auth/setup-status`);
  const setupBody = await setupRes.json();
  let authRes;
  if (setupBody.needs_setup) {
    console.log("→ 首次启动: POST /api/v1/auth/initialize");
    authRes = await fetch(`${BASE}/api/v1/auth/initialize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD, remember_me: true }),
    });
  } else {
    console.log("→ 已初始化: POST /api/v1/auth/login/local");
    authRes = await fetch(`${BASE}/api/v1/auth/login/local`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: EMAIL, password: PASSWORD, remember_me: "true" }),
    });
  }
  if (!authRes.ok) throw new Error(`auth failed: ${authRes.status} ${await authRes.text()}`);
  Object.assign(jar, cookiesFrom(authRes));
  if (!jar.access_token) throw new Error("未获得 access_token cookie");
  const cookieHeader = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
  console.log("✓ auth OK, cookies:", Object.keys(jar).join(","));

  // 3. 创建 thread (CSRF 双提交)
  const threadRes = await fetch(`${BASE}/api/threads`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader,
      "X-CSRF-Token": jar.csrf_token || "",
    },
    body: JSON.stringify({ metadata: { title: "web-demo smoke" } }),
  });
  if (!threadRes.ok) {
    throw new Error(`create thread failed: ${threadRes.status} ${await threadRes.text()}`);
  }
  const thread = await threadRes.json();
  console.log("✓ thread:", thread.thread_id);

  // 4. 流式 run: SSE 首字节 < 500ms
  const t0 = Date.now();
  const streamRes = await fetch(
    `${BASE}/api/threads/${thread.thread_id}/runs/stream`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader,
        "X-CSRF-Token": jar.csrf_token || "",
      },
      body: JSON.stringify({
        input: { messages: [{ role: "user", content: "ping" }] },
      }),
    },
  );
  if (!streamRes.ok) {
    throw new Error(`runs/stream failed: ${streamRes.status} ${await streamRes.text()}`);
  }
  const reader = streamRes.body.getReader();
  const { value } = await reader.read();
  const firstByteMs = Date.now() - t0;
  const head = new TextDecoder().decode(value).slice(0, 80).replace(/\n/g, "\\n");
  console.log(`✓ SSE 首字节: ${firstByteMs}ms — head: ${head}`);
  await reader.cancel();
  if (firstByteMs >= 500) {
    throw new Error(`SSE 首字节过慢: ${firstByteMs}ms (代理疑似缓冲)`);
  }

  console.log("\n✅ PASS — 同源代理 + 认证 + SSE 流式全部正常");
}

main().catch((err) => {
  console.error("\n❌ FAIL —", err.message);
  process.exit(1);
});
```

- [ ] **Step 2: 运行冒烟（前置：Task 5 的 gateway 与 web-demo 均在跑）**

```bash
cd /Users/libing/kk_Projects/OpenKylin/web-demo && pnpm smoke
```
期望：末行 `✅ PASS`。常见失败：
- `initialize` 400 密码不够强 → 换更复杂的 `SMOKE_PASSWORD`
- `create thread` 403 CSRF → 检查 cookie 解析是否拿到 `csrf_token`
- 502 → gateway 未起或端口不对

- [ ] **Step 3: 浏览器手工验证聊天闭环**

用浏览器打开 `http://localhost:28080`：
1. 首次进入应跳到初始化页 → 用 `admin@qilin.local / OpenKylin#Demo2026` 完成设置
2. 新建会话发送消息 → 回复**逐字流式**出现（不是一次性整段）
3. 思考/工具调用卡片按执行顺序交错展示
发现的接口漂移问题：在 `web-demo` 内做适配（不改 OpenKylin 后端），每个修复单独说明。

- [ ] **Step 4: 交付物预览验证**

在同一会话中让引擎产出交付物（如"生成一个简单的 HTML 页面"或"写一个 xlsx"），验证 artifact 面板预览与全屏预览/下载按钮可用。

- [ ] **Step 5: 提交**

```bash
cd /Users/libing/kk_Projects/OpenKylin && git add web-demo/scripts/smoke-proxy.mjs web-demo && git commit -m "feat(web-demo): M2 — auth + SSE streaming closed loop (smoke PASS)"
```

---

## Task 7: 全量页面验证与修复（对应里程碑 M3）

**Files:** 视发现的问题而定（均在 `web-demo/` 内）

- [ ] **Step 1: 按清单逐页验证**

在浏览器依次访问并验证（每页记录 通过/问题）：

| 页面 | 路由（中文默认） | 验证点 |
|---|---|---|
| 工作台首页 | `/zh/workspace` | 欢迎页渲染、快捷入口 |
| 会话历史侧边栏 | 同上 | 最近3/周/月/更早分组、时间戳 |
| Agents | `/zh/workspace/agents` | 列表、详情 |
| 自动化（crons） | `/zh/workspace/crons` | 列表、新建 |
| MCP | `/zh/workspace/mcp` | 服务器列表 |
| Token 用量 | `/zh/workspace/token-usage` | 图表渲染 |
| 设置·全部菜单 | 设置入口 | 常规/模型/记忆/MCP/工具沙箱/数据持久化/附件上传/Web工具/Token预算 逐一打开并保存一次 |
| 落地页 | `/zh` | hero + 4 sections 渲染 |
| 文档站 | `/zh/docs`、`/en/docs` | 目录与内容页 |
| 英文路由 | `/en/workspace` | i18n 切换 |

- [ ] **Step 2: 修复发现的问题**

每个问题一个修复 + 回归；接口漂移一律在 `web-demo` 内适配。原则：不改 `src/core` 的请求协议，除非该文件本身就是 desktop 分支逻辑。

- [ ] **Step 3: vitest 回归**

```bash
cd /Users/libing/kk_Projects/OpenKylin/web-demo && pnpm test 2>&1 | tail -10 && pnpm typecheck 2>&1 | tail -5
```
期望：不劣于 Task 2 基线。

- [ ] **Step 4: 提交**

```bash
cd /Users/libing/kk_Projects/OpenKylin && git add web-demo && git commit -m "feat(web-demo): M3 — full page verification & fixes"
```

---

## Task 8: 品牌化 KWorks → OpenKylin（对应里程碑 M4 前半）

**Files:**
- Modify: `web-demo/src/**`、`web-demo/content/**`（文案）
- Modify: `web-demo/public/favicon.svg`（替换）
- Modify: `web-demo/src/styles/globals.css`（主色）
- Modify: `web-demo/package.json`（description）

- [ ] **Step 1: 展示文案批量替换**

```bash
cd /Users/libing/kk_Projects/OpenKylin/web-demo
grep -rl "KWorks" src content --include="*.ts" --include="*.tsx" --include="*.mdx" --include="*.json" | xargs sed -i '' 's/KWorks/OpenKylin/g'
grep -rn "KWorks" src content --include="*.ts" --include="*.tsx" --include="*.mdx" | wc -l
```
期望：末行 `0`。注意：`kworksDesktop`（小写标识符）**不被匹配**，保持原样（web 模式下是死代码，保留以便上游同步）。

- [ ] **Step 2: package.json 描述**

编辑 `web-demo/package.json` 的 `description`（若无则加在 name 下方）：
```json
  "description": "OpenKylin Web Demo — KWorks-aligned web workspace for the OpenKylin agent engine",
```

- [ ] **Step 3: 替换 favicon**

用以下内容整体替换 `web-demo/public/favicon.svg`：
```xml
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#34d399"/>
      <stop offset="100%" stop-color="#059669"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bgGrad)"/>
  <text x="256" y="330" font-family="-apple-system, 'PingFang SC', sans-serif" font-size="260" font-weight="700" text-anchor="middle" fill="#ffffff">麒</text>
</svg>
```

- [ ] **Step 4: 主题主色改 OpenKylin 绿**

先定位：
```bash
grep -n -- "--primary:" web-demo/src/styles/globals.css
```
将亮色块的 `--primary: oklch(0 0 0);` 改为 `--primary: oklch(0.696 0.142 168.5);`，
暗色块的 `--primary:` 改为 `--primary: oklch(0.75 0.13 168.5);`；
同样把两处 `--ring:` 改为与对应 `--primary` 相同的值。改完 `pnpm typecheck` 不受影响，用浏览器对比按钮/焦点环颜色确认生效。

- [ ] **Step 5: 落地页文案重写**

逐文件编辑 `web-demo/src/components/landing/`：
- `hero.tsx`：主标题 `麒麟 OpenKylin`，副标题 `生产级多智能体引擎 · 本地优先的 AI 工作台`，主 CTA `开始使用`，次 CTA `查看文档`
- `sections/sandbox-section.tsx`：主题改为 `多后端沙箱隔离`（Local / BoxLite / E2B / Tenki）
- `sections/skills-section.tsx`：主题改为 `技能生态与市场`（静态+动态扫描、安全审查）
- `sections/community-section.tsx`：主题改为 `8 大渠道接入`（飞书/钉钉/企微/微信/Slack/Discord/Telegram/GitHub）
- `sections/whats-new-section.tsx`：主题改为 `v2.0 多智能体编排`（并行批次、协作模式、子代理递归）
具体行文在实现时按原文件结构仿写，保持布局类名不变。

- [ ] **Step 6: 回归验证**

```bash
cd /Users/libing/kk_Projects/OpenKylin/web-demo && pnpm typecheck 2>&1 | tail -5
```
浏览器刷新落地页 + 工作台，截图确认品牌一致、无 "KWorks" 残留：
```bash
grep -rn "KWorks" web-demo/src web-demo/content web-demo/public | wc -l
```
期望：`0`。

- [ ] **Step 7: 提交**

```bash
cd /Users/libing/kk_Projects/OpenKylin && git add web-demo && git commit -m "feat(web-demo): M4 — rebrand KWorks -> OpenKylin (copy/logo/primary color)"
```

---

## Task 9: README + 验收清单 + 收尾（对应里程碑 M4 后半）

**Files:**
- Create/Replace: `web-demo/README.md`
- Create: `docs/web-demo-acceptance-checklist.md`

- [ ] **Step 1: 写 `web-demo/README.md`**

```markdown
# OpenKylin Web Demo

与 KWorks web 端全面对齐的麒麟引擎 Web 工作台（直接移植 + 纯 web 模式）。

## 快速开始

```bash
# 1. 安装依赖（首次）
cd web-demo && pnpm install

# 2. 一键启动 gateway(28081) + web-demo(28080)
cd .. && ./scripts/start-all.sh

# 3. 打开 http://localhost:28080 完成首次初始化
```

## 端口与隔离

| 进程 | 默认端口 | env 覆盖 |
|---|---|---|
| web-demo | 28080 | WEB_DEMO_PORT |
| OpenKylin gateway | 28081 | GATEWAY_PORT / GATEWAY_TARGET_URL |

数据目录：仓库内 `.qilin/`（OPENKYLIN_HOME 默认），与 KWorks 应用 `~/.kworks/` 完全隔离。

## 架构

浏览器 → `server.js`（Next 自定义服务，同源代理 /api/*、/health，SSE 不缓冲，
支持 WebSocket）→ OpenKylin gateway。前端为 KWorks frontend 纯 web 模式
（`isDesktop()` 为 false 时的原生分支），API 层零改动。

## 常用命令

- `pnpm dev` — 启动（经同源代理）
- `pnpm dev:next` — 纯 next dev（rewrites fallback，SSE 可能被缓冲）
- `pnpm smoke` — 代理/认证/流式冒烟测试
- `pnpm typecheck` / `pnpm test` / `pnpm lint`

## 故障排查

- 502 `gateway_unreachable`：gateway 未启动 → `./scripts/start-gateway.sh --daemon`
- 流式变成整段输出：确认用的是 `pnpm dev`（server.js）而不是 `pnpm dev:next`
- 文档站异常：设 `WEB_DEMO_DISABLE_DOCS=true` 关闭 nextra
```

- [ ] **Step 2: 写 `docs/web-demo-acceptance-checklist.md`**

内容为 Task 6/7 实际验证过的清单（逐项 ✅/备注），包括：
1. `/health` 同源代理 200
2. `pnpm smoke` PASS（含 SSE 首字节实测值）
3. 初始化/登录/登出
4. 聊天流式逐字 + 工具卡片 + 澄清卡
5. 交付物预览（至少 HTML + 一种 Office 格式）
6. 设置全菜单打开+保存
7. agents/crons/mcp/token-usage 可达
8. 落地页/文档站/中英文切换
9. 与 KWorks 应用并行运行互不影响（同时启动验证一次）

- [ ] **Step 3: 端到端终验**

重启全栈（`./scripts/start-gateway.sh --stop; ./scripts/start-all.sh`），重跑 `pnpm smoke`，确认清单全绿。若本机 KWorks 应用当时在运行，记录其端口仍为 19987/18569 且功能正常（并行不冲突证据）。

- [ ] **Step 4: 提交**

```bash
cd /Users/libing/kk_Projects/OpenKylin && git add web-demo/README.md docs/web-demo-acceptance-checklist.md && git commit -m "docs(web-demo): M4 — README + acceptance checklist"
```

---

## 自审记录（计划作者）

- **规格覆盖**：设计文档 §2 架构 → Task 3/5；§3.1 全量清单 → Task 1/7；§3.2 品牌 → Task 8；§3.3 裁剪 → Task 1（保留代码）+ Task 5 Step 5（nextra fallback）；§4.1 脚本 → Task 5/9；§4.2 验证 → Task 2/6/7；§4.3 里程碑 → M1=Task 5、M2=Task 6、M3=Task 7、M4=Task 8/9；§4.4 风险 → Task 5 Step 5（nextra）、Task 6 Step 2（SSE）、Task 7 Step 2（接口漂移）。无遗漏。
- **占位符扫描**：所有代码步骤均含完整代码或精确命令；落地页文案给出基线文案与改法（仿写原结构），无 TBD。
- **一致性**：端口 28080/28081、路径 `/health`（非 /api/health）、`X-CSRF-Token`、`/api/langgraph→/api` 重写在全部任务中一致。
