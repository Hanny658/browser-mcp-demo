import express from "express";
import type { Server } from "http";
import { config } from "../config.js";
import { sessionManager } from "../browser/sessionManager.js";
import { sanitizeOutput } from "../security/policy.js";

const buildBaseUrl = () => {
  if (config.publicBaseUrl) return config.publicBaseUrl;
  return `http://${config.host}:${config.port}`;
};

export const buildViewUrl = (sessionId: string) => {
  const base = buildBaseUrl().replace(/\/+$/, "");
  return `${base}/session/view/${sessionId}`;
};

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

  return new Promise((resolve) => {
    const server = app.listen(config.port, config.host, () => {
      console.error(`[http] listening on ${config.host}:${config.port}`);
      resolve(server);
    });
  });
}
