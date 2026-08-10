# File Browser Right-Click Context Menu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a right-click context menu to every file/folder row in the file browser with three actions: Open in system file manager, Copy relative path, Copy absolute path.

**Architecture:** A new reusable `ContextMenu` React component is rendered (via portal) by `FileExplorer` whenever a row is right-clicked. Two of the three actions reuse existing utilities (`copyText`, `getRelativeFilePath`, `normalizeFilePathSlashes`). The "Open in file manager" action calls a new `desktop:openInFileManager` IPC channel whose main-process handler picks `shell.showItemInFolder` (files) or `shell.openPath` (folders). The renderer hides that action in web mode via the existing `window.piDesktop?.isDesktop` guard.

**Tech Stack:** Electron 43 (main + preload `contextBridge`), Next.js 16 App Router, React 19, TypeScript (strict, `noEmit`), hand-rolled inline styles + CSS variables. No UI library.

## Global Constraints

- **IPC channel naming:** `desktop:<action>`; renderer calls `window.piDesktop.<method>()`. New channel = `desktop:openInFileManager`; preload method = `openInFileManager(fullPath, isDir)`.
- **Desktop guard:** the "Open in File Manager" menu item is rendered only when `window.piDesktop?.isDesktop === true`. Copy actions render in both desktop and web modes.
- **Reuse, do not duplicate:** clipboard via `copyText` from `@/lib/clipboard`; path logic via `getRelativeFilePath` and `normalizeFilePathSlashes` from `@/lib/file-paths`. The workspace root is the existing `cwd` prop on `FileExplorer`.
- **i18n:** every user-facing string is a key under `files.*` added to BOTH `lib/i18n/messages/en.ts` and `lib/i18n/messages/zh-CN.ts`; read via `t("files.<key>")`.
- **Styling:** inline styles using the existing CSS variables (`--bg-panel`, `--border`, `--bg-hover`, `--text`, `--text-muted`, `--accent`). No Tailwind classes inside these components (matches `FileExplorer.tsx`).
- **No component/Electron test harness exists in this repo** (`test` only runs `lib/markdown.test.mjs`). Per-task verification is therefore: TypeScript typecheck + ESLint + manual check. Do NOT introduce a test runner as part of this feature (YAGNI).
- **Verification commands (exact):**
  - App typecheck: `npx tsc --noEmit`
  - Electron typecheck: `npx tsc -p electron/tsconfig.json --noEmit`
  - Lint app: `npm run lint`
  - Lint electron: `npm run lint:electron`
  - Run desktop app for manual testing: `npm run dev:electron`
  - Run web app for manual testing: `npm run dev`
- **Git:** before the first commit, create and switch to `git checkout -b feat/file-browser-context-menu` (we are currently on `main`). Commit once per task. Do not push.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `electron/main/ipc.ts` | Main-process IPC handlers | Add `desktop:openInFileManager` handler; add `shell` to the electron import |
| `electron/preload/index.ts` | `contextBridge` API exposed as `window.piDesktop` | Add `openInFileManager` method (type auto-derives via `global.d.ts`) |
| `lib/i18n/messages/en.ts` | English strings | Add 4 `files.*` keys |
| `lib/i18n/messages/zh-CN.ts` | Chinese strings | Add the same 4 `files.*` keys |
| `components/ContextMenu.tsx` | **NEW** — reusable, portal-rendered, viewport-clamped context menu; closes on outside-click / Esc / scroll / blur | Create |
| `components/FileExplorer.tsx` | File browser tree + Changes list | Add `onContextMenu` to `TreeNode` and `ChangeRow` rows; manage menu + "Copied" toast state; render `<ContextMenu>` |

**Shared interface contract (defined in Task 3, consumed in Task 4):**

```ts
// components/ContextMenu.tsx
export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}
export function ContextMenu(props: { x: number; y: number; items: ContextMenuItem[]; onClose: () => void }): React.ReactPortal;
```

```ts
// Row callback signature threaded through TreeNode / ChangeRow in Task 4
onItemContextMenu?: (fullPath: string, isDir: boolean, event: React.MouseEvent) => void;
```

---

### Task 1: Electron IPC channel `desktop:openInFileManager`

**Files:**
- Modify: `electron/main/ipc.ts` (line 1 import; add handler inside `registerIpc()`)
- Modify: `electron/preload/index.ts` (add method to the `api` object)

**Interfaces:**
- Produces: `window.piDesktop.openInFileManager(fullPath: string, isDir: boolean): Promise<void>` (consumed in Task 4). Files → reveal in parent; folders → open the folder.

- [ ] **Step 1: Add `shell` to the electron import in `electron/main/ipc.ts`**

Change line 1 from:
```ts
import { ipcMain, dialog, BrowserWindow, app } from "electron";
```
to:
```ts
import { ipcMain, dialog, BrowserWindow, app, shell } from "electron";
```

- [ ] **Step 2: Register the handler inside `registerIpc()`**

Insert this block immediately before the existing `ipcMain.on("desktop:quit", () => app.quit());` line:

```ts
  // 在系统文件管理器中显示/打开路径(桌面端)。文件→定位,文件夹→打开。
  ipcMain.handle("desktop:openInFileManager", (_event, fullPath: unknown, isDir: unknown) => {
    if (typeof fullPath !== "string" || fullPath.length === 0) return;
    if (typeof isDir !== "boolean") return;
    if (isDir) {
      void shell.openPath(fullPath);
    } else {
      shell.showItemInFolder(fullPath);
    }
  });
```

- [ ] **Step 3: Expose the method on the preload `api` object**

In `electron/preload/index.ts`, add this entry to the `api` object, immediately after the `quitApp` line:

```ts
  /** 在系统文件管理器中显示/打开路径(桌面端)。 */
  openInFileManager: (fullPath: string, isDir: boolean) =>
    ipcRenderer.invoke("desktop:openInFileManager", fullPath, isDir),
```

(The `PiDesktopApi` type and `electron/preload/global.d.ts` auto-derive — no separate type edit.)

- [ ] **Step 4: Verify typecheck + lint**

Run: `npx tsc -p electron/tsconfig.json --noEmit`
Expected: no output (success).

Run: `npm run lint:electron`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git checkout -b feat/file-browser-context-menu
git add electron/main/ipc.ts electron/preload/index.ts
git commit -m "feat(desktop): add openInFileManager IPC channel"
```

---

### Task 2: i18n keys

**Files:**
- Modify: `lib/i18n/messages/en.ts` (append after the `files.uploading` line, currently line 184)
- Modify: `lib/i18n/messages/zh-CN.ts` (same location, currently line 184)

**Interfaces:**
- Produces keys consumed in Task 4: `files.openInFileManager`, `files.copyRelativePath`, `files.copyAbsolutePath`, `files.copied`.

- [ ] **Step 1: Add the four keys to `lib/i18n/messages/en.ts`**

Insert immediately after the line `"files.uploading": "Uploading, {progress}%",`:

```ts
    "files.openInFileManager": "Open in File Manager",
    "files.copyRelativePath": "Copy Relative Path",
    "files.copyAbsolutePath": "Copy Absolute Path",
    "files.copied": "Copied",
```

- [ ] **Step 2: Add the four keys to `lib/i18n/messages/zh-CN.ts`**

Insert immediately after the line `"files.uploading": "正在上传，{progress}%",`:

```ts
    "files.openInFileManager": "在系统文件管理器中打开",
    "files.copyRelativePath": "复制相对路径",
    "files.copyAbsolutePath": "复制绝对路径",
    "files.copied": "已复制",
```

- [ ] **Step 3: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: no output (success).

- [ ] **Step 4: Commit**

```bash
git add lib/i18n/messages/en.ts lib/i18n/messages/zh-CN.ts
git commit -m "feat(i18n): add file-browser context menu strings"
```

---

### Task 3: Reusable `ContextMenu` component

**Files:**
- Create: `components/ContextMenu.tsx`

**Interfaces:**
- Produces: `export interface ContextMenuItem` and `export function ContextMenu` (signatures in the File Structure section above). Consumed in Task 4.

- [ ] **Step 1: Create `components/ContextMenu.tsx` with the full implementation**

```tsx
"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface ContextMenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

/**
 * Lightweight, reusable right-click menu. Rendered through a portal to
 * document.body so it is never clipped by ancestor overflow. It clamps itself
 * inside the viewport and closes on outside-click, Esc, scroll, or blur.
 */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // Clamp into the viewport once the element has been measured.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    const nextX = x + rect.width + margin > window.innerWidth
      ? Math.max(margin, window.innerWidth - rect.width - margin)
      : x;
    const nextY = y + rect.height + margin > window.innerHeight
      ? Math.max(margin, window.innerHeight - rect.height - margin)
      : y;
    setPos({ x: nextX, y: nextY });
  }, [x, y]);

  // Close on outside pointer-down, Esc, any scroll, or window blur.
  useEffect(() => {
    const handlePointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const handleClose = () => onClose();
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("scroll", handleClose, true);
    window.addEventListener("blur", handleClose);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("scroll", handleClose, true);
      window.removeEventListener("blur", handleClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        minWidth: 160,
        maxWidth: 260,
        padding: "4px 0",
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        boxShadow: "0 8px 24px rgba(0,0,0,0.28)",
        zIndex: 100000,
        fontSize: 12,
        color: "var(--text)",
      }}
    >
      {items.map((item, i) => (
        <button
          key={i}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return;
            item.onClick();
            onClose();
          }}
          onMouseEnter={(e) => {
            if (!item.disabled) e.currentTarget.style.background = "var(--bg-hover)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "none";
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            padding: "6px 12px",
            border: "none",
            background: "none",
            color: "var(--text)",
            textAlign: "left",
            cursor: item.disabled ? "default" : "pointer",
            fontSize: 12,
          }}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}
```

- [ ] **Step 2: Verify typecheck + lint**

Run: `npx tsc --noEmit`
Expected: no output (success).

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/ContextMenu.tsx
git commit -m "feat(ui): add reusable ContextMenu component"
```

---

### Task 4: Wire the context menu into `FileExplorer`

**Files:**
- Modify: `components/FileExplorer.tsx`
  - imports (top of file)
  - `TreeNode` props + row `<div>` + recursive child `<TreeNode>`
  - `ChangeRow` props + row `<div>`
  - `FileExplorer` body: state, handlers, menu items, render `<ContextMenu>` + "Copied" toast; pass `onItemContextMenu` to `TreeNode` and `ChangeRow`

**Interfaces:**
- Consumes: `ContextMenu`, `ContextMenuItem` (Task 3); `copyText` (`@/lib/clipboard`); `getRelativeFilePath`, `normalizeFilePathSlashes` (`@/lib/file-paths`, already imported); `window.piDesktop.openInFileManager` (Task 1); i18n keys (Task 2).

- [ ] **Step 1: Add imports**

In `components/FileExplorer.tsx`, immediately after the line `import { getFileIcon, FolderIcon } from "./FileIcons";`, add:

```ts
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { copyText } from "@/lib/clipboard";
```

- [ ] **Step 2: Add the `onItemContextMenu` prop to `TreeNode`**

In the `TreeNode` destructure (the function parameter list), add `onItemContextMenu,` immediately after the `t,` line. Then in the matching parameter type object, add this line immediately after `t: Translate;`:

```ts
  onItemContextMenu?: (fullPath: string, isDir: boolean, event: React.MouseEvent) => void;
```

- [ ] **Step 3: Add `onContextMenu` to the `TreeNode` row `<div>`**

On the row `<div>` that currently starts with `onClick={handleClick}` followed by `onMouseEnter`, insert a new `onContextMenu` line so the opening of the div reads:

```tsx
      <div
        onClick={handleClick}
        onContextMenu={
          onItemContextMenu
            ? (e) => {
                e.preventDefault();
                onItemContextMenu(node.fullPath, node.isDir, e);
              }
            : undefined
        }
        onMouseEnter={() => setHovered(true)}
```

- [ ] **Step 4: Thread `onItemContextMenu` to recursive child `TreeNode`**

In the recursive `<TreeNode>` call inside the `children.map(...)` block, add `onItemContextMenu={onItemContextMenu}` as a prop (e.g., immediately after `onAtMention={onAtMention}`).

- [ ] **Step 5: Add the `onItemContextMenu` prop to `ChangeRow` and its row `<div>`**

Update the `ChangeRow` function signature so it reads:

```tsx
function ChangeRow({
  status,
  cwd,
  onOpenFile,
  onItemContextMenu,
  t,
}: {
  status: GitFileStatus;
  cwd: string;
  onOpenFile: OpenFileHandler;
  onItemContextMenu?: (fullPath: string, isDir: boolean, event: React.MouseEvent) => void;
  t: Translate;
}) {
```

Then on the `ChangeRow` row `<div>` that starts with `onClick={() => onOpenFile(status.filePath, name, { modeHint: "diff" })}` followed by `onMouseEnter`, insert an `onContextMenu` line:

```tsx
    <div
      onClick={() => onOpenFile(status.filePath, name, { modeHint: "diff" })}
      onContextMenu={
        onItemContextMenu
          ? (e) => {
              e.preventDefault();
              onItemContextMenu(status.filePath, false, e);
            }
          : undefined
      }
      onMouseEnter={() => setHovered(true)}
```

- [ ] **Step 6: Add menu + toast state to `FileExplorer`**

Inside the `FileExplorer` component body, immediately after the `const [pendingConflict, setPendingConflict] = useState<PendingConflict | null>(null);` line, add:

```ts
  const [menu, setMenu] = useState<{ x: number; y: number; fullPath: string; isDir: boolean } | null>(null);
  const [copiedMsg, setCopiedMsg] = useState<string | null>(null);
  const copiedTimerRef = useRef<number | undefined>(undefined);
```

- [ ] **Step 7: Add the handlers and menu-item builder**

Immediately after the `addUploadedFilesToChat` `useCallback` block (just before `return (`), add:

```ts
  const flashCopied = useCallback(() => {
    setCopiedMsg(t("files.copied"));
    window.clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = window.setTimeout(() => setCopiedMsg(null), 1500);
  }, [t]);

  const handleItemContextMenu = useCallback(
    (fullPath: string, isDir: boolean, e: React.MouseEvent) => {
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY, fullPath, isDir });
    },
    [],
  );

  const handleCloseMenu = useCallback(() => setMenu(null), []);

  useEffect(() => () => window.clearTimeout(copiedTimerRef.current), []);

  const isDesktop = typeof window !== "undefined" && window.piDesktop?.isDesktop === true;

  const menuItems: ContextMenuItem[] = menu
    ? [
        ...(isDesktop
          ? [{
              label: t("files.openInFileManager"),
              onClick: () => {
                void window.piDesktop?.openInFileManager(menu.fullPath, menu.isDir);
              },
            }]
          : []),
        {
          label: t("files.copyRelativePath"),
          onClick: () => {
            void copyText(getRelativeFilePath(menu.fullPath, cwd)).then(flashCopied);
          },
        },
        {
          label: t("files.copyAbsolutePath"),
          onClick: () => {
            void copyText(normalizeFilePathSlashes(menu.fullPath)).then(flashCopied);
          },
        },
      ]
    : [];
```

- [ ] **Step 8: Pass `onItemContextMenu` to the rendered rows**

In the `roots.map((node) => (<TreeNode ... />))` block, add `onItemContextMenu={handleItemContextMenu}` (e.g., immediately after `onAtMention={onAtMention}`).

In the `gitFiles.map((status) => <ChangeRow ... />)` line, add `onItemContextMenu={handleItemContextMenu}` so it reads:

```tsx
            <ChangeRow key={status.filePath} status={status} cwd={cwd} onOpenFile={onOpenFile} onItemContextMenu={handleItemContextMenu} t={t} />
```

- [ ] **Step 9: Render `<ContextMenu>` and the "Copied" toast**

Immediately before the final closing `</div>` of the `FileExplorer` return (the one that closes `<div style={{ minHeight: "100%" }}>`), add:

```tsx
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={handleCloseMenu} />
      )}
      {copiedMsg && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            left: "50%",
            bottom: 24,
            transform: "translateX(-50%)",
            padding: "6px 12px",
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
            color: "var(--text)",
            fontSize: 12,
            zIndex: 100001,
            pointerEvents: "none",
          }}
        >
          {copiedMsg}
        </div>
      )}
```

- [ ] **Step 10: Verify typecheck + lint**

Run: `npx tsc --noEmit`
Expected: no output (success).

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 11: Manual verification (desktop)**

Run: `npm run dev:electron`
Then in the running app, confirm:
- Right-click a **file** in the tree → menu appears at the cursor; choose **Open in File Manager** → the OS file manager opens with the file highlighted.
- Right-click a **file** → **Copy Relative Path** → paste somewhere → equals the path relative to the project root; a "Copied" toast flashes.
- Right-click a **file** → **Copy Absolute Path** → paste → equals the full forward-slashed path.
- Right-click a **folder** → **Open in File Manager** → the OS file manager opens that folder (browses its contents).
- Right-click a file in the **Changes** section → same three actions work.
- The menu closes on Esc, on a click elsewhere, and on scroll.
- The menu never renders off-screen when right-clicking near the right/bottom edges.

- [ ] **Step 12: Manual verification (web mode)****

Run: `npm run dev`
Open the app in a browser; confirm:
- Right-click a file → the menu shows **only** Copy Relative Path and Copy Absolute Path (no "Open in File Manager").
- Both copy actions work.

- [ ] **Step 13: Commit**

```bash
git add components/FileExplorer.tsx
git commit -m "feat(files): add right-click context menu to file browser"
```
