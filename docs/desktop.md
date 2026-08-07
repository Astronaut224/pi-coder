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

### 人工验证项(待人工验证)

以下 12 项涉及 GUI / 安装卸载 / OS 交互,无法由自动化脚本验证,需在目标平台手动执行(在 Windows 上逐项跑;macOS 项在 mac 机器或 CI 上验证)。

- [ ] 1. 启动 → 窗口加载 → 创建 agent 会话 → 跑通完整任务 — 待人工验证
- [ ] 2. SSE 实时事件正常流式 — 待人工验证
- [ ] 3. 托盘显示/隐藏/退出;双击切换窗口 — 待人工验证
- [ ] 4. 全局快捷键唤出/隐藏窗口 — 待人工验证
- [ ] 5. 开机自启开关(默认关) — 待人工验证
- [ ] 6. 桌面通知(任务完成,含隐藏到托盘场景) — 待人工验证
- [ ] 7. 原生目录选择框 → cwd 生效 — 待人工验证
- [ ] 8. 单实例锁(二次启动聚焦已有窗口) — 待人工验证
- [ ] 9. 窗口位置/大小记忆 — 待人工验证
- [ ] 10. Windows NSIS 安装/卸载;便携版解压运行 — 待人工验证
- [ ] 11. macOS dmg 打开运行(在 mac 机器或 CI 验证) — 待人工验证
- [ ] 12. 自动更新检查流程 — 待人工验证

### 自动化回归(已验证)

以下 5 项由 Task 14 自动化回归在 Windows + Node 22.22.2 上实跑验证(单实例锁已合入 `electron/main/index.ts`):

- [x] `node --test electron/main/server-utils.test.mjs` — **通过**:7/7 用例全过(exit 0)
- [x] `npx tsc --noEmit -p tsconfig.json` — **通过**:0 错误(exit 0,web 作用域)
- [x] `npx tsc --noEmit -p electron/tsconfig.json` — **通过**:0 错误(exit 0,electron 作用域;同时确认单实例锁改动编译通过)
- [x] `npm run build:electron-main` — **通过**:dist-electron 干净重建(exit 0)
- [x] `npx eslint .` — **源码通过**:仅 4 个 pre-existing warning、0 error。
  - 注:`release/`(electron-builder 输出目录,已 gitignore)不在 `eslint.config.mjs` 的 `ignores` 列表内,若该目录存在打包产物会被扫描,产生大量产物文件告警。排除 `release/**` 后源码 lint 为 exit 0,告警明细如下(全部 pre-existing,与本任务改动无关):
    - `app/api/cwd/browse/route.ts:9` — warning `'shouldShowWindowsDrivePicker' is defined but never used`(基线)
    - `electron/main/server-utils.ts:49` — warning `'startedAt' is assigned a value but never used`(基线)
    - `electron/main/tray.ts:21` — warning `'_server' is defined but never used`(pre-existing)
    - `electron/main/tray.ts:54` — warning `Expected an assignment or function call and instead saw an expression`(pre-existing)
  - 建议(非本任务范围):在 `eslint.config.mjs` 的 `ignores` 中追加 `"release/**"`,与现有 `dist-electron/**` / `.next/**` / `resources/**` 对齐,避免打包产物污染 lint 结果。
