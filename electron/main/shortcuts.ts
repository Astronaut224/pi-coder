import { app, globalShortcut } from "electron";
import Store from "electron-store";
import { getMainWindow } from "./window";

const store = new Store<{ openAtLogin?: boolean }>({
  name: "pi-web-desktop-prefs",
  defaults: { openAtLogin: false },
});

const ACCEL = process.platform === "darwin" ? "Cmd+Shift+P" : "Ctrl+Shift+P";

export function registerGlobalShortcut(): void {
  // NOTE: globalShortcut.register captures this accelerator SYSTEM-WIDE, so
  // while pi-web runs it will also intercept other apps' local Cmd/Ctrl+Shift+P
  // (e.g. VS Code's command palette). This is a known trade-off to revisit.
  const ok = globalShortcut.register(ACCEL, () => {
    const win = getMainWindow();
    if (!win) return;
    if (win.isVisible() && win.isFocused()) {
      win.hide();
    } else {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
  if (!ok) {
    console.warn("[desktop] global shortcut registration failed:", ACCEL);
  }
}

export function unregisterGlobalShortcut(): void {
  globalShortcut.unregister(ACCEL);
}

export function setOpenAtLogin(enabled: boolean): void {
  store.set("openAtLogin", enabled);
  app.setLoginItemSettings({ openAtLogin: enabled });
}

export function isOpenAtLogin(): boolean {
  return Boolean(store.get("openAtLogin"));
}

/** 初始化开机自启状态(默认关,跟随上次设置)。 */
export function initLoginItem(): void {
  app.setLoginItemSettings({ openAtLogin: Boolean(store.get("openAtLogin")) });
}
