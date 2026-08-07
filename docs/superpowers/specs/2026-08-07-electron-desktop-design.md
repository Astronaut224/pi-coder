# pi-web Electron 桌面应用 — 设计文档

- **日期**:2026-08-07
- **状态**:已批准(待 spec 审阅)
- **作者**:wrtudio 与用户协作产出
- **关联项目**:`@agegr/pi-web` v0.8.6

---

## 1. 背景与目标

pi-web 是一个 **Next.js 16 服务器应用**(React 19 + TypeScript + Tailwind v4),作为 "pi coding agent" 的 Web UI。它**自带后端**:约 40 个 Next.js API 路由在 Node 进程中**直接运行** AI 编码代理运行时(`lib/rpc-manager.ts` 嵌入 `@earendil-works/pi-coding-agent` / `pi-agent-core` / `pi-ai` / `pi-tui`),使用 `fs` / `child_process` / `undici` / `proper-lockfile` 操作本地系统。客户端只用**相对 URL**(`/api/...`)与后端通信,基本是单路由 `/` 的 React 状态驱动应用。

本设计将 pi-web 打包成跨平台(**Windows 优先 + macOS**)Electron 桌面应用,内置 Node 运行时与 pi-web 服务,提供原生桌面集成,支持安装包 / 便携版 / 自动更新 / 代码签名。

### 核心约束(决定架构)

1. pi-web **不是静态前端**,不能用 `file://` 加载 —— 否则 API 调用、SSE 流、service worker 全部失效。
2. Electron 主进程必须**拉起 Next.js Node 服务**绑定本地端口,`BrowserWindow` 加载 `http://127.0.0.1:<port>`,且服务需在窗口生命周期内常驻(支持 SSE 流式事件)。
3. agent 运行时依赖 Node 原生能力(`fs`/`child_process`/`undici`/`proper-lockfile`),必须运行在 Node 环境(Electron 主进程通过 `ELECTRON_RUN_AS_NODE` 提供的内置 Node),**不在**沙箱化的 renderer 中运行。

## 2. 需求决策(来自设计对话)

| 维度 | 决策 |
|---|---|
| **核心目的** | 自用便捷 + 分发非技术用户 + 脱离 Node 依赖 + 原生桌面体验(全部) |
| **目标平台** | Windows(优先)+ macOS |
| **Next 服务运行方式** | 方案 A:`next.config` 设 `output:'standalone'`,主进程 fork standalone `server.js` 子进程 |
| **原生集成(v1)** | 系统托盘常驻、桌面通知(路 A:renderer Web Notification)、全局快捷键、开机自启(默认关)、原生目录选择框;基本盘:单实例锁、窗口位置/大小记忆、跟随系统主题、基础原生菜单 |
| **窗口关闭行为** | 关闭即最小化到托盘常驻(不退服务) |
| **托盘退出行为** | 终结 Next server 子进程 + 退出应用 |
| **分发(v1)** | Windows NSIS 安装包 + Windows 便携版、macOS dmg + zip、应用内自动更新(GitHub Releases)、代码签名 |
| **与现有 npm 包关系** | 并存 —— `@agegr/pi-web` web 发布流程不变,桌面版走 GitHub Releases |

### 非目标(v1 明确剔除,YAGNI)

- 多窗口 session(每个 agent 会话独立窗口)
- Linux 平台
- 用桌面版替代现有 web / npm 包
- agent 运行时 spawn MCP 所依赖的系统 `npx` 的内置化(沿用现有运行时行为,文档说明)

## 3. 整体架构

```
┌───────────────────────────────────────────────────────────┐
│  Electron 主进程  (electron/main/)                          │
│   · 单实例锁 · 系统托盘 · 全局快捷键 · 开机自启 · 原生菜单  │
│   · 启动 & 监管 Next server 子进程(选空闲端口)            │
│   · dialog 目录选择 · 原生设置项                            │
│   · electron-updater 自动更新                               │
└──────────────┬──────────────────────────┬──────────────────┘
   fork (动态端口)│              │ IPC via contextBridge
   ELECTRON_RUN_AS_NODE=1         │
                 ▼              ▼
   ┌────────────────────────────┐  ┌────────────────────────────┐
   │ Next server 子进程          │  │ Renderer (BrowserWindow)    │
   │ resources/server/           │◄─┤  加载 http://127.0.0.1:<port>│
   │  .next/standalone/server.js │  │  pi-web 原有 UI 基本不动    │
   │  + pi-* 运行时               │  │  + preload 注入原生能力     │
   │  fs/child_process/undici/   │  │   (选目录/托盘/自启/版本)   │
   │  proper-lockfile            │  │  Web Notification 触发通知  │
   └────────────────────────────┘  └────────────────────────────┘
```

**关键边界**:主进程只负责"壳 + 系统集成 + 监管服务";业务逻辑(agent、会话、文件操作)仍在 Next server 子进程内,与 web 版**完全一致、零修改**;客户端 UI 基本不动,仅通过 `preload` 注入少量原生能力。

## 4. Next server 子进程管理(核心)

### 4.1 standalone 构建与装配

- `next.config.ts` 增加 `output: 'standalone'`,构建后产出 `.next/standalone/`(含 `server.js` + 精简 `node_modules`,仅运行所需依赖)。
- standalone 默认**不含** `.next/static` 与 `public/`。构建脚本(`scripts/build-electron.ts`)负责:
  - 复制 `.next/static` → `standalone/.next/static`
  - 复制 `public/` → `standalone/public/`
  - 整包落入 `resources/server/`(打包时的 extraResources 源)
- **可行性 spike(实现第一步,见 §10)** 必须先验证 standalone 正确打包 `pi-*` / `undici` / `proper-lockfile` 等 `serverExternalPackages`,并确认 API/SSE/agent 端到端可用。不通过则回退方案 B(完整 `next start` 子进程)。

### 4.2 子进程启动

- `app.whenReady()` 后,主进程挑一个**空闲端口**(动态,避开 web 版固定 30141,允许桌面版与 web 版并行)。
- 通过 `child_process.fork(serverPath, { env })` 启动 `resources/server/server.js`,其中:
  - `ELECTRON_RUN_AS_NODE=1` —— 让 Electron 可执行文件以**纯 Node 模式**运行子进程(无 GUI),使用 Electron **内置的 Node 运行时**。**用户机器无需安装 Node**(命中"脱离 Node 依赖"诉求)。
  - 透传运行时 env:`PORT`、`HOSTNAME=127.0.0.1`、`HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY`、(可选)`PI_WEB_PASSWORD`、`XDG_STATE_HOME` 等。
- **Electron 版本选择约束**:内置 Node 运行时版本必须 **≥ 22.19**(pi-web `engines.node` 硬性要求)。实现时选定具体 Electron 版本时须核对其 bundled Node 版本。

### 4.3 就绪探测

- 主进程在 fork 后**轮询** `http://127.0.0.1:<port>/`(或已知轻量端点)直到返回 200,带超时(如 30s)。
- 超时未就绪 → 报错降级:弹出错误对话框(重试 / 查看日志),并记录子进程 stdout/stderr。

### 4.4 生命周期与崩溃恢复

- `app.on('before-quit')`:终结 server 子进程。
- 窗口 `close` 事件:`preventDefault()` + `hide()` → 最小化到托盘(已确认)。
- 托盘"退出"项:终结子进程 + `app.quit()`(已确认)。
- 子进程意外退出(`exit` 事件):**限次自动重启**(默认 3 次 / 5 分钟),超出阈值 → 桌面通知告知用户并提示查看日志。
- 端口被占用:递增挑选下一个空闲端口(极少触发)。

## 5. 原生集成

| 能力 | 实现 | 细节 |
|---|---|---|
| **系统托盘** | `Tray` + 右键菜单(显示/隐藏/退出)+ 双击切换窗口可见 | 从 pi-web 现有图标派生;macOS 需单色 template 图标(`@2x`) |
| **窗口关闭→托盘** | `close` 事件 `preventDefault` + `hide()` | 已确认 |
| **全局快捷键** | `globalShortcut`;默认 `Ctrl/Cmd+Shift+P` 切换窗口 | 可在菜单"首选项"修改;`will-quit` 时取消注册 |
| **开机自启** | `app.setLoginItemSettings({ openAtLogin })` | **默认关**,菜单给开关项 |
| **桌面通知** | **路 A**:renderer 的 Web Notification API | pi-web 前端订阅 SSE 已知"任务完成",完成时 `new Notification(...)`;Electron Chromium 转系统原生通知,窗口隐藏到托盘时照样弹出。改动最小,复用 pi-web 现有事件 |
| **单实例锁** | `requestSingleInstanceLock()` | 第二实例启动 → 聚焦已有窗口 |
| **窗口位置/大小记忆** | `electron-store` 持久化 bounds | 下次启动恢复 |
| **跟随系统主题** | `nativeTheme.themeSource = 'system'` | Chromium `prefers-color-scheme` 自动跟随系统;pi-web 若读媒体查询即自动适配,不强行改其主题逻辑 |
| **基础原生菜单** | `Menu.buildFromTemplate` | macOS 必备应用菜单(App/Edit/View/Window/Help);Win/Linux 给编辑/视图/帮助 |
| **原生目录选择** | 主进程 `dialog.showOpenDialog({ properties:['openDirectory'] })` → `preload` 暴露 `window.piDesktop.selectDirectory()` → 返回路径后调 `/api/cwd/validate` 设置 cwd | pi-web 的"选工作目录"入口检测到 `window.piDesktop` 存在时走原生对话框,否则走现有网页目录浏览(`/api/cwd/browse`) |

## 6. 安全模型

- `BrowserWindow` 的 `webPreferences = { contextIsolation: true, sandbox: true, nodeIntegration: false }`。
- 所有原生能力**仅**经 `preload` + `contextBridge` 暴露**白名单 API**(`selectDirectory`、托盘/自启开关、版本/更新信息)。renderer 无 Node 访问权。
- 窗口加载 `http://127.0.0.1:<port>`(**不用** `file://`);CSP 沿用 pi-web 现有响应头。
- 本地服务只绑 `127.0.0.1`,外部网络不可达 → 桌面版**默认不设** `PI_WEB_PASSWORD`(纯回环);需要时仍可配。
- 页面内外链(`a[target=_blank]`)经 `shell.openExternal` 走系统浏览器,不在 Electron 内开新窗口。

## 7. 打包与分发(electron-builder)

| 项 | 方案 |
|---|---|
| **打包工具** | electron-builder |
| **Windows** | NSIS `.exe` 安装包 + portable 便携版(zip) |
| **macOS** | `.dmg` + `.zip`(自动更新需要 zip) |
| **asar** | 主进程代码进 asar;`resources/server/`(standalone + static + public)放 **extraResources,不进 asar**(含 undici/proper-lockfile 等需真实 fs 访问) |
| **图标** | Windows `.ico`、macOS `.icns` |
| **代码签名** | Windows Authenticode(需代码签名证书);macOS `codesign` + `notarize`(需 Apple Developer 账号 + `APPLE_ID` / 应用专用密码 / Team ID)。CI 无证书时产出**未签名版**供本地开发 |
| **自动更新** | `electron-updater`;provider = **GitHub Releases**。打 tag → CI 构建 → 上传 release → 安装版应用内检查并一键升级。**便携版不自动更新**(提示手动下载新 release) |

## 8. 构建流程与目录结构

```
pi-web/
├── electron/
│   ├── main/
│   │   ├── index.ts          入口:单实例/托盘/快捷键/自启/菜单/窗口
│   │   ├── server-manager.ts Next 子进程:fork/就绪探测/生命周期/限次重启
│   │   ├── tray.ts           托盘图标与菜单
│   │   ├── updater.ts        electron-updater 集成
│   │   └── ipc.ts            dialog 目录选择等 IPC handler
│   ├── preload/
│   │   └── index.ts          contextBridge 白名单 API
│   └── icons/                build.ico / icon.icns
├── scripts/
│   └── build-electron.ts     装配 standalone(static+public)→ 调 electron-builder
├── electron-builder.yml      打包配置
├── next.config.ts            加 output:'standalone'
└── package.json              + electron/-builder/-updater/-store(devDeps) + scripts
```

新增 npm scripts:

- `build:web` —— `next build`(产出 `.next/standalone`)
- `build:desktop` —— 装配 server 资源 + 调 electron-builder
- `dev:desktop` —— 开发模式:主进程连接 `next dev` server(端口 30141),热更新 UI

**与现有 npm 包并存**:`@agegr/pi-web` 的 `package.json` `files` 字段不含 `electron/`,web 版发布流程(`release` 脚本)不变。桌面构建工具(electron 等)放 `devDependencies`,不影响 npm 发布产物。

**构建环境注意**:打包机 Node 需 ≥ 22.19(pi-web 要求);`next/font/google` 与 `next.config.ts` 中对 `node_modules/@earendil-works/pi-coding-agent/package.json` 的 `fs.readFileSync` 在**构建期**执行 —— 构建机需有网络(下载 Google 字体)且依赖已安装。

## 9. 测试策略

项目无测试运行器,沿用既有验证手段:

- `tsc --noEmit` + `eslint .`;electron/ 目录纳入 tsc 检查。门槛 = **无新增错误**(基线已有 2 个 pre-existing 错误于 `provider-credential-store.ts`,不作为回归)。
- **手动验证清单**(实现完成后逐项执行):
  1. 启动 → 窗口加载 → 创建 agent 会话 → 跑通一次完整任务(端到端)
  2. SSE 实时事件正常流式
  3. 系统托盘显示/隐藏/退出;双击切换窗口
  4. 全局快捷键唤出/隐藏窗口
  5. 开机自启开关(默认关)
  6. 桌面通知(任务完成时弹出,含窗口隐藏场景)
  7. 原生目录选择框 → cwd 生效
  8. 单实例锁(二次启动聚焦)
  9. 窗口位置/大小记忆
  10. Windows:NSIS 安装/卸载、便携版解压运行
  11. macOS:dmg 打开运行
  12. 自动更新检查流程(发布测试 release 验证)

## 10. 可行性 spike(实现第一步,里程碑)

在铺开主进程代码前,先单独验证 standalone 路径可行:

1. `next.config.ts` 加 `output:'standalone'`
2. `next build`
3. 装配 static + public 进 standalone
4. 手动 `node .next/standalone/server.js`(设 `PORT`)
5. `curl` 确认 API、SSE、agent 任务跑通
6. 确认 `standalone/node_modules` 含 `pi-*` / `undici` / `proper-lockfile`

**通过** → 按本设计铺开。**不通过** → 回退方案 B(完整 `next start` 子进程,镜像现有 `bin/pi-web.js`,体积更大但兼容风险最低)。

## 11. 错误处理

| 场景 | 处理 |
|---|---|
| server 启动超时 | 错误对话框:重试 / 查看日志(子进程 stdout/stderr) |
| 端口占用 | 递增挑选下一个空闲端口 |
| 子进程崩溃 | 限次重启(默认 3 次/5 分钟),超出 → 桌面通知 + 提示查看日志 |
| 自动更新失败 | 静默失败,下次重试,不打断使用 |
| CI 无签名证书 | 产出未签名版(Win)/ 未公证版(mac 用户右键打开),文档说明 |
| Electron 内置 Node < 22.19 | 选定版本时核对;若不满足则评估方案 B 下用系统 Node |

## 12. 风险与回退

| 风险 | 缓解 / 回退 |
|---|---|
| standalone 不兼容 `pi-*` / undici / proper-lockfile | §10 spike 验证;不过回退方案 B |
| 打包体积偏大 | standalone 已最小化;Electron 运行时本体(~80MB+)不可避免,文档设定期望 |
| macOS 签名 / 公证复杂 | 需 Apple Developer 账号;无证书则出未签名版,文档说明右键打开 |
| agent 运行时依赖系统 `npx`(spawn MCP) | 沿用现有行为;文档说明;后续可评估内置 node |
| Electron 安全审查 | 严格 `contextIsolation` / `sandbox` / preload 白名单 |
| 动态端口与已运行 web 版冲突 | 端口选择避开 30141;动态挑选空闲端口 |

## 13. 实现里程碑(粗略顺序)

1. **可行性 spike**(§10)—— 决定 A/B 分支
2. 项目骨架:`electron/` 目录、`package.json` 依赖与脚本、`electron-builder.yml`
3. `server-manager.ts`:子进程 fork + 就绪探测 + 生命周期
4. 窗口 + preload + 加载 http url(端到端跑通 agent)
5. 原生集成逐项:托盘 → 快捷键 → 自启 → 通知 → 目录选择 → 单实例 → 窗口记忆 → 主题 → 菜单
6. 打包:electron-builder(Win NSIS + 便携版 / mac dmg)
7. 代码签名 + 自动更新(electron-updater / GitHub Releases)
8. 手动验证清单(§9)逐项通过
