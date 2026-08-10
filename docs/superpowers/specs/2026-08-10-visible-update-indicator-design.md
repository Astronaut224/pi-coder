# Visible Update Indicator — Design

**Date:** 2026-08-10
**Status:** Approved
**Goal:** Make the desktop app's auto-update visible: show an update icon in the top-right corner when an update is detected, and show live download progress when clicked. Today the updater runs but the UI shows nothing.

## Background

The desktop app updates via GitHub Releases through `electron-updater` (`electron/main/updater.ts`). Today:

- `autoDownload = true`, `autoInstallOnAppQuit = true`.
- Checks once 5s after `app.whenReady()` (packaged only) and via the native Help menu "检查更新". No periodic re-check.
- `broadcast()` sends `desktop:updateStatus` to every `BrowserWindow` with states `checking | available(+version) | not-available | downloaded | error(+message)`.
- The preload exposes `onUpdateStatus(cb)` (returns an unsubscribe function), typed as `status: unknown`.
- **The renderer never consumes it** — the channel broadcasts into a void.
- **`download-progress` is not handled**, so percent/transferred bytes are never broadcast → a progress bar cannot be built from current events.
- **`quitAndInstall()` is never called**; install only happens silently on next quit.
- **No renderer→main IPC** exists for check / download / install.

## Decisions (user-approved)

1. **Download stays automatic.** `autoDownload` stays `true`. The icon is a passive status display; clicking it reveals progress. No "download" button.
2. **Install via panel button.** Add a renderer→main install IPC → `autoUpdater.quitAndInstall()`. The panel offers "重启并安装" once downloaded. (Install-on-quit remains as a fallback.)

## Scope

**In scope:** broadcast download progress; add install + manual-check IPC; new renderer hook + icon/dropdown component; i18n strings; wire into `AppShell`.

**Out of scope:** cancel-download; per-window state; periodic re-checks; changing auto-download/auto-install-on-quit semantics; non-desktop (web) — the indicator renders nothing when `!isDesktop`.

## Architecture / Data flow

```
main: updater.ts ──broadcast desktop:updateStatus──▶ preload.onUpdateStatus ──▶ useUpdateStatus hook ──▶ UpdateIndicator (icon + dropdown)
                                                                                                                    ▲
renderer ──installUpdate / checkForUpdates IPC──▶ main (ipc.ts) ─────────────────────────────────────────────────┘
```

The main process keeps its current auto-check. We extend what it **broadcasts** (progress) and add two **renderer→main actions** (install, retry-check). The renderer is a passive observer plus two action buttons.

## Detailed changes

### 1. `electron/main/updater.ts`

Extend the discriminated-union payload and wire the missing event. Capture `latestVersion` on `update-available` and carry it into `downloading`/`downloaded`.

```ts
export type UpdateStatus =
  | { state: "checking" }
  | { state: "available"; version: string }
  | { state: "downloading"; percent: number; transferred: number; total: number; version: string }
  | { state: "downloaded"; version: string }
  | { state: "not-available" }
  | { state: "error"; message: string };
```

Inside `initUpdater()`, add a module-level `let latestVersion = "";`, set it in the `update-available` handler, and add the missing handler:

```ts
autoUpdater.on("update-available", (info) => {
  latestVersion = info.version ?? "";
  broadcast({ state: "available", version: latestVersion });
});
autoUpdater.on("download-progress", (p) =>
  broadcast({
    state: "downloading",
    percent: p.percent,
    transferred: p.transferred,
    total: p.total,
    version: latestVersion,
  }),
);
autoUpdater.on("update-downloaded", () => broadcast({ state: "downloaded", version: latestVersion }));
```

Reset `latestVersion = ""` on `update-not-available` (so a stale version does not leak across checks). `error` and `checking` handlers are unchanged. Remove/refresh the stale "FUTURE enhancement" comment at lines 11–14 (the renderer consumer now exists).

`checkForUpdates()` is already exported — no change needed there.

`broadcast()` continues to iterate `BrowserWindow.getAllWindows()`.

### 2. `electron/main/ipc.ts`

Add two handlers (import `checkForUpdates` from `./updater` and `autoUpdater` from `electron-updater`):

```ts
ipcMain.handle("desktop:installUpdate", () => {
  autoUpdater.quitAndInstall();
});
ipcMain.handle("desktop:checkForUpdates", () => {
  checkForUpdates();
});
```

`quitAndInstall()` throws only in pathological states; it is fire-and-forget. `checkForUpdates()` already swallows errors internally.

### 3. `electron/preload/index.ts`

Add two methods to the `api` object and type the existing callback payload:

```ts
import { contextBridge, ipcRenderer } from "electron";
import type { UpdateStatus } from "../main/updater";
// ...
  onUpdateStatus: (cb: (status: UpdateStatus) => void) => {
    const handler = (_e: unknown, status: unknown) => cb(status as UpdateStatus);
    ipcRenderer.on("desktop:updateStatus", handler);
    return () => ipcRenderer.removeListener("desktop:updateStatus", handler);
  },
  /** 立即退出并安装已下载的更新。 */
  installUpdate: () => ipcRenderer.invoke("desktop:installUpdate"),
  /** 手动触发一次更新检查(用于失败后重试)。 */
  checkForUpdates: () => ipcRenderer.invoke("desktop:checkForUpdates"),
```

`import type` is erased at compile → no runtime main↔preload coupling. The `PiDesktopApi` type and `electron/preload/global.d.ts` auto-derive.

### 4. `hooks/useUpdateStatus.ts` (new)

App-side hook. Uses the established inline-cast pattern (the app `tsconfig.json` excludes `electron/`, so the app's global `Window.piDesktop` only types `selectDirectory`). Defines a local `UpdateStatus` type mirroring the main union (kept in sync manually — the real type lives in `electron/`).

```ts
export type UpdateStatus =
  | { state: "checking" }
  | { state: "available"; version: string }
  | { state: "downloading"; percent: number; transferred: number; total: number; version: string }
  | { state: "downloaded"; version: string }
  | { state: "not-available" }
  | { state: "error"; message: string };
```

Returns `{ status, showIndicator, currentVersion, install, retry }`:

- `status`: latest `UpdateStatus | null`.
- `showIndicator`: `true` only for `available | downloading | downloaded | error`. Transient `checking`/`not-available` do not surface an icon (and `not-available` clears remembered state).
- `currentVersion`: `piDesktop.version ?? ""` (the installed version).
- `install()`: calls the cast `piDesktop.installUpdate()`.
- `retry()`: calls the cast `piDesktop.checkForUpdates()`.

The hook reads the desktop bridge once via the inline cast and returns `showIndicator: false` when `!isDesktop` or in non-browser (SSR) contexts. It subscribes in a `useEffect` and calls the returned unsubscribe on cleanup.

### 5. `components/UpdateIndicator.tsx` (new)

Desktop-only, `position: fixed` icon button in the top-right corner, placed **immediately to the left of the existing file-panel toggle** so it never collides with the Windows caption buttons (`DESKTOP_CAPTION_WIDTH = 140px`) or the file toggle (also fixed, `right: calc(env(safe-area-inset-right) + 140px)`, width 36). The indicator sits at `right: calc(env(safe-area-inset-right) + 176px)`, width 36, `top: env(safe-area-inset-top)`, `zIndex: 300`.

- Renders `null` when `!showIndicator`.
- Renders `null` when `!isDesktop` (the hook already gates this, but the component double-checks).
- Self-contained dropdown: owns its own open state; the dropdown is a `position: fixed` panel anchored to the button's `getBoundingClientRect()` (drops down, left-aligned to the button). Closes on outside `pointerdown`, `Escape`, and `scroll`/`blur` — same pattern as `components/ContextMenu.tsx` (portal to `document.body`). It does **not** participate in `AppShell`'s shared `activeTopPanel` mechanism (it is not a `topBarRef` child), so it manages its own dismissal.
- Uses CSS variables (`--bg-panel`, `--border`, `--accent`, `--text`, `--text-muted`, `--text-dim`, `--bg-hover`) to match the rest of the top bar. Inline styles, no new CSS file (codebase convention).
- Marked `className="titlebar-no-drag"` on the button + dropdown so it stays interactive over the drag region.

**Icon per state** (16×16 inline SVG, like the other top-bar buttons):

| state | icon | color |
|---|---|---|
| `available` | downward arrow into tray | `--accent` |
| `downloading` | downward arrow + CSS spin (reuse `animate-spin`) | `--accent` |
| `downloaded` | check | `--accent` |
| `error` | warning triangle | `#dc2626` |

**Dropdown contents per state:**

| state | heading | body | action |
|---|---|---|---|
| `available` | `t("update.available")` | `v{currentVersion} → v{status.version}` | none (auto-download starting) |
| `downloading` | `t("update.downloading")` | progress bar `percent%` + `transferred / total` (human-readable, e.g. `1.2 MB / 8.4 MB`) + version line | none |
| `downloaded` | `t("update.downloaded")` | `v{currentVersion} → v{status.version}` | **`t("update.install")`** button → `install()` |
| `error` | `t("update.error")` | `status.message` | **`t("update.retry")`** button → `retry()` |

Progress bar: a thin `--accent` fill over a `--border` track, width `%` of `percent`, rounded. No animation jitter on every byte — React only re-renders when a new status object arrives (throttled by electron-updater's own emit cadence).

Tooltip on the icon button: `t("update.title")`.

### 6. `components/AppShell.tsx`

Render `<UpdateIndicator />` once, near the file-panel toggle button (desktop-only is handled inside the component). One import + one JSX line. No other AppShell changes — the indicator is `position: fixed`, so it does not disturb the existing flex layout or the caption-button clearance.

### 7. i18n (`lib/i18n/messages/en.ts` + `zh-CN.ts`)

New `update.*` keys inserted at the end of each `messages` object (before the closing `},`):

| key | en | zh-CN |
|---|---|---|
| `update.title` | App update | 应用更新 |
| `update.available` | A new version is available | 发现新版本 |
| `update.downloading` | Downloading update | 正在下载更新 |
| `update.downloaded` | Download complete | 下载完成 |
| `update.error` | Update failed | 更新失败 |
| `update.checking` | Checking for updates | 正在检查更新 |
| `update.install` | Restart and install | 重启并安装 |
| `update.retry` | Retry | 重试 |
| `update.currentVersion` | Current version | 当前版本 |
| `update.newVersion` | New version | 新版本 |
| `update.upToDate` | You're up to date | 已是最新版本 |

(`update.checking` and `update.upToDate` are included for completeness/future use but are not rendered by the initial indicator — `checking`/`not-available` do not show the icon. They cost nothing and avoid a later i18n round-trip.)

## States & edge cases

- **`not-available`:** hook clears remembered version and sets `showIndicator: false`. No icon. (If an icon had been showing from a prior `error`/`available`, a successful re-check that yields `not-available` dismisses it.)
- **`error` after `available`/`downloading`:** icon switches to the red warning; panel offers retry. The user can recover without restarting.
- **Portable / unsigned build:** `checkForUpdates()` swallows errors; an `error` status may broadcast. The indicator shows the error + retry, which will just error again — acceptable, and the icon can be dismissed by closing the dropdown (the icon remains until a non-error status arrives or the app restarts; this is intentional so a real failure is not silently hidden).
- **Fast network:** `downloading` may be brief; the user may click after `downloaded` already fired. Panel shows the restart button. Still "visible".
- **Multiple windows:** `broadcast` reaches all windows; each `UpdateIndicator` instance observes independently. Fine.
- **SSR:** hook guards `typeof window === "undefined"`; component renders `null`.

## Files touched

| file | change |
|---|---|
| `electron/main/updater.ts` | extend `UpdateStatus`; add `downloading` + version carry-through; reset on not-available; refresh stale comment |
| `electron/main/ipc.ts` | add `desktop:installUpdate` + `desktop:checkForUpdates` handlers |
| `electron/preload/index.ts` | add `installUpdate` + `checkForUpdates`; type `onUpdateStatus` payload via `import type` |
| `hooks/useUpdateStatus.ts` | **new** — subscription + state machine + actions |
| `components/UpdateIndicator.tsx` | **new** — icon + dropdown |
| `components/AppShell.tsx` | render `<UpdateIndicator />` (1 import + 1 line) |
| `lib/i18n/messages/en.ts` | add `update.*` keys |
| `lib/i18n/messages/zh-CN.ts` | add `update.*` keys |

## Verification

There is no React/Electron test harness (`npm test` only runs `lib/markdown.test.mjs`). Verify:

- `npx tsc --noEmit` (app)
- `npx tsc -p electron/tsconfig.json --noEmit` (electron)
- `npm run lint` + `npm run lint:electron`
- Manual GUI (`npm run dev:electron`, packaged or with a fake update source):
  - No update available → no icon.
  - Update available → accent icon appears top-right; click → dropdown shows version line; progress bar fills during download.
  - Downloaded → check icon; click → "重启并安装" → app quits and relaunches on the new version.
  - Error path → red warning icon; "重试" re-checks.
  - Icon never overlaps the caption buttons or the file-panel toggle at any window width.
