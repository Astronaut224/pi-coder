import { NextRequest, NextResponse } from "next/server";
import {
  isSafeThemeName,
  resolveTheme,
  type ThemeVariant,
} from "@/lib/theme";

// Theme resolution reads from disk on every request; Node.js runtime only.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ name: string }> },
) {
  try {
    const { name: encodedName } = await context.params;
    const name = decodeURIComponent(encodedName);

    // Reject path-like, dotted, spaced, or oversized names before any file
    // access. This is the guard against traversal (`../`, absolute paths) and
    // against treating the name as a file path.
    if (!isSafeThemeName(name)) {
      return NextResponse.json(
        { error: "Invalid theme name" },
        { status: 400 },
      );
    }

    const modeParam = new URL(request.url).searchParams.get("mode");
    const mode: ThemeVariant = modeParam === "light" ? "light" : "dark";

    const resolved = resolveTheme(name, mode);

    if (!resolved) {
      return NextResponse.json(
        { error: `Theme "${name}" variant "${mode}" not found` },
        { status: 404 },
      );
    }

    return NextResponse.json(resolved, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Failed to resolve theme:", error);

    return NextResponse.json(
      { error: "Failed to resolve theme" },
      { status: 500 },
    );
  }
}
