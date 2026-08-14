"use client";

import { useCallback, useEffect, useState } from "react";

export type UpdateStatus =
  | { state: "checking" }
  | { state: "available"; version: string }
  | {
      state: "downloading";
      percent: number;
      transferred: number;
      total: number;
      version: string;
    }
  | { state: "downloaded"; version: string }
  | { state: "not-available" }
  | { state: "error"; message: string };

/**
 * Mirrors the discriminated union in electron/main/updater.ts. Kept in sync
 * manually because the app tsconfig excludes electron/, so the real type is not
 * visible to app code.
 */

interface DesktopUpdateApi {
  isDesktop?: boolean;
  version?: string;
  onUpdateStatus?: (cb: (status: UpdateStatus) => void) => () => void;
  installUpdate?: () => Promise<unknown> | void;
  downloadUpdate?: () => Promise<unknown> | void;
  checkForUpdates?: () => Promise<unknown> | void;
}

const INDICATOR_STATES = new Set<UpdateStatus["state"]>([
  "available",
  "downloading",
  "downloaded",
  "error",
]);

function readDesktop(): DesktopUpdateApi | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { piDesktop?: DesktopUpdateApi }).piDesktop;
}

export interface UseUpdateStatusResult {
  status: UpdateStatus | null;
  showIndicator: boolean;
  currentVersion: string;
  download: () => void;
  install: () => void;
  retry: () => void;
}

export function useUpdateStatus(): UseUpdateStatusResult {
  const desktop = readDesktop();
  const isDesktop = desktop?.isDesktop === true;
  const [status, setStatus] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    if (!isDesktop) return;
    const unsubscribe = desktop?.onUpdateStatus?.((s) => setStatus(s));
    return () => {
      unsubscribe?.();
    };
  }, [isDesktop, desktop]);

  const install = useCallback(() => {
    void desktop?.installUpdate?.();
  }, [desktop]);

  const download = useCallback(() => {
    void desktop?.downloadUpdate?.();
  }, [desktop]);

  const retry = useCallback(() => {
    void desktop?.checkForUpdates?.();
  }, [desktop]);

  const showIndicator =
    isDesktop && status !== null && INDICATOR_STATES.has(status.state);

  return { status, showIndicator, currentVersion: desktop?.version ?? "", download, install, retry };
}
