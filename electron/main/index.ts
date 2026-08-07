import { app, Menu, nativeTheme, shell, type Menu as MenuType, type MenuItemConstructorOptions } from "electron";
import { ServerManager } from "./server-manager";
import { registerIpc } from "./ipc";
import { createMainWindow, loadMainWindowUrl } from "./window";
import { createTray, attachHideOnClose, markQuitting } from "./tray";
import {
  registerGlobalShortcut,
  unregisterGlobalShortcut,
  initLoginItem,
  setOpenAtLogin,
  isOpenAtLogin,
} from "./shortcuts";

const isDev = process.env.PI_WEB_DESKTOP_MODE === "dev";

let server: ServerManager | null = null;
let stopping = false;

app.whenReady().then(async () => {
  nativeTheme.themeSource = "system";
  process.env.PI_WEB_DESKTOP_VERSION = app.getVersion();
  registerIpc();

  // 跨平台应用菜单:承载"开机自动启动"开关与"退出"项(mac 也需要应用菜单)
  Menu.setApplicationMenu(buildAppMenu());

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
    initLoginItem();
    registerGlobalShortcut();
  } catch (err) {
    console.error("[desktop] failed to start server:", err);
    app.quit();
  }
});

function buildAppMenu(): MenuType {
  const isMac = process.platform === "darwin";
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" } as MenuItemConstructorOptions] : []),
    { role: "editMenu" },
    { role: "viewMenu" },
    {
      label: "窗口",
      submenu: [
        { role: "minimize" },
        {
          label: "开机自动启动",
          type: "checkbox",
          checked: isOpenAtLogin(),
          click: (item) => setOpenAtLogin(item.checked),
        },
        { type: "separator" },
        {
          label: "退出",
          // before-quit owns server.stop(); just trigger a normal quit.
          click: () => app.quit(),
        },
      ],
    },
    {
      role: "help",
      submenu: [
        {
          label: "打开项目仓库",
          click: () => {
            void shell.openExternal("https://github.com/agegr/pi-web");
          },
        },
        {
          label: "检查更新",
          enabled: false, // wired in Task 13 (electron/main/updater.ts checkForUpdates)
        },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

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

app.on("will-quit", () => {
  unregisterGlobalShortcut();
});
