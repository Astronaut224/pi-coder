// Pure helpers for the Windows titleBarOverlay color. No `electron` import so
// the module is unit-testable in plain Node.

/** Parse "#rrggbb", "#rgb", or "rrggbb" into 0-255 RGB. Throws on malformed input. */
export function parseHex(hex: string): { r: number; g: number; b: number } {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  if (!/^[0-9a-fA-F]{6}$/.test(h)) {
    throw new Error(`parseHex: expected #rrggbb / #rgb, got "${hex}"`);
  }
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** Perceptual luminance (ITU-R BT.601), normalized to 0..1. */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** Caption-button symbol color that stays readable on the given overlay bg.
 *  Non-hex inputs (e.g. custom themes using rgb()/named colors) fall back to
 *  white rather than throwing — the overlay `color` itself still applies. */
export function contrastSymbolColor(bgHex: string): string {
  try {
    return relativeLuminance(bgHex) >= 0.5 ? "#000000" : "#ffffff";
  } catch {
    return "#ffffff";
  }
}

/** Initial overlay colors before the renderer pushes the resolved theme color. */
export function initialOverlayColors(
  shouldUseDarkColors: boolean,
): { color: string; symbolColor: string } {
  const color = shouldUseDarkColors ? "#24231f" : "#f8f8f6";
  return { color, symbolColor: contrastSymbolColor(color) };
}
