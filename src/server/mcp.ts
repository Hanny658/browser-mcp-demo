import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { sessionManager } from "../browser/sessionManager.js";
import { waitForLogin, xhsOpenAndExtract, xhsSearch } from "../browser/xhs.js";
import { auditLog, stringifyAndGuard } from "../security/policy.js";
import { buildViewUrl } from "./http.js";

const tools = [
  {
    name: "create_session",
    description: "Create a new browser session and return sessionId + viewUrl.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "wait_for_login",
    description: "Poll login status for a session.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        timeoutSec: { type: "number" }
      },
      required: ["sessionId"],
      additionalProperties: false
    }
  },
  {
    name: "xhs_search",
    description: "Search XHS and return a list of notes.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        query: { type: "string" },
        maxNotes: { type: "number" },
        scrollTimes: { type: "number" }
      },
      required: ["sessionId", "query"],
      additionalProperties: false
    }
  },
  {
    name: "xhs_open_and_extract",
    description: "Open a note and extract full detail (stub for MVP).",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        url: { type: "string" }
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

export async function startMcpServer(): Promise<void> {
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
        const status = await waitForLogin(session, timeoutSec);
        await auditLog("wait_for_login", sessionId);
        return respondJson({ status });
      }
      case "xhs_search": {
        const sessionId = requireString(args.sessionId, "sessionId");
        const query = requireString(args.query, "query");
        const maxNotes = getOptionalNumber(args.maxNotes, 20);
        const scrollTimes = getOptionalNumber(args.scrollTimes, 2);
        const session = sessionManager.requireSession(sessionId);
        sessionManager.touch(sessionId);
        const result = await xhsSearch(session, query, maxNotes, scrollTimes);
        await auditLog("xhs_search", sessionId, { keyword: query });
        return respondJson(result);
      }
      case "xhs_open_and_extract": {
        const sessionId = requireString(args.sessionId, "sessionId");
        const url = requireString(args.url, "url");
        const session = sessionManager.requireSession(sessionId);
        sessionManager.touch(sessionId);
        const result = await xhsOpenAndExtract(session, url);
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

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[mcp] stdio transport ready");
}
