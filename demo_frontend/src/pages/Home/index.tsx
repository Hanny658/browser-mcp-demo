import { useMemo, useState } from "preact/hooks";
import "./style.css";

type AgentStep = {
  ts: string;
  state: string;
  action: string;
  status: string;
  summary?: string | null;
  detail?: {
    debug?: {
      url?: string;
      signals?: Record<string, boolean>;
    };
  } | null;
};

type Note = {
  id: string;
  url: string;
  title?: string | null;
  desc?: string | null;
  author?: string | null;
  snippet?: string | null;
  liked_count?: number | null;
  collected_count?: number | null;
  comments_count?: number | null;
  shared_count?: number | null;
  publish_time?: string | null;
};

type AgentRunResponse = {
  runId: string;
  status: string;
  sessionId?: string;
  viewUrl?: string;
  query?: string;
  notes?: Note[];
  steps?: AgentStep[];
  error?: string | null;
};

const formatCount = (value?: number | null) => {
  if (value === null || value === undefined) return "--";
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return `${value}`;
};

const postJson = async (url: string, body: Record<string, unknown>) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data?.error === "string" ? data.error : "Request failed";
    throw new Error(message);
  }
  return data as AgentRunResponse;
};

export function Home() {
  const [query, setQuery] = useState("");
  const [maxNotes, setMaxNotes] = useState(8);
  const [scrollTimes, setScrollTimes] = useState(2);
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [viewUrl, setViewUrl] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reuseSession, setReuseSession] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const summaryLine = useMemo(() => {
    if (!status) return "Idle";
    return `${status}${runId ? ` · ${runId.slice(0, 8)}` : ""}`;
  }, [status, runId]);

  const applyRun = (data: AgentRunResponse) => {
    setRunId(data.runId);
    setStatus(data.status);
    setSteps(data.steps ?? []);
    setNotes(data.notes ?? []);
    setViewUrl(data.viewUrl ?? null);
    setSessionId(data.sessionId ?? null);
    setError(data.error ?? null);
    setLastUpdated(new Date().toLocaleTimeString());
  };

  const handleSubmit = async (event: Event) => {
    event.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        query,
        maxNotes,
        scrollTimes
      };
      if (reuseSession && sessionId) {
        payload.sessionId = sessionId;
      }
      const data = await postJson("/agent/run", payload);
      applyRun(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  };

  const handleContinue = async () => {
    if (!runId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await postJson("/agent/continue", { runId, loginTimeoutSec: 25 });
      applyRun(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Continue failed");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setRunId(null);
    setStatus(null);
    setSteps([]);
    setNotes([]);
    setViewUrl(null);
    setError(null);
    setLastUpdated(null);
  };

  const needsLogin = status === "NEED_LOGIN" && !!viewUrl;

  return (
    <div class="home">
      <section class="hero">
        <div>
          <p class="eyebrow">Remote Browser + MCP Agent</p>
          <h1>Find team notes with natural language.</h1>
          <p class="sub">
            Ask a question, login through the MCP session view, and get structured results back.
          </p>
        </div>
        <div class="status-card">
          <span class={`status-pill status-${status ?? "idle"}`}>{summaryLine}</span>
          <span class="status-meta">Last update: {lastUpdated ?? "--"}</span>
          {sessionId && <span class="status-meta">Session: {sessionId.slice(0, 8)}</span>}
        </div>
      </section>

      <section class="chat-panel">
        <form class="chat-form" onSubmit={handleSubmit}>
          <label class="label">Your request</label>
          <textarea
            value={query}
            onInput={(event) => setQuery((event.target as HTMLTextAreaElement).value)}
            placeholder="Example: Find the best team notes about campus life"
            rows={3}
          />

          <div class="controls">
            <div class="control">
              <label class="label">Max notes: {maxNotes}</label>
              <input
                type="range"
                min={1}
                max={50}
                value={maxNotes}
                onInput={(event) => setMaxNotes(Number((event.target as HTMLInputElement).value))}
              />
            </div>
            <div class="control">
              <label class="label">Scroll times: {scrollTimes}</label>
              <input
                type="range"
                min={0}
                max={8}
                value={scrollTimes}
                onInput={(event) => setScrollTimes(Number((event.target as HTMLInputElement).value))}
              />
            </div>
            <label class="toggle">
              <input
                type="checkbox"
                checked={reuseSession}
                onChange={(event) => setReuseSession((event.target as HTMLInputElement).checked)}
              />
              Reuse session
            </label>
          </div>

          <div class="actions">
            <button class="primary" type="submit" disabled={loading || !query.trim()}>
              {loading ? "Working..." : "Send"}
            </button>
            <button type="button" disabled={loading || !runId} onClick={handleContinue}>
              Continue
            </button>
            <button type="button" class="ghost" onClick={handleReset}>
              Reset
            </button>
          </div>

          {error && <div class="error">{error}</div>}
        </form>

        {needsLogin && (
          <div class="callout">
            <div>
              <strong>Login required.</strong>
              <p>Open the MCP session view, finish login, then click Continue.</p>
              <code>{viewUrl}</code>
            </div>
            <button
              type="button"
              class="primary"
              onClick={() => window.open(viewUrl!, "_blank", "noopener,noreferrer")}
            >
              Open Login View
            </button>
          </div>
        )}
      </section>

      <section class="grid">
        <div class="panel">
          <h2>Agent log</h2>
          <div class="log-list">
            {steps.length === 0 && <div class="empty">No steps yet.</div>}
            {steps.map((step) => (
              <div key={`${step.ts}-${step.action}`} class={`log-item log-${step.status}`}>
                <div class="log-head">
                  <span class="log-action">{step.action}</span>
                  <span class="log-state">{step.state}</span>
                  <span class="log-time">{new Date(step.ts).toLocaleTimeString()}</span>
                </div>
                <div class="log-body">
                  <p>{step.summary ?? "Waiting for update."}</p>
                  {step.detail?.debug && (
                    <p class="log-debug">
                      Debug: {step.detail.debug.url ?? "--"} · signals{" "}
                      {JSON.stringify(step.detail.debug.signals)}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div class="panel">
          <h2>Notes</h2>
          <div class="note-list">
            {notes.length === 0 && <div class="empty">No notes yet.</div>}
            {notes.map((note) => (
              <a class="note-card" key={note.id} href={note.url} target="_blank" rel="noreferrer">
                <div class="note-title">{note.title || note.desc || "Untitled note"}</div>
                {note.author && <div class="note-author">by {note.author}</div>}
                <p class="note-snippet">{note.snippet || note.desc || "No snippet available."}</p>
                <div class="note-meta">
                  <span>Likes {formatCount(note.liked_count)}</span>
                  <span>Collects {formatCount(note.collected_count)}</span>
                  <span>Comments {formatCount(note.comments_count)}</span>
                </div>
              </a>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
