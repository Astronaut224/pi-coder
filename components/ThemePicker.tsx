"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { ThemeSetInfo } from "@/lib/theme";

interface ThemePickerProps {
  /** Currently selected theme-set name ("" = built-in default). */
  currentThemeName: string;
  /** True while a theme request is in flight — disables repeated selection. */
  isApplying: boolean;
  /** Called with the chosen base name (or "" for the default theme). */
  onSelect: (name: string) => void;
}

type LoadState = "loading" | "ready" | "error";

/**
 * Dropdown menu content for choosing a JSON theme. Mounted only while the
 * theme panel is open, so the list is re-fetched (and thus refreshed) every
 * time the menu opens — newly dropped theme files show up without a reload.
 *
 * Renders inside AppShell's shared top-bar dropdown container; it does not
 * manage its own positioning or open/close state.
 */
export function ThemePicker({ currentThemeName, isApplying, onSelect }: ThemePickerProps) {
  const { t } = useI18n();
  const [themes, setThemes] = useState<ThemeSetInfo[]>([]);
  const [state, setState] = useState<LoadState>("loading");

  const load = useCallback(() => {
    let cancelled = false;
    setState("loading");
    fetch("/api/themes", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = (await response.json()) as { themeSets?: ThemeSetInfo[] };
        if (cancelled) return;
        setThemes(data.themeSets ?? []);
        setState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setThemes([]);
        setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(), [load]);

  const variantLabel = (s: ThemeSetInfo): string => {
    if (s.hasDark && s.hasLight) return t("theme.bothVariants");
    if (s.hasDark) return t("theme.darkOnly");
    if (s.hasLight) return t("theme.lightOnly");
    return t("theme.bothVariants");
  };

  const itemStyle = (active: boolean): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    width: "100%",
    minHeight: 34,
    padding: "5px 10px",
    border: "none",
    borderRadius: 4,
    background: active ? "var(--bg-selected)" : "transparent",
    color: "var(--text)",
    cursor: isApplying ? "wait" : "pointer",
    textAlign: "left",
    fontSize: 12,
    transition: "background 0.1s",
    opacity: isApplying ? 0.7 : 1,
  });

  return (
    <div
      role="menu"
      aria-label={t("theme.choose")}
      style={{
        background: "var(--bg-panel)",
        borderLeft: "1px solid var(--border)",
        borderRight: "1px solid var(--border)",
        borderBottom: "1px solid var(--border)",
        overflow: "hidden",
        padding: 4,
      }}
    >
      {/* Built-in default theme */}
      <button
        type="button"
        role="menuitemradio"
        aria-checked={!currentThemeName}
        disabled={isApplying}
        onClick={() => onSelect("")}
        onMouseEnter={(e) => {
          if (currentThemeName && !isApplying) e.currentTarget.style.background = "var(--bg-hover)";
        }}
        onMouseLeave={(e) => {
          if (currentThemeName) e.currentTarget.style.background = "transparent";
        }}
        style={itemStyle(!currentThemeName)}
      >
        <span style={{ fontWeight: !currentThemeName ? 600 : 400 }}>{t("theme.default")}</span>
        {!currentThemeName && <CheckIcon />}
      </button>

      {state === "ready" && themes.length > 0 && (
        <div
          style={{
            padding: "6px 10px 3px",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: "var(--text-dim)",
          }}
        >
          {t("theme.available")}
        </div>
      )}

      {state === "ready" &&
        themes.map((theme) => {
          const active = currentThemeName === theme.name;
          return (
            <button
              key={theme.name}
              type="button"
              role="menuitemradio"
              aria-checked={active}
              disabled={isApplying}
              onClick={() => onSelect(theme.name)}
              onMouseEnter={(e) => {
                if (!active && !isApplying) e.currentTarget.style.background = "var(--bg-hover)";
              }}
              onMouseLeave={(e) => {
                if (!active) e.currentTarget.style.background = "transparent";
              }}
              style={itemStyle(active)}
            >
              <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span style={{ fontWeight: active ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {theme.displayName}
                </span>
                <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{variantLabel(theme)}</span>
              </span>
              {active && <CheckIcon />}
            </button>
          );
        })}

      {state === "ready" && themes.length === 0 && (
        <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
          {t("theme.noCustomThemes")}
        </div>
      )}

      {state === "loading" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", fontSize: 12, color: "var(--text-muted)" }}>
          <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.25" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          {t("i18n.loading")}
        </div>
      )}

      {state === "error" && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 10px", fontSize: 12, color: "#dc2626" }}>
          <span>{t("theme.loadFailed")}</span>
          <button
            type="button"
            onClick={load}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 4,
              padding: "2px 8px",
              background: "transparent",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 11,
            }}
          >
            {t("theme.reload")}
          </button>
        </div>
      )}
    </div>
  );
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--accent)"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
