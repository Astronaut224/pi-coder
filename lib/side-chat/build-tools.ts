import type { Agent, AgentTool } from "@earendil-works/pi-agent-core";
import { createCodingTools, createReadOnlyTools } from "@earendil-works/pi-coding-agent";
import type { FileActivityTracker } from "./file-activity-tracker";
import { wrapToolsWithOverlapDetection } from "./tool-wrapper";
import { createPeekMainTool } from "./peek-main";

export type SideChatToolMode = "readOnly" | "edit";

export interface SideChatToolContext {
  cwd: string;
  fileTracker: FileActivityTracker;
  mainAgent: Agent;
  forkMessageCount: number;
}

export function buildSideChatTools(mode: SideChatToolMode, ctx: SideChatToolContext): AgentTool[] {
  const base = mode === "edit"
    ? wrapToolsWithOverlapDetection(createCodingTools(ctx.cwd), ctx.fileTracker, ctx.cwd, async () => false)
    : createReadOnlyTools(ctx.cwd);
  return [...base, createPeekMainTool(ctx.mainAgent, ctx.forkMessageCount)];
}
