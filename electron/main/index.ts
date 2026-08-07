import { app, Menu } from "electron";
import { ServerManager } from "./server-manager";
import { registerIpc } from "./ipc";
import { createMainWindow, loadMainWindowUrl } from "./window";

const isDev = process.env.PI_WEB_DESKTOP_MODE === "dev";

let server: ServerManager | null = null;

app.whenReady().then(async () => {
  registerIpc();

  // 基础菜单(mac 需要应用菜单才能正常)
  if (process.platform === "darwin") {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { role: "appMenu" },
        { role: "editMenu" },
        { role: "viewMenu" },
        { role: "windowMenu" },
      ]),
    );
  }

  server = new ServerManager({
    mode: isDev ? "dev" : "standalone",
    devUrl: "http://127.0.0.1:30141",
    onLog: (line) => process.stdout.write(line),
    onUnrecoverable: () => {
      console.error("[desktop] server unrecoverable");
    },
  });

  try {
    const { url } = await server.start();
    const win = createMainWindow();
    await loadMainWindowUrl(url);
    // 临时:窗口关闭即退出(托盘逻辑在 Task 8 替换)
    win.on("close", (e) => {
      e.preventDefault();
      app.quit();
    });
  } catch (err) {
    console.error("[desktop] failed to start server:", err);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async (e) => {
  if (server) {
    e.preventDefault();
    await server.stop();
    server = null;
    app.quit();
  }
});
