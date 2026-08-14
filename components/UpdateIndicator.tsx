"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useUpdateStatus } from "@/hooks/useUpdateStatus";
import { useI18n } from "@/hooks/useI18n";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

/**
 * Desktop-only update indicator. A fixed-position icon at the top-right corner
 * (immediately left of the file-panel toggle) that appears when an update is
 * available, downloading, downloaded, or errored. Clicking opens a dropdown with
 * version info, a live progress bar, and a restart-and-install / retry action.
 */
export function UpdateIndicator() {
  const { t } = useI18n();
  const { status, showIndicator, currentVersion, download, install, retry } = useUpdateStatus();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  // Close on outside-pointer-down, Esc, any scroll, or window blur — same pattern
  // as components/ContextMenu.tsx. The button itself is excluded so its click can
  // toggle without the mousedown handler immediately closing the panel.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (target && panelRef.current?.contains(target)) return;
      if (target && btnRef.current?.contains(target)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("blur", close);
    };
  }, [open, close]);

  if (!showIndicator || status === null) return null;

  const color = status.state === "error" ? "#dc2626" : "var(--accent)";
  const newVersion =
    status.state === "available" || status.state === "downloading" || status.state === "downloaded"
      ? status.version
      : "";

  // Anchor the dropdown below the button, right-aligned to the button's right edge.
  const rect = btnRef.current?.getBoundingClientRect();
  const panelTop = rect ? rect.bottom + 4 : 48;
  const panelRight = rect ? window.innerWidth - rect.right : 212;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="titlebar-no-drag"
        onClick={() => setOpen((v) => !v)}
        title={t("update.title")}
        aria-label={t("update.title")}
        aria-expanded={open}
        style={{
          position: "fixed",
          top: "env(safe-area-inset-top)",
          right: "calc(env(safe-area-inset-right) + 176px)",
          zIndex: 300,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 36,
          height: 36,
          padding: 0,
          background: open ? "var(--bg-hover)" : "var(--bg-panel)",
          border: "none",
          borderLeft: "1px solid var(--border)",
          borderBottom: "1px solid var(--border)",
          color,
          cursor: "pointer",
          transition: "color 0.12s, background 0.12s",
        }}
      >
        {status.state === "downloaded" ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : status.state === "error" ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        ) : status.state === "downloading" ? (
          <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.25" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        )}
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            className="titlebar-no-drag"
            role="dialog"
            aria-label={t("update.title")}
            style={{
              position: "fixed",
              top: panelTop,
              right: panelRight,
              zIndex: 500,
              width: 248,
              padding: "12px 14px",
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              boxShadow: "0 8px 24px rgba(0,0,0,0.28)",
              color: "var(--text)",
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            {status.state === "available" && (
              <>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>
                  {t("update.available")}
                </div>
                {newVersion && (
                  <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginBottom: 4 }}>
                    v{currentVersion || "?"} → v{newVersion}
                  </div>
                )}
                <div style={{ color: "var(--text-muted)", marginBottom: 10 }}>
                  {t("update.confirmPrompt")}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => {
                      download();
                      close();
                    }}
                    style={{
                      flex: 1,
                      padding: "7px 12px",
                      borderRadius: 6,
                      border: "none",
                      background: "var(--accent)",
                      color: "#fff",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {t("update.confirmUpdate")}
                  </button>
                  <button
                    type="button"
                    onClick={close}
                    style={{
                      flex: 1,
                      padding: "7px 12px",
                      borderRadius: 6,
                      border: "1px solid var(--border)",
                      background: "var(--bg-hover)",
                      color: "var(--text)",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {t("update.cancel")}
                  </button>
                </div>
              </>
            )}

            {status.state === "downloading" && (
              <>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>
                  {t("update.downloading")}
                </div>
                <div
                  style={{
                    height: 6,
                    borderRadius: 3,
                    background: "var(--border)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.max(0, Math.min(100, status.percent))}%`,
                      background: "var(--accent)",
                      borderRadius: 3,
                      transition: "width 0.15s ease-out",
                    }}
                  />
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginTop: 6,
                    color: "var(--text-muted)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                  }}
                >
                  <span>
                    {formatBytes(status.transferred)} / {formatBytes(status.total)}
                  </span>
                  <span>{Math.round(status.percent)}%</span>
                </div>
              </>
            )}

            {status.state === "downloaded" && (
              <>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>
                  {t("update.downloaded")}
                </div>
                {newVersion && (
                  <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginBottom: 10 }}>
                    v{currentVersion || "?"} → v{newVersion}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    install();
                    close();
                  }}
                  style={{
                    width: "100%",
                    padding: "7px 12px",
                    borderRadius: 6,
                    border: "none",
                    background: "var(--accent)",
                    color: "#fff",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {t("update.install")}
                </button>
              </>
            )}

            {status.state === "error" && (
              <>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#dc2626", marginBottom: 6 }}>
                  {t("update.error")}
                </div>
                <div
                  style={{
                    color: "var(--text-muted)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    marginBottom: 10,
                    overflowWrap: "anywhere",
                  }}
                >
                  {status.message}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    retry();
                    close();
                  }}
                  style={{
                    width: "100%",
                    padding: "7px 12px",
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                    background: "var(--bg-hover)",
                    color: "var(--text)",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {t("update.retry")}
                </button>
              </>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
