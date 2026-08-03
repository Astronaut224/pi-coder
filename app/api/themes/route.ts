import { NextResponse } from "next/server";
import { listThemeSets } from "@/lib/theme";

// Theme files live on disk and may change between requests; always run on the
// Node.js runtime (never Edge) and never cache the listing.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const themeSets = listThemeSets();

    return NextResponse.json(
      { themeSets },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error("Failed to list themes:", error);

    return NextResponse.json(
      { error: "Failed to list themes" },
      { status: 500 },
    );
  }
}
