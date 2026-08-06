"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

export type SideChatToolMode = "readOnly" | "edit";
export type SideChatErrorKind = "no-main-session" | "main-busy" | "network" | null;

export interface UseSideChatResult {
  messages: AgentMessage[];
  streamingText: string;
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
  const [streamingText, setStreamingText] = useState("");
  const [toolStatus, setToolStatus] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [toolMode, setToolModeState] = useState<SideChatToolMode>("readOnly");
  const [error, setError] = useState<SideChatErrorKind>(null);
  const [ready, setReady] = useState(false);
  const esRef = useRef<EventSource | null>(null);

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

  // Connect the SSE stream whenever the main session changes.
  useEffect(() => {
    if (!mainSessionId) {
      setReady(false);
      setMessages([]);
      return;
    }
    setReady(false);
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
          setReady(true);
          setError(null);
          break;
        }
        case "message_update": {
          const ame = data.assistantMessageEvent as { type?: string; delta?: string } | undefined;
          if (ame?.type === "text_delta") {
            setIsStreaming(true);
            setStreamingText((s) => s + (ame.delta ?? ""));
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
          setMessages((data.messages as AgentMessage[]) ?? []);
          setStreamingText("");
          setIsStreaming(false);
          setToolStatus("");
          break;
        }
        default:
          break;
      }
    };

    es.onerror = () => {
      if (!closed && !ready) setError("network");
    };

    return () => {
      closed = true;
      es.close();
      esRef.current = null;
    };
  }, [mainSessionId, ready]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !mainSessionId) return;
      setError(null);
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
    setStreamingText("");
    setIsStreaming(false);
  }, [post, applyErrorFromResponse]);

  const clear = useCallback(async () => {
    const res = await post("clear");
    await applyErrorFromResponse(res);
    const json = (await res?.json().catch(() => ({}))) as { messages?: AgentMessage[]; toolMode?: SideChatToolMode };
    if (json.messages) setMessages(json.messages);
    if (json.toolMode) setToolModeState(json.toolMode);
    setStreamingText("");
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
    streamingText,
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
