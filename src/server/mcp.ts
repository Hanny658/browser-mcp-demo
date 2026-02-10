import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { sessionManager } from "../browser/sessionManager.js";
import { getAdapter, normalizeSite } from "../sites/registry.js";
import { auditLog, stringifyAndGuard } from "../security/policy.js";
import { buildViewUrl } from "./viewUrl.js";

const tools = [
  {
    name: "create_session",
    description: "Create a new browser session and return sessionId + viewUrl.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "wait_for_login",
    description: "Poll login status for a session (site-specific when provided).",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        timeoutSec: { type: "number" },
        site: { type: "string" }
      },
      required: ["sessionId"],
      additionalProperties: false
    }
  },
  {
    name: "platform_search",
    description: "Search a site and return a list of notes.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        query: { type: "string" },
        maxNotes: { type: "number" },
        scrollTimes: { type: "number" },
        site: { type: "string" }
      },
      required: ["sessionId", "query"],
      additionalProperties: false
    }
  },
  {
    name: "xhs_open_and_extract",
    description: "Open a note and extract full detail (site-specific).",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        url: { type: "string" },
        site: { type: "string" }
      },
      required: ["sessionId", "url"],
      additionalProperties: false
    }
  },
  {
    name: "destroy_session",
    description: "Destroy a browser session.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" }
      },
      required: ["sessionId"],
      additionalProperties: false
    }
  }
];

const respondJson = (payload: unknown) => ({
  content: [{ type: "text", text: stringifyAndGuard(payload) }]
});

const requireString = (value: unknown, field: string) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`INVALID_${field.toUpperCase()}`);
  }
  return value.trim();
};

const getOptionalNumber = (value: unknown, fallback: number) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

export function createMcpServer() {
  const server = new Server(
    { name: "xhs-remote-browser-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;

    switch (name) {
      case "create_session": {
        const session = await sessionManager.createSession();
        await auditLog("create_session", session.id);
        return respondJson({ sessionId: session.id, viewUrl: buildViewUrl(session.id) });
      }
      case "wait_for_login": {
        const sessionId = requireString(args.sessionId, "sessionId");
        const timeoutSec = getOptionalNumber(args.timeoutSec, 120);
        const session = sessionManager.requireSession(sessionId);
        sessionManager.touch(sessionId);
        const site = normalizeSite(typeof args.site === "string" ? args.site : undefined);
        const adapter = getAdapter(site);
        const result = await adapter.waitForLogin(session, timeoutSec);
        await auditLog("wait_for_login", sessionId);
        return respondJson(result);
      }
      case "platform_search": {
        const sessionId = requireString(args.sessionId, "sessionId");
        const query = requireString(args.query, "query");
        const maxNotes = getOptionalNumber(args.maxNotes, 20);
        const scrollTimes = getOptionalNumber(args.scrollTimes, 2);
        const session = sessionManager.requireSession(sessionId);
        sessionManager.touch(sessionId);
        const site = normalizeSite(typeof args.site === "string" ? args.site : undefined);
        const adapter = getAdapter(site);
        const result = await adapter.search(session, query, maxNotes, scrollTimes);
        await auditLog("platform_search", sessionId, { keyword: query });
        return respondJson(result);
      }
      case "xhs_open_and_extract": {
        const sessionId = requireString(args.sessionId, "sessionId");
        const url = requireString(args.url, "url");
        const session = sessionManager.requireSession(sessionId);
        sessionManager.touch(sessionId);
        const site = normalizeSite(typeof args.site === "string" ? args.site : undefined);
        const adapter = getAdapter(site);
        const result = await adapter.openAndExtract(session, url);
        await auditLog("xhs_open_and_extract", sessionId, { noteUrl: url });
        return respondJson(result);
      }
      case "destroy_session": {
        const sessionId = requireString(args.sessionId, "sessionId");
        const ok = await sessionManager.destroySession(sessionId);
        await auditLog("destroy_session", sessionId);
        return respondJson({ ok });
      }
      default:
        throw new Error("UNKNOWN_TOOL");
    }
  });

  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[mcp] stdio transport ready");
}
