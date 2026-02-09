import { randomUUID } from "crypto";
import { config } from "../config.js";
import { sanitizeOutput } from "../security/policy.js";
import { buildViewUrl } from "../server/viewUrl.js";
import { McpInProcessClient } from "./mcpClient.js";
import { AgentNarrator } from "./narrator.js";
import { AgentKeyworder } from "./keyworder.js";
import type { AgentRun, AgentRunInput, AgentStep } from "./types.js";
import type { Note } from "../types.js";

const DEFAULT_MAX_NOTES = 20;
const DEFAULT_SCROLL_TIMES = 2;
const DEFAULT_LOGIN_TIMEOUT_SEC = 8;
const MAX_STEPS_PER_RUN = 4;

export class AgentManager {
  private runs = new Map<string, AgentRun>();
  private janitor?: NodeJS.Timeout;
  private mcpClient = new McpInProcessClient();
  private narrator = new AgentNarrator();
  private keyworder = new AgentKeyworder();
  private running = new Set<string>();

  startJanitor(): void {
    if (this.janitor) return;
    const interval = Math.min(config.agentRunTtlMs / 2, 30_000);
    this.janitor = setInterval(() => {
      const now = Date.now();
      for (const run of this.runs.values()) {
        if (now - run.updatedAt > config.agentRunTtlMs) {
          this.runs.delete(run.id);
        }
      }
    }, interval);
    this.janitor.unref?.();
  }

  getRun(id: string): AgentRun | undefined {
    return this.runs.get(id);
  }

  toPublicRun(run: AgentRun) {
    return sanitizeOutput({
      runId: run.id,
      status: run.state,
      running: this.running.has(run.id),
      sessionId: run.sessionId,
      viewUrl: run.viewUrl,
      query: run.query,
      notes: run.notes ?? [],
      steps: run.steps,
      error: run.error ?? null
    });
  }

  async createRun(input: AgentRunInput): Promise<AgentRun> {
    const run: AgentRun = {
      id: randomUUID(),
      state: "INIT",
      query: input.query.trim(),
      sessionId: input.sessionId?.trim(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      steps: [],
      options: {
        maxNotes: Number.isFinite(input.maxNotes) ? Math.max(1, Math.floor(input.maxNotes!)) : DEFAULT_MAX_NOTES,
        scrollTimes: Number.isFinite(input.scrollTimes) ? Math.max(0, Math.floor(input.scrollTimes!)) : DEFAULT_SCROLL_TIMES,
        loginTimeoutSec: Number.isFinite(input.loginTimeoutSec)
          ? Math.max(1, Math.floor(input.loginTimeoutSec!))
          : DEFAULT_LOGIN_TIMEOUT_SEC
      }
    };

    this.runs.set(run.id, run);
    await this.advanceRun(run.id, input);
    return run;
  }

  async advanceRun(runId: string, input?: Partial<AgentRunInput>): Promise<AgentRun> {
    const run = this.requireRun(runId);
    if (input?.query) run.query = input.query.trim();
    if (input?.sessionId) run.sessionId = input.sessionId.trim();
    if (input?.maxNotes !== undefined && Number.isFinite(input.maxNotes)) {
      run.options.maxNotes = Math.max(1, Math.floor(input.maxNotes));
    }
    if (input?.scrollTimes !== undefined && Number.isFinite(input.scrollTimes)) {
      run.options.scrollTimes = Math.max(0, Math.floor(input.scrollTimes));
    }
    if (input?.loginTimeoutSec !== undefined && Number.isFinite(input.loginTimeoutSec)) {
      run.options.loginTimeoutSec = Math.max(1, Math.floor(input.loginTimeoutSec));
    }

    run.updatedAt = Date.now();
    this.scheduleRun(run);
    return run;
  }

  private requireRun(id: string): AgentRun {
    const run = this.runs.get(id);
    if (!run) throw new Error("RUN_NOT_FOUND");
    return run;
  }

  private async runLoop(run: AgentRun): Promise<void> {
    let steps = 0;
    while (steps < MAX_STEPS_PER_RUN) {
      steps += 1;
      if (run.state === "DONE" || run.state === "ERROR") return;

      if (run.state === "INIT") {
        await this.handleCreateSession(run);
        continue;
      }

      if (run.state === "NEED_LOGIN") {
        await this.handleWaitLogin(run);
        if (run.state !== "READY") return;
        continue;
      }

      if (run.state === "READY") {
        await this.handleSearch(run);
        return;
      }

      return;
    }
  }

  private scheduleRun(run: AgentRun): void {
    if (this.running.has(run.id)) return;
    this.running.add(run.id);
    void (async () => {
      try {
        await this.runLoop(run);
      } finally {
        this.running.delete(run.id);
      }
    })();
  }

  private async pushStep(run: AgentRun, step: AgentStep): Promise<void> {
    const summary = await this.narrator.summarize({
      action: step.action,
      state: step.state,
      outcome: step.status,
      detail: step.detail
    });
    run.steps.push({ ...step, summary });
    run.updatedAt = Date.now();
  }

  private async handleCreateSession(run: AgentRun): Promise<void> {
    if (run.sessionId) {
      run.viewUrl = run.viewUrl ?? buildViewUrl(run.sessionId);
      run.state = "NEED_LOGIN";
      await this.pushStep(run, {
        ts: new Date().toISOString(),
        state: run.state,
        action: "create_session",
        status: "ok",
        detail: { reused: true, sessionId: run.sessionId }
      });
      return;
    }

    try {
      const data = await this.mcpClient.callTool<{ sessionId: string; viewUrl: string }>(
        "create_session",
        {}
      );
      run.sessionId = data.sessionId;
      run.viewUrl = data.viewUrl;
      run.state = "NEED_LOGIN";
      await this.pushStep(run, {
        ts: new Date().toISOString(),
        state: run.state,
        action: "create_session",
        status: "ok",
        detail: { sessionId: data.sessionId, viewUrl: data.viewUrl }
      });
    } catch (err) {
      run.state = "ERROR";
      run.error = err instanceof Error ? err.message : "CREATE_SESSION_FAILED";
      await this.pushStep(run, {
        ts: new Date().toISOString(),
        state: run.state,
        action: "create_session",
        status: "error",
        detail: { error: run.error }
      });
    }
  }

  private async handleWaitLogin(run: AgentRun): Promise<void> {
    if (!run.sessionId) {
      run.state = "ERROR";
      run.error = "SESSION_ID_MISSING";
      await this.pushStep(run, {
        ts: new Date().toISOString(),
        state: run.state,
        action: "wait_for_login",
        status: "error",
        detail: { error: run.error }
      });
      return;
    }

    try {
      const data = await this.mcpClient.callTool<{
        status: string;
        debug?: { url: string; signals: Record<string, boolean>; pages: number };
      }>("wait_for_login", {
        sessionId: run.sessionId,
        timeoutSec: run.options.loginTimeoutSec
      });
      const status = data.status;
      if (status === "READY") {
        run.state = "READY";
        await this.pushStep(run, {
          ts: new Date().toISOString(),
          state: run.state,
          action: "wait_for_login",
          status: "ok",
          detail: { status, debug: data.debug }
        });
        return;
      }
      run.state = "NEED_LOGIN";
      await this.pushStep(run, {
        ts: new Date().toISOString(),
        state: run.state,
        action: "wait_for_login",
        status: "waiting",
        detail: { status, viewUrl: run.viewUrl, debug: data.debug }
      });
    } catch (err) {
      run.state = "ERROR";
      run.error = err instanceof Error ? err.message : "WAIT_LOGIN_FAILED";
      await this.pushStep(run, {
        ts: new Date().toISOString(),
        state: run.state,
        action: "wait_for_login",
        status: "error",
        detail: { error: run.error }
      });
    }
  }

  private async handleSearch(run: AgentRun): Promise<void> {
    if (!run.sessionId) {
      run.state = "ERROR";
      run.error = "SESSION_ID_MISSING";
      await this.pushStep(run, {
        ts: new Date().toISOString(),
        state: run.state,
        action: "xhs_search",
        status: "error",
        detail: { error: run.error }
      });
      return;
    }

    try {
      if (!run.searchQuery) {
        const result = await this.keyworder.extract(run.query);
        run.keywordCandidates = result.queries;
        run.searchQuery = result.queries[0] ?? run.query;
        await this.pushStep(run, {
          ts: new Date().toISOString(),
          state: run.state,
          action: "keyword_extract",
          status: "ok",
          detail: { count: result.queries.length, method: result.method, reason: result.reason ?? null }
        });
      }

      const data = await this.mcpClient.callTool<{ status: string; notes: Note[] }>("xhs_search", {
        sessionId: run.sessionId,
        query: run.searchQuery ?? run.query,
        maxNotes: run.options.maxNotes,
        scrollTimes: run.options.scrollTimes
      });
      if (data.status === "READY") {
        run.notes = data.notes;
        run.state = "DONE";
        await this.pushStep(run, {
          ts: new Date().toISOString(),
          state: run.state,
          action: "xhs_search",
          status: "ok",
          detail: { count: data.notes?.length ?? 0 }
        });
      } else if (data.status === "NEED_LOGIN") {
        run.state = "NEED_LOGIN";
        await this.pushStep(run, {
          ts: new Date().toISOString(),
          state: run.state,
          action: "xhs_search",
          status: "waiting",
          detail: { status: data.status, viewUrl: run.viewUrl }
        });
      } else {
        run.state = "ERROR";
        run.error = `SEARCH_FAILED_${data.status}`;
        await this.pushStep(run, {
          ts: new Date().toISOString(),
          state: run.state,
          action: "xhs_search",
          status: "error",
          detail: { status: data.status }
        });
      }
    } catch (err) {
      run.state = "ERROR";
      run.error = err instanceof Error ? err.message : "SEARCH_FAILED";
      await this.pushStep(run, {
        ts: new Date().toISOString(),
        state: run.state,
        action: "xhs_search",
        status: "error",
        detail: { error: run.error }
      });
    }
  }
}

export const agentManager = new AgentManager();
