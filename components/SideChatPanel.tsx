"use client";

import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import type { AgentMessage } from "@/lib/types";
import { MessageView } from "./MessageView";
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
  }, [sc.messages, sc.streamingMessage, sc.toolStatus]);

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
    : sc.error === "network" ? t("sideChat.network")
    : null;

  // While the agent is active but no assistant bubble is streaming yet (or a tool
  // is running), show a pulsing status line so it's clear the model is working —
  // matches the main chat's phase label.
  const phaseLabel = sc.toolStatus
    ? t("chat.runningNamedTool", { name: sc.toolStatus })
    : t("chat.thinking");
  const showPhase = sc.isStreaming && (!sc.streamingMessage || Boolean(sc.toolStatus));

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
          <MessageView key={`m-${i}`} message={m as unknown as AgentMessage} />
        ))}
        {sc.streamingMessage && (
          <MessageView key="streaming" message={sc.streamingMessage as unknown as AgentMessage} isStreaming />
        )}
        {showPhase && (
          <div style={{ alignSelf: "flex-start", padding: "6px 2px", fontSize: 13, color: "var(--text-muted)" }}>
            <span className="animate-[pulse_1.5s_infinite]">{phaseLabel}</span>
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
