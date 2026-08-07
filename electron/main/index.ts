import { app, Menu } from "electron";
import { ServerManager } from "./server-manager";
import { registerIpc } from "./ipc";
import { createMainWindow, loadMainWindowUrl } from "./window";
import { createTray, attachHideOnClose, markQuitting } from "./tray";

const isDev = process.env.PI_WEB_DESKTOP_MODE === "dev";

let server: ServerManager | null = null;
let stopping = false;

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
    createTray(server);
    attachHideOnClose(win);
  } catch (err) {
    console.error("[desktop] failed to start server:", err);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async (e) => {
  markQuitting();
  if (stopping || !server) return; // already handling, or nothing to stop → let default quit proceed
  stopping = true;
  e.preventDefault();
  try {
    await server.stop();
  } catch (err) {
    console.error("[desktop] server.stop() failed during quit:", err);
  } finally {
    server = null;
    app.quit(); // re-fire; 2nd before-quit hits the guard and returns
  }
});
