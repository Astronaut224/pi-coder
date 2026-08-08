import path from "node:path";
import { BrowserWindow, nativeTheme, shell } from "electron";
import Store from "electron-store";
import { initialOverlayColors } from "./titlebar-color";

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

  // 外链走系统浏览器(target=_blank / window.open)
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      void shell.openExternal(url).catch(() => {});
      return { action: "deny" };
    }
    return { action: "deny" };
  });

  // 同窗口导航守卫:仅放行 127.0.0.1(本机 standalone server),其余外链
  // (markdown 中的 <a href>、location 跳转等)交给系统浏览器,防止主窗口
  // 被导航离开 127.0.0.1 后无法返回。
  win.webContents.on("will-navigate", (e, url) => {
    try {
      if (new URL(url).hostname !== "127.0.0.1") {
        e.preventDefault();
        void shell.openExternal(url).catch(() => {});
      }
    } catch {
      e.preventDefault();
    }
  });

  win.on("resize", () => persistBounds(win));
  win.on("move", () => persistBounds(win));
  win.on("closed", () => {
    mainWindow = null;
  });

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
