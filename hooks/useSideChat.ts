"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

export type SideChatToolMode = "readOnly" | "edit";
export type SideChatErrorKind = "no-main-session" | "main-busy" | "network" | null;

export interface UseSideChatResult {
  messages: AgentMessage[];
  streamingMessage: AgentMessage | null;
  toolStatus: string;
  isStreaming: boolean;
  toolMode: SideChatToolMode;
  error: SideChatErrorKind;
  ready: boolean;
  send: (text: string) => Promise<void>;
  abort: () => void;
  refork: () => Promise<void>;
  clear: () => Promise<void>;
  setToolMode: (mode: SideChatToolMode) => Promise<void>;
}

export function useSideChat(mainSessionId: string | null): UseSideChatResult {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [streamingMessage, setStreamingMessage] = useState<AgentMessage | null>(null);
  const [toolStatus, setToolStatus] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [toolMode, setToolModeState] = useState<SideChatToolMode>("readOnly");
  const [error, setError] = useState<SideChatErrorKind>(null);
  const [ready, setReady] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const readyRef = useRef(false);

  const post = useCallback(
    async (action: string, payload: Record<string, unknown> = {}) => {
      if (!mainSessionId) return null;
      const res = await fetch(`/api/agent/${encodeURIComponent(mainSessionId)}/side`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      return res;
    },
    [mainSessionId],
  );

  const applyErrorFromResponse = useCallback(async (res: Response | null) => {
    if (!res || res.ok) return;
    const json = await res.json().catch(() => ({}));
    const code = (json as { error?: string }).error;
    if (code === "no-main-session") setError("no-main-session");
    else if (code === "main-busy") setError("main-busy");
  }, []);

  // Reload the full committed transcript from the server. The agent_end SSE event
  // carries only the current run's new messages (not the whole conversation), so —
  // like the main chat's loadSession() on agent_end — we re-fetch the authoritative
  // list instead of trusting the event payload.
  const refreshMessages = useCallback(async () => {
    if (!mainSessionId) return;
    try {
      const res = await fetch(`/api/agent/${encodeURIComponent(mainSessionId)}/side`);
      if (!res.ok) return;
      const d = (await res.json()) as { messages?: AgentMessage[]; toolMode?: SideChatToolMode };
      if (d.messages) setMessages(d.messages);
      if (d.toolMode) setToolModeState(d.toolMode);
    } catch {
      // ignore — the SSE stream keeps the UI live
    }
  }, [mainSessionId]);

  // Connect the SSE stream whenever the main session changes.
  useEffect(() => {
    if (!mainSessionId) {
      setReady(false);
      readyRef.current = false;
      setMessages([]);
      setStreamingMessage(null);
      return;
    }
    setReady(false);
    readyRef.current = false;
    setError(null);
    let closed = false;

    const es = new EventSource(`/api/agent/${encodeURIComponent(mainSessionId)}/side/events`);
    esRef.current = es;

    es.onmessage = (ev) => {
      if (closed) return;
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(ev.data) as Record<string, unknown>;
      } catch {
        return;
      }
      switch (data.type) {
        case "connected": {
          setMessages((data.messages as AgentMessage[]) ?? []);
          setToolModeState((data.toolMode as SideChatToolMode) ?? "readOnly");
          setStreamingMessage(null);
          setReady(true);
          readyRef.current = true;
          setError(null);
          break;
        }
        case "message_start":
        case "message_update": {
          // Mirror the main chat: stream from the partial assistant `message`, not
          // from assistantMessageEvent deltas. Ignore user-role streaming messages
          // (the user message is shown optimistically on send).
          const msg = data.message as AgentMessage | undefined;
          if (msg && (msg as { role?: string }).role !== "user") {
            setIsStreaming(true);
            setStreamingMessage(msg);
          }
          break;
        }
        case "tool_execution_start": {
          setIsStreaming(true);
          setToolStatus(`Running ${data.toolName as string}…`);
          break;
        }
        case "tool_execution_end": {
          setToolStatus("");
          break;
        }
        case "agent_end": {
          setStreamingMessage(null);
          setIsStreaming(false);
          setToolStatus("");
          void refreshMessages();
          break;
        }
        default:
          break;
      }
    };

    es.onerror = () => {
      if (!closed && !readyRef.current) setError("network");
    };

    return () => {
      closed = true;
      es.close();
      esRef.current = null;
    };
  }, [mainSessionId, refreshMessages]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !mainSessionId) return;
      setError(null);
      // Show the user's message immediately, like the main chat.
      const optimistic: AgentMessage = {
        role: "user",
        content: [{ type: "text", text: trimmed }],
      } as AgentMessage;
      setMessages((prev) => [...prev, optimistic]);
      setStreamingMessage(null);
      setIsStreaming(true);
      const res = await post("prompt", { text: trimmed });
      await applyErrorFromResponse(res);
    },
    [mainSessionId, post, applyErrorFromResponse],
  );

  const abort = useCallback(() => {
    void post("abort");
  }, [post]);

  const refork = useCallback(async () => {
    const res = await post("refork");
    await applyErrorFromResponse(res);
    const json = (await res?.json().catch(() => ({}))) as { messages?: AgentMessage[]; toolMode?: SideChatToolMode };
    if (json.messages) setMessages(json.messages);
    if (json.toolMode) setToolModeState(json.toolMode);
    setStreamingMessage(null);
    setIsStreaming(false);
  }, [post, applyErrorFromResponse]);

  const clear = useCallback(async () => {
    const res = await post("clear");
    await applyErrorFromResponse(res);
    const json = (await res?.json().catch(() => ({}))) as { messages?: AgentMessage[]; toolMode?: SideChatToolMode };
    if (json.messages) setMessages(json.messages);
    if (json.toolMode) setToolModeState(json.toolMode);
    setStreamingMessage(null);
    setIsStreaming(false);
  }, [post, applyErrorFromResponse]);

  const setToolMode = useCallback(
    async (mode: SideChatToolMode) => {
      const res = await post("setToolMode", { toolMode: mode });
      await applyErrorFromResponse(res);
      const json = (await res?.json().catch(() => ({}))) as { toolMode?: SideChatToolMode };
      if (json.toolMode) setToolModeState(json.toolMode);
    },
    [post, applyErrorFromResponse],
  );

  return {
    messages,
    streamingMessage,
    toolStatus,
    isStreaming,
    toolMode,
    error,
    ready,
    send,
    abort,
    refork,
    clear,
    setToolMode,
  };
}
