import { autoUpdater } from "electron-updater";
import { BrowserWindow, autoUpdater as electronAutoUpdater } from "electron";

export type UpdateStatus =
  | { state: "checking" }
  | { state: "available"; version: string }
  | { state: "downloading"; percent: number; transferred: number; total: number; version: string }
  | { state: "downloaded"; version: string }
  | { state: "not-available" }
  | { state: "error"; message: string };

export interface UpdaterHooks {
  /**
   * electron-updater 的 quitAndInstall() 在 setImmediate 里派发 "before-quit-for-update"
   * 后随即 app.quit()。此回调抢在 app.quit() 之前执行,用于瞬时退出主进程,跳过
   * before-quit 里 server.stop() 的最长 3s 等待。
   */
  onBeforeQuitForUpdate?: () => void;
  /**
   * 在调用 quitAndInstall()(即 spawn NSIS 安装器)之前执行,用于同步强杀并等待
   * 同名 server 子进程真正退出,确保安装器启动时已无残留的 Pi Coder.exe。
   * 这是修复"安装器提示无法关闭应用程序"bug 的关键:必须在安装器 spawn 之前
   * 让 server 子进程消失,而不是在 spawn 之后的 before-quit-for-update 里才杀。
   */
  onBeforeInstall?: () => Promise<void> | void;
}

// Broadcasts update status to every renderer window so the UI can show
// download progress and a restart-and-install action.
function broadcast(status: UpdateStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("desktop:updateStatus", status);
  }
}

let beforeInstallHook: (() => Promise<void> | void) | undefined;

export function initUpdater(hooks: UpdaterHooks = {}): void {
  // 关闭自动下载:检测到更新后仅广播 available 状态(渲染端显示下载图标),
  // 由用户在确认提示框中点击"确认更新"后才调用 downloadUpdate() 开始下载。
  autoUpdater.autoDownload = false;
  // 下载完成后若用户直接退出,仍可在退出时自动安装(此路径下 server 已通过
  // before-quit 的 server.stop() 优雅关闭,不会触发安装器的"无法关闭"问题)。
  autoUpdater.autoInstallOnAppQuit = true;

  beforeInstallHook = hooks.onBeforeInstall;

  if (hooks.onBeforeQuitForUpdate) {
    electronAutoUpdater.on("before-quit-for-update", hooks.onBeforeQuitForUpdate);
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

/**
 * 用户在"确认更新"提示框中确认后触发下载。autoDownload=false,因此只有调用本方法
 * 才会真正开始下载。下载进度与完成通过 download-progress / update-downloaded 事件广播。
 */
export function downloadUpdate(): void {
  try {
    void autoUpdater.downloadUpdate();
  } catch {
    /* 错误已通过 error 事件广播 */
  }
}

/**
 * 用户点击"重启并安装"后触发:先 await onBeforeInstall(强杀并等待 server 子进程退出),
 * 再调用 quitAndInstall()。这样 NSIS 安装器 spawn 时同名 Pi Coder.exe 已被回收,
 * 不会触发"无法关闭应用程序,请手动关闭后重试"对话框。
 */
export async function installUpdate(): Promise<void> {
  try {
    await beforeInstallHook?.();
  } catch {
    /* 即便等待失败也不要阻塞安装 */
  }
  autoUpdater.quitAndInstall();
}
