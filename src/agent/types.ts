import type { Note } from "../types.js";
import type { SiteId } from "../sites/types.js";

export type AgentState = "INIT" | "NEED_LOGIN" | "READY" | "DONE" | "ERROR";

export interface AgentRunInput {
  query: string;
  sessionId?: string;
  maxNotes?: number;
  scrollTimes?: number;
  loginTimeoutSec?: number;
  site?: SiteId;
}

export interface AgentStep {
  ts: string;
  state: AgentState;
  action: string;
  status: "ok" | "waiting" | "error";
  detail?: Record<string, unknown>;
  summary?: string;
}

export interface AgentRun {
  id: string;
  state: AgentState;
  query: string;
  searchQuery?: string | undefined;
  keywordCandidates?: string[] | undefined;
  sessionId?: string | undefined;
  viewUrl?: string | undefined;
  site: SiteId;
  notes?: Note[] | undefined;
  createdAt: number;
  updatedAt: number;
  steps: AgentStep[];
  error?: string | undefined;
  options: {
    maxNotes: number;
    scrollTimes: number;
    loginTimeoutSec: number;
  };
}
