import { contextBridge, ipcRenderer, webUtils } from "electron";
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
  /** 用户确认更新后触发下载(autoDownload=false 时仅此入口开始下载)。 */
  downloadUpdate: () => ipcRenderer.invoke("desktop:downloadUpdate"),
  /** 立即退出并安装已下载的更新。 */
  installUpdate: () => ipcRenderer.invoke("desktop:installUpdate"),
  /** 手动触发一次更新检查(用于失败后重试)。 */
  checkForUpdates: () => ipcRenderer.invoke("desktop:checkForUpdates"),
  /** 退出整个应用(含 server 子进程)。 */
  quitApp: () => ipcRenderer.send("desktop:quit"),
  /** 在系统文件管理器中显示/打开路径(桌面端)。 */
  openInFileManager: (fullPath: string, isDir: boolean) =>
    ipcRenderer.invoke("desktop:openInFileManager", fullPath, isDir),
  /**
   * 解析从系统文件管理器拖入的 File 对象对应的磁盘绝对路径(桌面端)。
   * 取代已弃用的 File.path,在 sandbox 渲染进程中同样可用。File 对象经
   * contextBridge 传入后其原生 backing 仍可被 webUtils 读取。返回 "" 表示
   * 该 File 并非磁盘文件(如 JS 构造的 Blob)。
   */
  getPathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return "";
    }
  },
};

contextBridge.exposeInMainWorld("piDesktop", api);

export type PiDesktopApi = typeof api;
