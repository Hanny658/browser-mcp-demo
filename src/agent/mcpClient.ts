import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../server/mcp.js";

export class McpInProcessClient {
  private client?: Client;
  private connected = false;

  private async ensureConnected(): Promise<void> {
    if (this.connected) return;
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer();
    await server.connect(serverTransport);

    this.client = new Client({ name: "xhs-agent-client", version: "0.1.0" });
    await this.client.connect(clientTransport);
    this.connected = true;
  }

  async callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    await this.ensureConnected();
    const result = (await this.client!.callTool({ name, arguments: args })) as unknown;
    const content = (result as { content?: Array<{ type?: string; text?: string }> })?.content;
    const first = Array.isArray(content) ? content[0] : undefined;
    if (first && first.type === "text" && typeof first.text === "string") {
      try {
        return JSON.parse(first.text) as T;
      } catch {
        return { raw: first.text } as T;
      }
    }
    return result as T;
  }
}
