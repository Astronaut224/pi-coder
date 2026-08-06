"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import type { AgentMessage, AssistantContentBlock, AssistantMessage } from "@/lib/types";
import { normalizeToolCalls } from "@/lib/normalize";
import { countToolCallBlocks, getDisplayableAssistantBlocks, splitFinalAssistantBlocks } from "@/lib/message-display";
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

  // Normalize once per message-list change so MessageView (built for lib/types)
  // gets toolCallId/toolName/input instead of agent-core's id/name/arguments.
  const messages = useMemo(
    () => sc.messages.map((m) => normalizeToolCalls(m as unknown as AgentMessage)),
    [sc.messages],
  );

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
          <div style={{ color: "var(--text-dim)", fontSize: 12, textAlign: "center", marginTop: 24 }}>…</div>
        )}
        {errorText && (
          <div style={{ color: "var(--text-muted)", fontSize: 12, textAlign: "center", marginTop: 24, padding: "0 12px" }}>
            {errorText}
          </div>
        )}
        {sc.expired && (
          <div style={{ alignSelf: "stretch", padding: "12px", background: "var(--accent-soft)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--text-muted)", textAlign: "center" }}>
            <div style={{ marginBottom: 8 }}>{t("sideChat.expired")}</div>
            <button onClick={() => void sc.refork()} style={toolbarButtonStyle(true)}>{t("sideChat.refork")}</button>
          </div>
        )}
        {renderTurns(messages, t)}
        {sc.streamingMessage && (
          <MessageView
            key="streaming"
            message={normalizeToolCalls(sc.streamingMessage as unknown as AgentMessage)}
            isStreaming
          />
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
            disabled={!input.trim() || sc.isStreaming || sc.expired}
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

// ----------------------------------------------------------------------------
// Turn grouping: fold each turn's intermediate messages (thinking, tool calls,
// tool results) and the final assistant's process blocks into a collapsed
// "处理详情" group, showing only the final answer expanded — mirrors ChatWindow.
// ----------------------------------------------------------------------------

function renderTurns(messages: AgentMessage[], t: (key: string, params?: Record<string, string | number>) => string): ReactNode[] {
  const rendered: ReactNode[] = [];
  for (let idx = 0; idx < messages.length;) {
    const msg = messages[idx];
    if (!isGroupAnchor(msg)) {
      rendered.push(<MessageView key={`m-${idx}`} message={msg} />);
      idx += 1;
      continue;
    }

    const userIdx = idx;
    let endIdx = userIdx + 1;
    while (endIdx < messages.length && !isGroupAnchor(messages[endIdx])) endIdx += 1;

    const finalAssistantIdx = findFinalAssistantIndex(messages, userIdx, endIdx);
    if (finalAssistantIdx === -1) {
      for (let i = userIdx; i < endIdx; i++) rendered.push(<MessageView key={`m-${i}`} message={messages[i]} />);
      idx = endIdx;
      continue;
    }

    rendered.push(<MessageView key={`m-${userIdx}`} message={messages[userIdx]} />);

    const processIndices: number[] = [];
    for (let i = userIdx + 1; i < finalAssistantIdx; i++) processIndices.push(i);
    const visibleProcessIndices = processIndices.filter((i) => hasDisplayableProcessMessage(messages[i]));

    const finalAssistant = messages[finalAssistantIdx] as AssistantMessage;
    const finalSplit = splitFinalAssistantBlocks(finalAssistant);
    const finalProcessMessage = finalSplit.processBlocks.length > 0
      ? withAssistantBlocks(finalAssistant, finalSplit.processBlocks, { omitUsage: true })
      : null;
    const finalAnswerMessage = finalSplit.answerBlocks.length > 0
      ? withAssistantBlocks(finalAssistant, finalSplit.answerBlocks)
      : null;

    const processCount = visibleProcessIndices.length + (finalProcessMessage ? 1 : 0);
    if (processCount > 0) {
      rendered.push(
        <ProcessDetailsGroup
          key={`pg-${userIdx}`}
          messageCount={processCount}
          t={t}
          toolCallCount={countToolCallsIn(messages, visibleProcessIndices) + countToolCallBlocks(finalSplit.processBlocks)}
        >
          {visibleProcessIndices.map((i) => <MessageView key={`p-${i}`} message={messages[i]} />)}
          {finalProcessMessage && <MessageView key={`pf-${finalAssistantIdx}`} message={finalProcessMessage} />}
        </ProcessDetailsGroup>,
      );
    }

    if (finalAnswerMessage) rendered.push(<MessageView key={`m-${finalAssistantIdx}`} message={finalAnswerMessage} />);
    for (let i = finalAssistantIdx + 1; i < endIdx; i++) rendered.push(<MessageView key={`m-${i}`} message={messages[i]} />);
    idx = endIdx;
  }
  return rendered;
}

function isGroupAnchor(message: AgentMessage): boolean {
  return message.role === "user";
}

function hasFinalAssistantAnswer(message: AgentMessage): boolean {
  if (message.role !== "assistant") return false;
  return splitFinalAssistantBlocks(message as AssistantMessage).answerBlocks.some((block) => (
    block.type === "image" || (block.type === "text" && block.text.trim().length > 0)
  ));
}

function findFinalAssistantIndex(messages: AgentMessage[], userIdx: number, endIdx: number): number {
  for (let i = endIdx - 1; i > userIdx; i--) if (hasFinalAssistantAnswer(messages[i])) return i;
  for (let i = endIdx - 1; i > userIdx; i--) if (messages[i]?.role === "assistant") return i;
  return -1;
}

function hasDisplayableProcessMessage(message: AgentMessage): boolean {
  if (message.role === "assistant") return getDisplayableAssistantBlocks(message as AssistantMessage).length > 0;
  return message.role === "custom";
}

function countToolCallsIn(messages: AgentMessage[], indices: number[]): number {
  let count = 0;
  for (const idx of indices) {
    const msg = messages[idx];
    if (msg?.role !== "assistant") continue;
    count += countToolCallBlocks(getDisplayableAssistantBlocks(msg as AssistantMessage));
  }
  return count;
}

function withAssistantBlocks(
  message: AssistantMessage,
  content: AssistantContentBlock[],
  options: { omitUsage?: boolean } = {},
): AssistantMessage {
  const next: AssistantMessage = { ...message, content };
  if (options.omitUsage) next.usage = undefined;
  return next;
}

function ProcessDetailsGroup({ messageCount, toolCallCount, children, t }: {
  messageCount: number;
  toolCallCount: number;
  children: ReactNode;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const parts = [t("chat.processDetails"), `${messageCount} ${t(messageCount === 1 ? "chat.message" : "chat.messages")}`];
  if (toolCallCount > 0) parts.push(`${toolCallCount} ${t(toolCallCount === 1 ? "chat.toolCall" : "chat.toolCalls")}`);

  return (
    <div style={{ marginBottom: 14 }}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: "flex", alignItems: "center", gap: 8, width: "auto", minHeight: 24,
          padding: "2px 0", border: "none", background: "transparent",
          color: "var(--text-muted)", cursor: "pointer", fontSize: 12, textAlign: "left",
        }}
        title={expanded ? t("chat.collapseProcess") : t("chat.expandProcess")}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>
          <polyline points="4 2.5 7.5 6 4 9.5" />
        </svg>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {parts.join(" · ")}
        </span>
      </button>
      {expanded && <div style={{ marginTop: 8 }}>{children}</div>}
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
