import express from "express";
import type { Server } from "http";
import { config } from "../config.js";
import { sessionManager } from "../browser/sessionManager.js";
import { sanitizeOutput } from "../security/policy.js";
import { buildViewUrl } from "./viewUrl.js";
import { agentManager } from "../agent/agentManager.js";

const renderViewPage = (sessionId: string) => {
  const safeId = sessionId.replace(/[^a-zA-Z0-9-]/g, "");
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>XHS Session View</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 24px; }
    code { background: #f4f4f4; padding: 2px 4px; }
  </style>
</head>
<body>
  <h1>Session ${safeId}</h1>
  <p>This MVP uses a local headful Chromium window for HITL login.</p>
  <p>If you do not see a browser window, ensure <code>HEADLESS=false</code> and restart.</p>
  <p>After login, return to your MCP client and call <code>wait_for_login</code>.</p>
</body>
</html>`;
};

export async function startHttpServer(): Promise<Server> {
  const app = express();
  app.use(express.json({ limit: "64kb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  app.post("/session", async (_req, res) => {
    try {
      const session = await sessionManager.createSession();
      const payload = sanitizeOutput({
        sessionId: session.id,
        viewUrl: buildViewUrl(session.id)
      });
      res.json(payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : "UNKNOWN_ERROR";
      const status = message === "MAX_SESSIONS_REACHED" ? 429 : 500;
      res.status(status).json({ error: message });
    }
  });

  app.get("/session/view/:id", (req, res) => {
    const session = sessionManager.getSession(req.params.id);
    if (!session) {
      res.status(404).send("Session not found.");
      return;
    }
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.send(renderViewPage(session.id));
  });

  app.post("/session/:id/destroy", async (req, res) => {
    const ok = await sessionManager.destroySession(req.params.id);
    res.json({ ok });
  });

  app.post("/agent/run", async (req, res) => {
    try {
      const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";
      if (!query) {
        res.status(400).json({ error: "QUERY_REQUIRED" });
        return;
      }
    const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId.trim() : undefined;
    const maxNotes = typeof req.body?.maxNotes === "number" ? req.body.maxNotes : undefined;
    const scrollTimes = typeof req.body?.scrollTimes === "number" ? req.body.scrollTimes : undefined;
    const loginTimeoutSec = typeof req.body?.loginTimeoutSec === "number" ? req.body.loginTimeoutSec : undefined;
    const site = typeof req.body?.site === "string" ? req.body.site.trim() : undefined;

    const run = await agentManager.createRun({
      query,
      sessionId,
      maxNotes,
      scrollTimes,
      loginTimeoutSec,
      site
    });
      res.json(sanitizeOutput(agentManager.toPublicRun(run)));
    } catch (err) {
      const message = err instanceof Error ? err.message : "UNKNOWN_ERROR";
      res.status(500).json({ error: message });
    }
  });

  app.post("/agent/continue", async (req, res) => {
    try {
      const runId = typeof req.body?.runId === "string" ? req.body.runId.trim() : "";
      if (!runId) {
        res.status(400).json({ error: "RUN_ID_REQUIRED" });
        return;
      }
      const loginTimeoutSec = typeof req.body?.loginTimeoutSec === "number" ? req.body.loginTimeoutSec : undefined;
      const run = await agentManager.advanceRun(runId, { loginTimeoutSec });
      res.json(sanitizeOutput(agentManager.toPublicRun(run)));
    } catch (err) {
      const message = err instanceof Error ? err.message : "UNKNOWN_ERROR";
      res.status(500).json({ error: message });
    }
  });

  app.get("/agent/run/:id", (req, res) => {
    const run = agentManager.getRun(req.params.id);
    if (!run) {
      res.status(404).json({ error: "RUN_NOT_FOUND" });
      return;
    }
    res.json(sanitizeOutput(agentManager.toPublicRun(run)));
  });

  return new Promise((resolve) => {
    const server = app.listen(config.port, config.host, () => {
      console.error(`[http] listening on ${config.host}:${config.port}`);
      resolve(server);
    });
  });
}
