# Visible Update Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the desktop app's `electron-updater` auto-update visible — an update icon appears in the top-right corner when an update is detected, and clicking it shows live download progress and a restart-and-install action.

**Architecture:** The main process already broadcasts `desktop:updateStatus` but never emits download progress and the renderer never consumes it. We extend the main `UpdateStatus` union with a `downloading` state, add `desktop:installUpdate` + `desktop:checkForUpdates` IPC, expose them on the preload, then add a renderer hook (`useUpdateStatus`) that subscribes and a self-contained `UpdateIndicator` component (fixed-position icon + portal dropdown) wired into `AppShell`.

**Tech Stack:** Electron 43, `electron-updater ^6.8.9`, Next.js 16 App Router, React 19, TypeScript strict. Inline styles + CSS variables (`--bg-panel`, `--border`, `--bg-hover`, `--text`, `--text-muted`, `--text-dim`, `--accent`, `--accent-soft`). i18n via flat dotted keys in `lib/i18n/messages/{en,zh-CN}.ts`.

## Global Constraints

- **No test harness for this code.** `npm test` runs only `lib/markdown.test.mjs`. There is no React/Electron unit-test setup. Per-task verification is type-check + lint (commands below), with a final manual GUI matrix. Do NOT invent unit tests.
- App typecheck: `npx tsc --noEmit`. Electron typecheck: `npx tsc -p electron/tsconfig.json --noEmit`.
- Lint: `npm run lint` (app) and `npm run lint:electron` (electron).
- **Typing gotcha:** the app `tsconfig.json` excludes `electron/`, so the app's global `Window.piDesktop` (declared in `components/SessionSidebar.tsx`) only types `selectDirectory`. Accessing any other member in app code (`useUpdateStatus.ts`, `UpdateIndicator.tsx`) MUST use an inline `(window as unknown as { piDesktop?: {...} }).piDesktop` cast — exactly as `AppShell.tsx:85` and `hooks/useTheme.ts:125` do. Do NOT modify the global declaration.
- Electron `tsconfig.json` includes `./**/*.ts` with `rootDir: "."`, so `main/` and `preload/` share one program. A type-only `import type { UpdateStatus } from "../main/updater"` in preload is compile-time-erased and type-checks fine.
- All user-facing strings go through i18n (`t("update.*")`); add keys to BOTH `en.ts` and `zh-CN.ts`.
- Desktop-only feature: `UpdateIndicator` renders `null` when `!isDesktop`. Non-desktop (web) is untouched.
- Run manual GUI verification via `npm run dev:electron`. Do NOT run `next build` / `npm run build` during dev (it writes `.next/` and disturbs the dev server).
- Match surrounding code style: inline styles, CSS variables, 16×16 inline SVGs, `className="titlebar-no-drag"` on elements over the drag region.

---

## File Structure

| file | responsibility | change |
|---|---|---|
| `electron/main/updater.ts` | broadcast richer update status | extend `UpdateStatus`; add `downloading` + version carry-through; reset on not-available; refresh stale comment |
| `electron/main/ipc.ts` | renderer→main update actions | add `desktop:installUpdate` + `desktop:checkForUpdates` handlers |
| `electron/preload/index.ts` | contextBridge API | add `installUpdate` + `checkForUpdates`; type `onUpdateStatus` payload |
| `hooks/useUpdateStatus.ts` | **new** — subscribe + state machine + actions | new file |
| `components/UpdateIndicator.tsx` | **new** — icon + dropdown | new file |
| `components/AppShell.tsx` | mount the indicator | 1 import + 1 render line |
| `lib/i18n/messages/en.ts` | English strings | add `update.*` keys |
| `lib/i18n/messages/zh-CN.ts` | Chinese strings | add `update.*` keys |

---

## Task 1: Main process — progress broadcast + update actions IPC

**Files:**
- Modify: `electron/main/updater.ts`
- Modify: `electron/main/ipc.ts`

**Interfaces:**
- Produces (consumed by preload in Task 2): `UpdateStatus` union (extended) and `checkForUpdates()` (already exported).

- [ ] **Step 1: Extend `UpdateStatus` and wire progress in `electron/main/updater.ts`**

Replace the type block (lines 4–9) with the extended union:

```ts
export type UpdateStatus =
  | { state: "checking" }
  | { state: "available"; version: string }
  | { state: "downloading"; percent: number; transferred: number; total: number; version: string }
  | { state: "downloaded"; version: string }
  | { state: "not-available" }
  | { state: "error"; message: string };
```

Replace the stale comment + `broadcast` + `initUpdater` block (lines 11–32) — add a `latestVersion` capture, a `download-progress` handler, version carry-through, and reset on not-available:

```ts
// Broadcasts update status to every renderer window so the UI can show
// download progress and a restart-and-install action.
function broadcast(status: UpdateStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("desktop:updateStatus", status);
  }
}

export function initUpdater(): void {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  let latestVersion = "";

  autoUpdater.on("checking-for-update", () => broadcast({ state: "checking" }));
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
  autoUpdater.on("update-not-available", () => {
    latestVersion = "";
    broadcast({ state: "not-available" });
  });
  autoUpdater.on("error", (err) => broadcast({ state: "error", message: String(err) }));
}
```

`checkForUpdates()` (lines 34–41) is unchanged and already exported.

- [ ] **Step 2: Add install + check IPC handlers in `electron/main/ipc.ts`**

Add the imports (line 1 becomes):

```ts
import { ipcMain, dialog, BrowserWindow, app, shell } from "electron";
import { autoUpdater } from "electron-updater";
import { getMainWindow } from "./window";
import { contrastSymbolColor } from "./titlebar-color";
import { checkForUpdates } from "./updater";
```

Add the two handlers immediately before the existing `ipcMain.on("desktop:quit", ...)` line:

```ts
  // 立即退出并安装已下载的更新(由渲染端"重启并安装"按钮触发)。
  ipcMain.handle("desktop:installUpdate", () => {
    autoUpdater.quitAndInstall();
  });

  // 手动触发一次更新检查(由渲染端"重试"按钮触发);错误由 updater 内部静默处理。
  ipcMain.handle("desktop:checkForUpdates", () => {
    checkForUpdates();
  });

  ipcMain.on("desktop:quit", () => app.quit());
```

- [ ] **Step 3: Type-check the electron side**

Run: `npx tsc -p electron/tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 4: Lint the electron side**

Run: `npm run lint:electron`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add electron/main/updater.ts electron/main/ipc.ts
git commit -m "feat(desktop): broadcast update download progress + install/check IPC"
```

---

## Task 2: Preload — expose install/check and type the status payload

**Files:**
- Modify: `electron/preload/index.ts`

**Interfaces:**
- Produces (consumed by `useUpdateStatus` in Task 3): `installUpdate()`, `checkForUpdates()`, and a typed `onUpdateStatus(cb: (status: UpdateStatus) => void)`.

- [ ] **Step 1: Add the type-only import**

Change line 1 to:

```ts
import { contextBridge, ipcRenderer } from "electron";
import type { UpdateStatus } from "../main/updater";
```

- [ ] **Step 2: Type `onUpdateStatus` and add the two new methods**

Replace the existing `onUpdateStatus` block (lines 12–17) and add the new methods. The final `api` object becomes:

```ts
const api = {
  isDesktop: true as const,
  version: process.env.PI_WEB_DESKTOP_VERSION ?? "0.0.0",
  /** 打开原生目录选择框;返回选中路径或 null。 */
  selectDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke("desktop:selectDirectory"),
  /** Sync the Windows title bar overlay color to the current theme (desktop only). */
  setTitleBarColor: (hex: string) =>
    ipcRenderer.send("desktop:set-title-bar-overlay", { color: hex }),
  /** 订阅自动更新状态。 */
  onUpdateStatus: (cb: (status: UpdateStatus) => void) => {
    const handler = (_e: unknown, status: unknown) => cb(status as UpdateStatus);
    ipcRenderer.on("desktop:updateStatus", handler);
    return () => ipcRenderer.removeListener("desktop:updateStatus", handler);
  },
  /** 立即退出并安装已下载的更新。 */
  installUpdate: () => ipcRenderer.invoke("desktop:installUpdate"),
  /** 手动触发一次更新检查(用于失败后重试)。 */
  checkForUpdates: () => ipcRenderer.invoke("desktop:checkForUpdates"),
  /** 退出整个应用(含 server 子进程)。 */
  quitApp: () => ipcRenderer.send("desktop:quit"),
  /** 在系统文件管理器中显示/打开路径(桌面端)。 */
  openInFileManager: (fullPath: string, isDir: boolean) =>
    ipcRenderer.invoke("desktop:openInFileManager", fullPath, isDir),
};
```

- [ ] **Step 3: Type-check the electron side**

Run: `npx tsc -p electron/tsconfig.json --noEmit`
Expected: no errors. (The `import type` is erased; `PiDesktopApi` and `electron/preload/global.d.ts` auto-derive.)

- [ ] **Step 4: Lint the electron side**

Run: `npm run lint:electron`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add electron/preload/index.ts
git commit -m "feat(preload): expose installUpdate/checkForUpdates + type update status"
```

---

## Task 3: `useUpdateStatus` hook (new)

**Files:**
- Create: `hooks/useUpdateStatus.ts`

**Interfaces:**
- Consumes: the preload `piDesktop` API (via inline cast): `isDesktop`, `version`, `onUpdateStatus`, `installUpdate`, `checkForUpdates`.
- Produces: `{ status, showIndicator, currentVersion, install, retry }` (see code below) — consumed by `UpdateIndicator` in Task 4.

- [ ] **Step 1: Create the hook file**

Create `hooks/useUpdateStatus.ts` with this exact content:

```ts
"use client";

import { useCallback, useEffect, useState } from "react";

export type UpdateStatus =
  | { state: "checking" }
  | { state: "available"; version: string }
  | {
      state: "downloading";
      percent: number;
      transferred: number;
      total: number;
      version: string;
    }
  | { state: "downloaded"; version: string }
  | { state: "not-available" }
  | { state: "error"; message: string };

/**
 * Mirrors the discriminated union in electron/main/updater.ts. Kept in sync
 * manually because the app tsconfig excludes electron/, so the real type is not
 * visible to app code.
 */

interface DesktopUpdateApi {
  isDesktop?: boolean;
  version?: string;
  onUpdateStatus?: (cb: (status: UpdateStatus) => void) => () => void;
  installUpdate?: () => Promise<unknown> | void;
  checkForUpdates?: () => Promise<unknown> | void;
}

const INDICATOR_STATES = new Set<UpdateStatus["state"]>([
  "available",
  "downloading",
  "downloaded",
  "error",
]);

function readDesktop(): DesktopUpdateApi | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { piDesktop?: DesktopUpdateApi }).piDesktop;
}

export interface UseUpdateStatusResult {
  status: UpdateStatus | null;
  showIndicator: boolean;
  currentVersion: string;
  install: () => void;
  retry: () => void;
}

export function useUpdateStatus(): UseUpdateStatusResult {
  const desktop = readDesktop();
  const isDesktop = desktop?.isDesktop === true;
  const [status, setStatus] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    if (!isDesktop) return;
    const unsubscribe = desktop?.onUpdateStatus?.((s) => setStatus(s));
    return () => {
      unsubscribe?.();
    };
  }, [isDesktop, desktop]);

  const install = useCallback(() => {
    void desktop?.installUpdate?.();
  }, [desktop]);

  const retry = useCallback(() => {
    void desktop?.checkForUpdates?.();
  }, [desktop]);

  const showIndicator =
    isDesktop && status !== null && INDICATOR_STATES.has(status.state);

  return { status, showIndicator, currentVersion: desktop?.version ?? "", install, retry };
}
```

- [ ] **Step 2: Type-check the app side**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint the app side**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add hooks/useUpdateStatus.ts
git commit -m "feat: add useUpdateStatus hook for desktop auto-update status"
```

---

## Task 4: `UpdateIndicator` component (new) + i18n keys

**Files:**
- Create: `components/UpdateIndicator.tsx`
- Modify: `lib/i18n/messages/en.ts`
- Modify: `lib/i18n/messages/zh-CN.ts`

**Interfaces:**
- Consumes: `useUpdateStatus` (Task 3) and `useI18n` (`@/hooks/useI18n`).
- Produces: a default-exported-free named export `UpdateIndicator` consumed by `AppShell` in Task 5.

- [ ] **Step 1: Add i18n keys to `lib/i18n/messages/en.ts`**

Find the last key (currently `"i18n.after": "After",`) immediately before the closing `},` of the `messages` object, and add the `update.*` keys after it:

```ts
    "i18n.after": "After",
    "update.title": "App update",
    "update.available": "A new version is available",
    "update.downloading": "Downloading update",
    "update.downloaded": "Download complete",
    "update.error": "Update failed",
    "update.checking": "Checking for updates",
    "update.install": "Restart and install",
    "update.retry": "Retry",
    "update.currentVersion": "Current version",
    "update.newVersion": "New version",
    "update.upToDate": "You're up to date",
  },
```

- [ ] **Step 2: Add i18n keys to `lib/i18n/messages/zh-CN.ts`**

Same insertion point (after `"i18n.after": "之后",`):

```ts
    "i18n.after": "之后",
    "update.title": "应用更新",
    "update.available": "发现新版本",
    "update.downloading": "正在下载更新",
    "update.downloaded": "下载完成",
    "update.error": "更新失败",
    "update.checking": "正在检查更新",
    "update.install": "重启并安装",
    "update.retry": "重试",
    "update.currentVersion": "当前版本",
    "update.newVersion": "新版本",
    "update.upToDate": "已是最新版本",
  },
```

- [ ] **Step 3: Create the component file**

Create `components/UpdateIndicator.tsx` with this exact content:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useUpdateStatus } from "@/hooks/useUpdateStatus";
import { useI18n } from "@/hooks/useI18n";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

/**
 * Desktop-only update indicator. A fixed-position icon at the top-right corner
 * (immediately left of the file-panel toggle) that appears when an update is
 * available, downloading, downloaded, or errored. Clicking opens a dropdown with
 * version info, a live progress bar, and a restart-and-install / retry action.
 */
export function UpdateIndicator() {
  const { t } = useI18n();
  const { status, showIndicator, currentVersion, install, retry } = useUpdateStatus();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  // Close on outside-pointer-down, Esc, any scroll, or window blur — same pattern
  // as components/ContextMenu.tsx. The button itself is excluded so its click can
  // toggle without the mousedown handler immediately closing the panel.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (target && panelRef.current?.contains(target)) return;
      if (target && btnRef.current?.contains(target)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("blur", close);
    };
  }, [open, close]);

  if (!showIndicator || status === null) return null;

  const color = status.state === "error" ? "#dc2626" : "var(--accent)";
  const newVersion =
    status.state === "available" || status.state === "downloading" || status.state === "downloaded"
      ? status.version
      : "";

  // Anchor the dropdown below the button, right-aligned to the button's right edge.
  const rect = btnRef.current?.getBoundingClientRect();
  const panelTop = rect ? rect.bottom + 4 : 48;
  const panelRight = rect ? window.innerWidth - rect.right : 212;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="titlebar-no-drag"
        onClick={() => setOpen((v) => !v)}
        title={t("update.title")}
        aria-label={t("update.title")}
        aria-expanded={open}
        style={{
          position: "fixed",
          top: "env(safe-area-inset-top)",
          right: "calc(env(safe-area-inset-right) + 176px)",
          zIndex: 300,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 36,
          height: 36,
          padding: 0,
          background: open ? "var(--bg-hover)" : "var(--bg-panel)",
          border: "none",
          borderLeft: "1px solid var(--border)",
          borderBottom: "1px solid var(--border)",
          color,
          cursor: "pointer",
          transition: "color 0.12s, background 0.12s",
        }}
      >
        {status.state === "downloaded" ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : status.state === "error" ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        ) : status.state === "downloading" ? (
          <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.25" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        )}
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            className="titlebar-no-drag"
            role="dialog"
            aria-label={t("update.title")}
            style={{
              position: "fixed",
              top: panelTop,
              right: panelRight,
              zIndex: 500,
              width: 248,
              padding: "12px 14px",
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              boxShadow: "0 8px 24px rgba(0,0,0,0.28)",
              color: "var(--text)",
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            {status.state === "available" && (
              <>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>
                  {t("update.available")}
                </div>
                {newVersion && (
                  <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                    v{currentVersion || "?"} → v{newVersion}
                  </div>
                )}
              </>
            )}

            {status.state === "downloading" && (
              <>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>
                  {t("update.downloading")}
                </div>
                <div
                  style={{
                    height: 6,
                    borderRadius: 3,
                    background: "var(--border)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.max(0, Math.min(100, status.percent))}%`,
                      background: "var(--accent)",
                      borderRadius: 3,
                      transition: "width 0.15s ease-out",
                    }}
                  />
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginTop: 6,
                    color: "var(--text-muted)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                  }}
                >
                  <span>
                    {formatBytes(status.transferred)} / {formatBytes(status.total)}
                  </span>
                  <span>{Math.round(status.percent)}%</span>
                </div>
              </>
            )}

            {status.state === "downloaded" && (
              <>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>
                  {t("update.downloaded")}
                </div>
                {newVersion && (
                  <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginBottom: 10 }}>
                    v{currentVersion || "?"} → v{newVersion}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    install();
                    close();
                  }}
                  style={{
                    width: "100%",
                    padding: "7px 12px",
                    borderRadius: 6,
                    border: "none",
                    background: "var(--accent)",
                    color: "#fff",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {t("update.install")}
                </button>
              </>
            )}

            {status.state === "error" && (
              <>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#dc2626", marginBottom: 6 }}>
                  {t("update.error")}
                </div>
                <div
                  style={{
                    color: "var(--text-muted)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    marginBottom: 10,
                    overflowWrap: "anywhere",
                  }}
                >
                  {status.message}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    retry();
                    close();
                  }}
                  style={{
                    width: "100%",
                    padding: "7px 12px",
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                    background: "var(--bg-hover)",
                    color: "var(--text)",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {t("update.retry")}
                </button>
              </>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
```

- [ ] **Step 4: Type-check the app side**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Lint the app side**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add components/UpdateIndicator.tsx lib/i18n/messages/en.ts lib/i18n/messages/zh-CN.ts
git commit -m "feat: add UpdateIndicator component with progress + install/retry actions"
```

---

## Task 5: Wire into AppShell + manual verification

**Files:**
- Modify: `components/AppShell.tsx`

**Interfaces:**
- Consumes: `UpdateIndicator` (Task 4).

- [ ] **Step 1: Add the import**

In `components/AppShell.tsx`, alongside the other local component imports (e.g. after the `ThemePicker` import near line 18), add:

```ts
import { UpdateIndicator } from "./UpdateIndicator";
```

- [ ] **Step 2: Render the indicator**

Render `<UpdateIndicator />` immediately after the file-panel toggle button (the `position: fixed` button that ends around the line before `{modelsConfigOpen && <ModelsConfig ... />}`). Because the indicator is `position: fixed`, placement is for locality only and does not affect layout. Add it on its own line:

```tsx
      </button>
      <UpdateIndicator />
      {modelsConfigOpen && <ModelsConfig onClose={() => { setModelsConfigOpen(false); setModelsRefreshKey((k) => k + 1); }} />}
```

- [ ] **Step 3: Type-check the app side**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Lint the app side**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 5: Manual GUI verification**

Run `npm run dev:electron` and verify against this matrix:

| scenario | expected |
|---|---|
| No update available | no icon at top-right (only the file-panel toggle and caption buttons) |
| Update available | accent down-arrow icon appears at top-right, immediately left of the file-panel toggle |
| Click icon while downloading | dropdown opens with heading + progress bar + `transferred / total` + `%` |
| Download completes | icon switches to accent check; dropdown shows version line + "重启并安装" button |
| Click "重启并安装" | app quits and relaunches on the new version |
| Error path (e.g. offline / unsigned) | red warning icon; dropdown shows message + "重试" button; clicking "重试" re-checks |
| Outside click / Esc / scroll | dropdown closes |
| Various window widths | update icon never overlaps the caption buttons or the file-panel toggle |
| Web build (`npm run dev`) | no update icon rendered (non-desktop) |

If a real update is not available to test against, temporarily point the build at a test feed or verify the `available`→`downloading`→`downloaded` flow by inspecting that the icon appears and the dropdown renders per state; the error path can be forced by checking offline.

- [ ] **Step 6: Commit**

```bash
git add components/AppShell.tsx
git commit -m "feat: mount UpdateIndicator in AppShell top-right"
```

---

## Completion

After Task 5 is verified:

- Announce: "I'm using the finishing-a-development-branch skill to complete this work."
- **REQUIRED SUB-SKILL:** Use superpowers:finishing-a-development-branch — verify (tsc both projects + both lints already green per tasks), present the four finish options, and execute the user's choice. The user's prior preference for this project is "merge to main locally."
