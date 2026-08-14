import { ipcMain, dialog, BrowserWindow, app, shell } from "electron";
import { getMainWindow } from "./window";
import { contrastSymbolColor } from "./titlebar-color";
import { checkForUpdates, downloadUpdate, installUpdate } from "./updater";

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
  // setTitleBarOverlay only exists on win32 (and linux); the window is only
  // created with a titleBarOverlay on Windows, so guard with the same isWin
  // check as window.ts to avoid "setTitleBarOverlay is not a function" on macOS.
  ipcMain.on("desktop:set-title-bar-overlay", (event, payload: { color?: unknown }) => {
    if (process.platform !== "win32") return;
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

  // 用户在"确认更新"提示框中确认后触发下载(autoDownload=false,仅此入口开始下载)。
  ipcMain.handle("desktop:downloadUpdate", () => {
    downloadUpdate();
  });

  // 立即退出并安装已下载的更新(由渲染端"重启并安装"按钮触发)。
  // installUpdate() 会先等待 server 子进程退出,再 quitAndInstall(),避免安装器
  // 检测到残留同名进程而弹出"无法关闭应用程序"对话框。
  ipcMain.handle("desktop:installUpdate", async () => {
    await installUpdate();
  });

  // 手动触发一次更新检查(由渲染端"重试"按钮触发);错误由 updater 内部静默处理。
  ipcMain.handle("desktop:checkForUpdates", () => {
    checkForUpdates();
  });

  ipcMain.on("desktop:quit", () => app.quit());
}
