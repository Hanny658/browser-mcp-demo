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

const cwd = process.cwd();

export const config = {
  host: process.env.HOST ?? "127.0.0.1",
  port: parseIntSafe(process.env.PORT, 3000),
  publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? "").replace(/\/+$/, ""),
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
