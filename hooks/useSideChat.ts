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
  expired: boolean;
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
  const [expired, setExpired] = useState(false);
  const [ready, setReady] = useState(false);
  const [reconnectEpoch, setReconnectEpoch] = useState(0);
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
    if (code === "not-open") setExpired(true); // side chat was idle-reaped
    else if (code === "no-main-session") setError("no-main-session");
    else if (code === "main-busy") setError("main-busy");
  }, []);

  const refreshMessages = useCallback(async () => {
    if (!mainSessionId) return;
    try {
      const res = await fetch(`/api/agent/${encodeURIComponent(mainSessionId)}/side`);
      if (!res.ok) {
        if (res.status === 404) setExpired(true);
        return;
      }
      const d = (await res.json()) as { messages?: AgentMessage[]; toolMode?: SideChatToolMode };
      if (d.messages) setMessages(d.messages);
      if (d.toolMode) setToolModeState(d.toolMode);
    } catch {
      // ignore — the SSE stream keeps the UI live
    }
  }, [mainSessionId]);

  // Connect the SSE stream whenever the main session changes or we need to rebind
  // (after a refork/clear that may have replaced the server-side entry).
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
          setExpired(false);
          setReady(true);
          readyRef.current = true;
          setError(null);
          break;
        }
        case "message_start":
        case "message_update": {
          const msg = data.message as AgentMessage | undefined;
          if (msg && (msg as { role?: string }).role !== "user") {
            setIsStreaming(true);
            setStreamingMessage(msg);
          }
          break;
        }
        case "tool_execution_start": {
          setIsStreaming(true);
          setToolStatus(typeof data.toolName === "string" ? data.toolName : "");
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
  }, [mainSessionId, refreshMessages, reconnectEpoch]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !mainSessionId) return;
      setError(null);
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

  // refork/clear re-create the entry if it expired, so on success we reconnect the
  // SSE stream to bind to the (possibly new) entry.
  const recoverAfterMutation = useCallback(async (res: Response | null) => {
    if (!res) return;
    let json: { messages?: AgentMessage[]; toolMode?: SideChatToolMode; error?: string } = {};
    try { json = await res.json(); } catch { /* ignore */ }
    if (!res.ok) {
      if (json.error === "not-open") setExpired(true);
      else if (json.error === "no-main-session") setError("no-main-session");
      return;
    }
    if (json.messages) setMessages(json.messages);
    setExpired(false);
    setStreamingMessage(null);
    setIsStreaming(false);
    setReconnectEpoch((e) => e + 1);
  }, []);

  const refork = useCallback(async () => {
    await recoverAfterMutation(await post("refork"));
  }, [post, recoverAfterMutation]);

  const clear = useCallback(async () => {
    await recoverAfterMutation(await post("clear"));
  }, [post, recoverAfterMutation]);

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
    expired,
    ready,
    send,
    abort,
    refork,
    clear,
    setToolMode,
  };
}
