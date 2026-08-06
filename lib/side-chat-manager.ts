import { Agent, type AgentEvent, type AgentMessage } from "@earendil-works/pi-agent-core";
import { getRpcSession, type AgentSessionWrapper } from "./rpc-manager";
import { buildSessionTitleAgentOptions } from "./session-title";
import { SIDE_CHAT_PROMPT } from "./side-chat/prompt";
import { buildSideChatTools, type SideChatToolContext, type SideChatToolMode } from "./side-chat/build-tools";
import { FileActivityTracker } from "./side-chat/file-activity-tracker";
import { extractWritePaths } from "./side-chat/tool-wrapper";

export type SideChatEvent = AgentEvent;

const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

export class SideChatError extends Error {
  constructor(public code: "no-main-session" | "main-busy", message: string) {
    super(message);
    this.name = "SideChatError";
  }
}

export class SideChatEntry {
  agent: Agent;
  readonly mainAgent: Agent;
  readonly cwd: string;
  forkMessageCount: number;
  readonly fileTracker = new FileActivityTracker();
  toolMode: SideChatToolMode = "readOnly";

  private listeners = new Set<(event: SideChatEvent) => void>();
  private unsubscribeMain: (() => void) | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly mainSessionId: string,
    wrapper: AgentSessionWrapper,
    initialMessages?: AgentMessage[],
  ) {
    this.mainAgent = wrapper.inner.agent as unknown as Agent;
    this.cwd = wrapper.cwd;
    this.forkMessageCount = this.mainAgent.state.messages.length;

    this.agent = this.buildAgent(initialMessages);

    // Track the main agent's file writes so edit-mode overlap detection works.
    this.unsubscribeMain = wrapper.onEvent((event) => {
      if (
        event.type === "tool_execution_start"
        && typeof (event as { toolName?: unknown }).toolName === "string"
        && ["write", "edit", "bash"].includes((event as unknown as { toolName: string }).toolName)
      ) {
        const args = (event as { args?: unknown }).args;
        extractWritePaths((event as unknown as { toolName: string }).toolName, args)
          .forEach((p) => this.fileTracker.trackWrite(p, this.cwd));
      }
    });

    this.resetIdleTimer();
  }

  private buildAgent(initialMessages?: AgentMessage[]): Agent {
    const options = buildSessionTitleAgentOptions(this.mainAgent);
    options.initialState!.systemPrompt = this.mainAgent.state.systemPrompt + SIDE_CHAT_PROMPT;
    options.initialState!.messages = initialMessages
      ?? (structuredClone(this.mainAgent.state.messages) as AgentMessage[]);
    options.initialState!.tools = buildSideChatTools("readOnly", this.toolContext());
    const agent = new Agent(options);
    agent.subscribe((event) => this.emit(event));
    return agent;
  }

  private toolContext(): SideChatToolContext {
    return {
      cwd: this.cwd,
      fileTracker: this.fileTracker,
      mainAgent: this.mainAgent,
      forkMessageCount: this.forkMessageCount,
    };
  }

  onEvent(listener: (event: SideChatEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: SideChatEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  getMessages(): AgentMessage[] {
    return [...this.agent.state.messages];
  }

  prompt(text: string): Promise<void> {
    this.resetIdleTimer();
    return this.agent.prompt(text);
  }

  abort(): void {
    this.agent.abort();
  }

  setToolMode(mode: SideChatToolMode): void {
    this.toolMode = mode;
    this.agent.state.tools = buildSideChatTools(mode, this.toolContext());
  }

  /**
   * Re-fork from the main session in place: rebuilds this.agent with a fresh
   * clone of the main messages, updates the fork point, resets tool mode.
   * Preserves `this.listeners` so live SSE subscriptions keep working.
   * Caller MUST have verified the main session via requireMain first.
   */
  reforkInPlace(): void {
    this.forkMessageCount = this.mainAgent.state.messages.length;
    this.agent.abort();
    this.agent = this.buildAgent();
    this.toolMode = "readOnly";
    this.resetIdleTimer();
  }

  /**
   * Reset the side chat to empty in place (keeps listeners). Caller MUST have
   * verified the main session via requireMain first.
   */
  clearInPlace(): void {
    this.forkMessageCount = this.mainAgent.state.messages.length;
    this.agent.abort();
    this.agent = this.buildAgent([]);
    this.toolMode = "readOnly";
    this.resetIdleTimer();
  }

  resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => disposeSideChat(this.mainSessionId), IDLE_TIMEOUT_MS);
  }

  dispose(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.unsubscribeMain?.();
    this.unsubscribeMain = null;
    this.agent.abort();
    this.listeners.clear();
  }
}

const entries = new Map<string, SideChatEntry>();

function requireMain(mainSessionId: string): AgentSessionWrapper {
  const wrapper = getRpcSession(mainSessionId);
  if (!wrapper || !wrapper.isAlive()) {
    throw new SideChatError("no-main-session", "Main session not found");
  }
  if (wrapper.isRunning()) {
    throw new SideChatError("main-busy", "Main session is busy");
  }
  return wrapper;
}

function disposeSideChat(mainSessionId: string): void {
  const entry = entries.get(mainSessionId);
  if (!entry) return;
  entry.dispose();
  entries.delete(mainSessionId);
}

export function getSideChat(mainSessionId: string): SideChatEntry | undefined {
  return entries.get(mainSessionId);
}

export function openSideChat(mainSessionId: string): SideChatEntry {
  const existing = entries.get(mainSessionId);
  if (existing) return existing;
  const wrapper = requireMain(mainSessionId);
  const entry = new SideChatEntry(mainSessionId, wrapper);
  entries.set(mainSessionId, entry);
  return entry;
}

export function reforkSideChat(mainSessionId: string): SideChatEntry {
  const existing = entries.get(mainSessionId);
  if (!existing) return openSideChat(mainSessionId);
  requireMain(mainSessionId); // throws (main-busy/no-main) BEFORE mutating -> existing entry stays intact
  existing.reforkInPlace();
  return existing;
}

export function clearSideChat(mainSessionId: string): SideChatEntry {
  const existing = entries.get(mainSessionId);
  if (!existing) return openSideChat(mainSessionId);
  requireMain(mainSessionId);
  existing.clearInPlace();
  return existing;
}
