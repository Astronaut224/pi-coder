"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { ResolvedTheme } from "@/lib/theme";

// ─── Types ───────────────────────────────────────────────────────────────────

type Mode = "light" | "dark";
type ToggleOrigin = { x: number; y: number };

export interface UseThemeResult {
  mode: Mode;
  themeName: string;
  isDark: boolean;
  isApplying: boolean;
  setMode(mode: Mode, origin?: ToggleOrigin): Promise<void>;
  setTheme(name: string): Promise<void>;
  toggleTheme(origin?: ToggleOrigin): Promise<void>;
  reloadTheme(): Promise<void>;
}

// ─── Storage keys ────────────────────────────────────────────────────────────

const KEY_MODE = "pi-theme-mode";
const KEY_THEME_NAME = "pi-theme-name";
const LEGACY_KEY = "pi-theme";

// Only these variables may be injected as inline styles from a JSON theme —
// anything else the API returns is ignored. Kept in sync with the variables
// produced by lib/theme.ts and consumed by app/globals.css.
const THEME_CSS_VARS = [
  "--bg",
  "--bg-panel",
  "--bg-hover",
  "--bg-selected",
  "--border",
  "--text",
  "--text-muted",
  "--text-dim",
  "--accent",
  "--accent-hover",
  "--accent-active",
  "--accent-soft",
  "--accent-soft-2",
  "--accent-border",
  "--user-bg",
  "--assistant-bg",
  "--tool-bg",
  "--bg-subtle",
] as const;

// ─── Module-level store ──────────────────────────────────────────────────────

interface ThemeStoreState {
  mode: Mode;
  themeName: string;
  isApplying: boolean;
}

const SSR_STATE: ThemeStoreState = { mode: "light", themeName: "", isApplying: false };
let storeState: ThemeStoreState = SSR_STATE;

const listeners = new Set<() => void>();

function setStoreState(next: Partial<ThemeStoreState>): void {
  storeState = { ...storeState, ...next };
  listeners.forEach((cb) => cb());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): ThemeStoreState {
  return storeState;
}

function getServerSnapshot(): ThemeStoreState {
  return SSR_STATE;
}

// ─── CSS variable application ────────────────────────────────────────────────

function applyCssVars(vars: Record<string, string>): void {
  const root = document.documentElement;
  for (const key of THEME_CSS_VARS) {
    const value = vars[key];
    if (value) {
      root.style.setProperty(key, value);
    } else {
      root.style.removeProperty(key);
    }
  }
}

function clearCssVars(): void {
  const root = document.documentElement;
  for (const key of THEME_CSS_VARS) {
    root.style.removeProperty(key);
  }
}

function setRootThemeName(name: string): void {
  if (name) {
    document.documentElement.dataset.theme = name;
  } else {
    delete document.documentElement.dataset.theme;
  }
}

// ─── Storage helpers ─────────────────────────────────────────────────────────

/** One-time migration from the legacy single key to the split keys. */
function migrateLegacyStorage(): void {
  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy === "light" || legacy === "dark") {
      if (!localStorage.getItem(KEY_MODE)) {
        localStorage.setItem(KEY_MODE, legacy);
      }
      localStorage.removeItem(LEGACY_KEY);
    }
  } catch {
    // Storage unavailable (private mode, quota) — carry on with defaults.
  }
}

function readMode(): Mode {
  try {
    const stored = localStorage.getItem(KEY_MODE);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // fall through
  }
  // The inline script in layout.tsx has already applied the .dark class before
  // hydration, so prefer the DOM as the source of truth here.
  if (typeof document !== "undefined" && document.documentElement.classList.contains("dark")) {
    return "dark";
  }
  return "light";
}

function readThemeName(): string {
  try {
    const stored = localStorage.getItem(KEY_THEME_NAME);
    if (typeof stored === "string") return stored;
  } catch {
    // fall through
  }
  return "";
}

function persistMode(mode: Mode): void {
  try {
    localStorage.setItem(KEY_MODE, mode);
  } catch {
    // ignore
  }
}

function persistThemeName(name: string): void {
  try {
    localStorage.setItem(KEY_THEME_NAME, name);
  } catch {
    // ignore
  }
}

// ─── Theme fetching (with race protection) ───────────────────────────────────

// Incremented on every fetch; a stale response whose seq no longer matches the
// current request is discarded, so a quick double-click always ends on the last
// selection and an older network response can never overwrite a newer one.
let requestSeq = 0;

async function fetchResolvedTheme(
  name: string,
  mode: Mode,
): Promise<ResolvedTheme | null> {
  if (!name) return null;

  const response = await fetch(
    `/api/themes/${encodeURIComponent(name)}?mode=${mode}`,
    { cache: "no-store" },
  );

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Failed to load theme: ${response.status}`);
  }

  return (await response.json()) as ResolvedTheme;
}

/**
 * Load a (name, mode) theme and inject it, or fall back to the built-in theme
 * if the theme is missing / corrupt / the request fails. `mySeq` is the seq at
 * call time; if the current seq has moved on, this load is a no-op.
 */
async function applyThemeSelection(name: string, mode: Mode): Promise<void> {
  if (!name) {
    clearCssVars();
    setRootThemeName("");
    setStoreState({ themeName: "", isApplying: false });
    return;
  }

  setStoreState({ isApplying: true });
  const mySeq = ++requestSeq;

  let resolved: ResolvedTheme | null;
  try {
    resolved = await fetchResolvedTheme(name, mode);
  } catch {
    if (mySeq !== requestSeq) return; // superseded — leave isApplying to the owner
    fallbackToDefault(name);
    return;
  }

  if (mySeq !== requestSeq) return; // superseded

  if (!resolved) {
    fallbackToDefault(name);
    return;
  }

  applyCssVars(resolved.cssVars);
  setRootThemeName(name);
  setStoreState({ isApplying: false });
}

/** Revert to the built-in theme: clear vars, drop the stored name, keep mode. */
function fallbackToDefault(name: string): void {
  clearCssVars();
  setRootThemeName("");
  persistThemeName("");
  console.warn(`Theme "${name}" is unavailable; reverted to the default theme.`);
  setStoreState({ themeName: "", isApplying: false });
}

// ─── Public actions ──────────────────────────────────────────────────────────

async function setTheme(name: string): Promise<void> {
  const mode = storeState.mode;
  persistThemeName(name);
  setStoreState({ themeName: name });
  await applyThemeSelection(name, mode);
}

async function reloadTheme(): Promise<void> {
  await applyThemeSelection(storeState.themeName, storeState.mode);
}

/**
 * Switch light/dark mode. The next variant's JSON theme is fetched *first*;
 * only once that resolves (or confirms a fallback) do we start the View
 * Transition and apply all DOM changes inside its callback — so the page never
 * sits half-styled mid-switch.
 */
async function setMode(next: Mode, origin?: ToggleOrigin): Promise<void> {
  const prev = storeState.mode;
  if (next === prev) return;

  const name = storeState.themeName;

  // Pre-fetch the next variant so the transition swaps straight into it.
  let cssVars: Record<string, string> | null = null;
  if (name) {
    setStoreState({ isApplying: true });
    try {
      const resolved = await fetchResolvedTheme(name, next);
      cssVars = resolved ? resolved.cssVars : null;
    } catch {
      cssVars = null;
    }
  }

  const commit = () => {
    const root = document.documentElement;
    root.classList.toggle("dark", next === "dark");
    root.dataset.themeMode = next;

    if (cssVars) {
      applyCssVars(cssVars);
      setRootThemeName(name);
    } else if (!name) {
      clearCssVars();
      setRootThemeName("");
    } else {
      // Variant (or whole theme) unavailable → fall back to built-in, keep mode.
      clearCssVars();
      setRootThemeName("");
      persistThemeName("");
    }

    persistMode(next);
    setStoreState({ mode: next, themeName: cssVars ? name : "", isApplying: false });
  };

  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const supportsVT =
    typeof document !== "undefined" &&
    typeof document.startViewTransition === "function";

  if (!supportsVT || reduceMotion) {
    commit();
    return;
  }

  const x = origin?.x ?? window.innerWidth / 2;
  const y = origin?.y ?? window.innerHeight / 2;
  const endRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  );

  const transition = document.startViewTransition(commit);
  transition.ready
    .then(() => {
      document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${endRadius}px at ${x}px ${y}px)`,
          ],
        },
        {
          duration: 450,
          easing: "cubic-bezier(0.22, 0.61, 0.36, 1)",
          pseudoElement: "::view-transition-new(root)",
        },
      );
    })
    .catch(() => {
      // Transition cancelled (e.g. another started) — DOM is already committed.
    });
}

async function toggleTheme(origin?: ToggleOrigin): Promise<void> {
  const next: Mode = storeState.mode === "dark" ? "light" : "dark";
  await setMode(next, origin);
}

// ─── Bootstrap (runs once, on first consumer mount) ──────────────────────────

let bootstrapped = false;

function bootstrap(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  migrateLegacyStorage();

  const mode = readMode();
  const name = readThemeName();

  const root = document.documentElement;
  root.classList.toggle("dark", mode === "dark");
  root.dataset.themeMode = mode;
  setRootThemeName(name);

  setStoreState({ mode, themeName: name });

  // Load the JSON theme (if any). Not awaited — the inline script has already
  // painted the correct light/dark mode, so there is no flash.
  void applyThemeSelection(name, mode);
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useTheme(): UseThemeResult {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    bootstrap();
  }, []);

  // Actions are stable module-level functions.
  return {
    mode: state.mode,
    themeName: state.themeName,
    isDark: state.mode === "dark",
    isApplying: state.isApplying,
    setMode,
    setTheme,
    toggleTheme,
    reloadTheme,
  };
}
