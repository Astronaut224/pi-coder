import { contextBridge, ipcRenderer } from "electron";

const api = {
  isDesktop: true as const,
  version: process.env.PI_WEB_DESKTOP_VERSION ?? "0.0.0",
  /** 打开原生目录选择框;返回选中路径或 null。 */
  selectDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke("desktop:selectDirectory"),
  /** 订阅自动更新状态(Task 13 接线)。 */
  onUpdateStatus: (cb: (status: unknown) => void) => {
    const handler = (_e: unknown, status: unknown) => cb(status);
    ipcRenderer.on("desktop:updateStatus", handler);
    return () => ipcRenderer.removeListener("desktop:updateStatus", handler);
  },
  /** 退出整个应用(含 server 子进程)。 */
  quitApp: () => ipcRenderer.send("desktop:quit"),
};

contextBridge.exposeInMainWorld("piDesktop", api);

export type PiDesktopApi = typeof api;
