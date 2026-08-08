import { ipcMain, dialog, BrowserWindow, app } from "electron";
import { getMainWindow } from "./window";
import { contrastSymbolColor } from "./titlebar-color";

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

  ipcMain.on("desktop:quit", () => app.quit());
}
