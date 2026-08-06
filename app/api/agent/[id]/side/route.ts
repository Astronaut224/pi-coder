import { NextResponse } from "next/server";
import {
  clearSideChat,
  getSideChat,
  openSideChat,
  reforkSideChat,
  SideChatError,
} from "@/lib/side-chat-manager";

type SideChatBody = {
  action: "open" | "prompt" | "abort" | "refork" | "clear" | "setToolMode";
  text?: string;
  toolMode?: "readOnly" | "edit";
};

// POST /api/agent/[id]/side - drive the side chat for a main session
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: SideChatBody;
  try {
    body = (await req.json()) as SideChatBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    if (body.action === "open") {
      const entry = openSideChat(id);
      return NextResponse.json({ ok: true, toolMode: entry.toolMode, messages: entry.getMessages() });
    }

    const entry = getSideChat(id);
    if (!entry) return NextResponse.json({ error: "not-open" }, { status: 404 });

    switch (body.action) {
      case "prompt": {
        const text = (body.text ?? "").trim();
        if (!text) return NextResponse.json({ error: "empty-prompt" }, { status: 400 });
        // Streaming happens over /side/events. Swallow rejections here; failures
        // surface to the client as an error assistant message via the event stream.
        void entry.prompt(text).catch(() => {});
        return NextResponse.json({ ok: true });
      }
      case "abort":
        entry.abort();
        return NextResponse.json({ ok: true });
      case "setToolMode": {
        if (body.toolMode) entry.setToolMode(body.toolMode);
        return NextResponse.json({ ok: true, toolMode: entry.toolMode });
      }
      case "refork": {
        const e = reforkSideChat(id);
        return NextResponse.json({ ok: true, toolMode: e.toolMode, messages: e.getMessages() });
      }
      case "clear": {
        const e = clearSideChat(id);
        return NextResponse.json({ ok: true, toolMode: e.toolMode, messages: e.getMessages() });
      }
      default:
        return NextResponse.json({ error: "unknown-action" }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof SideChatError) {
      const status = error.code === "no-main-session" ? 404 : 409;
      return NextResponse.json({ error: error.code }, { status });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
