import { McpClient } from "./client.js";
import { getMcpServers } from "./config.js";
import type { ToolDefinition } from "../agent.js";

export { McpClient } from "./client.js";

// ── MCP Manager ──────────────────────────────────────────────
// Manages all MCP server connections.

export class McpManager {
  private clients: McpClient[] = [];

  /**
   * Connect to all configured MCP servers.
   */
  async connectAll(): Promise<void> {
    const servers = getMcpServers();

    if (servers.length === 0) {
      console.log("   🔌 MCP: no servers configured");
      return;
    }

    console.log(`   🔌 MCP: connecting to ${servers.length} server(s)...`);

    for (const serverConfig of servers) {
      if (!serverConfig.enabled) continue;

      const client = new McpClient(serverConfig);
      try {
        // Timeout MCP connection — prevents bot hang on headless VPS (OAuth flows)
        const connectTimeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("connection timeout (15s)")), 15000)
        );
        await Promise.race([client.connect(), connectTimeout]);
        this.clients.push(client);
      } catch (error) {
        console.error(
          `   ❌ MCP [${serverConfig.name}]: skipped — ${error instanceof Error ? error.message : error}`
        );
      }
    }
  }

  /**
   * Get all tools from all connected MCP servers.
   */
  getAllTools(): ToolDefinition[] {
    const allTools: ToolDefinition[] = [];
    for (const client of this.clients) {
      if (client.isConnected()) {
        allTools.push(...client.getTools());
      }
    }
    return allTools;
  }

  /**
   * Disconnect all MCP servers.
   */
  async disconnectAll(): Promise<void> {
    for (const client of this.clients) {
      await client.disconnect();
    }
    this.clients = [];
  }

  /**
   * Get connected server count.
   */
  get connectedCount(): number {
    return this.clients.filter((c) => c.isConnected()).length;
  }
}
