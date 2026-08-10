import { autoUpdater } from "electron-updater";
import { BrowserWindow, autoUpdater as electronAutoUpdater } from "electron";

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

export function initUpdater(onBeforeQuitForUpdate?: () => void): void {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // electron-updater 的 quitAndInstall() 先 spawn NSIS 安装器,再在 setImmediate 里
  // emit "before-quit-for-update" 然后 app.quit()。我们抢在这个 app.quit() 之前:
  // 同步强杀同名 server 子进程并瞬时 app.exit(0)。否则主进程会被 before-quit 里
  // server.stop() 的最长 3s await 卡住,安装器据此检测到存活的 Pi Coder.exe,
  // 反复弹"无法关闭"对话框并卡住自动更新。该事件由 electron-updater 派发在
  // Electron 内置的 autoUpdater(EventEmitter)上,而非 electron-updater 实例。
  if (onBeforeQuitForUpdate) {
    electronAutoUpdater.on("before-quit-for-update", onBeforeQuitForUpdate);
  }

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
