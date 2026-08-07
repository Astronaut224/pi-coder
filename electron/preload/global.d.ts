import type { PiDesktopApi } from "./index";

declare global {
  interface Window {
    piDesktop?: PiDesktopApi;
  }
}
