import { autoUpdater } from "electron-updater";
import { BrowserWindow } from "electron";

export type UpdateStatus =
  | { state: "checking" }
  | { state: "available"; version: string }
  | { state: "downloading"; percent: number; transferred: number; total: number; version: string }
  | { state: "downloaded"; version: string }
  | { state: "not-available" }
  | { state: "error"; message: string };

// Broadcasts update status to every renderer window so the UI can show
// download progress and a restart-and-install action.
function broadcast(status: UpdateStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("desktop:updateStatus", status);
  }
}

export function initUpdater(): void {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  let latestVersion = "";

  autoUpdater.on("checking-for-update", () => broadcast({ state: "checking" }));
  autoUpdater.on("update-available", (info) => {
    latestVersion = info.version ?? "";
    broadcast({ state: "available", version: latestVersion });
  });
  autoUpdater.on("download-progress", (p) =>
    broadcast({
      state: "downloading",
      percent: p.percent,
      transferred: p.transferred,
      total: p.total,
      version: latestVersion,
    }),
  );
  autoUpdater.on("update-downloaded", () => broadcast({ state: "downloaded", version: latestVersion }));
  autoUpdater.on("update-not-available", () => {
    latestVersion = "";
    broadcast({ state: "not-available" });
  });
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
