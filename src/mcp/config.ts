// ── MCP Server Definitions ───────────────────────────────────

export interface McpServerConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  enabled: boolean;
}

/**
 * Build MCP server configs from environment variables.
 */
export function getMcpServers(): McpServerConfig[] {
  const servers: McpServerConfig[] = [];

  // ── Google Workspace (Gmail + Calendar + Drive) ────────────
  const googleCredsFile = process.env["GOOGLE_CREDENTIALS_FILE"];
  if (googleCredsFile) {
    servers.push({
      name: "google-workspace",
      command: "npx",
      args: ["-y", "@presto-ai/google-workspace-mcp"],
      env: {
        GOOGLE_CREDENTIALS_FILE: googleCredsFile,
      },
      enabled: true,
    });
  }

  // ── Notion ─────────────────────────────────────────────────
  const notionApiKey = process.env["NOTION_API_KEY"];
  if (notionApiKey) {
    servers.push({
      name: "notion",
      command: "npx",
      args: ["-y", "@notionhq/notion-mcp-server"],
      env: {
        OPENAPI_MCP_HEADERS: JSON.stringify({
          Authorization: `Bearer ${notionApiKey}`,
          "Notion-Version": "2022-06-28",
        }),
      },
      enabled: true,
    });
  }

  return servers;
}
