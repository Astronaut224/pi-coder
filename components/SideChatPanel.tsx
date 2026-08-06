"use client";

import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { MarkdownBody } from "./MarkdownBody";
import { useSideChat } from "@/hooks/useSideChat";
import { useI18n } from "@/hooks/useI18n";

interface Props {
  mainSessionId: string | null;
}

export function SideChatPanel({ mainSessionId }: Props) {
  const { t } = useI18n();
  const sc = useSideChat(mainSessionId);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new content.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [sc.messages, sc.streamingText, sc.toolStatus]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || sc.isStreaming) return;
    const text = input;
    setInput("");
    void sc.send(text);
  };

  const errorText =
    sc.error === "no-main-session" ? t("sideChat.noMainSession")
    : sc.error === "main-busy" ? t("sideChat.mainBusy")
    : sc.error === "network" ? t("sideChat.mainBusy")
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg)" }}>
      {/* Toolbar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
        padding: "6px 8px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)",
        fontSize: 12,
      }}>
        <button
          onClick={() => void sc.setToolMode(sc.toolMode === "edit" ? "readOnly" : "edit")}
          title={sc.toolMode === "edit" ? t("sideChat.readOnly") : t("sideChat.edit")}
          style={toolbarButtonStyle(sc.toolMode === "edit")}
        >
          {sc.toolMode === "edit" ? t("sideChat.edit") : t("sideChat.readOnly")}
        </button>
        <button onClick={() => void sc.refork()} style={toolbarButtonStyle(false)} title={t("sideChat.refork")}>
          {t("sideChat.refork")}
        </button>
        <button onClick={() => void sc.clear()} style={toolbarButtonStyle(false)} title={t("sideChat.clear")}>
          {t("sideChat.clear")}
        </button>
        {sc.isStreaming && (
          <button onClick={sc.abort} style={{ ...toolbarButtonStyle(false), color: "var(--accent)" }} title={t("sideChat.stop")}>
            {t("sideChat.stop")}
          </button>
        )}
        {sc.toolStatus && (
          <span style={{ marginLeft: "auto", color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {sc.toolStatus}
          </span>
        )}
      </div>
      {sc.toolMode === "edit" && (
        <div style={{ padding: "4px 10px", fontSize: 11, color: "var(--text-dim)", background: "var(--accent-soft)", borderBottom: "1px solid var(--border)" }}>
          {t("sideChat.editWarning")}
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {!sc.ready && !errorText && (
          <div style={{ color: "var(--text-dim)", fontSize: 12, textAlign: "center", marginTop: 24 }}>
            …
          </div>
        )}
        {errorText && (
          <div style={{ color: "var(--text-muted)", fontSize: 12, textAlign: "center", marginTop: 24, padding: "0 12px" }}>
            {errorText}
          </div>
        )}
        {sc.messages.map((m, i) => (
          <MessageBubble key={i} message={m} />
        ))}
        {sc.streamingText && (
          <div style={{ alignSelf: "flex-start", maxWidth: "100%", color: "var(--text)" }}>
            <MarkdownBody isStreaming>{sc.streamingText}</MarkdownBody>
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={onSubmit} style={{ flexShrink: 0, padding: 8, borderTop: "1px solid var(--border)", background: "var(--bg-panel)" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSubmit(e as unknown as FormEvent);
              }
            }}
            placeholder={t("sideChat.placeholder")}
            rows={2}
            style={{
              flex: 1, resize: "none", border: "1px solid var(--border)", borderRadius: 6,
              padding: "8px 10px", fontSize: 13, background: "var(--bg)", color: "var(--text)",
              fontFamily: "inherit", outline: "none",
            }}
          />
          <button
            type="submit"
            disabled={!input.trim() || sc.isStreaming}
            style={{
              height: 38, padding: "0 14px", border: "none", borderRadius: 6, cursor: "pointer",
              background: "var(--accent)", color: "#fff", fontWeight: 500, fontSize: 13,
              opacity: (!input.trim() || sc.isStreaming) ? 0.5 : 1,
            }}
          >
            {t("chat.send")}
          </button>
        </div>
      </form>
    </div>
  );
}

function toolbarButtonStyle(active: boolean): CSSProperties {
  return {
    height: 26, padding: "0 10px", fontSize: 12, cursor: "pointer",
    border: "1px solid var(--border)", borderRadius: 5,
    background: active ? "var(--accent-soft)" : "var(--bg)",
    color: active ? "var(--accent)" : "var(--text-muted)",
  };
}

function MessageBubble({ message }: { message: AgentMessage }) {
  const m = message as {
    role?: string;
    content?: string | Array<{ type: string; text?: string; toolName?: string }>;
    toolName?: string;
  };

  if (m.role === "user") {
    const text = typeof m.content === "string"
      ? m.content
      : (Array.isArray(m.content) ? m.content : [])
          .filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join("\n");
    return (
      <div style={{ alignSelf: "flex-end", maxWidth: "85%", background: "var(--user-bg)", border: "1px solid var(--border)", borderRadius: 10, padding: "8px 12px" }}>
        <div style={{ whiteSpace: "pre-wrap", fontSize: 13, color: "var(--text)" }}>{text}</div>
      </div>
    );
  }

  if (m.role === "assistant") {
    const blocks = Array.isArray(m.content) ? m.content : [];
    const text = blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");
    const tools = blocks.filter((b) => b.type === "toolCall").map((b) => b.toolName ?? "tool");
    return (
      <div style={{ alignSelf: "flex-start", maxWidth: "100%", color: "var(--text)" }}>
        {text && <MarkdownBody>{text}</MarkdownBody>}
        {tools.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
            {tools.map((name, i) => (
              <span key={i} style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, background: "var(--bg-panel)", border: "1px solid var(--border)", color: "var(--text-muted)" }}>
                {name}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (m.role === "toolResult") {
    const first = (Array.isArray(m.content) ? m.content : [])[0];
    const preview = first?.type === "text" ? (first.text ?? "") : "";
    return (
      <div style={{ alignSelf: "flex-start", maxWidth: "85%", fontSize: 11, color: "var(--text-dim)", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 8px" }}>
        <span style={{ color: "var(--text-muted)" }}>{m.toolName ?? "tool"}:</span>{" "}
        <span style={{ whiteSpace: "pre-wrap" }}>{preview.slice(0, 200)}{preview.length > 200 ? "…" : ""}</span>
      </div>
    );
  }

  return null;
}
