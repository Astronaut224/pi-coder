import { Type } from "typebox";
import type { Agent, AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";

export function createPeekMainTool(mainAgent: Agent, forkMessageCount: number): AgentTool {
  return {
    name: "peek_main",
    label: "peek_main",
    description: "View main agent's recent activity. Use when user asks about main's progress or status.",
    parameters: Type.Object({
      lines: Type.Optional(Type.Integer({ description: "Max items (default: 20)", minimum: 1, maximum: 50 })),
      since_fork: Type.Optional(Type.Boolean({ description: "Only show activity after side chat opened" })),
    }),
    execute: async (_toolCallId, params: unknown) => {
      const args = params as { lines?: number; since_fork?: boolean };
      const all = mainAgent.state.messages;
      const msgs = args.since_fork ? all.slice(forkMessageCount) : all;
      const recent = msgs.slice(-(args.lines ?? 20));
      if (!recent.length) {
        return {
          content: [{ type: "text", text: args.since_fork ? "No new activity since fork." : "No recent activity." }],
          details: { source: "peek_main", empty: true },
        };
      }
      const formatted = recent.map(formatMessage).filter(Boolean).join("\n\n");
      return {
        content: [{ type: "text", text: `Main agent activity (${recent.length} items):\n\n${formatted}` }],
        details: { source: "peek_main", count: recent.length },
      };
    },
  };
}

function formatMessage(msg: AgentMessage): string {
  const m = msg as {
    role?: string;
    content?: string | Array<{ type: string; text?: string; toolName?: string }>;
    toolName?: string;
  };
  if (m.role === "user") {
    const c = typeof m.content === "string"
      ? m.content
      : (m.content ?? []).map((b) => (b.type === "text" ? b.text ?? "" : "[image]")).join("");
    return `[User]: ${c.slice(0, 300)}${c.length > 300 ? "..." : ""}`;
  }
  if (m.role === "assistant") {
    const blocks = Array.isArray(m.content) ? m.content : [];
    const fullText = blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");
    const text = fullText.slice(0, 500);
    const tools = blocks.filter((b) => b.type === "toolCall").map((b) => b.toolName ?? "tool");
    const parts = [
      text && (text + (fullText.length > 500 ? "..." : "")),
      tools.length && `[Calling: ${tools.join(", ")}]`,
    ].filter(Boolean);
    return parts.length ? `[Assistant]: ${parts.join("\n")}` : "";
  }
  if (m.role === "toolResult") {
    const first = (Array.isArray(m.content) ? m.content : [])[0];
    const fullText = first?.type === "text" ? first.text ?? "" : "";
    const preview = fullText.slice(0, 150);
    return `[${m.toolName ?? "tool"}]: ${preview}${fullText.length > 150 ? "..." : ""}`;
  }
  return "";
}
