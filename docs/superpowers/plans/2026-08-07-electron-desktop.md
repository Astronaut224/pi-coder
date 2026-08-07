# pi-web Electron 桌面应用 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 pi-web(Next.js 服务器应用)打包成 Electron 桌面应用(Windows 优先 + macOS),内置 Node 运行时与服务,提供原生集成,支持安装包/便携版/自动更新/签名。

**Architecture:** Electron 主进程在 `app.whenReady()` 后,以 `ELECTRON_RUN_AS_NODE=1` 用其内置 Node 运行时 fork Next 的 standalone `server.js` 子进程(绑动态端口、回环地址),轮询就绪后让 `BrowserWindow` 加载 `http://127.0.0.1:<port>`。业务逻辑零修改,仅在 renderer 经 `preload`/`contextBridge` 注入少量原生能力。

**Tech Stack:** Electron 43(bundled Node 24.18)、electron-builder、electron-updater、electron-store、Next.js 16 standalone、TypeScript、`node:test`(纯逻辑单测)。

## Global Constraints

- **Electron 版本**:`electron@^43.3.0`(bundled Node 24.18.0 ≥ pi-web 要求的 22.19)。
- **Node 运行时**:pi-web `engines.node >= 22.19`;开发/打包机 Node ≥ 22.19。
- **Next**:保持 `next@16.2.12`;`next.config.ts` 新增 `output: 'standalone'`;`serverExternalPackages`(undici / 4 个 `@earendil-works/pi-*`)**保持不变**。
- **子进程**:fork standalone `server.js` 时必须设 `ELECTRON_RUN_AS_NODE=1`、`HOSTNAME=127.0.0.1`、动态 `PORT`;绝不用 `file://` 加载窗口。
- **安全**:`BrowserWindow` 必须 `webPreferences = { contextIsolation: true, sandbox: true, nodeIntegration: false, preload }`;所有原生能力只经 `contextBridge` 暴露白名单 API。
- **验证策略**:
  - 纯逻辑 → `node:test`(`.test.mjs`,项目已有先例 `lib/message-display.test.mjs`),命令 `node --test <file>`。
  - 全局类型/编译 → `npx tsc --noEmit -p tsconfig.json` 与 `npx tsc --noEmit -p electron/tsconfig.json`。
  - Lint → `npx eslint .`;基线允许 2 个 pre-existing 错误(`provider-credential-store.ts`),门槛 = **无新增**。
  - Electron API 集成 → 手动验证(起 `electron .` 观察行为)。
- **与 npm 包并存**:`@agegr/pi-web` 的 `package.json` `files` 字段**不**含 `electron/`、`dist-electron/`、`resources/`;`release` 脚本不变。
- **提交**:conventional commits(如 `feat(electron): ...`),不加 Claude 署名,跟仓库现有风格。
- **平台**:Windows(NSIS + portable)优先,macOS(dmg + zip)。本机为 Win11,mac 构建在 CI 或 mac 机器完成。

---

## File Structure

```
electron/
├── tsconfig.json              # 主进程/preload TS 编译配置,outDir ../dist-electron
├── main/
│   ├── index.ts               # 入口:单实例锁、组装 server+window、before-quit、菜单、主题
│   ├── server-utils.ts        # 纯逻辑:getFreePort/waitForReady/RestartTracker/buildServerEnv(可单测,不 import electron)
│   ├── server-utils.test.mjs  # node:test 单测
│   ├── server-manager.ts      # 集成:fork/就绪/生命周期/限次重启(import child_process,手动验证)
│   ├── window.ts              # BrowserWindow 创建、bounds 记忆(electron-store)、加载 url
│   ├── tray.ts                # Tray 图标 + 菜单 + 关闭到托盘
│   ├── updater.ts             # electron-updater 集成
│   └── ipc.ts                 # dialog 目录选择等 IPC handler
├── preload/
│   └── index.ts               # contextBridge 白名单 API
└── icons/                     # build.ico(Windows)、icon.icns(mac)、tray.png + tray-icon-template@2x.png(mac)
scripts/
└── build-electron.ts          # 装配 standalone(static+public)→ 调 electron-builder
electron-builder.yml
dist-electron/                 # tsc 产物(gitignore)
```

**职责边界**:`server-utils.ts` 是无 electron 依赖的纯逻辑(可单测);`server-manager.ts` 消费它做进程编排;`window.ts`/`tray.ts`/`updater.ts`/`ipc.ts` 各管一域;`index.ts` 只组装。每个文件单一职责。

---

## Task 1: 可行性 spike —— standalone 构建验证

**Files:**
- Modify: `next.config.ts`

**Interfaces:**
- Produces: 决策点 —— standalone 对 pi-web 是否可用(决定后续走方案 A 还是回退方案 B)。

这是整个项目的门槛任务。不通过则停下与用户确认回退方案 B(完整 `next start` 子进程)。

- [ ] **Step 1: 给 next.config 加 standalone 输出**

修改 `next.config.ts`,在 `nextConfig` 对象里加 `output: 'standalone'`(放在 `serverExternalPackages` 之后):

```ts
const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: [
    "undici",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-tui",
  ],
  // ...其余保持不变
```

- [ ] **Step 2: 构建**

Run: `npm run build`
Expected: 构建成功;末尾出现类似 `✓ Compiled successfully` 与 standalone 提示;`.next/standalone/` 目录生成,内含 `server.js` 与 `node_modules/`。

- [ ] **Step 3: 装配 static 与 public**

standalone 默认不含 `.next/static` 与 `public/`,需手动复制(本步手动,正式脚本在 Task 12):

Run:
```bash
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public
```
Expected: `.next/standalone/.next/static/` 与 `.next/standalone/public/` 存在。

- [ ] **Step 4: 手动启动 standalone server 并验证**

Run:
```bash
PORT=31415 HOSTNAME=127.0.0.1 node .next/standalone/server.js
```
(Windows Git Bash 用 `PORT=31415 HOSTNAME=127.0.0.1 node .next/standalone/server.js`;若用 cmd 改为 `set PORT=31415 && set HOSTNAME=127.0.0.1 && node .next/standalone\server.js`。)

另开终端验证:
```bash
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:31415/
```
Expected: 返回 `200`(首页可访问)。

- [ ] **Step 5: 确认关键依赖被打进 standalone**

Run:
```bash
ls .next/standalone/node_modules/@earendil-works/
ls .next/standalone/node_modules/ | grep -E "^(undici|proper-lockfile)$"
```
Expected: `@earendil-works/` 下含 `pi-coding-agent`、`pi-agent-core`、`pi-ai`、`pi-tui`;且 `undici`、`proper-lockfile` 都存在。

- [ ] **Step 6: 端到端冒烟(可选但强烈建议)**

浏览器打开 `http://127.0.0.1:31415/`,创建一个 agent 会话,发一条简单消息(如 "list files in cwd"),确认能跑通并返回。若 agent 正常工作 → spike 通过。

- [ ] **Step 7: 决策 + 提交**

- 若 Step 4/5/6 通过 → 本计划继续(方案 A)。提交:
  ```bash
  git add next.config.ts
  git commit -m "build: enable Next standalone output for desktop packaging"
  ```
- 若不通过(server 起不来 / 关键依赖缺失 / agent 报错)→ **停止,向用户报告**,确认是否回退方案 B(完整 `next start` 子进程);方案 B 需修订本计划后再继续。

---

## Task 2: 项目骨架 —— 依赖、脚本、tsconfig

**Files:**
- Modify: `package.json`(scripts + devDependencies + main + 不改 files)
- Create: `electron/tsconfig.json`
- Create: `.gitignore` 追加项(若无则创建)
- Create: `electron/main/.gitkeep`、`electron/preload/.gitkeep`(占位,后续任务填充;这两个文件在本任务后由真实文件取代,可省略)

**Interfaces:**
- Produces: `npm run build:electron-main`(编译 electron TS)、`npm run dev:electron`(开发跑 electron)、`npm run build:desktop`(打包)、electron 的 `tsconfig`。后续任务依赖这些脚本与 `electron/tsconfig.json`。

- [ ] **Step 1: 安装依赖**

Run:
```bash
npm install -D electron@^43.3.0 electron-builder@^26 electron-updater@^6 electron-store@^10 concurrently@^9 wait-on@^8
```
Expected: 依赖写入 `devDependencies`;无致命冲突。`electron` 会下载二进制(可能需几分钟)。

说明:`electron-updater` 与 `electron-store` 虽在 devDeps,但因主进程代码 `require` 它们且会被打进 asar(electron-builder 默认把 dependencies + devDependencies 中被引用的打进 app),需确认它们在最终包内(Task 12 验证)。为稳妥,把它们放 `dependencies` 更可靠。改为:

Run:
```bash
npm install electron-updater@^6 electron-store@^10
npm install -D electron@^43.3.0 electron-builder@^26 concurrently@^9 wait-on@^8
```
(`electron`/`electron-builder`/`concurrently`/`wait-on` 是 dev/构建工具 → devDeps;`electron-updater`/`electron-store` 是运行时依赖 → dependencies。)

- [ ] **Step 2: 新增 npm scripts**

在 `package.json` 的 `scripts` 中追加(不要改现有脚本):

```json
    "dev:electron": "concurrently -k -n next,electron -c cyan,magenta \"next dev -H 127.0.0.1 -p 30141\" \"wait-on http://127.0.0.1:30141 && electron .\"",
    "build:electron-main": "tsc -p electron/tsconfig.json",
    "build:desktop": "npm run build && npm run build:electron-main && npm run assemble:server && electron-builder",
    "assemble:server": "node --experimental-strip-types scripts/build-electron.ts",
    "lint:electron": "eslint electron --ext .ts,.tsx"
```

并给 `package.json` 顶层加 `"main": "dist-electron/main/index.js"`(Electron 入口)。

- [ ] **Step 3: 创建 electron tsconfig**

Create `electron/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "lib": ["ES2022"],
    "rootDir": ".",
    "outDir": "../dist-electron",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "sourceMap": true,
    "types": ["node"]
  },
  "include": ["./**/*.ts", "./**/*.tsx"],
  "exclude": ["./**/*.test.mjs"]
}
```

- [ ] **Step 4: 更新 .gitignore**

在仓库根 `.gitignore` 追加(若已忽略 `dist*` 则跳过对应行):

```
dist-electron/
resources/server/
```

- [ ] **Step 5: 验证 electron 安装与编译配置**

Run: `npx electron --version`
Expected: 打印版本号(如 `v43.3.0`)。

Run: `npm run build:electron-main`
Expected: 因 `electron/` 下还没有 `.ts` 文件,tsc 报 `No inputs were found` 或成功 0 文件 —— 这是预期的。本步仅确认脚本可执行、无配置语法错误。

Run: `npx tsc --noEmit -p electron/tsconfig.json`
Expected: 同上(0 文件,无错误)。

- [ ] **Step 6: 确认 npm 发布产物未被污染**

Run: `npm pack --dry-run 2>&1 | grep -E "electron/|dist-electron/|resources/" | head`
Expected: **无输出**(electron/ 等不在 `files` 白名单,不会进 npm 包)。若出现 electron 文件,检查 `package.json` `files` 字段未误改。

- [ ] **Step 7: 提交**

```bash
git add package.json package-lock.json electron/tsconfig.json .gitignore
git commit -m "chore(electron): scaffold desktop deps, scripts, tsconfig"
```

---

## Task 3: server-utils.ts 纯逻辑 + 单测(TDD)

**Files:**
- Create: `electron/main/server-utils.ts`
- Test: `electron/main/server-utils.test.mjs`

**Interfaces:**
- Consumes: Node 内置 `net`、`http`(无 electron 依赖)。
- Produces(供 Task 4 `server-manager.ts` 消费):
  - `getFreePort(): Promise<number>` —— 返回一个 127.0.0.1 上当前空闲的端口。
  - `waitForReady(port: number, opts?: { host?: string; timeoutMs?: number; intervalMs?: number }): Promise<void>` —— 轮询 `http://host:port/` 直到 2xx/3xx/4xx,超时 reject。
  - `class RestartTracker` —— `constructor(maxRestarts: number, windowMs: number)`;`canRestart(): boolean`;`record(): void`。
  - `buildServerEnv(port: number, extra?: Record<string,string>): Record<string,string>` —— 组合子进程 env。

- [ ] **Step 1: 写失败测试 —— buildServerEnv**

Create `electron/main/server-utils.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import net from "node:net";
import http from "node:http";

async function loadSubject() {
  return import("./server-utils.ts");
}

test("buildServerEnv sets PORT, HOSTNAME, ELECTRON_RUN_AS_NODE", async () => {
  const { buildServerEnv } = await loadSubject();
  const env = buildServerEnv(31415);
  assert.equal(env.PORT, "31415");
  assert.equal(env.HOSTNAME, "127.0.0.1");
  assert.equal(env.ELECTRON_RUN_AS_NODE, "1");
});

test("buildServerEnv preserves process.env and lets extra override", async () => {
  const { buildServerEnv } = await loadSubject();
  process.env.FOO_MARKER = "kept";
  const env = buildServerEnv(1, { FOO_MARKER: "overridden", CUSTOM: "x" });
  assert.equal(env.FOO_MARKER, "overridden");
  assert.equal(env.CUSTOM, "x");
  delete process.env.FOO_MARKER;
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test electron/main/server-utils.test.mjs`
Expected: FAIL(`Cannot find module './server-utils.ts'`)。

- [ ] **Step 3: 实现 buildServerEnv**

Create `electron/main/server-utils.ts`:

```ts
import net from "node:net";
import http from "node:http";

/** 组合 Next standalone 子进程所需的环境变量。 */
export function buildServerEnv(
  port: number,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    ...extra,
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test electron/main/server-utils.test.mjs`
Expected: PASS(2 tests)。

- [ ] **Step 5: 写并实现 getFreePort(同一轮 TDD)**

追加到测试文件:

```js
test("getFreePort returns a free, bindable port", async () => {
  const { getFreePort } = await loadSubject();
  const port = await getFreePort();
  assert.equal(typeof port, "number");
  assert.ok(port > 0);
  // 拿到的端口应能被监听
  await new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(port, "127.0.0.1", () => srv.close(() => resolve()));
  });
});
```

Run: `node --test electron/main/server-utils.test.mjs` → FAIL(getFreePort 未导出)。

追加实现到 `server-utils.ts`:

```ts
/** 在 127.0.0.1 上获取一个当前空闲的端口。 */
export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const { port } = addr;
        srv.close(() => resolve(port));
      } else {
        reject(new Error("failed to obtain a free port"));
      }
    });
  });
}
```

Run: `node --test electron/main/server-utils.test.mjs` → PASS(3 tests)。

- [ ] **Step 6: 写并实现 waitForReady**

追加测试:

```js
test("waitForReady resolves when server responds <500", async () => {
  const { getFreePort, waitForReady } = await loadSubject();
  const port = await getFreePort();
  const srv = http.createServer((_req, res) => res.statusCode = 200 && res.end("ok"));
  await new Promise((r) => srv.listen(port, "127.0.0.1", r));
  await waitForReady(port, { timeoutMs: 3000, intervalMs: 100 });
  srv.close();
});

test("waitForReady rejects on timeout when nothing listens", async () => {
  const { getFreePort, waitForReady } = await loadSubject();
  const port = await getFreePort(); // 空闲端口,无人监听
  await assert.rejects(
    waitForReady(port, { timeoutMs: 400, intervalMs: 100 }),
    /not ready|timeout|ECONNREFUSED/i,
  );
});
```

追加实现:

```ts
export interface WaitForReadyOptions {
  host?: string;
  timeoutMs?: number;
  intervalMs?: number;
}

/** 轮询 http://host:port/ 直到返回 <500,或超时。 */
export function waitForReady(
  port: number,
  opts: WaitForReadyOptions = {},
): Promise<void> {
  const host = opts.host ?? "127.0.0.1";
  const timeoutMs = opts.timeoutMs ?? 30000;
  const intervalMs = opts.intervalMs ?? 300;
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const probe = () => {
      const req = http.get(
        { host, port, path: "/", timeout: 2000 },
        (res) => {
          res.resume();
          if (res.statusCode && res.statusCode < 500) {
            cleanup();
            resolve();
          } else {
            scheduleNext();
          }
        },
      );
      req.on("error", scheduleNext);
      req.on("timeout", () => {
        req.destroy();
        scheduleNext();
      });
    };

    const interval = setInterval(probe, intervalMs);
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`server on ${host}:${port} not ready within ${timeoutMs}ms`));
    }, timeoutMs);

    function scheduleNext() { /* setInterval 会继续;只防提前 resolve */ }
    function cleanup() {
      clearInterval(interval);
      clearTimeout(timer);
    }

    probe(); // 立即先探一次
  });
}
```

Run: `node --test electron/main/server-utils.test.mjs` → PASS(5 tests)。

- [ ] **Step 7: 写并实现 RestartTracker**

追加测试:

```js
test("RestartTracker allows restarts up to max within window", async () => {
  const { RestartTracker } = await loadSubject();
  const t = new RestartTracker(3, 60000);
  assert.equal(t.canRestart(), true);
  t.record();
  t.record();
  t.record();
  assert.equal(t.canRestart(), false); // 已达 3 次
});

test("RestartTracker resets after the window elapses", async () => {
  const { RestartTracker } = await loadSubject();
  const t = new RestartTracker(1, 50); // 50ms 窗口
  t.record();
  assert.equal(t.canRestart(), false);
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(t.canRestart(), true);
});
```

追加实现:

```ts
/** 在时间窗口内限制子进程重启次数。 */
export class RestartTracker {
  private timestamps: number[] = [];
  constructor(
    private readonly maxRestarts: number = 3,
    private readonly windowMs: number = 300000,
  ) {}

  /** 记录一次重启(清理窗口外的旧记录)。 */
  record(): void {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);
    this.timestamps.push(now);
  }

  /** 是否仍可重启(窗口内次数 < max)。 */
  canRestart(): boolean {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);
    return this.timestamps.length < this.maxRestarts;
  }
}
```

Run: `node --test electron/main/server-utils.test.mjs` → PASS(7 tests)。

- [ ] **Step 8: 类型检查 + lint**

Run: `npx tsc --noEmit -p electron/tsconfig.json`
Expected: PASS(无错误)。

Run: `npx eslint electron/main/server-utils.ts`
Expected: 无错误。

- [ ] **Step 9: 提交**

```bash
git add electron/main/server-utils.ts electron/main/server-utils.test.mjs
git commit -m "feat(electron): add pure server lifecycle utils with tests"
```

---

## Task 4: server-manager.ts —— 子进程编排(集成)

**Files:**
- Create: `electron/main/server-manager.ts`

**Interfaces:**
- Consumes: `getFreePort` / `waitForReady` / `RestartTracker` / `buildServerEnv`(Task 3),`node:child_process` 的 `fork`,`electron` 的 `app`(用于资源路径)。
- Produces:`class ServerManager`:
  - `constructor(opts: { mode: "standalone" | "dev"; devUrl?: string; serverPath?: string; onUnrecoverable?: () => void; onLog?: (line: string) => void })`
  - `start(): Promise<{ port: number; url: string }>` —— standalone 模式 fork+就绪;dev 模式直接就绪探测 devUrl。
  - `getUrl(): string | null`
  - `async stop(): Promise<void>`

- [ ] **Step 1: 实现 server-manager**

Create `electron/main/server-manager.ts`:

```ts
import { fork, type ChildProcess } from "node:child_process";
import path from "node:path";
import { app } from "electron";
import {
  buildServerEnv,
  getFreePort,
  RestartTracker,
  waitForReady,
} from "./server-utils";

export interface ServerManagerOptions {
  /** "standalone":fork 打包的 server.js;"dev":连已运行的 next dev url。 */
  mode: "standalone" | "dev";
  /** dev 模式的目标 url,如 http://127.0.0.1:30141。 */
  devUrl?: string;
  /** standalone server.js 绝对路径;不传则按 app.isPackaged 推导。 */
  serverPath?: string;
  /** 超出重启上限时回调(用于通知用户)。 */
  onUnrecoverable?: () => void;
  /** 收到 server stdout/stderr 日志。 */
  onLog?: (line: string) => void;
}

export class ServerManager {
  private child: ChildProcess | null = null;
  private port: number | null = null;
  private url: string | null = null;
  private restarts = new RestartTracker(3, 300000);
  private stopping = false;

  constructor(private readonly opts: ServerManagerOptions) {}

  private resolveServerPath(): string {
    if (this.opts.serverPath) return this.opts.serverPath;
    return app.isPackaged
      ? path.join(process.resourcesPath, "server", "server.js")
      : path.join(app.getAppPath(), ".next", "standalone", "server.js");
  }

  async start(): Promise<{ port: number; url: string }> {
    if (this.opts.mode === "dev") {
      const url = this.opts.devUrl ?? "http://127.0.0.1:30141";
      await waitForReadyUrl(url);
      this.url = url;
      return { port: new URL(url).port ? Number(new URL(url).port) : 80, url };
    }

    const port = await getFreePort();
    const serverPath = this.resolveServerPath();
    this.child = fork(serverPath, [], {
      env: buildServerEnv(port),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const log = (chunk: Buffer) => {
      const line = chunk.toString();
      this.opts.onLog?.(line);
      if (process.env.PI_WEB_DESKTOP_DEBUG) process.stdout.write(line);
    };
    this.child.stdout?.on("data", log);
    this.child.stderr?.on("data", log);
    this.child.on("exit", (code) => {
      this.opts.onLog?.(`[server] exited code=${code}\n`);
      this.child = null;
      if (this.stopping) return;
      if (this.restarts.canRestart()) {
        this.restarts.record();
        this.opts.onLog?.(`[server] restarting (attempt within limit)\n`);
        void this.restart();
      } else {
        this.opts.onUnrecoverable?.();
      }
    });

    await waitForReady(port, { timeoutMs: 30000 });
    this.port = port;
    this.url = `http://127.0.0.1:${port}`;
    return { port, url: this.url };
  }

  private async restart(): Promise<void> {
    try {
      await this.start();
    } catch {
      this.opts.onUnrecoverable?.();
    }
  }

  getUrl(): string | null {
    return this.url;
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.child) {
      await new Promise<void>((resolve) => {
        const c = this.child!;
        c.once("exit", () => resolve());
        c.kill("SIGTERM");
        // 兜底:3s 后强杀
        setTimeout(() => {
          if (!c.killed) c.kill("SIGKILL");
          resolve();
        }, 3000).unref();
      });
      this.child = null;
    }
  }
}

function waitForReadyUrl(url: string): Promise<void> {
  const { port, hostname } = new URL(url);
  return waitForReady(Number(port) || 80, { host: hostname });
}
```

- [ ] **Step 2: 类型检查 + lint**

Run: `npx tsc --noEmit -p electron/tsconfig.json`
Expected: PASS。

Run: `npx eslint electron/main/server-manager.ts`
Expected: 无新增错误。

- [ ] **Step 3: 手动冒烟(需要 Task 5/6 的入口才能完整跑;本任务只确认编译)**

本任务的运行时验证合入 Task 7 的端到端冒烟。此处仅需 tsc + eslint 通过。

- [ ] **Step 4: 提交**

```bash
git add electron/main/server-manager.ts
git commit -m "feat(electron): add Next server subprocess manager"
```

---

## Task 5: preload + contextBridge 白名单 API

**Files:**
- Create: `electron/preload/index.ts`
- Create: `electron/main/ipc.ts`(目录选择 IPC handler,本任务先放骨架,Task 10 填充 dialog)

**Interfaces:**
- Consumes: `electron` 的 `contextBridge`、`ipcRenderer`。
- Produces:renderer 侧全局 `window.piDesktop`,类型:
  - `isDesktop: true`
  - `version: string`(app 版本)
  - `selectDirectory(): Promise<string | null>` —— 调原生目录选择框,返回选中路径或 null(取消)
  - `onUpdateStatus(cb: (status: UpdateStatus) => void): void`(Task 13 用)
  - `quitApp(): void`

- [ ] **Step 1: 实现 preload**

Create `electron/preload/index.ts`:

```ts
import { contextBridge, ipcRenderer } from "electron";

const api = {
  isDesktop: true as const,
  version: process.env.PI_WEB_DESKTOP_VERSION ?? "0.0.0",
  /** 打开原生目录选择框;返回选中路径或 null。 */
  selectDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke("desktop:selectDirectory"),
  /** 订阅自动更新状态(Task 13 接线)。 */
  onUpdateStatus: (cb: (status: unknown) => void) => {
    const handler = (_e: unknown, status: unknown) => cb(status);
    ipcRenderer.on("desktop:updateStatus", handler);
    return () => ipcRenderer.removeListener("desktop:updateStatus", handler);
  },
  /** 退出整个应用(含 server 子进程)。 */
  quitApp: () => ipcRenderer.send("desktop:quit"),
};

contextBridge.exposeInMainWorld("piDesktop", api);

export type PiDesktopApi = typeof api;
```

- [ ] **Step 2: IPC handler 骨架**

Create `electron/main/ipc.ts`:

```ts
import { ipcMain, dialog, BrowserWindow, app } from "electron";

/** 注册所有桌面端 IPC handler。 */
export function registerIpc(): void {
  ipcMain.handle("desktop:selectDirectory", async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.on("desktop:quit", () => app.quit());
}
```

- [ ] **Step 3: 全局类型声明(让 TS 识别 window.piDesktop)**

Create `electron/preload/global.d.ts`:

```ts
import type { PiDesktopApi } from "./index";

declare global {
  interface Window {
    piDesktop?: PiDesktopApi;
  }
}
```

- [ ] **Step 4: 类型检查 + lint**

Run: `npx tsc --noEmit -p electron/tsconfig.json`
Expected: PASS。

Run: `npx eslint electron/preload electron/main/ipc.ts`
Expected: 无新增错误。

- [ ] **Step 5: 提交**

```bash
git add electron/preload electron/main/ipc.ts
git commit -m "feat(electron): add preload contextBridge API and IPC handlers"
```

---

## Task 6: window.ts —— 窗口创建 + bounds 记忆

**Files:**
- Create: `electron/main/window.ts`

**Interfaces:**
- Consumes: `electron` 的 `BrowserWindow`、`shell`;`electron-store`。
- Produces:
  - `createMainWindow(url: string): BrowserWindow`
  - `getMainWindow(): BrowserWindow | null`
  - `loadMainWindowUrl(url: string): Promise<void>`(dev/prod 都用它加载 url)

- [ ] **Step 1: 实现 window.ts**

Create `electron/main/window.ts`:

```ts
import path from "node:path";
import { BrowserWindow, shell } from "electron";
import Store from "electron-store";

interface WindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
}

const store = new Store<{ windowBounds?: WindowBounds }>({
  name: "pi-web-desktop",
  defaults: { windowBounds: { width: 1280, height: 800 } },
});

let mainWindow: BrowserWindow | null = null;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function createMainWindow(): BrowserWindow {
  const bounds = store.get("windowBounds")!;
  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 720,
    minHeight: 500,
    show: false,
    autoHideMenuBar: process.platform === "win32",
    title: "pi-web",
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  // 外链走系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      void shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "deny" };
  });

  win.on("resize", () => persistBounds(win));
  win.on("move", () => persistBounds(win));

  win.once("ready-to-show", () => win.show());

  mainWindow = win;
  return win;
}

export async function loadMainWindowUrl(url: string): Promise<void> {
  const win = getMainWindow();
  if (!win) return;
  await win.loadURL(url);
}

function persistBounds(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  const [width, height] = win.getContentSize();
  const [x, y] = win.getPosition();
  store.set("windowBounds", { x, y, width, height });
}
```

- [ ] **Step 2: 类型检查 + lint**

Run: `npx tsc --noEmit -p electron/tsconfig.json`
Expected: PASS。

Run: `npx eslint electron/main/window.ts`
Expected: 无新增错误。

- [ ] **Step 3: 提交**

```bash
git add electron/main/window.ts
git commit -m "feat(electron): add main window with persisted bounds"
```

---

## Task 7: index.ts 入口 —— 组装 + 端到端跑通里程碑

**Files:**
- Create: `electron/main/index.ts`

**Interfaces:**
- Consumes: `ServerManager`(Task 4)、`registerIpc`(Task 5)、`createMainWindow`/`loadMainWindowUrl`(Task 6)、`electron` 的 `app`。
- Produces:可运行的 Electron 应用(端到端:启动 → fork/连接 server → 窗口加载 pi-web → agent 可用)。

- [ ] **Step 1: 实现 index.ts(最小可用版,本任务不含托盘/快捷键/更新)**

Create `electron/main/index.ts`:

```ts
import { app, Menu } from "electron";
import { ServerManager } from "./server-manager";
import { registerIpc } from "./ipc";
import { createMainWindow, loadMainWindowUrl } from "./window";

const isDev = process.env.PI_WEB_DESKTOP_MODE === "dev";

let server: ServerManager | null = null;

app.whenReady().then(async () => {
  registerIpc();

  // 基础菜单(mac 需要应用菜单才能正常)
  if (process.platform === "darwin") {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { role: "appMenu" },
        { role: "editMenu" },
        { role: "viewMenu" },
        { role: "windowMenu" },
      ]),
    );
  }

  server = new ServerManager({
    mode: isDev ? "dev" : "standalone",
    devUrl: "http://127.0.0.1:30141",
    onLog: (line) => process.stdout.write(line),
    onUnrecoverable: () => {
      console.error("[desktop] server unrecoverable");
    },
  });

  try {
    const { url } = await server.start();
    const win = createMainWindow();
    await loadMainWindowUrl(url);
    // 临时:窗口关闭即退出(托盘逻辑在 Task 8 替换)
    win.on("close", (e) => {
      e.preventDefault();
      app.quit();
    });
  } catch (err) {
    console.error("[desktop] failed to start server:", err);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async (e) => {
  if (server) {
    e.preventDefault();
    await server.stop();
    server = null;
    app.quit();
  }
});
```

- [ ] **Step 2: 编译**

Run: `npm run build:electron-main`
Expected: 产出 `dist-electron/main/index.js` 等,无错误。

- [ ] **Step 3: 确认 standalone 产物存在(prod 冒烟需要)**

若 `.next/standalone/server.js` 不存在(上一次 spike 后改过/清理过),重新构建:
Run: `npm run build`
然后装配(Task 1 Step 3 的复制,或先临时手动):
```bash
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public
```

- [ ] **Step 4: prod 冒烟 —— 跑未打包 electron 加载 standalone**

Run: `npx electron .`
Expected:
- 控制台打印 server 日志(Next 启动)。
- 窗口弹出并加载 pi-web 首页。
- 能创建 agent 会话并跑通一次任务。

若窗口白屏/超时:设 `PI_WEB_DESKTOP_DEBUG=1` 看 server 日志;确认 standalone 路径正确。

- [ ] **Step 5: dev 冒烟 —— 跑 dev 模式连 next dev**

Run: `PI_WEB_DESKTOP_MODE=dev npm run dev:electron`
(Windows Git Bash 同上;cmd 用 `set PI_WEB_DESKTOP_MODE=dev && npm run dev:electron`)
Expected:concurrently 起 next dev,wait-on 等到 30141 就绪后 electron 窗口加载,UI 改动可热更新。

- [ ] **Step 6: 全量类型/lint 回归**

Run: `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p electron/tsconfig.json && npx eslint .`
Expected:除 2 个 pre-existing 基线错误外无新增。

- [ ] **Step 7: 提交**

```bash
git add electron/main/index.ts
git commit -m "feat(electron): wire up entry point, end-to-end runnable"
```

---

## Task 8: 系统托盘 + 关闭即最小化到托盘

**Files:**
- Create: `electron/main/tray.ts`
- Create: `electron/icons/tray.png`(Windows,16×16 或 32×32 透明 PNG)
- Create: `electron/icons/tray-icon-template@2x.png`(mac template 图标)
- Modify: `electron/main/index.ts`(接入托盘,替换 Task 7 的临时 close 行为)

**Interfaces:**
- Consumes: `electron` 的 `Tray`、`Menu`、`app`、`nativeImage`;`ServerManager`、`getMainWindow`。
- Produces:`createTray(server: ServerManager): Tray` —— 托盘图标 + 右键菜单(显示/隐藏/退出)+ 双击切换;把窗口 close 改为隐藏。

- [ ] **Step 1: 准备托盘图标**

放两个图标文件到 `electron/icons/`:
- `tray.png`:Windows 用,32×32 透明背景 PNG(可从 pi-web 现有 public 图标派生/缩放)。
- `tray-icon-template@2x.png`:mac 用,template 图标(纯黑+透明,34×34@2x)。

(若暂无设计稿,可先用任意 32×32 透明 PNG 占位,Task 12 会用正式图标覆盖。)

- [ ] **Step 2: 实现 tray.ts**

Create `electron/main/tray.ts`:

```ts
import path from "node:path";
import { app, Tray, Menu, nativeImage, type BrowserWindow } from "electron";
import type { ServerManager } from "./server-manager";
import { getMainWindow } from "./window";

let tray: Tray | null = null;

export function createTray(server: ServerManager): Tray {
  const iconPath =
    process.platform === "darwin"
      ? path.join(__dirname, "..", "icons", "tray-icon-template@2x.png")
      : path.join(__dirname, "..", "icons", "tray.png");
  const image = nativeImage.createFromPath(iconPath);
  if (process.platform === "darwin") image.setTemplateImage(true);

  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  tray.setToolTip("pi-web");

  const rebuildMenu = () => {
    tray!.setContextMenu(
      Menu.buildFromTemplate([
        { label: "显示主窗口", click: () => showMainWindow() },
        { label: "隐藏主窗口", click: () => getMainWindow()?.hide() },
        { type: "separator" },
        {
          label: "退出",
          click: async () => {
            await server.stop();
            app.quit();
          },
        },
      ]),
    );
  };
  rebuildMenu();

  // 双击切换窗口可见性
  tray.on("click", () => {
    const win = getMainWindow();
    if (!win) return;
    win.isVisible() ? win.hide() : showMainWindow();
  });

  return tray;
}

/** 把"关闭窗口"改为隐藏到托盘,并接管窗口的显示。 */
export function attachHideOnClose(win: BrowserWindow): void {
  win.on("close", (e) => {
    e.preventDefault();
    win.hide();
  });
}

function showMainWindow(): void {
  const win = getMainWindow();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
```

- [ ] **Step 3: 在 index.ts 接入托盘,替换临时 close 行为**

修改 `electron/main/index.ts`:
- 顶部 import:`import { createTray, attachHideOnClose } from "./tray";`
- 在 `loadMainWindowUrl(url)` 之后,删除 Task 7 的临时 `win.on("close", ...)` 块,改为:
  ```ts
  createTray(server);
  attachHideOnClose(win);
  ```
- `window-all-closed` 处理:mac 不退出(托盘常驻),其他平台也不退出(因为 close 被阻止,window-all-closed 不会触发);保持现有逻辑,但 Darwin 下显式不退出已正确。

- [ ] **Step 4: 编译 + 手动验证**

Run: `npm run build:electron-main && npx electron .`
Expected:
- 系统区出现托盘图标。
- 关闭窗口 → 窗口隐藏、托盘仍在、server 进程仍在(任务管理器可见 node 子进程)。
- 右键托盘 → "显示主窗口"恢复;"退出"终结 server 并退出应用。
- 双击托盘切换窗口。

- [ ] **Step 5: 类型/lint + 提交**

Run: `npx tsc --noEmit -p electron/tsconfig.json && npx eslint electron/main/tray.ts electron/main/index.ts`
Expected: PASS(无新增)。

```bash
git add electron/main/tray.ts electron/main/index.ts electron/icons
git commit -m "feat(electron): add system tray and close-to-tray behavior"
```

---

## Task 9: 全局快捷键 + 开机自启

**Files:**
- Create: `electron/main/shortcuts.ts`
- Modify: `electron/main/index.ts`(接入快捷键 + 自启默认关)

**Interfaces:**
- Consumes: `electron` 的 `globalShortcut`、`app`、`Menu`;`electron-store`。
- Produces:
  - `registerGlobalShortcut(): void` —— 注册 `Cmd/Ctrl+Shift+P` 切换窗口。
  - `unregisterGlobalShortcut(): void`
  - `setOpenAtLogin(enabled: boolean): void`
  - `isOpenAtLogin(): boolean`

- [ ] **Step 1: 实现 shortcuts.ts**

Create `electron/main/shortcuts.ts`:

```ts
import { app, globalShortcut } from "electron";
import Store from "electron-store";
import { getMainWindow } from "./window";

const store = new Store<{ openAtLogin?: boolean }>({
  name: "pi-web-desktop",
  defaults: { openAtLogin: false },
});

const ACCEL = process.platform === "darwin" ? "Cmd+Shift+P" : "Ctrl+Shift+P";

export function registerGlobalShortcut(): void {
  globalShortcut.register(ACCEL, () => {
    const win = getMainWindow();
    if (!win) return;
    if (win.isVisible() && win.isFocused()) {
      win.hide();
    } else {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
}

export function unregisterGlobalShortcut(): void {
  globalShortcut.unregister(ACCEL);
}

export function setOpenAtLogin(enabled: boolean): void {
  store.set("openAtLogin", enabled);
  app.setLoginItemSettings({ openAtLogin: enabled });
}

export function isOpenAtLogin(): boolean {
  return Boolean(store.get("openAtLogin"));
}

/** 初始化开机自启状态(默认关,跟随上次设置)。 */
export function initLoginItem(): void {
  app.setLoginItemSettings({ openAtLogin: Boolean(store.get("openAtLogin")) });
}
```

- [ ] **Step 2: 在 index.ts 接入**

修改 `electron/main/index.ts`:
- import:`import { registerGlobalShortcut, unregisterGlobalShortcut, initLoginItem, setOpenAtLogin, isOpenAtLogin } from "./shortcuts";`
- 在 `app.whenReady()` 回调里(server.start 之前或之后均可)加:
  ```ts
  initLoginItem();
  registerGlobalShortcut();
  ```
- 新增退出时取消注册:
  ```ts
  app.on("will-quit", () => {
    unregisterGlobalShortcut();
  });
  ```
- 在菜单里加入"开机自启"开关项。把 Task 7 的 mac 菜单构建替换为跨平台菜单(放进一个 `buildAppMenu()`);Windows/Linux 也设菜单以承载开关。示例:
  ```ts
  function buildAppMenu(): Menu {
    const isMac = process.platform === "darwin";
    const template: Electron.MenuItemConstructorOptions[] = [
      ...(isMac ? [{ role: "appMenu" }] : []),
      { role: "editMenu" },
      { role: "viewMenu" },
      {
        label: "窗口",
        submenu: [
          { role: "minimize" },
          {
            label: "开机自动启动",
            type: "checkbox",
            checked: isOpenAtLogin(),
            click: (item) => setOpenAtLogin(item.checked),
          },
          { type: "separator" },
          {
            label: "退出",
            click: async () => {
              if (server) await server.stop();
              app.quit();
            },
          },
        ],
      },
      { role: "help" },
    ];
    return Menu.buildFromTemplate(template);
  }
  ```
  并在 `app.whenReady` 里 `Menu.setApplicationMenu(buildAppMenu())`(替换原 mac-only 菜单块)。

- [ ] **Step 3: 编译 + 手动验证**

Run: `npm run build:electron-main && npx electron .`
Expected:
- `Ctrl+Shift+P`(Win)/`Cmd+Shift+P`(Mac)切换窗口显示/隐藏(即使应用未聚焦)。
- 菜单"窗口 → 开机自动启动"勾选/取消,系统开机启动项随之变化(Win 可在任务管理器"启动"页确认;Mac 在系统设置登录项)。
- 退出应用后快捷键不再占用。

- [ ] **Step 4: 类型/lint + 提交**

Run: `npx tsc --noEmit -p electron/tsconfig.json && npx eslint electron/main`
Expected: PASS。

```bash
git add electron/main/shortcuts.ts electron/main/index.ts
git commit -m "feat(electron): add global shortcut and login-item toggle"
```

---

## Task 10: 桌面通知(renderer)+ 原生目录选择(前端接入)

**Files:**
- Modify: `hooks/useAudio.ts`(完成时发桌面通知)
- Modify: 渲染 `<DirectoryPicker>` 的父组件(先 grep 定位)
- Modify: `electron/main/ipc.ts`(已注册 selectDirectory,本任务确认前端接入)

**Interfaces:**
- Consumes:`window.piDesktop`(Task 5)。
- Produces:任务完成时系统通知;选工作目录走原生对话框。

- [ ] **Step 1: 在 useAudio.playDone 注入桌面通知**

修改 `hooks/useAudio.ts` 的 `playDone`(约第 63 行),在播放提示音的同时发桌面通知。把 `playDone` 改为:

```ts
  const playDone = useCallback(() => {
    // 桌面端:任务完成时发系统通知(窗口隐藏到托盘时也能感知)
    const desktop = typeof window !== "undefined" ? window.piDesktop : undefined;
    if (desktop) {
      try {
        new Notification("pi-web", { body: "任务已完成" });
      } catch {
        /* Notification 不可用时忽略 */
      }
    }
    if (!enabledRef.current) return;
    const ctx = getCtx();
    if (!ctx) return;
    const play = () => {
      try {
        playTone(ctx);
      } catch {
        // AudioContext not available
      }
    };
    if (ctx.state === "suspended") {
      ctx.resume().then(play).catch(() => {});
      return;
    }
    play();
  }, [getCtx]);
```

(通知在 Electron renderer 中是 Chromium Notification,会转为系统原生通知;不依赖 `enabledRef`,因为通知是独立于提示音的"完成"信号。若希望通知也跟随声音开关,可在 `if (!enabledRef.current) return;` 之前不通知 —— 但本设计让通知独立于声音,更符合"完成任务感知"。)

- [ ] **Step 2: 定位 DirectoryPicker 的渲染处**

Run: `grep -rn "<DirectoryPicker" --include=*.tsx components hooks app`
Expected: 找到渲染 `<DirectoryPicker ... />` 的文件与行(很可能在 `components/AppShell.tsx`)。记录文件路径与上下文:它如何控制显隐、`onSelect` 后调哪个函数(应是设置 cwd)。

- [ ] **Step 3: 在父组件加"桌面端走原生选择框"分支**

在 Step 2 定位的父组件中,找到触发"打开 DirectoryPicker"的入口(通常是一个 `setShowPicker(true)` 之类的状态/回调)。在其触发函数最前面加分支:若 `window.piDesktop` 存在,则直接调用原生选择框并设置 cwd,跳过网页 picker。

示例模式(实际函数名/变量名以 Step 2 定位为准,这里给出 AppShell 场景的典型改法):

```tsx
  const openDirectoryPicker = async () => {
    // 桌面端:用原生目录选择框
    if (typeof window !== "undefined" && window.piDesktop) {
      const dir = await window.piDesktop.selectDirectory();
      if (dir) {
        void applyCwd(dir); // 复用现有 onSelect 路径(原 <DirectoryPicker onSelect> 调用的同一函数)
      }
      return;
    }
    setShowDirectoryPicker(true); // 网页端:打开网页 picker
  };
```

把原本直接 `setShowDirectoryPicker(true)` 的按钮 `onClick` 改为 `() => void openDirectoryPicker()`。
(`applyCwd` 即原 `<DirectoryPicker onSelect={...}>` 里的回调;保持复用,确保选中路径走同一条 `/api/cwd/validate` 校验逻辑。)

- [ ] **Step 4: 编译 + 类型/lint**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS。

Run: `npx eslint hooks/useAudio.ts components/<定位到的父组件>.tsx`
Expected: 无新增错误。

- [ ] **Step 5: 手动验证**

Run: `npm run build:electron-main && npx electron .`
Expected:
- 跑一个 agent 任务,完成时弹出系统通知(标题 "pi-web",正文 "任务已完成");把窗口最小化到托盘后再跑任务,通知仍弹出。
- 点"选工作目录"入口 → 弹出**原生**文件夹选择框 → 选中 → cwd 生效(session 工作目录改变)。

- [ ] **Step 6: 提交**

```bash
git add hooks/useAudio.ts components/<定位到的父组件>.tsx
git commit -m "feat(desktop): native completion notifications and directory picker"
```

---

## Task 11: 跟随系统主题 + 完善原生菜单

**Files:**
- Modify: `electron/main/index.ts`(nativeTheme;菜单已在 Task 9 引入,本任务补 help 菜单内容)

**Interfaces:**
- Consumes: `electron` 的 `nativeTheme`。

- [ ] **Step 1: 接入 nativeTheme 跟随系统**

修改 `electron/main/index.ts`,在 `app.whenReady()` 回调顶部加:

```ts
  const { nativeTheme } = require("electron");
  nativeTheme.themeSource = "system";
```

(或顶部 import `nativeTheme` 后 `nativeTheme.themeSource = "system";`。这让 Chromium 的 `prefers-color-scheme` 跟随系统;pi-web 若用媒体查询即自动适配深浅色。)

- [ ] **Step 2: 完善 help 菜单**

把 Task 9 `buildAppMenu()` 的 `{ role: "help" }` 替换为带子项:

```ts
  {
    role: "help",
    submenu: [
      {
        label: "打开项目仓库",
        click: () => void import("electron").then(({ shell }) => shell.openExternal("https://github.com/agegr/pi-web")),
      },
      {
        label: "检查更新",
        click: () => void import("./updater").then(({ checkForUpdates }) => checkForUpdates()),
      },
    ],
  },
```

(Task 13 实现 `updater.ts` 的 `checkForUpdates`;在此之前该菜单项可暂时留空 click 或在 Task 13 接线。)

- [ ] **Step 3: 编译 + 手动验证**

Run: `npm run build:electron-main && npx electron .`
Expected:切换系统深/浅色模式,pi-web 界面跟随(若 pi-web 用媒体查询);help 菜单显示子项。

- [ ] **Step 4: 类型/lint + 提交**

Run: `npx tsc --noEmit -p electron/tsconfig.json && npx eslint electron/main`
Expected: PASS。

```bash
git add electron/main/index.ts
git commit -m "feat(electron): follow system theme and flesh out menus"
```

---

## Task 12: 打包构建 —— standalone 装配 + electron-builder 配置 + 图标

**Files:**
- Create: `scripts/build-electron.ts`
- Create: `electron-builder.yml`
- Create: `electron/icons/build.ico`(Windows)、`electron/icons/icon.icns`(mac)
- Modify: `electron/main/index.ts`(注入 `PI_WEB_DESKTOP_VERSION`)

**Interfaces:**
- Produces:`npm run build:desktop` 产出 Windows NSIS 安装包 + portable、macOS dmg + zip;`resources/server/` 装配好。

- [ ] **Step 1: 实现 standalone 装配脚本**

Create `scripts/build-electron.ts`:

```ts
// 装配 Next standalone 产物到 resources/server/,复制 static 与 public。
import { cp, mkdir, rm, cp as cpFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const standaloneDir = path.join(root, ".next", "standalone");
const targetDir = path.join(root, "resources", "server");

async function main() {
  if (!standaloneDir) throw new Error(".next/standalone not found — run `next build` first");

  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });

  // 1) 复制 standalone 主体(server.js + node_modules)
  await cp(standaloneDir, targetDir, { recursive: true });

  // 2) 复制 .next/static 与 public(standalone 默认不含)
  await cp(
    path.join(root, ".next", "static"),
    path.join(targetDir, ".next", "static"),
    { recursive: true },
  );
  await cp(path.join(root, "public"), path.join(targetDir, "public"), {
    recursive: true,
  });

  console.log("[build-electron] assembled server at", targetDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: 准备应用图标**

放图标到 `electron/icons/`:
- `build.ico`:Windows 应用图标(多尺寸,256×256 起)。
- `icon.icns`:mac 应用图标。
(可从 pi-web 现有 `public/icons/` 下的图标转换生成,或用电子 Logo 工具。无设计稿时用占位图标,后续替换。)

- [ ] **Step 3: 写 electron-builder.yml**

Create `electron-builder.yml`:

```yaml
appId: com.agegr.pi-web
productName: pi-web
copyright: Copyright © 2026 agegr
directories:
  output: release
  buildResources: electron/icons
files:
  - dist-electron/**/*
  - package.json
  - "!**/.DS_Store"
extraResources:
  - from: resources/server
    to: server
    filter: ["**/*"]
asarUnpack: []

win:
  target:
    - target: nsis
      arch: [x64]
    - target: portable
      arch: [x64]
  icon: electron/icons/build.ico

nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  createStartMenuShortcut: true

portable:
  artifactName: ${productName}-${version}-portable.${ext}

mac:
  target:
    - target: dmg
      arch: [x64, arm64]
    - target: zip
      arch: [x64, arm64]
  icon: electron/icons/icon.icns
  category: public.app-category.developer-tools

# 签名/公证/发布在 Task 13 接线
```

- [ ] **Step 4: 在 index.ts 注入版本号(供 preload 的 version)**

修改 `electron/main/index.ts`,在 `app.whenReady()` 回调里、`registerIpc()` 之前:

```ts
  process.env.PI_WEB_DESKTOP_VERSION = app.getVersion();
```

- [ ] **Step 5: 执行完整打包(Windows)**

Run: `npm run build:desktop`
Expected:
- `npm run build` → 产出 `.next/standalone`。
- `build:electron-main` → 产出 `dist-electron/`。
- `assemble:server` → 产出 `resources/server/`。
- `electron-builder` → 在 `release/` 产出 `pi-web Setup <ver>.exe`(NSIS)与 `pi-web-<ver>-portable.exe`。

- [ ] **Step 6: 验证安装包**

- 安装 `pi-web Setup <ver>.exe` → 开始菜单出现 pi-web → 启动 → 窗口加载、agent 跑通。
- 卸载 → 干净移除。
- 运行 portable exe → 解压/运行 → 正常工作。

- [ ] **Step 7: 类型/lint + 提交**

Run: `npx tsc --noEmit -p electron/tsconfig.json`
Expected: PASS。

```bash
git add scripts/build-electron.ts electron-builder.yml electron/icons electron/main/index.ts
git commit -m "build(electron): standalone assembly, electron-builder config, icons"
```

---

## Task 13: 代码签名 + 自动更新(electron-updater)

**Files:**
- Create: `electron/main/updater.ts`
- Modify: `electron/main/index.ts`(启动时检查更新)
- Modify: `electron-builder.yml`(publish + 签名配置)

**Interfaces:**
- Consumes:`electron-updater` 的 `autoUpdater`。
- Produces:`checkForUpdates()` 函数 + 启动时自动检查;GitHub Releases 发布配置;签名/公证环境变量驱动。

- [ ] **Step 1: 实现 updater.ts**

Create `electron/main/updater.ts`:

```ts
import { autoUpdater } from "electron-updater";
import { BrowserWindow } from "electron";

export type UpdateStatus =
  | { state: "checking" }
  | { state: "available"; version: string }
  | { state: "not-available" }
  | { state: "downloaded" }
  | { state: "error"; message: string };

function broadcast(status: UpdateStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("desktop:updateStatus", status);
  }
}

export function initUpdater(): void {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => broadcast({ state: "checking" }));
  autoUpdater.on("update-available", (info) =>
    broadcast({ state: "available", version: info.version ?? "" }),
  );
  autoUpdater.on("update-not-available", () => broadcast({ state: "not-available" }));
  autoUpdater.on("update-downloaded", () => broadcast({ state: "downloaded" }));
  autoUpdater.on("error", (err) => broadcast({ state: "error", message: String(err) }));
}

export function checkForUpdates(): void {
  // 静默失败:便携版/未签名/无更新源都不打断使用
  try {
    void autoUpdater.checkForUpdates();
  } catch {
    /* ignore */
  }
}
```

- [ ] **Step 2: 在 index.ts 接入**

修改 `electron/main/index.ts`:
- import:`import { initUpdater, checkForUpdates } from "./updater";`
- 在 `app.whenReady()` 回调(server.start 之后、窗口加载之后):
  ```ts
  initUpdater();
  // 启动 5 秒后检查更新(避开启动峰值),仅打包版生效
  if (app.isPackaged) {
    setTimeout(() => checkForUpdates(), 5000);
  }
  ```
- (Task 11 Step 2 的 help 菜单"检查更新"已引用 `checkForUpdates`,接线完成。)

- [ ] **Step 3: electron-builder.yml 加 publish 与签名**

在 `electron-builder.yml` 顶部加:

```yaml
publish:
  provider: github
  owner: agegr
  repo: pi-web
```

签名(mac 公证 + Windows Authenticode)用环境变量驱动,只在 CI 提供 secret 时生效:

```yaml
win:
  # ...既有...
  # signingHashAlgorithms 与 certificate 由 CI 环境变量 WIN_CERT_FILE / WIN_CERT_PASSWORD 提供
  # electron-builder 默认读取 CSC_LINK / CSC_KEY_PASSWORD,无需在此写死

mac:
  # ...既有...
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: electron/icons/entitlements.mac.plist
  entitlementsInherit: electron/icons/entitlements.mac.plist
  notarize:
    teamId: ${APPLE_TEAM_ID}
```

Create `electron/icons/entitlements.mac.plist`(mac 公证最小 entitlements):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
  <key>com.apple.security.cs.disable-library-validation</key><true/>
</dict>
</plist>
```

- [ ] **Step 4: 类型/lint + 编译**

Run: `npx tsc --noEmit -p electron/tsconfig.json && npm run build:electron-main`
Expected: PASS。

- [ ] **Step 5: 本地打包验证(未签名)**

Run: `npm run build:desktop`
Expected:本地无证书 → 产出**未签名**安装包(正常,用于本地测试);控制台可能出现签名相关 warning,可忽略。

- [ ] **Step 6: 自动更新流程验证(需发布测试 release)**

1. 推一个 tag(如 `v0.8.7-desktop-test`)触发 CI(或手动)发布到 GitHub Releases。
2. 安装该版本 → 启动 → 5 秒后主进程日志应出现 update 检查。
3. 发布一个更高版本到 Releases → 重启旧版 → 应检测到并下载、重启安装。
(若无 CI,可手动 `electron-builder --publish always` 配合 `GH_TOKEN` 发布测试。)

- [ ] **Step 7: 提交**

```bash
git add electron/main/updater.ts electron/main/index.ts electron-builder.yml electron/icons/entitlements.mac.plist
git commit -m "feat(electron): auto-update via GitHub Releases and signing config"
```

---

## Task 14: 手动验证清单 + 文档

**Files:**
- Create: `docs/desktop.md`(构建/分发/签名说明)

**Interfaces:**
- Produces:一份覆盖 spec §9 全部条目的手动验证记录 + 面向分发者的文档。

- [ ] **Step 1: 跑完整手动验证清单**

逐项执行(spec §9),在 `docs/desktop.md` 末尾记录结果(✓/✗ + 备注):

1. 启动 → 窗口加载 → 创建 agent 会话 → 跑通完整任务
2. SSE 实时事件正常流式
3. 托盘显示/隐藏/退出;双击切换窗口
4. 全局快捷键唤出/隐藏窗口
5. 开机自启开关(默认关)
6. 桌面通知(任务完成,含隐藏到托盘场景)
7. 原生目录选择框 → cwd 生效
8. 单实例锁(二次启动聚焦已有窗口)
9. 窗口位置/大小记忆
10. Windows NSIS 安装/卸载;便携版解压运行
11. macOS dmg 打开运行(在 mac 机器或 CI 验证)
12. 自动更新检查流程

发现的问题 → 修复并回到对应任务。

- [ ] **Step 2: 写 docs/desktop.md**

Create `docs/desktop.md`,内容含:

```markdown
# pi-web 桌面版

## 开发
- UI 热更新开发:`npm run dev:electron`(连 next dev)
- 测 standalone 路径:`npm run build` 后 `npx electron .`

## 打包
- Windows:`npm run build:desktop` → `release/pi-web Setup <ver>.exe` + portable
- macOS:在 mac 机器或 CI 跑同一命令,产出 dmg + zip

## 签名(可选)
- Windows:CI 设 `CSC_LINK` / `CSC_KEY_PASSWORD`(或 `WIN_CERT_FILE`/`WIN_CERT_PASSWORD`)
- macOS:CI 设 `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` 完成公证

## 分发
- 安装版经 GitHub Releases 发布,支持应用内自动更新
- 便携版不自动更新,需手动下载新 release

## 验证清单
(粘贴 Task 14 Step 1 的结果)
```

- [ ] **Step 3: 全量回归**

Run: `node --test electron/main/server-utils.test.mjs && npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p electron/tsconfig.json && npx eslint .`
Expected:单测全过;tsc 无新错误;eslint 仅 2 个基线 pre-existing。

- [ ] **Step 4: 提交**

```bash
git add docs/desktop.md
git commit -m "docs: desktop build/distribution guide and verification checklist"
```

---

## 备注:单实例锁

Task 7 的入口尚未显式调用单实例锁(spec 基本盘要求)。在 Task 7 实现时,在 `app.whenReady()` 之前补:

```ts
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = getMainWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
  // 把原 app.whenReady().then(...) 的启动逻辑放在这里
}
```

(实现者:把 Task 7 Step 1 的 `app.whenReady().then(...)` 整体移入 `else` 分支内。)

---

## Self-Review 记录

- **Spec 覆盖**:架构(§3)→ Task 3/4/6/7;server 子进程(§4)→ Task 3/4;原生集成(§5)→ Task 8/9/10/11;安全(§6)→ Task 5/6;打包分发(§7)→ Task 12/13;构建/目录(§8)→ Task 2/12;测试(§9)→ Task 3 单测 + Task 14 手动清单;可行性 spike(§10)→ Task 1;错误处理(§11)→ Task 3/4(RestartTracker/超时);风险回退(§12)→ Task 1 决策点。✓
- **占位符**:Task 8/10 中"以 grep 定位为准"的现有代码改动已给出确切搜索命令 + 改动模式与示例代码,非占位。图标文件标注"可暂用占位,Task 12 替换"属合理的资源依赖。✓
- **类型一致性**:`getFreePort`/`waitForReady`/`RestartTracker`/`buildServerEnv`(Task 3)与 Task 4 消费签名一致;`window.piDesktop` API(Task 5)与 Task 10 消费一致;`ServerManager` 构造与 `start()` 返回值在 Task 4/7 一致。✓
- **新增任务**:单实例锁在备注中补入 Task 7。✓
