import { autoUpdater } from "electron-updater";
import { BrowserWindow } from "electron";

export type UpdateStatus =
  | { state: "checking" }
  | { state: "available"; version: string }
  | { state: "not-available" }
  | { state: "downloaded" }
  | { state: "error"; message: string };

// Broadcasts update status to every renderer window.
// NOTE: the renderer consumer (ipcRenderer.on "desktop:updateStatus") is a
// FUTURE enhancement — the preload (Task 5) only exposes selectDirectory today.
// Auto-update still works without it (autoDownload + autoInstallOnAppQuit).
function broadcast(status: UpdateStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("desktop:updateStatus", status);
  }
}

export function initUpdater(): void {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => broadcast({ state: "checking" }));
  autoUpdater.on("update-available", (info) =>
    broadcast({ state: "available", version: info.version ?? "" }),
  );
  autoUpdater.on("update-not-available", () => broadcast({ state: "not-available" }));
  autoUpdater.on("update-downloaded", () => broadcast({ state: "downloaded" }));
  autoUpdater.on("error", (err) => broadcast({ state: "error", message: String(err) }));
}

export function checkForUpdates(): void {
  // 静默失败:便携版/未签名/无更新源都不打断使用
  try {
    void autoUpdater.checkForUpdates();
  } catch {
    /* ignore */
  }
}
