import type { Note } from "../types.js";

export type AgentState = "INIT" | "NEED_LOGIN" | "READY" | "DONE" | "ERROR";

export interface AgentRunInput {
  query: string;
  sessionId?: string;
  maxNotes?: number;
  scrollTimes?: number;
  loginTimeoutSec?: number;
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
  searchQuery?: string;
  keywordCandidates?: string[];
  sessionId?: string;
  viewUrl?: string;
  notes?: Note[];
  createdAt: number;
  updatedAt: number;
  steps: AgentStep[];
  error?: string;
  options: {
    maxNotes: number;
    scrollTimes: number;
    loginTimeoutSec: number;
  };
}
