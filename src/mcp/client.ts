import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpServerConfig } from "./config.js";
import { isToolAllowed, redactForLog, logMcpCall } from "./guardrails.js";
import type { ToolDefinition } from "../agent.js";

// ── MCP Client ───────────────────────────────────────────────
// Wraps a single MCP server connection.

// Fields that Gemini's FunctionDeclaration does NOT support
const UNSUPPORTED_FIELDS = new Set([
  "additionalProperties",
  "$ref",
  "$schema",
  "default",
  "definitions",
  "allOf",
  "anyOf",
  "oneOf",
  "not",
  "patternProperties",
  "if",
  "then",
  "else",
  "const",
  "examples",
  "title",
  "id",
  "$id",
  "$comment",
  "readOnly",
  "writeOnly",
  "deprecated",
  "externalDocs",
]);

/**
 * Recursively strip JSON Schema fields that Gemini doesn't support.
 */
function sanitizeSchemaProperties(
  properties: Record<string, unknown>
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(properties)) {
    if (UNSUPPORTED_FIELDS.has(key)) continue;

    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = value as Record<string, unknown>;

      // If a property only has $ref, replace with { type: "string" }
      if ("$ref" in nested && Object.keys(nested).length <= 2) {
        clean[key] = { type: "string", description: `Reference: ${String(nested["$ref"])}` };
        continue;
      }

      // Recursively clean nested objects (e.g., items, properties)
      const cleaned: Record<string, unknown> = {};
      for (const [nk, nv] of Object.entries(nested)) {
        if (UNSUPPORTED_FIELDS.has(nk)) continue;

        if (nk === "properties" && nv && typeof nv === "object") {
          cleaned[nk] = sanitizeSchemaProperties(nv as Record<string, unknown>);
        } else if (nk === "items" && nv && typeof nv === "object") {
          cleaned[nk] = sanitizeSchemaProperties({ _: nv })["_"];
        } else {
          cleaned[nk] = nv;
        }
      }
      clean[key] = cleaned;
    } else {
      clean[key] = value;
    }
  }

  return clean;
}

export class McpClient {
  private readonly client: Client;
  private transport: StdioClientTransport | null = null;
  private connected = false;
  readonly serverName: string;
  private readonly discoveredTools: Map<string, { description: string; inputSchema: unknown }> =
    new Map();

  constructor(private readonly config: McpServerConfig) {
    this.serverName = config.name;
    this.client = new Client(
      { name: `gravity-claw-${config.name}`, version: "1.0.0" },
      { capabilities: {} }
    );
  }

  /**
   * Connect to the MCP server (spawns subprocess).
   */
  async connect(): Promise<void> {
    if (this.connected) return;

    try {
      const env = { ...process.env, ...(this.config.env ?? {}) };

      this.transport = new StdioClientTransport({
        command: this.config.command,
        args: this.config.args,
        env: env as Record<string, string>,
      });

      await this.client.connect(this.transport);
      this.connected = true;

      // Discover available tools
      const toolsResponse = await this.client.listTools();
      const blocked: string[] = [];

      for (const tool of toolsResponse.tools) {
        if (isToolAllowed(this.serverName, tool.name)) {
          this.discoveredTools.set(tool.name, {
            description: tool.description ?? "",
            inputSchema: tool.inputSchema,
          });
        } else {
          blocked.push(tool.name);
        }
      }

      console.log(
        `   🔌 MCP [${this.serverName}]: connected (${this.discoveredTools.size}/${toolsResponse.tools.length} tools allowed)`
      );

      // Verbose logging for debugging
      if (this.discoveredTools.size > 0) {
        const names = [...this.discoveredTools.keys()].join(", ");
        console.log(`      ✅ Allowed: ${names}`);
      }
      if (blocked.length > 0) {
        console.log(`      🚫 Blocked: ${blocked.join(", ")}`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`   ❌ MCP [${this.serverName}]: failed to connect — ${msg}`);
      this.connected = false;
    }
  }

  /**
   * Get all discovered (and allowed) tools as agent ToolDefinitions.
   */
  getTools(): ToolDefinition[] {
    const tools: ToolDefinition[] = [];
    const serverName = this.serverName;
    const client = this.client;

    for (const [name, meta] of this.discoveredTools) {
      // Gemini requires tool names matching [a-zA-Z_][a-zA-Z0-9_]*
      const rawName = `${serverName}_${name}`;
      const toolName = rawName.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^[0-9]/, "_$&");

      // Sanitize schema — Gemini doesn't support many JSON Schema features
      const rawSchema = meta.inputSchema as Record<string, unknown>;
      const cleanProps = sanitizeSchemaProperties(
        (rawSchema.properties ?? {}) as Record<string, unknown>
      );
      const required = rawSchema.required as string[] | undefined;

      tools.push({
        name: toolName,
        description: `[${serverName}] ${meta.description}`.substring(0, 500),
        parameters: {
          type: "object",
          properties: cleanProps,
          required,
        },
        execute: async (input: Record<string, unknown>) => {
          console.log(
            `   🔌 MCP call: ${serverName}/${name} ${JSON.stringify(redactForLog(input)).substring(0, 100)}`
          );

          try {
            const result = await client.callTool({ name, arguments: input });
            logMcpCall(serverName, name, input, true);

            // Extract text content from MCP response
            const content = result.content as Array<{ type: string; text?: string }>;
            const text = content
              ?.filter((c) => c.type === "text")
              .map((c) => c.text ?? "")
              .join("\n");

            return text || JSON.stringify(result.content);
          } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            logMcpCall(serverName, name, input, false);
            return JSON.stringify({ error: errMsg });
          }
        },
      });
    }

    return tools;
  }

  /**
   * Disconnect from the MCP server.
   */
  async disconnect(): Promise<void> {
    if (!this.connected) return;
    try {
      await this.client.close();
      console.log(`   🔌 MCP [${this.serverName}]: disconnected`);
    } catch {
      // Ignore close errors
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }
}
