# 主题联动标题栏 + 统一图标 — 设计文档

- **日期**:2026-08-08
- **状态**:已批准(待 spec 审阅)
- **作者**:Claude 与用户协作产出
- **关联项目**:`pi-coder` v0.87.1(Electron 桌面版)

---

## 1. 背景与目标

当前 Electron 桌面版存在两个问题:

1. **标题栏不联动主题**:窗口用的是 Windows 原生默认标题栏(白底/系统色),与应用主题(暖白/深色、自定义 JSON 主题)脱节,视觉割裂。
2. **图标未统一**:构建日志显示 `default Electron icon is used reason=application icon is not set` —— exe、快捷方式、安装程序、任务栏、运行时窗口全部是 Electron 默认图标。`electron/icons/` 下无 `icon.ico`。

### 目标

- **任务一**:让 Windows 标题栏颜色跟随应用主题(顶栏 `--bg-panel` 色),caption 按钮保留系统原生(最小化/最大化/关闭),其符号色与背景自动保证可读。
- **任务二**:用 `D:\workspace\pi\pi-coder\app\favicon.ico` 作为唯一图源,统一 exe 图标、Windows 快捷方式图标、安装程序图标、任务栏图标、运行时窗口图标。

### 非目标(明确剔除)

- macOS 标题栏改造(保持默认交通灯按钮;`titleBarOverlay` 本就是 Windows 特性)。
- 系统托盘图标(`electron/icons/tray.png`)保持现状 —— 托盘用单色模板图是平台惯例,彩色 favicon 缩到 16px 在通知区不清晰;用户清单中的"任务栏"指窗口任务栏图标,不含托盘。

---

## 2. 现状勘察(关键事实)

| 事实 | 位置 | 说明 |
|---|---|---|
| 顶栏已主题化 | `components/AppShell.tsx:891` | `background: var(--bg-panel)`,`height: calc(36px + env(safe-area-inset-top))`(Windows 桌面 = 36px),贴窗口顶部 y=0,`borderBottom: 1px solid var(--border)` |
| 顶栏最右侧元素 | `components/AppShell.tsx:1258` | session 信息按钮(`marginLeft:auto`),显示 token/cost/上下文,`paddingRight: rightPanelOpen ? 12 : 48` —— **会被 caption 按钮遮挡,必须预留空间** |
| 主题变量注入点 | `hooks/useTheme.ts:87-97`(`applyCssVars`) | `document.documentElement.style.setProperty` 写 `--bg-panel` 等;`clearCssVars`(99-104)、`setMode`(263-342)均经此 |
| 主题色值 | `app/globals.css:29` / `:53` | `--bg-panel`:亮 `#f8f8f6` / 暗 `#24231f` |
| 明暗判定 | `hooks/useTheme.ts`(外部 store + `localStorage` `pi-theme-mode`) | **不**用 `prefers-color-scheme`,**不**消费 `nativeTheme`;`nativeTheme.themeSource='system'`(index.ts:34)当前对渲染层无效 |
| 现有桌面桥 | `electron/preload/index.ts:19` | `window.piDesktop` 仅 main→renderer(`selectDirectory`/`onUpdateStatus`/`quitApp`);无 renderer→main 通道 |
| `getComputedStyle` 读取 | 全仓库无 | 主题变量目前单向写入;同步标题栏需新增一次读取 |
| 窗口创建 | `electron/main/window.ts:23-41` | 无 `titleBarStyle`、无 `icon`、无 `backgroundColor`,`title:'pi-web'`,`autoHideMenuBar`(win32) |
| favicon 实为 PNG | `app/favicon.ico` | `file` 报告 `PNG image data, 512 x 512, RGBA` —— 非 ICO 容器,需转换 |
| 图标工具链 | `node_modules/sharp` 已装(Next.js 传递依赖) | 无 ImageMagick;用 sharp 生成多分辨率 ICO,零新依赖 |

---

## 3. 方案选型

### 任务一:标题栏

| 方案 | 说明 | 取舍 |
|---|---|---|
| **A. `titleBarOverlay`(采用)** | `titleBarStyle:'hidden'` + `titleBarOverlay`,保留原生 caption 按钮,叠加在已有主题顶栏上,运行时同步 `--bg-panel` | 保留原生无障碍/贴靠/Aero,改动最小,顶栏已存在故极干净 ✅ |
| B. `frame:false` + 自绘 HTML caption 按钮 | 全无边框,自绘按钮/拖拽 | 控制力最强但工作量大,丢失原生行为 ❌ |
| C. 仅设 `backgroundColor` | 只改窗口底色 | 达不到"标题栏联动主题" ❌ |

**采用 A**(与用户建议的 `titleBarOverlay` 一致),仅 `process.platform === 'win32'` 生效;macOS 不设 `titleBarStyle`(默认)。

### 任务二:图标

采用**自生成多分辨率 ICO**(sharp 脚本)而非依赖 electron-builder 的 PNG→ICO 自动转换:已提交的 `.ico` 产物使构建确定性、离线、不依赖转换行为 quirks。

---

## 4. 详细设计

### 4.1 任务一:主题联动标题栏

#### 4.1.1 主进程窗口(`electron/main/window.ts`)

`createMainWindow()` 的 `new BrowserWindow({...})` 增加(**仅 win32**):

- `titleBarStyle: 'hidden'`
- `titleBarOverlay: { color, symbolColor, height: 36 }`
  - `color` 初始值:`nativeTheme.shouldUseDarkColors ? '#24231f' : '#f8f8f6'`
  - `symbolColor` 初始值:对应反差色(深底 `#ffffff` / 浅底 `#000000`)
  - `height: 36`(对齐顶栏高度)
- `backgroundColor`:同 `color` 初始值(避免加载白屏闪烁)
- `icon`:`path.join(__dirname, '..', '..', 'electron', 'icons', 'icon.ico')`(见 4.2.3)
- `title`:`'pi-web'` → `'Pi Coder'`(任务栏/Alt+Tab 提示)

macOS 分支不设 `titleBarStyle`/`titleBarOverlay`(保留默认)。判定:`process.platform === 'win32'` 时合并这些选项。

> 注:`titleBarStyle:'hidden'` 去掉标题栏与 caption;`titleBarOverlay` 把 caption 按钮以叠层重新画回(由 Electron 原生绘制)。

#### 4.1.2 IPC:运行时同步主题色

- **`electron/preload/index.ts`** 新增:`setTitleBarColor: (hex: string) => ipcRenderer.send('desktop:set-title-bar-overlay', { color: hex })`,并入 `piDesktop` API 与 `PiDesktopApi` 类型;同步更新 `electron/preload/global.d.ts` 的 `Window.piDesktop` 类型。
- **`electron/main/ipc.ts`** 新增 handler:
  ```
  ipcMain.on('desktop:set-title-bar-overlay', (e, { color }) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? getMainWindow();
    win?.setTitleBarOverlay({ color, symbolColor: contrastSymbolColor(color) });
  });
  ```
  - `contrastSymbolColor(hex)`:按相对亮度判定 → 浅底返回 `'#000000'`,深底返回 `'#ffffff'`。
  - 需从 `window.ts` 导入 `getMainWindow`(已 export)。
- 通道为 `send`(单向 fire-and-forget),无需返回。

#### 4.1.3 渲染层推送主题色(`hooks/useTheme.ts`)

新增内部函数 `syncTitleBarOverlay()`:
1. `const color = getComputedStyle(document.documentElement).getPropertyValue('--bg-panel').trim();`
2. 若 `window.piDesktop?.isDesktop === true` 则调用 `window.piDesktop.setTitleBarColor(color)`(桥存在性守卫;Web 模式无 `piDesktop`,自动跳过)。

调用时机(覆盖全部变化路径):
- `applyCssVars(vars)` 末尾、`clearCssVars()` 末尾;
- `bootstrap()` 初次应用后(初始同步,修正可能的主进程初始猜测色)。
- `setMode` 走 `applyCssVars`/`clearCssVars`,自动覆盖。

> Web 模式无 `window.piDesktop`,调用被守卫跳过,零副作用。

#### 4.1.4 顶栏拖拽区 + caption 留白(`components/AppShell.tsx` + `app/globals.css`)

- `AppShell.tsx` 顶栏 `<div ref={topBarRef}>`(891 行)新增 class `titlebar-drag`(仅桌面模式加;通过既有 `window.piDesktop` 判定)。
- `globals.css` 新增:
  ```css
  .titlebar-drag { -webkit-app-region: drag; }
  .titlebar-drag button,
  .titlebar-drag a,
  .titlebar-drag [role="button"],
  .titlebar-drag input,
  .titlebar-drag select { -webkit-app-region: no-drag; }
  ```
  → 顶栏可拖动移窗,其内所有交互控件仍可点(无需逐个改)。
- caption 留白:桌面模式下顶栏 `paddingRight` 预留 caption 宽度(常量 `~140px`,Windows 3 按钮),保护右侧 session 信息按钮(1258)。实现上在顶栏 style 条件合并 `paddingRight: isDesktop ? '140px' : undefined`(或与既有右侧按钮 paddingRight 叠加)。
- 验证项(实现时确认):右面板(right panel)打开时其顶部是否也到 y=0 且贴右边缘 —— 若是,同样需 caption 预留。

#### 4.1.5 数据流

```
用户切主题/明暗
  → useTheme.applyCssVars 写 --bg-panel
  → syncTitleBarOverlay(): getComputedStyle 读 --bg-panel 实值
  → window.piDesktop.setTitleBarColor(hex)  (renderer→main, send)
  → ipc: contrastSymbolColor(hex) 算反差
  → win.setTitleBarOverlay({ color, symbolColor })  (原生叠层重绘)
```

### 4.2 任务二:统一图标

#### 4.2.1 图标生成脚本(`scripts/generate-icons.mjs`,新增)

- 输入:`app/favicon.ico`(512×512 PNG)。
- 用 `sharp` 缩放到 `[16,24,32,48,64,128,256]`(各 PNG buffer)。
- 纯 JS ICO 编码(ICONDIR + ICONDIRENTRY×N + PNG 数据;ICO 规范允许 ≥64 的项用 PNG 编码),输出 `electron/icons/icon.ico`。
- 脚本幂等可重跑;产物提交进仓库(确定性构建)。

#### 4.2.2 `electron-builder.yml`

- `extraResources` 之外,`files` 列表新增 `electron/icons/icon.ico`(供打包后运行时窗口图标走 asar 读取)。
- `buildResources` 已是 `electron/icons` → 放在那里的 `icon.ico` 被 electron-builder **自动嵌入 exe**(覆盖 exe/快捷方式/安装程序/任务栏)。无需额外 `win.icon`。

#### 4.2.3 运行时窗口图标(`electron/main/window.ts`)

`BrowserWindow({ icon })` 指向 `path.join(__dirname, '..', '..', 'electron', 'icons', 'icon.ico')`:
- dev:`<root>/dist-electron/main` → `<root>/electron/icons/icon.ico` ✓
- 打包:文件经 `files` 进 asar → `<appRoot>/electron/icons/icon.ico`,Electron 透明读 asar 图片 ✓
- 打包另含 exe 嵌入图标(任务栏/窗口双保险)。

#### 4.2.4 构建脚本接入(`package.json`)

- 新增 `"generate:icons": "node scripts/generate-icons.mjs"`。
- `build:desktop` / `build:desktop:mac` 改为以 `npm run generate:icons &&` 开头。
- `build:desktop:cn` / `build:desktop:mac:cn` 经 `npm run build:desktop(:mac)` 自动继承,无需改。

### 4.3 涉及文件清单

| 文件 | 变更 |
|---|---|
| `electron/main/window.ts` | win32 加 titleBarStyle/overlay/backgroundColor/icon;title 改名 |
| `electron/main/ipc.ts` | 新增 `desktop:set-title-bar-overlay` handler + 对比色函数 |
| `electron/preload/index.ts` | 暴露 `setTitleBarColor`;更新 `PiDesktopApi` |
| `electron/preload/global.d.ts` | 更新 `Window.piDesktop` 类型 |
| `hooks/useTheme.ts` | `syncTitleBarOverlay()` + 三处调用点 |
| `components/AppShell.tsx` | 顶栏加 `titlebar-drag` class + 桌面模式 caption paddingRight |
| `app/globals.css` | `.titlebar-drag` 拖拽区规则 |
| `scripts/generate-icons.mjs` | 新增 |
| `electron/icons/icon.ico` | 新增(生成产物) |
| `electron-builder.yml` | `files` 加 icon.ico |
| `package.json` | `generate:icons` 脚本 + 接入 build:desktop(:mac) |

---

## 5. 测试 / 验证

自动化(可跑):
- `npx tsc --noEmit -p electron/tsconfig.json` —— 主进程/preload 类型通过。
- `npm run build:electron-main` —— dist-electron 重建。
- `npm run generate:icons` —— 产出 `electron/icons/icon.ico`,`file` 报告为 ICO(非 PNG);尺寸含多分辨率。
- `npm run build:desktop:cn` —— 构建日志不再出现 `default Electron icon is used`;`release/win-unpacked/Pi Coder.exe` 图标为 favicon。
- `npx eslint .` —— 无新 error。

人工(Windows 实机,GUI/OS 交互无法自动化):
- 启动 → 顶栏为 `--bg-panel` 色,caption 按钮可见且符号色可读;拖动顶栏可移窗;顶栏内按钮(侧栏/主题/语言/session 信息)可点。
- 切明暗 → 标题栏色实时跟随;切自定义 JSON 主题 → 标题栏色跟随该主题 `--bg-panel`。
- session 信息按钮(token/cost)不被 caption 按钮遮挡。
- 任务栏/Alt+Tab/窗口图标 = favicon;exe 图标、快捷方式、安装程序图标 = favicon。
- 加载时无白屏闪烁(backgroundColor 生效)。

---

## 6. 风险与回退

- **`titleBarStyle:'hidden'` 使窗口必须靠 `app-region` 拖拽**:若遗漏拖拽区会导致无法移窗。已用顶栏整条作拖拽区兜底。
- **caption 宽度因 DPI/缩放有别**:用固定 ~140px,极端缩放下可能略有出入;若反馈不佳,后续改用 Electron `env(titlebar-area-*)` 自适应。
- **回退**:标题栏改动均在 win32 分支与渲染层守卫内,Web 模式无影响;移除 win32 选项即恢复原生标题栏。图标改动不影响功能,回退即移除 icon.ico 引用。
