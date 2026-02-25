import * as fs from "node:fs";
import * as path from "node:path";

// ── Tool Allowlist ───────────────────────────────────────────
// Only tools on this list can execute. Everything else is blocked.
// Use "*" as a wildcard to allow ALL tools from a server (useful for initial testing).

const ALLOWED_TOOLS: Record<string, string[] | "*"> = {
  // Google Workspace (12 tools)
  "google-workspace": [
    // Calendar
    "calendar.list",
    "calendar.listEvents",
    "calendar.getEvent",
    "calendar.findFreeTime",
    "calendar.createEvent",
    "calendar.updateEvent",
    // Gmail
    "gmail.search",
    "gmail.get",
    "gmail.createDraft",
    "gmail.sendDraft",
    "gmail.send",
    // Drive
    "drive.search",
  ],

  // Notion (full access — database creation included)
  notion: [
    "API-post-search",
    "API-retrieve-a-page",
    "API-get-block-children",
    "API-post-page",
    "API-patch-page",
    "API-append-block-children",
    "API-query-data-source",
    "API-create-a-database",
    "API-update-a-database",
    "API-retrieve-a-database",
    "API-delete-a-block",
    "API-update-a-block",
  ],
};

// ── Dangerous Operations (always blocked) ────────────────────

const BLOCKED_TOOLS: string[] = [
  "delete-a-block",
  "gmail_delete",
  "gmail_send",
  "drive_delete",
  "calendar_delete",
];

// ── Sensitive Fields ─────────────────────────────────────────
// These fields are redacted from logs but NOT from the actual API call.

const SENSITIVE_FIELDS = [
  "body",
  "password",
  "token",
  "secret",
  "authorization",
  "api_key",
  "apiKey",
  "credentials",
];

// ── Guardrails ───────────────────────────────────────────────

/**
 * Check if a tool is allowed for a given server.
 */
export function isToolAllowed(serverName: string, toolName: string): boolean {
  // Always block dangerous operations
  if (BLOCKED_TOOLS.some((b) => toolName.includes(b))) return false;

  const allowed = ALLOWED_TOOLS[serverName];
  if (!allowed) return false;

  // Wildcard: allow everything (for initial testing/discovery)
  if (allowed === "*") return true;

  // Exact match or prefix match
  return allowed.some(
    (a) => toolName === a || toolName.startsWith(a + "_") || a.startsWith(toolName)
  );
}

/**
 * Get the list of allowed tools for a server.
 */
export function getAllowedTools(serverName: string): string[] | "*" {
  return ALLOWED_TOOLS[serverName] ?? [];
}

/**
 * Redact sensitive fields from an args object for logging.
 */
export function redactForLog(args: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (SENSITIVE_FIELDS.some((f) => key.toLowerCase().includes(f.toLowerCase()))) {
      redacted[key] = "[REDACTED]";
    } else if (typeof value === "string" && value.length > 200) {
      redacted[key] = value.substring(0, 200) + "...[truncated]";
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

// ── MCP Audit Log ────────────────────────────────────────────

const LOG_DIR = "memory";
const LOG_FILE = path.join(LOG_DIR, "mcp_log.md");

export function logMcpCall(
  server: string,
  tool: string,
  args: Record<string, unknown>,
  success: boolean
): void {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
    if (!fs.existsSync(LOG_FILE)) {
      fs.writeFileSync(LOG_FILE, "# MCP Audit Log\n\n", "utf-8");
    }

    const timestamp = new Date().toISOString().replace("T", " ").substring(0, 19);
    const redacted = redactForLog(args);
    const argsStr = JSON.stringify(redacted).substring(0, 300);
    const status = success ? "✅" : "❌";
    const entry = `- [${timestamp}] ${status} **${server}/${tool}** ${argsStr}\n`;

    fs.appendFileSync(LOG_FILE, entry, "utf-8");
  } catch {
    // Never crash on logging failure
  }
}
