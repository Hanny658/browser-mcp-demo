import "dotenv/config";
import path from "path";

const parseIntSafe = (value: string | undefined, fallback: number) => {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseBool = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) return fallback;
  return value === "1" || value.toLowerCase() === "true";
};

const parseViewMode = (value: string | undefined) => {
  const mode = (value ?? "info").toLowerCase();
  return mode === "novnc" ? "novnc" : "info";
};

const cwd = process.cwd();

export const config = {
  host: process.env.HOST ?? "127.0.0.1",
  port: parseIntSafe(process.env.PORT, 3000),
  publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? "").replace(/\/+$/, ""),
  // Optional: serve the built frontend from the same HTTP server.
  uiDistDir: process.env.UI_DIST_DIR ? path.resolve(cwd, process.env.UI_DIST_DIR) : "",
  // "info" shows a static instruction page; "novnc" embeds a noVNC iframe.
  viewMode: parseViewMode(process.env.VIEW_MODE),
  // Example: http://HOST:7900/vnc.html?autoconnect=1&resize=scale&path=websockify
  // You can also include {sessionId} for future per-session routing.
  novncUrlTemplate: process.env.NOVNC_URL_TEMPLATE ?? "",
  maxSessions: parseIntSafe(process.env.MAX_SESSIONS, 5),
  sessionTtlMs: parseIntSafe(process.env.SESSION_TTL_MINUTES, 60) * 60 * 1000,
  profilesDir: path.resolve(cwd, process.env.PROFILES_DIR ?? "./profiles"),
  deleteProfile: parseBool(process.env.DELETE_PROFILE, true),
  headless: parseBool(process.env.HEADLESS, false),
  xhsBaseUrl: process.env.XHS_BASE_URL ?? "https://www.xiaohongshu.com",
  auditLogPath: path.resolve(cwd, process.env.AUDIT_LOG_PATH ?? "./logs/audit.log"),
  mcpTransport: process.env.MCP_TRANSPORT ?? "stdio",
  mcpHttpPort: parseIntSafe(process.env.MCP_HTTP_PORT, 3333),
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-5-mini",
  agentRunTtlMs: parseIntSafe(process.env.AGENT_RUN_TTL_MINUTES, 60) * 60 * 1000
};
