import { ipcMain, dialog, BrowserWindow, app } from "electron";

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

  ipcMain.on("desktop:quit", () => app.quit());
}
