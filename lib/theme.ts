/**
 * Server-side JSON theme loader for pi-web.
 *
 * Reads pi CLI theme JSON files from a single fixed directory
 * (`~/.pi/agent/themes/`), resolves `vars` references and ANSI 256-color
 * indices, pairs `-dark` / `-light` variants into theme sets, and maps the
 * result onto pi-web's CSS custom properties.
 *
 * SECURITY CONTRACT
 * -----------------
 * This module is the only place that touches the filesystem for themes.
 * - It reads exactly one directory: `join(homedir(), ".pi", "agent", "themes")`.
 * - Theme names are validated against a strict whitelist before any file access.
 * - It never treats a name as a path, never accepts a client-supplied `cwd`,
 *   and never falls back to reading an arbitrary file path.
 * - Only `.json` regular files are read; symlinks are skipped; oversized files
 *   are skipped; a single corrupt file never aborts a listing.
 * - Color values are normalized to 6-digit hex (or rgba() for the soft tints).
 *   Unrecognized strings are dropped — never passed through into CSS — so
 *   `url(...)`, `var(...)`, `;`, etc. cannot reach the inline style payload.
 *
 * Adapted from the reference implementation at
 * https://github.com/isWittHere/pi-web-desktop (MIT). The color math is reused;
 * the public API, file scanning, color whitelist, and CSS-variable mapping were
 * rewritten to fit pi-web and the security requirements above.
 */

import { readFileSync, readdirSync, existsSync, lstatSync } from "fs";
import { join, basename, extname } from "path";
import { homedir } from "os";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PiTheme {
  name: string;
  vars?: Record<string, string | number>;
  colors: Record<string, string | number>;
}

/** A paired theme set (e.g. "gruvbox" with dark + light variants). */
export interface ThemeSetInfo {
  /** Base name (e.g. "gruvbox") — the stable identifier clients select on. */
  name: string;
  /** Human-readable display name. */
  displayName: string;
  /** Whether this set has a dark variant. */
  hasDark: boolean;
  /** Whether this set has a light variant. */
  hasLight: boolean;
  /** Always false here — the built-in theme has no JSON files. */
  builtin: boolean;
}

/** A resolved, ready-to-use theme (one variant of a set). */
export interface ResolvedTheme {
  /** Base theme-set name. */
  name: string;
  /** Whether this specific variant is dark (derived from bg0 luminance). */
  isDark: boolean;
  /** CSS variable name → value (hex or rgba()). */
  cssVars: Record<string, string>;
}

export type ThemeVariant = "dark" | "light";

// ─── Theme directory (the only one this module ever reads) ───────────────────

function themesDir(): string {
  return join(homedir(), ".pi", "agent", "themes");
}

/** Max bytes of a single theme JSON file we are willing to parse. */
const MAX_THEME_FILE_BYTES = 256 * 1024;

// ─── Safe theme-name validation ──────────────────────────────────────────────

/**
 * A theme name is the base identifier clients select on (no extension, no
 * variant suffix). It must be safe to interpolate into a filename, so we allow
 * only: leading alphanumeric, then alphanumeric / underscore / hyphen, 1–64
 * chars total. This rejects `..`, `/`, `\`, `:`, `.`, spaces, and empty strings.
 */
const SAFE_THEME_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function isSafeThemeName(name: string): boolean {
  return typeof name === "string" && SAFE_THEME_NAME.test(name);
}

// ─── ANSI 256-color palette → hex ────────────────────────────────────────────

// Standard xterm 256-color palette. 0-15: ANSI, 16-231: 6x6x6 cube, 232-255: grayscale.
const ANSI_BASIC: Record<number, string> = {
  0: "#000000", 1: "#800000", 2: "#008000", 3: "#808000",
  4: "#000080", 5: "#800080", 6: "#008080", 7: "#c0c0c0",
  8: "#808080", 9: "#ff0000", 10: "#00ff00", 11: "#ffff00",
  12: "#0000ff", 13: "#ff00ff", 14: "#00ffff", 15: "#ffffff",
};

function ansiToHex(code: number): string {
  if (code in ANSI_BASIC) return ANSI_BASIC[code];

  // 16-231: 6×6×6 RGB cube
  if (code >= 16 && code <= 231) {
    const n = code - 16;
    const r = Math.round((Math.floor(n / 36) % 6) * (255 / 5));
    const g = Math.round((Math.floor(n / 6) % 6) * (255 / 5));
    const b = Math.round((n % 6) * (255 / 5));
    return rgbToHex(r, g, b);
  }

  // 232-255: grayscale ramp
  if (code >= 232 && code <= 255) {
    const v = Math.round(((code - 232) / 23) * 255);
    return rgbToHex(v, v, v);
  }

  return "#000000";
}

// ─── Color resolution (strict whitelist) ─────────────────────────────────────

/**
 * Resolve a single color value to a normalized 6-digit hex string.
 *
 * Accepted:
 *   "#rrggbb"          → lowercased
 *   "#rgb"             → expanded to "#rrggbb"
 *   "rrggbb"           → prefixed and lowercased
 *   "rgb"              → expanded
 *   242 / "242"        → ANSI 256-color index → hex (0–255 only)
 *   "varName"          → looked up in `vars` (already-resolved hex)
 *
 * Anything else (including url(), var(), ";", unknown words) returns "" so the
 * mapping layer can substitute a safe default. Nothing unrecognized is ever
 * passed through into CSS.
 */
function resolveColor(
  value: string | number | undefined | null,
  vars: Record<string, string>,
): string {
  if (value === undefined || value === null) return "";

  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 && value <= 255
      ? ansiToHex(value)
      : "";
  }

  const trimmed = String(value).trim();
  if (trimmed === "") return "";

  // 6-digit hex, optional leading #
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase();
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) return `#${trimmed.toLowerCase()}`;

  // 3-digit hex, optional leading #
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`.toLowerCase();
  }
  if (/^[0-9a-fA-F]{3}$/.test(trimmed)) {
    return `#${trimmed[0]}${trimmed[0]}${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}`.toLowerCase();
  }

  // Variable reference into the already-resolved palette
  if (vars[trimmed]) return vars[trimmed];

  // Bare ANSI index as a string: "242"
  if (/^\d{1,3}$/.test(trimmed)) {
    const code = Number(trimmed);
    if (code >= 0 && code <= 255) return ansiToHex(code);
  }

  return "";
}

/** Resolve all `vars` entries to hex strings (vars hold raw colors, no cross-refs). */
function resolveVars(
  vars: Record<string, string | number> | undefined,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  if (!vars) return resolved;
  for (const [key, value] of Object.entries(vars)) {
    const hex = resolveColor(value, {});
    if (hex) resolved[key] = hex;
  }
  return resolved;
}

/** Resolve all `colors` entries, expanding var references against the palette. */
function resolveColors(
  colors: Record<string, string | number>,
  vars: Record<string, string>,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(colors)) {
    resolved[key] = resolveColor(value, vars);
  }
  return resolved;
}

// ─── Color manipulation helpers ─────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(hex);
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${clamp(r).toString(16).padStart(2, "0")}${clamp(g).toString(16).padStart(2, "0")}${clamp(b).toString(16).padStart(2, "0")}`;
}

/** Lighten a hex color by mixing with white. factor 0 = no change, 1 = white. */
function lighten(hex: string, factor: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const [r, g, b] = rgb;
  return rgbToHex(
    r + (255 - r) * factor,
    g + (255 - g) * factor,
    b + (255 - b) * factor,
  );
}

/** Darken a hex color by mixing with black. factor 0 = no change, 1 = black. */
function darken(hex: string, factor: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const [r, g, b] = rgb;
  return rgbToHex(r * (1 - factor), g * (1 - factor), b * (1 - factor));
}

/** Mix two hex colors. factor 0 = all a, factor 1 = all b. */
function mix(a: string, b: string, factor: number): string {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  if (!ra || !rb) return a || b || "#000000";
  return rgbToHex(
    ra[0] + (rb[0] - ra[0]) * factor,
    ra[1] + (rb[1] - ra[1]) * factor,
    ra[2] + (rb[2] - ra[2]) * factor,
  );
}

/** Relative luminance (0–1). Used to decide dark vs light. */
function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0.5;
  const [rs, gs, bs] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

// ─── File-name convention helpers ────────────────────────────────────────────

/**
 * Detect the base name and variant from a theme filename.
 *   gruvbox-dark.json  → { base: "gruvbox", variant: "dark" }
 *   gruvbox-light.json → { base: "gruvbox", variant: "light" }
 *   monokai.json       → { base: "monokai", variant: null }
 */
function parseThemeFilename(
  filename: string,
): { base: string; variant: ThemeVariant | null } {
  const stem = basename(filename, extname(filename));

  const darkMatch = /^(.+)-dark$/i.exec(stem);
  if (darkMatch) return { base: darkMatch[1], variant: "dark" };

  const lightMatch = /^(.+)-light$/i.exec(stem);
  if (lightMatch) return { base: lightMatch[1], variant: "light" };

  return { base: stem, variant: null };
}

/** Convert a kebab-case theme name to a display-friendly title. */
function themeNameToDisplay(name: string): string {
  return name
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ─── File parsing & scanning ─────────────────────────────────────────────────

/**
 * Parse one theme JSON file. Validates the required shape; returns null on any
 * error so a single bad file is silently skipped rather than failing the whole
 * listing.
 */
function parseThemeFile(path: string): PiTheme | null {
  try {
    const raw = readFileSync(path, "utf-8");
    const json = JSON.parse(raw) as unknown;

    if (!json || typeof json !== "object") return null;
    const obj = json as Record<string, unknown>;

    if (typeof obj.name !== "string" || !obj.name) return null;
    if (!obj.colors || typeof obj.colors !== "object") return null;

    return {
      name: obj.name,
      vars: obj.vars as Record<string, string | number> | undefined,
      colors: obj.colors as Record<string, string | number>,
    };
  } catch {
    return null;
  }
}

interface ScannedFile {
  base: string;
  variant: ThemeVariant;
  isDark: boolean;
}

/**
 * Scan the (single) theme directory. Skips non-`.json` entries, symlinks
 * (lstat does not follow them), oversized files, unsafe base names, and any
 * file that fails to parse. Never throws.
 */
function scanThemeDir(dir: string): ScannedFile[] {
  const results: ScannedFile[] = [];

  let entries: string[];
  try {
    if (!existsSync(dir)) return results;
    entries = readdirSync(dir);
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (extname(entry).toLowerCase() !== ".json") continue;

    const fullPath = join(dir, entry);

    let stat;
    try {
      stat = lstatSync(fullPath);
    } catch {
      continue;
    }
    // lstat.isFileSync() is false for symlinks and directories → both skipped.
    if (!stat.isFile()) continue;
    if (stat.size > MAX_THEME_FILE_BYTES) continue;

    const parsed = parseThemeFilename(entry);
    if (!isSafeThemeName(parsed.base)) continue;

    const theme = parseThemeFile(fullPath);
    if (!theme) continue;

    const vars = resolveVars(theme.vars);
    const bg0 = vars.bg0 || "#1a1a1a";
    const isDark = relativeLuminance(bg0) < 0.5;
    const variant = parsed.variant ?? (isDark ? "dark" : "light");

    results.push({ base: parsed.base, variant, isDark });
  }

  return results;
}

// ─── pi CLI token → CSS variable mapping ────────────────────────────────────

/**
 * Map resolved pi CLI theme colors + palette vars onto pi-web's CSS custom
 * properties. Produces exactly the variables pi-web consumes; missing fields
 * fall back to values chosen for the theme's own polarity (not a fixed light
 * palette), so a sparse dark theme still reads as dark.
 */
function mapToCssVars(
  colors: Record<string, string>,
  vars: Record<string, string>,
): Record<string, string> {
  const bg0 = vars.bg0 || "#1a1a1a";
  const isDark = relativeLuminance(bg0) < 0.5;

  // Palette, with polarity-aware defaults for anything the theme omits.
  const bg1 = vars.bg1 || (isDark ? "#242424" : "#f6f5f1");
  const bg2 = vars.bg2 || (isDark ? "#2f2d28" : "#ecebe4");
  const bg3 = vars.bg3 || (isDark ? "#393631" : "#dedbcf");
  const fg0 = vars.fg0 || (isDark ? "#eceae6" : "#26211c");
  const fg3 = vars.fg3 || (isDark ? "#9c978d" : "#6f6a60");
  const fg4 = vars.fg4 || (isDark ? "#736f68" : "#9a948a");
  const orange = vars.orange || (isDark ? "#f0932e" : "#e07a1f");
  const green = vars.green || (isDark ? "#22c55e" : "#2f9e44");
  const red = vars.red || (isDark ? "#ef4444" : "#d23b3b");
  const yellow = vars.yellow || (isDark ? "#facc15" : "#e8a33d");

  // Semantic tokens (resolve against palette; fall back to a sensible color).
  const accent = colors.accent || orange;
  const text = colors.text || fg0;
  const muted = colors.muted || fg3;
  const dim = colors.dim || fg4;
  const border = colors.border || bg3;
  const selectedBg = colors.selectedBg || bg2;
  const success = colors.success || green;
  const error = colors.error || red;
  const warning = colors.warning || yellow;
  const userMessageBg = colors.userMessageBg || bg1;
  const toolSuccessBg = colors.toolSuccessBg || bg1;

  // If the theme left accent (or any tint base) unresolved, guard the math.
  const safe = (hex: string, fallback: string) => (hexToRgb(hex) ? hex : fallback);
  const accentHex = safe(accent, orange);
  const borderHex = safe(border, bg3);

  const css: Record<string, string> = {};

  // Core backgrounds
  css["--bg"] = bg0;
  css["--bg-panel"] = bg1;
  css["--bg-hover"] = bg2;
  css["--bg-selected"] = selectedBg === bg1 ? bg2 : selectedBg;
  css["--border"] = borderHex;

  // Text
  css["--text"] = text;
  css["--text-muted"] = muted;
  css["--text-dim"] = dim;

  // Accent + derived shades
  css["--accent"] = accentHex;
  css["--accent-hover"] = isDark ? lighten(accentHex, 0.2) : darken(accentHex, 0.15);
  css["--accent-active"] = isDark ? darken(accentHex, 0.16) : darken(accentHex, 0.12);
  css["--accent-soft"] = mix(bg0, accentHex, isDark ? 0.2 : 0.1);
  css["--accent-soft-2"] = mix(bg0, accentHex, isDark ? 0.13 : 0.06);
  css["--accent-border"] = mix(borderHex, accentHex, isDark ? 0.55 : 0.4);

  // Message / tool surfaces
  css["--user-bg"] = userMessageBg;
  css["--assistant-bg"] = bg0;
  css["--tool-bg"] = toolSuccessBg;

  // Subtle accent tint (the only non-hex output). success/warning/error are
  // not emitted here — they are a later-phase concern and would otherwise leak
  // unused tokens onto the page.
  const accentRgb = hexToRgb(accentHex);
  const accentRgbStr = accentRgb ? accentRgb.join(",") : (isDark ? "255,255,255" : "60,45,20");
  css["--bg-subtle"] = isDark
    ? `rgba(${accentRgbStr},0.045)`
    : `rgba(${accentRgbStr},0.035)`;

  // Reference success/error/warning locally so they are not flagged unused if
  // the mapping grows later; they also document the resolved semantic palette.
  void success;
  void error;
  void warning;

  return css;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * List all available theme sets found in `~/.pi/agent/themes/`.
 * Themes are grouped by base name and reported with which variants exist.
 * Returns an empty array (never throws) if the directory is missing or empty.
 * No filesystem paths are exposed to the caller.
 */
export function listThemeSets(): ThemeSetInfo[] {
  const files = scanThemeDir(themesDir());

  const groups = new Map<string, { hasDark: boolean; hasLight: boolean }>();
  for (const f of files) {
    const g = groups.get(f.base) ?? { hasDark: false, hasLight: false };
    if (f.variant === "dark") g.hasDark = true;
    if (f.variant === "light") g.hasLight = true;
    groups.set(f.base, g);
  }

  const result: ThemeSetInfo[] = [];
  for (const [base, g] of groups) {
    result.push({
      name: base,
      displayName: themeNameToDisplay(base),
      hasDark: g.hasDark,
      hasLight: g.hasLight,
      builtin: false,
    });
  }

  result.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return result;
}

/**
 * Resolve a specific variant of a theme set.
 *
 * Name is validated first; unsafe names return null with no file access.
 *
 * Lookup order within `~/.pi/agent/themes/`:
 *   1. `{name}-{variant}.json`   (e.g. gruvbox-dark.json)
 *   2. `{name}.json`             (single-file theme)
 *   3. `{name}-{opposite}.json`  (degrade gracefully: a dark-only theme still
 *                                 renders in light mode rather than 404ing)
 *
 * There is deliberately no "treat `name` as a path" fallback.
 */
export function resolveTheme(
  name: string,
  variant: ThemeVariant,
): ResolvedTheme | null {
  if (!isSafeThemeName(name)) return null;

  const dir = themesDir();
  const opposite: ThemeVariant = variant === "dark" ? "light" : "dark";
  const candidates = [
    `${name}-${variant}.json`,
    `${name}.json`,
    `${name}-${opposite}.json`,
  ];

  for (const candidate of candidates) {
    const fullPath = join(dir, candidate);

    let stat;
    try {
      stat = lstatSync(fullPath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    if (stat.size > MAX_THEME_FILE_BYTES) continue;

    const theme = parseThemeFile(fullPath);
    if (!theme) continue;

    const vars = resolveVars(theme.vars);
    const colors = resolveColors(theme.colors, vars);
    const cssVars = mapToCssVars(colors, vars);
    const bg0 = vars.bg0 || "#1a1a1a";

    return {
      name,
      isDark: relativeLuminance(bg0) < 0.5,
      cssVars,
    };
  }

  return null;
}
