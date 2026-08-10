# File Browser Right-Click Context Menu — Design

**Date:** 2026-08-10
**Status:** Approved

## Goal

Add a right-click context menu to items in the file browser (`FileExplorer`) with three actions:

1. **Open in system file manager** — desktop only.
2. **Copy relative path** — relative to the workspace root.
3. **Copy absolute path**.

## Scope (confirmed with user)

- The menu appears on **all items in the main file tree and in the "Changes" section** — both files and folders.
- For a **folder**, "Open in system file manager" **opens the folder to browse its contents**.
- For a **file**, "Open in system file manager" **reveals/highlights the file in its parent directory**.

## Architecture

### 1. New reusable `ContextMenu` component

**New file:** `components/ContextMenu.tsx`

There is no existing reusable context-menu / dropdown component in the codebase, so we add a small one.

- Props: `{ x: number; y: number; items: MenuItem[]; onClose: () => void }`.
- `MenuItem = { label: string; icon?: ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }`.
- Rendered with `createPortal(..., document.body)` so it is never clipped by ancestor overflow.
- Positioned absolutely at `(x, y)`, then **clamped to viewport** so it never renders off-screen.
- Closes on: outside click, `Esc`, window `scroll`/`blur`, and after any item is clicked.
- Styled with existing CSS variables used elsewhere in `FileExplorer`: `--bg-panel`, `--border`, `--bg-hover`, `--text`, `--accent`.
- Accessibility: `role="menu"`, items `role="menuitem"`, `aria-label` per item — matching the inline menus in `AppShell.tsx` / `ThemePicker.tsx`.

### 2. `FileExplorer.tsx` integration

- Add `onContextMenu` handlers to:
  - the row `<div>` in `TreeNode` (around lines 285–429), and
  - the row in `ChangeRow` (around lines 464–515).
- Each handler: `e.preventDefault()` and set menu state `{ x: e.clientX, y: e.clientY, node }`.
- Render a **single** `<ContextMenu>` at the top level of `FileExplorer`, building items from the right-clicked `node` plus the existing `cwd` prop:

  1. **Open in system file manager** — rendered only when `window.piDesktop?.isDesktop === true`. Calls `window.piDesktop.openInFileManager(node.fullPath, node.isDir)`.
  2. **Copy relative path** — `copyText(getRelativeFilePath(node.fullPath, cwd))`.
  3. **Copy absolute path** — `copyText(normalizeFilePathSlashes(node.fullPath))`.

- After a successful copy, show a transient "Copied" confirmation in the existing `aria-live` status region in `FileExplorer`, auto-clearing after ~1.5s.

### 3. Electron IPC — new channel

A single channel handles both file/folder behaviors; the split is decided in the main process.

- **`electron/main/ipc.ts`**: register
  `ipcMain.handle("desktop:openInFileManager", (_e, fullPath: string, isDir: boolean) => isDir ? shell.openPath(fullPath) : shell.showItemInFolder(fullPath))`
  with input validation (non-empty string `fullPath`; boolean `isDir`). `shell` is already imported in this area of the codebase.
- **`electron/preload/index.ts`**: add to the exposed `api`:
  `openInFileManager: (fullPath: string, isDir: boolean) => ipcRenderer.invoke("desktop:openInFileManager", fullPath, isDir)`.
  The `PiDesktopApi` type and `global.d.ts` auto-derive, so no separate type edit is needed.
- Renderer calls `window.piDesktop!.openInFileManager(node.fullPath, node.isDir)` (guarded by the desktop check above).

### 4. i18n

Add three keys to **both** `lib/i18n/messages/en.ts` and `lib/i18n/messages/zh-CN.ts` (under the existing `files.*` namespace):

| Key | en | zh-CN |
|---|---|---|
| `files.openInFileManager` | Open in File Manager | 在系统文件管理器中打开 |
| `files.copyRelativePath` | Copy Relative Path | 复制相对路径 |
| `files.copyAbsolutePath` | Copy Absolute Path | 复制绝对路径 |

A short "Copied" status string also needs an i18n key (e.g. `files.copied` — en "Copied", zh "已复制").

## Files Touched

| File | Change |
|---|---|
| `components/ContextMenu.tsx` | **NEW** — reusable context menu component |
| `components/FileExplorer.tsx` | `onContextMenu` on `TreeNode` + `ChangeRow`; render `<ContextMenu>`; copy feedback |
| `electron/main/ipc.ts` | `desktop:openInFileManager` handler |
| `electron/preload/index.ts` | `openInFileManager` preload method |
| `lib/i18n/messages/en.ts` | `files.openInFileManager`, `files.copyRelativePath`, `files.copyAbsolutePath`, `files.copied` |
| `lib/i18n/messages/zh-CN.ts` | same keys |

## Edge Cases & Error Handling

- **Web mode** (no `window.piDesktop`): the "Open in File Manager" item is hidden; both copy actions still work.
- **Absolute path** is normalized to forward slashes on Windows via `normalizeFilePathSlashes`.
- **Relative path** falls back to the full path when the item is not under `cwd` (existing `getRelativeFilePath` behavior).
- The menu is **viewport-clamped** and closes cleanly on `Esc` / outside click / scroll.
- IPC input is validated; `openInFileManager` is only ever called inside the desktop-mode guard.

## Out of Scope (YAGNI)

- Full keyboard arrow-navigation between menu items (menu is still `Esc` / outside-click closable).
- Making the existing tree rows keyboard-focusable — unrelated a11y improvement.
- Submenus / dynamically populated items.

## Verification

- Manual: right-click a file → reveal in file manager works; copy relative/absolute paths paste correctly; right-click a folder → opens the folder; in web mode the open-in-file-manager item is absent; menu closes on Esc/outside-click and never overflows the window.
- Typecheck / lint pass (`tsc`, project lint).
