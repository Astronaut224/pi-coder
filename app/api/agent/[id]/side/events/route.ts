import { getSideChat, openSideChat, SideChatError } from "@/lib/side-chat-manager";

export const dynamic = "force-dynamic";

// GET /api/agent/[id]/side/events - SSE stream of side-chat events (token-level)
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let entry = getSideChat(id);
  if (!entry) {
    try {
      entry = openSideChat(id);
    } catch (error) {
      const code = error instanceof SideChatError ? error.code : "error";
      const status = code === "no-main-session" ? 404 : 409;
      return new Response(JSON.stringify({ error: code }), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  const snapshot = entry;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const encode = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      // Initial snapshot so a reconnecting client renders history immediately.
      encode({ type: "connected", sessionId: id, messages: snapshot.getMessages(), toolMode: snapshot.toolMode });

      // NOTE: unlike the main /events route we forward message_update WITH
      // assistantMessageEvent so text_delta reaches the client.
      const unsubscribe = snapshot.onEvent((event) => encode(event));

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(":\n\n"));
        } catch {
          // controller already closed
        }
      }, 30_000);

      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        controller.close();
      };

      req.signal?.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
