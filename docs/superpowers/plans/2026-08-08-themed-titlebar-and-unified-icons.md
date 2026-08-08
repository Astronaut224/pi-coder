# 主题联动标题栏 + 统一图标 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Windows title bar follow the app theme (via `titleBarOverlay`) and unify all app/window icons to `app/favicon.ico`.

**Architecture:** Two independent features. (1) Icons: a `sharp`-based script converts the 512px PNG `app/favicon.ico` into a multi-resolution `electron/icons/icon.ico`; electron-builder embeds it into the exe (→ exe/shortcut/installer/taskbar) and the same file is set as the `BrowserWindow` icon (→ runtime window). (2) Title bar: on Windows, `titleBarStyle:'hidden'` + `titleBarOverlay` overlays native caption buttons onto the app's existing themed top bar (`--bg-panel`); a new renderer→main IPC pushes the resolved `--bg-panel` color at runtime so the overlay stays in sync on every theme/mode change.

**Tech Stack:** Electron 43, electron-builder 26, Next.js 16, React 19, TypeScript, `sharp` (transitive dep via Next.js), Node test runner (`node --test` with `--experimental-strip-types`).

## Global Constraints

- Node `>=22.19.0` (engines floor). Electron tests run via `node --experimental-strip-types --test <file>` and import `.ts` via dynamic `import("./x.ts")`.
- `titleBarOverlay` / `titleBarStyle:'hidden'` are **Windows-only** (`process.platform === 'win32'`). macOS keeps its default title bar. The system-tray icon (`electron/icons/tray.png`) is unchanged.
- The color mirrored onto the title bar is the resolved CSS variable `--bg-panel` (light `#f8f8f6`, dark `#24231f`, overridden by custom JSON themes).
- `electron-builder.yml` `buildResources` is already `electron/icons`, so a file named `icon.ico` placed there is auto-embedded into the Windows exe — no `win.icon` key needed.
- No new runtime dependencies. `sharp` is already installed (transitive via Next.js); it is the only tool used for icon conversion.
- Commit after every task. Conventional-commit style (`feat(electron):`, `build(desktop):`, `style:`, etc.), matching recent history.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `scripts/generate-icons.mjs` (new) | Convert `app/favicon.ico` (512px PNG) → multi-res `electron/icons/icon.ico`. Pure-JS ICO encoder + sharp. | 1 |
| `electron/icons/icon.ico` (new, generated) | The embedded exe/shortcut/installer/taskbar icon + runtime window icon. | 1 (gen), 2 (ship) |
| `package.json` | `generate:icons` script; prepend to `build:desktop` / `build:desktop:mac`. | 2 |
| `electron-builder.yml` | Ship `electron/icons/icon.ico` via `files`. | 2 |
| `electron/main/titlebar-color.ts` (new) | Pure helpers: `parseHex`, `relativeLuminance`, `contrastSymbolColor`, `initialOverlayColors`. No `electron` import (unit-testable). | 3 |
| `electron/main/titlebar-color.test.mjs` (new) | Node tests for the color helpers. | 3 |
| `electron/main/window.ts` | Win32 `titleBarStyle`/`titleBarOverlay`/`backgroundColor` + `icon` + `title:"Pi Coder"`. | 4 |
| `electron/main/ipc.ts` | `desktop:set-title-bar-overlay` handler → `win.setTitleBarOverlay`. | 4 |
| `electron/preload/index.ts` | Expose `piDesktop.setTitleBarColor(hex)`. (`global.d.ts` derives automatically.) | 4 |
| `hooks/useTheme.ts` | `syncTitleBarOverlay()` after `applyCssVars`/`clearCssVars`. | 5 |
| `components/AppShell.tsx` | Top bar: `titlebar-drag` class + desktop caption `paddingRight`. | 5 |
| `app/globals.css` | `.titlebar-drag` drag-region rules. | 5 |

Each source file is edited in exactly one task (no cross-task conflicts on the same file).

---

## Task 1: Icon generation script + `icon.ico` artifact

**Files:**
- Create: `scripts/generate-icons.mjs`
- Create (generated output): `electron/icons/icon.ico`

**Interfaces:**
- Produces: `electron/icons/icon.ico` — a valid multi-resolution ICO (PNG-encoded entries; sizes 16/24/32/48/64/128/256). Consumed by Task 2 (shipped via `files`) and Task 4 (runtime `BrowserWindow` icon).

- [ ] **Step 1: Write `scripts/generate-icons.mjs`**

```js
// scripts/generate-icons.mjs
// Generates a multi-resolution Windows ICO from app/favicon.ico (a 512x512 PNG
// mislabeled .ico) so electron-builder can embed it into the exe. Pure-JS ICO
// encoder + sharp (already installed via Next.js) — no new dependency.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const SOURCE = path.join(root, "app", "favicon.ico");
const OUT_DIR = path.join(root, "electron", "icons");
const OUT = path.join(OUT_DIR, "icon.ico");
const SIZES = [16, 24, 32, 48, 64, 128, 256];

// Encode [{size, png}] into a valid .ico using PNG-encoded entries
// (supported by Windows Vista+ and Electron's rcedit embedding).
function encodeIco(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = icon
  header.writeUInt16LE(count, 4);

  const entries = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  for (let i = 0; i < count; i++) {
    const { size, png } = images[i];
    const o = i * 16;
    entries.writeUInt8(size >= 256 ? 0 : size, o + 0); // width  (0 means 256)
    entries.writeUInt8(size >= 256 ? 0 : size, o + 1); // height
    entries.writeUInt8(0, o + 2); // color count (0 = >=256)
    entries.writeUInt8(0, o + 3); // reserved
    entries.writeUInt16LE(1, o + 4); // color planes
    entries.writeUInt16LE(32, o + 6); // bits per pixel
    entries.writeUInt32LE(png.length, o + 8); // image size
    entries.writeUInt32LE(offset, o + 12); // image offset
    offset += png.length;
  }
  return Buffer.concat([header, entries, ...images.map((i) => i.png)]);
}

async function main() {
  const srcPng = await readFile(SOURCE);
  const meta = await sharp(srcPng).metadata();
  if (meta.width !== meta.height) {
    throw new Error(`source favicon is not square: ${meta.width}x${meta.height}`);
  }
  const images = [];
  for (const size of SIZES) {
    const png = await sharp(srcPng).resize(size, size).png().toBuffer();
    images.push({ size, png });
  }
  const ico = encodeIco(images);
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT, ico);

  // Self-validate: ICO magic (00 00 01 00) + entry count.
  const written = await readFile(OUT);
  const ok = written[0] === 0 && written[1] === 0 && written[2] === 1 && written[3] === 0;
  const entries = written.readUInt16LE(4);
  if (!ok || entries !== SIZES.length) {
    throw new Error(`generated ICO is malformed (magic ok=${ok}, entries=${entries})`);
  }
  console.log(`[generate-icons] wrote ${OUT} (${SIZES.length} sizes: ${SIZES.join(", ")})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the generator**

Run: `node scripts/generate-icons.mjs`
Expected: a line like `[generate-icons] wrote D:\workspace\pi\pi-coder\electron\icons\icon.ico (7 sizes: 16, 24, 32, 48, 64, 128, 256)` and exit code 0.

- [ ] **Step 3: Verify the produced ICO is well-formed**

Run:
```bash
node -e "const b=require('fs').readFileSync('electron/icons/icon.ico');const cnt=b.readUInt16LE(4);if(!(b[0]===0&&b[1]===0&&b[2]===1&&b[3]===0&&cnt===7))process.exit(1);console.log('icon.ico OK, entries='+cnt)"
```
Expected: `icon.ico OK, entries=7`.

- [ ] **Step 4: Commit**

```bash
git add scripts/generate-icons.mjs electron/icons/icon.ico
git commit -m "build(desktop): add icon generation script + multi-res icon.ico"
```

---

## Task 2: Wire icons into the build config

**Files:**
- Modify: `package.json` (scripts)
- Modify: `electron-builder.yml` (`files`)

**Interfaces:**
- Consumes: `electron/icons/icon.ico` (from Task 1), `scripts/generate-icons.mjs`.
- Produces: `generate:icons` npm script; `icon.ico` shipped inside the app; `build:desktop`/`build:desktop:mac` regenerate icons before packaging.

- [ ] **Step 1: Add the `generate:icons` script in `package.json`**

In the `"scripts"` object, add this line (place it next to the other `build:*` scripts, e.g. right before `"build:desktop"`):

```json
    "generate:icons": "node scripts/generate-icons.mjs",
```

- [ ] **Step 2: Prepend `generate:icons` to the two desktop build scripts**

In `package.json`, change:

```json
    "build:desktop": "npm run build:web && npm run build:electron-main && npm run assemble:server && electron-builder --win",
    "build:desktop:mac": "npm run build:web && npm run build:electron-main && npm run assemble:server && electron-builder --mac",
```

to:

```json
    "build:desktop": "npm run generate:icons && npm run build:web && npm run build:electron-main && npm run assemble:server && electron-builder --win",
    "build:desktop:mac": "npm run generate:icons && npm run build:web && npm run build:electron-main && npm run assemble:server && electron-builder --mac",
```

(`build:desktop:cn` / `build:desktop:mac:cn` call `npm run build:desktop(:mac)`, so they inherit automatically — leave them unchanged.)

- [ ] **Step 3: Ship `icon.ico` via `electron-builder.yml` `files`**

In `electron-builder.yml`, the `files:` list currently is:

```yaml
files:
  - dist-electron/**/*
  - package.json
  - electron/icons/tray.png
  - electron/icons/tray-icon-template@2x.png
  - "!**/.DS_Store"
```

Add `- electron/icons/icon.ico` so it becomes:

```yaml
files:
  - dist-electron/**/*
  - package.json
  - electron/icons/tray.png
  - electron/icons/icon.ico
  - electron/icons/tray-icon-template@2x.png
  - "!**/.DS_Store"
```

(Ships `icon.ico` inside the app so the runtime `BrowserWindow` icon — added in Task 4 — resolves from the asar. The buildResources auto-embedding of `icon.ico` into the exe is unaffected; it reads from the source tree regardless of `files`.)

- [ ] **Step 4: Validate JSON + re-run the generator through the new script**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'));console.log('package.json OK')"
npm run generate:icons
```
Expected: `package.json OK`, then the `[generate-icons] wrote ...` line, exit 0.

- [ ] **Step 5: Commit**

```bash
git add package.json electron-builder.yml
git commit -m "build(desktop): wire generate:icons into desktop builds and ship icon.ico"
```

---

## Task 3: Pure title-bar color helpers (TDD)

**Files:**
- Create: `electron/main/titlebar-color.ts`
- Test: `electron/main/titlebar-color.test.mjs`

**Interfaces:**
- Produces (consumed by Task 4):
  - `contrastSymbolColor(bgHex: string): string` — `"#000000"` on light bg, `"#ffffff"` on dark bg.
  - `initialOverlayColors(shouldUseDarkColors: boolean): { color: string; symbolColor: string }` — `{ color: "#24231f"|"#f8f8f6", symbolColor }`.
  - `parseHex(hex): {r,g,b}`, `relativeLuminance(hex): number`.

- [ ] **Step 1: Write the failing test**

Create `electron/main/titlebar-color.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./titlebar-color.ts");
}

test("parseHex parses #rrggbb, #rgb, and bare hex", async () => {
  const { parseHex } = await loadSubject();
  assert.deepEqual(parseHex("#f8f8f6"), { r: 248, g: 248, b: 246 });
  assert.deepEqual(parseHex("#fff"), { r: 255, g: 255, b: 255 });
  assert.deepEqual(parseHex("24231f"), { r: 36, g: 35, b: 31 });
});

test("parseHex rejects garbage", async () => {
  const { parseHex } = await loadSubject();
  assert.throws(() => parseHex("not-a-color"));
});

test("contrastSymbolColor: light bg -> black, dark bg -> white", async () => {
  const { contrastSymbolColor } = await loadSubject();
  assert.equal(contrastSymbolColor("#f8f8f6"), "#000000");
  assert.equal(contrastSymbolColor("#ffffff"), "#000000");
  assert.equal(contrastSymbolColor("#24231f"), "#ffffff");
  assert.equal(contrastSymbolColor("#000000"), "#ffffff");
});

test("initialOverlayColors dark/light", async () => {
  const { initialOverlayColors } = await loadSubject();
  assert.deepEqual(initialOverlayColors(true), { color: "#24231f", symbolColor: "#ffffff" });
  assert.deepEqual(initialOverlayColors(false), { color: "#f8f8f6", symbolColor: "#000000" });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --experimental-strip-types --test electron/main/titlebar-color.test.mjs`
Expected: FAIL — `Cannot find module './titlebar-color.ts'` (file does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `electron/main/titlebar-color.ts`:

```ts
// Pure helpers for the Windows titleBarOverlay color. No `electron` import so
// the module is unit-testable in plain Node.

/** Parse "#rrggbb", "#rgb", or "rrggbb" into 0-255 RGB. Throws on malformed input. */
export function parseHex(hex: string): { r: number; g: number; b: number } {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  if (!/^[0-9a-fA-F]{6}$/.test(h)) {
    throw new Error(`parseHex: expected #rrggbb / #rgb, got "${hex}"`);
  }
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** Perceptual luminance (ITU-R BT.601), normalized to 0..1. */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** Caption-button symbol color that stays readable on the given overlay bg. */
export function contrastSymbolColor(bgHex: string): string {
  return relativeLuminance(bgHex) >= 0.5 ? "#000000" : "#ffffff";
}

/** Initial overlay colors before the renderer pushes the resolved theme color. */
export function initialOverlayColors(
  shouldUseDarkColors: boolean,
): { color: string; symbolColor: string } {
  const color = shouldUseDarkColors ? "#24231f" : "#f8f8f6";
  return { color, symbolColor: contrastSymbolColor(color) };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --experimental-strip-types --test electron/main/titlebar-color.test.mjs`
Expected: PASS — 4 tests pass, exit 0.

- [ ] **Step 5: Confirm electron tsc still clean (new file picked up)**

Run: `npx tsc --noEmit -p electron/tsconfig.json`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add electron/main/titlebar-color.ts electron/main/titlebar-color.test.mjs
git commit -m "feat(electron): add pure title-bar overlay color helpers + tests"
```

---

## Task 4: Native window overlay + IPC + preload bridge

**Files:**
- Modify: `electron/main/window.ts` (imports + `new BrowserWindow({...})` options)
- Modify: `electron/main/ipc.ts` (new handler + imports)
- Modify: `electron/preload/index.ts` (add `setTitleBarColor`)

**Interfaces:**
- Consumes: `initialOverlayColors`, `contrastSymbolColor` (Task 3); `electron/icons/icon.ico` (Task 1).
- Produces: `piDesktop.setTitleBarColor(hex)` in the renderer bridge; IPC channel `desktop:set-title-bar-overlay` accepting `{ color: string }`.

- [ ] **Step 1: Update `electron/main/window.ts` imports**

At the top, change:

```ts
import path from "node:path";
import { BrowserWindow, shell } from "electron";
import Store from "electron-store";
```

to:

```ts
import path from "node:path";
import { BrowserWindow, nativeTheme, shell } from "electron";
import Store from "electron-store";
import { initialOverlayColors } from "./titlebar-color";
```

- [ ] **Step 2: Replace the `new BrowserWindow({...})` options block**

In `createMainWindow()`, replace this block:

```ts
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
```

with:

```ts
  const isWin = process.platform === "win32";
  // Initial overlay/bg color before the renderer pushes the resolved --bg-panel.
  const overlay = initialOverlayColors(nativeTheme.shouldUseDarkColors);
  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 720,
    minHeight: 500,
    show: false,
    autoHideMenuBar: isWin,
    title: "Pi Coder",
    icon: path.join(__dirname, "..", "..", "electron", "icons", "icon.ico"),
    backgroundColor: overlay.color,
    // Windows: hide the OS title bar and overlay the native caption buttons onto
    // the app's themed top bar. The renderer pushes the resolved --bg-panel color
    // at runtime via the `desktop:set-title-bar-overlay` IPC.
    ...(isWin
      ? {
          titleBarStyle: "hidden" as const,
          titleBarOverlay: {
            color: overlay.color,
            symbolColor: overlay.symbolColor,
            height: 36,
          },
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
```

- [ ] **Step 3: Add the IPC handler in `electron/main/ipc.ts`**

Change the top imports:

```ts
import { ipcMain, dialog, BrowserWindow, app } from "electron";
```

to:

```ts
import { ipcMain, dialog, BrowserWindow, app } from "electron";
import { getMainWindow } from "./window";
import { contrastSymbolColor } from "./titlebar-color";
```

Then inside `registerIpc()`, after the existing `desktop:selectDirectory` handler and before `ipcMain.on("desktop:quit", ...)`, add:

```ts
  // Renderer pushes the resolved --bg-panel so the Windows titleBarOverlay
  // recolors with the active theme / light-dark mode.
  ipcMain.on("desktop:set-title-bar-overlay", (event, payload: { color?: unknown }) => {
    const color = typeof payload?.color === "string" ? payload.color : undefined;
    if (!color) return;
    const win = BrowserWindow.fromWebContents(event.sender) ?? getMainWindow();
    win?.setTitleBarOverlay({ color, symbolColor: contrastSymbolColor(color) });
  });
```

- [ ] **Step 4: Expose `setTitleBarColor` in the preload bridge**

In `electron/preload/index.ts`, add this entry to the `api` object (e.g. after `selectDirectory`):

```ts
  /** Sync the Windows title bar overlay color to the current theme (desktop only). */
  setTitleBarColor: (hex: string) =>
    ipcRenderer.send("desktop:set-title-bar-overlay", { color: hex }),
```

(`PiDesktopApi = typeof api` updates automatically; `electron/preload/global.d.ts` derives `Window.piDesktop` from it — no separate edit.)

- [ ] **Step 5: Type-check the electron scope**

Run: `npx tsc --noEmit -p electron/tsconfig.json`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add electron/main/window.ts electron/main/ipc.ts electron/preload/index.ts
git commit -m "feat(electron): Windows titleBarOverlay + runtime theme-sync IPC"
```

---

## Task 5: Renderer integration — push theme color + drag region + caption space

**Files:**
- Modify: `hooks/useTheme.ts` (add `syncTitleBarOverlay`, call it from `applyCssVars`/`clearCssVars`)
- Modify: `components/AppShell.tsx` (top bar class + caption padding + desktop flag)
- Modify: `app/globals.css` (`.titlebar-drag` rules)

**Interfaces:**
- Consumes: `piDesktop.setTitleBarColor(hex)` (Task 4); CSS var `--bg-panel`.
- Produces: themed, draggable title bar; caption-button space reserved on the right.

- [ ] **Step 1: Add `syncTitleBarOverlay` in `hooks/useTheme.ts`**

Immediately after the `setRootThemeName` function (after line 112, before the `// ─── Storage helpers` comment), insert:

```ts
// ─── Desktop title bar sync ──────────────────────────────────────────────────

interface DesktopTitleBarBridge {
  isDesktop?: true;
  setTitleBarColor?: (hex: string) => void;
}

/** Push the resolved --bg-panel color to the native Windows titleBarOverlay. */
function syncTitleBarOverlay(): void {
  const desktop = (window as unknown as { piDesktop?: DesktopTitleBarBridge }).piDesktop;
  if (!desktop?.isDesktop) return;
  const color = getComputedStyle(document.documentElement)
    .getPropertyValue("--bg-panel")
    .trim();
  if (color) desktop.setTitleBarColor?.(color);
}
```

- [ ] **Step 2: Call `syncTitleBarOverlay()` from both variable appliers**

In `applyCssVars`, add the call before the closing brace:

```ts
function applyCssVars(vars: Record<string, string>): void {
  const root = document.documentElement;
  for (const key of THEME_CSS_VARS) {
    const value = vars[key];
    if (value) {
      root.style.setProperty(key, value);
    } else {
      root.style.removeProperty(key);
    }
  }
  syncTitleBarOverlay();
}
```

In `clearCssVars`, add the call before the closing brace:

```ts
function clearCssVars(): void {
  const root = document.documentElement;
  for (const key of THEME_CSS_VARS) {
    root.style.removeProperty(key);
  }
  syncTitleBarOverlay();
}
```

(This covers all paths: `setMode` and `bootstrap` both route through `applyCssVars`/`clearCssVars`, so initial load, theme switch, and light/dark toggle all sync.)

- [ ] **Step 3: Add the desktop flag + caption constant in `components/AppShell.tsx`**

Near the top of the file (after the imports, at module scope), add:

```ts
/** Reserved right-side space for the Windows caption buttons (≈ 3 × 46px). */
const DESKTOP_CAPTION_WIDTH = 140;
```

Inside the `AppShell` component body (near the other `useState`/`useEffect` hooks), add a client-only desktop flag to avoid SSR hydration mismatch:

```ts
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    setIsDesktop(
      (window as unknown as { piDesktop?: { isDesktop?: boolean } }).piDesktop?.isDesktop === true,
    );
  }, []);
```

(`useState` and `useEffect` are already imported on line 3 of `AppShell.tsx` — `import { useState, useCallback, useRef, useEffect } from "react";` — so no import change is needed.)

- [ ] **Step 4: Make the top bar a drag region + reserve caption space**

In the top bar `<div ref={topBarRef} style={{...}}>` (currently around line 891), add a `className` and a `paddingRight`. Change:

```tsx
        <div ref={topBarRef} style={{ display: "flex", alignItems: "center", flexShrink: 0, borderBottom: "1px solid var(--border)", height: "calc(36px + env(safe-area-inset-top))", paddingTop: "env(safe-area-inset-top)", background: "var(--bg-panel)" }}>
```

to:

```tsx
        <div
          ref={topBarRef}
          className={isDesktop ? "titlebar-drag" : undefined}
          style={{
            display: "flex",
            alignItems: "center",
            flexShrink: 0,
            borderBottom: "1px solid var(--border)",
            height: "calc(36px + env(safe-area-inset-top))",
            paddingTop: "env(safe-area-inset-top)",
            paddingRight: isDesktop ? `${DESKTOP_CAPTION_WIDTH}px` : undefined,
            background: "var(--bg-panel)",
          }}
        >
```

(The `paddingRight` pushes the right-aligned session-info button left of the caption buttons; `titlebar-drag` makes the bar draggable while its buttons stay clickable via the CSS rule in Step 5.)

- [ ] **Step 5: Add `.titlebar-drag` rules to `app/globals.css`**

Append to `app/globals.css`:

```css
/* Electron Windows titleBarOverlay: the app's top bar is the window drag region;
   interactive controls inside it stay clickable. No-op in regular browsers. */
.titlebar-drag {
  -webkit-app-region: drag;
}
.titlebar-drag button,
.titlebar-drag a,
.titlebar-drag [role="button"],
.titlebar-drag input,
.titlebar-drag select,
.titlebar-drag textarea {
  -webkit-app-region: no-drag;
}
```

- [ ] **Step 6: Type-check + lint**

Run:
```bash
npx tsc --noEmit -p tsconfig.json
npx eslint hooks/useTheme.ts components/AppShell.tsx app/globals.css
```
Expected: 0 errors. (Pre-existing warnings elsewhere are unaffected.)

- [ ] **Step 7: Commit**

```bash
git add hooks/useTheme.ts components/AppShell.tsx app/globals.css
git commit -m "feat(desktop): sync title bar to theme + make top bar the drag region"
```

---

## Task 6: Integration build + verification

**Files:** none (verification only; commit only if a fix is needed).

- [ ] **Step 1: Run the full Windows desktop build (CN mirror)**

Run: `npm run build:desktop:cn`
Expected: all of `generate:icons → build:web → build:electron-main → assemble:server → electron-builder --win` succeed; exit 0.

- [ ] **Step 2: Verify icons were embedded (not the default Electron icon)**

Capture the build output, then grep for the icon-warning and target lines:

```bash
npm run build:desktop:cn 2>&1 | tee build-desktop.log
grep -E "default Electron icon is used|building target=(nsis|portable)" build-desktop.log
rm build-desktop.log
```

Expected: grep prints two `building target=` lines (nsis + portable) and **no** `default Electron icon is used` line. If the default-icon warning still appears, `electron/icons/icon.ico` is missing or malformed — re-run `npm run generate:icons`, confirm Task 1 Step 3 passes, then rebuild.

(`build-desktop.log` is a throwaway capture, deleted in the same command — do not commit it.)

- [ ] **Step 3: Confirm the packaged exe + installers exist**

Run:
```bash
cd release && for f in "Pi Coder Setup 0.87.1.exe" "Pi Coder-0.87.1-portable.exe"; do [ -f "$f" ] && echo "OK: $f" || echo "MISSING: $f"; done
```
Expected: two `OK:` lines.

- [ ] **Step 4: Run the electron unit test + both type-checks**

Run:
```bash
node --experimental-strip-types --test electron/main/titlebar-color.test.mjs
npx tsc --noEmit -p electron/tsconfig.json
npx tsc --noEmit -p tsconfig.json
```
Expected: 4 tests pass; 0 type errors in both scopes.

- [ ] **Step 5: Manual checklist on Windows (run the packaged app)**

Launch `release/win-unpacked/Pi Coder.exe` (or the installer). Verify by eye:

- [ ] Title bar background = app `--bg-panel` color (not white/system).
- [ ] Min/Max/Close caption buttons visible; their symbols are readable (dark on light theme, light on dark theme).
- [ ] Dragging the top bar moves the window; top-bar buttons (sidebar toggle, theme, palette, language, session info) remain clickable.
- [ ] Toggle light/dark → title bar recolors in real time.
- [ ] Apply a custom JSON theme → title bar takes that theme's `--bg-panel`.
- [ ] The session-info button (tokens/cost/context, top-right) is **not** hidden behind the caption buttons.
- [ ] No white flash on startup.
- [ ] Taskbar icon, Alt+Tab icon, window icon, exe icon, desktop shortcut icon, and installer icon are all the favicon.

If all pass, the feature is complete. If a manual item fails, file a fix as a follow-up commit referencing this task.

---

## Self-Review Notes (plan author)

- **Spec coverage:** Task 1–2 = spec §4.2 (icons). Task 3–5 = spec §4.1 (title bar: 4.1.1 window → Task 4; 4.1.2 IPC → Task 4; 4.1.3 renderer push → Task 5; 4.1.4 drag/padding → Task 5). Task 6 = spec §5 verification. macOS-out-of-scope and tray-unchanged respected (no edits to `tray.ts`/`tray.png`; win32-only branching in `window.ts`).
- **Placeholder scan:** none — every code step contains full code.
- **Type consistency:** `contrastSymbolColor`/`initialOverlayColors` (Task 3) consumed with identical names in Task 4; IPC payload shape `{ color: string }` matches preload (`{ color: hex }`) and handler (`payload.color`); `setTitleBarColor` name identical in preload (Task 4) and renderer (Task 5).
