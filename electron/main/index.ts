import { app, Menu, nativeTheme, shell, type Menu as MenuType, type MenuItemConstructorOptions } from "electron";
import { ServerManager } from "./server-manager";
import { registerIpc } from "./ipc";
import { createMainWindow, loadMainWindowUrl, getMainWindow } from "./window";
import { createTray, attachHideOnClose, markQuitting } from "./tray";
import {
  registerGlobalShortcut,
  unregisterGlobalShortcut,
  initLoginItem,
  setOpenAtLogin,
  isOpenAtLogin,
} from "./shortcuts";
import { initUpdater, checkForUpdates } from "./updater";

const isDev = process.env.PI_WEB_DESKTOP_MODE === "dev";

let server: ServerManager | null = null;
let stopping = false;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = getMainWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

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
      createTray();
      attachHideOnClose(win);
      initLoginItem();
      registerGlobalShortcut();
      // Auto-update is a NON-CRITICAL feature: isolate init so an updater failure
      // cannot abort app startup.
      try {
        initUpdater({
          // before-quit-for-update 兜底:同步强杀 server 子进程后立即退出,跳过
          // before-quit 里 server.stop() 的最长 3s 等待,赶在 NSIS 安装器检测之前
          // 让进程消失。正常情况下 installUpdate() 的 onBeforeInstall 已先行处理。
          onBeforeQuitForUpdate: () => {
            server?.killNow();
            app.exit(0);
          },
          // 关键修复:在 quitAndInstall() spawn NSIS 安装器之前,同步强杀并等待
          // server 子进程真正退出。否则安装器启动后仍检测到残留的同名
          // Pi Coder.exe,反复弹"无法关闭应用程序,请手动关闭后重试"对话框,
          // 而此时界面与托盘里已无应用可手动关闭。
          onBeforeInstall: async () => {
            await server?.killAndWait();
          },
        });
      } catch (err) {
        console.warn("[desktop] updater init failed", err);
      }
      // 启动 5 秒后检查更新(避开启动峰值),仅打包版生效
      if (app.isPackaged) {
        setTimeout(() => checkForUpdates(), 5000);
      }
    } catch (err) {
      console.error("[desktop] failed to start server:", err);
      app.quit();
    }
  });
}

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
          accelerator: "CmdOrCtrl+Q",
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
            void shell.openExternal("https://github.com/agegr/pi-web").catch(() => {});
          },
        },
        {
          label: "检查更新",
          enabled: true, // triggers updater.checkForUpdates()
          click: () => checkForUpdates(),
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
