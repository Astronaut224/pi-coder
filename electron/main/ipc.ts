import { ipcMain, dialog, BrowserWindow, app, shell } from "electron";
import { autoUpdater } from "electron-updater";
import { getMainWindow } from "./window";
import { contrastSymbolColor } from "./titlebar-color";
import { checkForUpdates } from "./updater";

/** 注册所有桌面端 IPC handler。 */
export function registerIpc(): void {
  ipcMain.handle("desktop:selectDirectory", async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // Renderer pushes the resolved --bg-panel so the Windows titleBarOverlay
  // recolors with the active theme / light-dark mode.
  ipcMain.on("desktop:set-title-bar-overlay", (event, payload: { color?: unknown }) => {
    const color = typeof payload?.color === "string" ? payload.color : undefined;
    if (!color) return;
    const win = BrowserWindow.fromWebContents(event.sender) ?? getMainWindow();
    if (!win || win.isDestroyed()) return;
    win.setTitleBarOverlay({ color, symbolColor: contrastSymbolColor(color) });
  });

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

  // 立即退出并安装已下载的更新(由渲染端"重启并安装"按钮触发)。
  ipcMain.handle("desktop:installUpdate", () => {
    autoUpdater.quitAndInstall();
  });

  // 手动触发一次更新检查(由渲染端"重试"按钮触发);错误由 updater 内部静默处理。
  ipcMain.handle("desktop:checkForUpdates", () => {
    checkForUpdates();
  });

  ipcMain.on("desktop:quit", () => app.quit());
}
