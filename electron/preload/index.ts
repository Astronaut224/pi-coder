import { contextBridge, ipcRenderer } from "electron";
import type { UpdateStatus } from "../main/updater";

const api = {
  isDesktop: true as const,
  version: process.env.PI_WEB_DESKTOP_VERSION ?? "0.0.0",
  /** 打开原生目录选择框;返回选中路径或 null。 */
  selectDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke("desktop:selectDirectory"),
  /** Sync the Windows title bar overlay color to the current theme (desktop only). */
  setTitleBarColor: (hex: string) =>
    ipcRenderer.send("desktop:set-title-bar-overlay", { color: hex }),
  /** 订阅自动更新状态。 */
  onUpdateStatus: (cb: (status: UpdateStatus) => void) => {
    const handler = (_e: unknown, status: unknown) => cb(status as UpdateStatus);
    ipcRenderer.on("desktop:updateStatus", handler);
    return () => ipcRenderer.removeListener("desktop:updateStatus", handler);
  },
  /** 立即退出并安装已下载的更新。 */
  installUpdate: () => ipcRenderer.invoke("desktop:installUpdate"),
  /** 手动触发一次更新检查(用于失败后重试)。 */
  checkForUpdates: () => ipcRenderer.invoke("desktop:checkForUpdates"),
  /** 退出整个应用(含 server 子进程)。 */
  quitApp: () => ipcRenderer.send("desktop:quit"),
  /** 在系统文件管理器中显示/打开路径(桌面端)。 */
  openInFileManager: (fullPath: string, isDir: boolean) =>
    ipcRenderer.invoke("desktop:openInFileManager", fullPath, isDir),
};

contextBridge.exposeInMainWorld("piDesktop", api);

export type PiDesktopApi = typeof api;
