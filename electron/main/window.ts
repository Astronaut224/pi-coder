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
