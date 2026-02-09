import { startHttpServer } from "./server/http.js";
import { startMcpServer } from "./server/mcp.js";
import { sessionManager } from "./browser/sessionManager.js";
import { agentManager } from "./agent/agentManager.js";

async function main() {
  sessionManager.startJanitor();
  agentManager.startJanitor();
  await startHttpServer();
  await startMcpServer();
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});

async function shutdown(signal: string) {
  console.error(`[shutdown] ${signal}`);
  await sessionManager.shutdown();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
