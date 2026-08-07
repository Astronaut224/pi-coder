import path from "node:path";
import { app, Tray, Menu, nativeImage, type BrowserWindow } from "electron";
import { getMainWindow } from "./window";

// NOTE: tray-icon-template@2x.png is a PLACEHOLDER copied from pi-web's
// icon-512.png. It is NOT a real macOS template image (true templates must be
// pure-black-on-transparent so the OS can tint them). setTemplateImage(true)
// will tint it incorrectly on macOS. Replaced with a proper template in Task 12.
//
// Quit-correctness: the close handler must let the window actually close during
// a real app quit. index.ts calls markQuitting() at the top of before-quit so
// the close handler sees it and stops intercepting.
let isQuitting = false;
let tray: Tray | null = null;

export function markQuitting(): void {
  isQuitting = true;
}

export function createTray(): Tray {
  // Resolve via app.getAppPath(): in dev this is the project root, in a packaged
  // app it is the asar root (where electron-builder packs electron/icons/*.png).
  // __dirname (dist-electron/main) cannot be used — tsc copies no non-TS assets.
  const iconPath =
    process.platform === "darwin"
      ? path.join(app.getAppPath(), "electron", "icons", "tray-icon-template@2x.png")
      : path.join(app.getAppPath(), "electron", "icons", "tray.png");
  const image = nativeImage.createFromPath(iconPath);
  if (process.platform === "darwin") image.setTemplateImage(true);

  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  tray.setToolTip("pi-web");

  const rebuildMenu = () => {
    tray!.setContextMenu(
      Menu.buildFromTemplate([
        { label: "显示主窗口", click: () => showMainWindow() },
        { label: "隐藏主窗口", click: () => getMainWindow()?.hide() },
        { type: "separator" },
        {
          label: "退出",
          click: () => {
            // before-quit owns server.shutdown; just trigger a normal quit.
            app.quit();
          },
        },
      ]),
    );
  };
  rebuildMenu();

  // 单击切换窗口可见性
  tray.on("click", () => {
    const win = getMainWindow();
    if (!win) return;
    if (win.isVisible()) {
      win.hide();
    } else {
      showMainWindow();
    }
  });

  return tray;
}

/** 把"关闭窗口"改为隐藏到托盘,并接管窗口的显示。在真正退出时放行 close。 */
export function attachHideOnClose(win: BrowserWindow): void {
  win.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

function showMainWindow(): void {
  const win = getMainWindow();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
