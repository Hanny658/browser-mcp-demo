import { randomUUID } from "crypto";
import { config } from "../config.js";
import { sanitizeOutput } from "../security/policy.js";
import { normalizeSite } from "../sites/registry.js";
import { buildViewUrl } from "../server/viewUrl.js";
import { McpInProcessClient } from "./mcpClient.js";
import { AgentNarrator } from "./narrator.js";
import { AgentKeyworder } from "./keyworder.js";
import type { AgentRun, AgentRunInput, AgentStep } from "./types.js";
import type { Note } from "../types.js";

const DEFAULT_MAX_NOTES = 20;
const DEFAULT_SCROLL_TIMES = 0;
const DEFAULT_LOGIN_TIMEOUT_SEC = 30;
const DEFAULT_DETAIL_COUNT = 0;
const MAX_STEPS_PER_RUN = 4;
const DETAIL_EXTRACTION_MAX = 10;
const DETAIL_EXTRACTION_PARALLEL_MAX = 8;
const DETAIL_EXTRACTION_TIMEOUT_MS = Math.max(3000, config.agentDetailTimeoutMs);
const DETAIL_RETRY_TIMEOUT_MS = Math.max(DETAIL_EXTRACTION_TIMEOUT_MS + 5000, Math.floor(DETAIL_EXTRACTION_TIMEOUT_MS * 1.5));
const DEFAULT_DETAIL_PARALLEL = Math.max(1, Math.min(config.agentDetailParallel, DETAIL_EXTRACTION_PARALLEL_MAX));

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
      site: run.site,
      searchQuery: run.searchQuery ?? null,
      keywordCandidates: run.keywordCandidates ?? [],
      options: run.options,
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
      site: normalizeSite(input.site),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      steps: [],
      options: {
        maxNotes: Number.isFinite(input.maxNotes) ? Math.max(1, Math.floor(input.maxNotes!)) : DEFAULT_MAX_NOTES,
        scrollTimes: Number.isFinite(input.scrollTimes) ? Math.max(0, Math.floor(input.scrollTimes!)) : DEFAULT_SCROLL_TIMES,
        loginTimeoutSec: Number.isFinite(input.loginTimeoutSec)
          ? Math.max(1, Math.floor(input.loginTimeoutSec!))
          : DEFAULT_LOGIN_TIMEOUT_SEC,
        detailCount: Number.isFinite(input.detailCount)
          ? Math.max(0, Math.min(Math.floor(input.detailCount!), DETAIL_EXTRACTION_MAX))
          : DEFAULT_DETAIL_COUNT,
        detailParallel: Number.isFinite(input.detailParallel)
          ? Math.max(1, Math.min(Math.floor(input.detailParallel!), DETAIL_EXTRACTION_PARALLEL_MAX))
          : DEFAULT_DETAIL_PARALLEL
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
    if (input?.site) run.site = normalizeSite(input.site);
    if (input?.maxNotes !== undefined && Number.isFinite(input.maxNotes)) {
      run.options.maxNotes = Math.max(1, Math.floor(input.maxNotes));
    }
    if (input?.scrollTimes !== undefined && Number.isFinite(input.scrollTimes)) {
      run.options.scrollTimes = Math.max(0, Math.floor(input.scrollTimes));
    }
    if (input?.loginTimeoutSec !== undefined && Number.isFinite(input.loginTimeoutSec)) {
      run.options.loginTimeoutSec = Math.max(1, Math.floor(input.loginTimeoutSec));
    }
    if (input?.detailCount !== undefined && Number.isFinite(input.detailCount)) {
      run.options.detailCount = Math.max(0, Math.min(Math.floor(input.detailCount), DETAIL_EXTRACTION_MAX));
    }
    if (input?.detailParallel !== undefined && Number.isFinite(input.detailParallel)) {
      run.options.detailParallel = Math.max(
        1,
        Math.min(Math.floor(input.detailParallel), DETAIL_EXTRACTION_PARALLEL_MAX)
      );
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
      const data = await this.mcpClient.callTool<{ sessionId: string; viewUrl: string }>("create_session", {
        site: run.site
      });
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
        timeoutSec: run.options.loginTimeoutSec,
        site: run.site
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
        action: "platform_search",
        status: "error",
        detail: { error: run.error }
      });
      return;
    }

    try {
      if (!run.searchQuery) {
        const result = await this.keyworder.extract(run.query, run.site);
        run.keywordCandidates = result.queries;
        run.searchQuery = result.queries[0] ?? run.query;
        await this.pushStep(run, {
          ts: new Date().toISOString(),
          state: run.state,
          action: "keyword_extract",
          status: "ok",
          detail: {
            count: result.queries.length,
            method: result.method,
            reason: result.reason ?? null,
            queries: result.queries.slice(0, 3)
          }
        });
      }

      const data = await this.mcpClient.callTool<{
        status: string;
        notes: Note[];
        reason?: string;
        debug?: { url?: string; title?: string };
      }>("platform_search", {
        sessionId: run.sessionId,
        query: run.searchQuery ?? run.query,
        maxNotes: run.options.maxNotes,
        scrollTimes: run.options.scrollTimes,
        site: run.site
      });
      if (data.status === "READY") {
        run.notes = data.notes;
        if (run.site === "xhs" && run.options.detailCount > 0 && (data.notes?.length ?? 0) > 0) {
          run.notes = await this.enrichXhsDetails(run, run.notes);
        }
        run.state = "DONE";
        const count = run.notes?.length ?? 0;
        await this.pushStep(run, {
          ts: new Date().toISOString(),
          state: run.state,
          action: "platform_search",
          status: "ok",
          detail: {
            count,
            reason: count === 0 ? data.reason ?? "no_results_or_blocked" : undefined,
            debug: count === 0 ? data.debug : undefined
          }
        });
      } else if (data.status === "NEED_LOGIN") {
        run.state = "NEED_LOGIN";
        await this.pushStep(run, {
          ts: new Date().toISOString(),
          state: run.state,
          action: "platform_search",
          status: "waiting",
          detail: { status: data.status, viewUrl: run.viewUrl }
        });
      } else {
        run.state = "ERROR";
        run.error = `SEARCH_FAILED_${data.status}`;
        await this.pushStep(run, {
          ts: new Date().toISOString(),
          state: run.state,
          action: "platform_search",
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
        action: "platform_search",
        status: "error",
        detail: { error: run.error }
      });
    }
  }

  private mergeNote(base: Note, detail: Note): Note {
    const mergedDesc = detail.desc ?? base.desc ?? null;
    return {
      ...base,
      // Only enrich main body text to avoid detail-page noise overriding search metadata.
      desc: mergedDesc,
      snippet: mergedDesc ? mergedDesc.slice(0, 180) : base.snippet ?? null
    };
  }

  private async enrichXhsDetails(run: AgentRun, notes: Note[]): Promise<Note[]> {
    if (!run.sessionId) return notes;
    const detailCount = Math.max(0, Math.min(run.options.detailCount, notes.length, DETAIL_EXTRACTION_MAX));
    if (detailCount === 0) return notes;

    const next = notes.slice();
    const targetIndexes = next
      .map((note, index) => ({ note, index }))
      .filter(({ note }) => typeof note?.url === "string" && note.url.length > 0)
      .slice(0, detailCount);

    let success = 0;
    let needLogin = 0;
    let failed = 0;
    let timeout = 0;
    const timeoutIndexes = new Set<number>();
    let retried = 0;
    let retryRecovered = 0;

    const withTimeout = async <T>(task: Promise<T>, timeoutMs: number): Promise<T> => {
      return await Promise.race([
        task,
        new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error("DETAIL_TIMEOUT")), timeoutMs))
      ]);
    };

    const extractDetail = async (url: string, timeoutMs: number) => {
      try {
        const detail = await withTimeout(
          this.mcpClient.callTool<{ status: string; note: Note | null }>("xhs_open_and_extract", {
            sessionId: run.sessionId,
            url,
            site: run.site
          }),
          timeoutMs
        );
        return detail;
      } catch (err) {
        const message = err instanceof Error ? err.message : "DETAIL_FAILED";
        return { status: message === "DETAIL_TIMEOUT" ? "TIMEOUT" : "ERROR", note: null as Note | null, error: message };
      }
    };

    for (let i = 0; i < targetIndexes.length; i += run.options.detailParallel) {
      const chunk = targetIndexes.slice(i, i + run.options.detailParallel);
      const results = await Promise.all(
        chunk.map(async ({ note, index }) => {
          const detail = await extractDetail(note.url, DETAIL_EXTRACTION_TIMEOUT_MS);
          return {
            index,
            detail
          };
        })
      );

      for (const { index, detail } of results) {
        if (detail.status === "READY" && detail.note) {
          const existing = next[index];
          if (existing) {
            next[index] = this.mergeNote(existing, detail.note);
            success += 1;
          } else {
            failed += 1;
          }
        } else if (detail.status === "NEED_LOGIN") {
          needLogin += 1;
        } else if (detail.status === "TIMEOUT") {
          timeout += 1;
          timeoutIndexes.add(index);
        } else {
          failed += 1;
        }
      }
    }

    if (timeoutIndexes.size > 0 && run.options.detailParallel > 1) {
      for (const index of timeoutIndexes) {
        const note = next[index];
        if (!note?.url) continue;
        retried += 1;
        const detail = await extractDetail(note.url, DETAIL_RETRY_TIMEOUT_MS);
        if (detail.status === "READY" && detail.note) {
          next[index] = this.mergeNote(note, detail.note);
          success += 1;
          timeout = Math.max(0, timeout - 1);
          retryRecovered += 1;
        } else if (detail.status === "NEED_LOGIN") {
          needLogin += 1;
          timeout = Math.max(0, timeout - 1);
        } else if (detail.status === "ERROR") {
          failed += 1;
          timeout = Math.max(0, timeout - 1);
        }
      }
    }

    await this.pushStep(run, {
      ts: new Date().toISOString(),
      state: run.state,
      action: "xhs_open_and_extract",
      status: success > 0 ? "ok" : failed > 0 || timeout > 0 ? "error" : "waiting",
      detail: {
        attempted: targetIndexes.length,
        parallel: run.options.detailParallel,
        success,
        needLogin,
        timeout,
        failed,
        retried,
        retryRecovered
      }
    });

    return next;
  }
}

export const agentManager = new AgentManager();
