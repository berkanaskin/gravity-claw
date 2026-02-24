// ── Browser Control Tools (Bot-side) ────────────────────────
// These tools run on the VPS and send commands to the PC Bridge
// via WebSocket. Each action includes approval flow.

import WebSocket from "ws";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ToolDefinition } from "../agent.js";
import { isSiteApproved, approveSite, recordSiteAccess } from "./site-memory.js";

// ── Bridge Connection ───────────────────────────────────────

let ws: WebSocket | null = null;
let pendingRequests = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let requestId = 0;

const BRIDGE_URL = process.env["PC_BRIDGE_URL"] || "ws://localhost:3847/ws";
const BRIDGE_TOKEN = process.env["PC_BRIDGE_TOKEN"] || "gravity-claw-bridge-2026";

// Audit log
const AUDIT_DIR = "memory";
const AUDIT_FILE = path.join(AUDIT_DIR, "browser_audit.log");

function auditLog(action: string, detail: string, status: string): void {
  try {
    if (!fs.existsSync(AUDIT_DIR)) fs.mkdirSync(AUDIT_DIR, { recursive: true });
    const ts = new Date().toISOString().replace("T", " ").substring(0, 19);
    const entry = `[${ts}] ${status}: ${action} → ${detail.substring(0, 200)}\n`;
    fs.appendFileSync(AUDIT_FILE, entry, "utf-8");
  } catch { /* never crash on logging */ }
}

/** Connect to PC Bridge */
async function ensureConnection(): Promise<WebSocket> {
  if (ws && ws.readyState === WebSocket.OPEN) return ws;

  return new Promise((resolve, reject) => {
    const url = `${BRIDGE_URL}?token=${BRIDGE_TOKEN}`;
    const socket = new WebSocket(url);

    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("PC Bridge bağlantı zaman aşımı (10s). PC Bridge çalışıyor mu?"));
    }, 10000);

    socket.on("open", () => {
      clearTimeout(timeout);
      ws = socket;
      console.log("🖥️ Connected to PC Bridge");
      resolve(socket);
    });

    socket.on("message", (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        const pending = pendingRequests.get(msg.id);
        if (pending) {
          pendingRequests.delete(msg.id);
          if (msg.success) {
            pending.resolve(msg.result);
          } else {
            pending.reject(new Error(msg.error || "Unknown bridge error"));
          }
        }
      } catch { /* ignore parse errors */ }
    });

    socket.on("close", () => {
      ws = null;
      console.log("🔌 PC Bridge disconnected");
    });

    socket.on("error", (err: Error) => {
      clearTimeout(timeout);
      ws = null;
      reject(new Error(`PC Bridge bağlantı hatası: ${err.message}`));
    });
  });
}

/** Send command to PC Bridge and await response */
async function bridgeCommand(action: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const socket = await ensureConnection();
  const id = `req_${++requestId}`;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`Bridge command timeout: ${action}`));
    }, 60000); // 60s timeout for long operations

    pendingRequests.set(id, {
      resolve: (v) => { clearTimeout(timeout); resolve(v); },
      reject: (e) => { clearTimeout(timeout); reject(e); },
    });

    socket.send(JSON.stringify({ id, action, params }));
  });
}

// ── Tool Definitions ────────────────────────────────────────

export function createBrowserTools(): ToolDefinition[] {
  return [
    // 1. Open URL
    {
      name: "browser_open",
      description:
        "Open a URL in the user's Chrome browser on their PC. " +
        "For NEW sites, you MUST ask for approval first. " +
        "For previously approved sites, you can open directly. " +
        "Always show the URL to the user before opening.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The URL to navigate to (e.g., https://chat.openai.com)",
          },
          approved: {
            type: "boolean",
            description: "Set to true if the user has approved this navigation, or if the site was previously approved.",
          },
        },
        required: ["url", "approved"],
      },
      execute: async (args) => {
        const url = args["url"] as string;
        const approved = args["approved"] as boolean;

        // Check site memory
        const alreadyApproved = isSiteApproved(url);

        if (alreadyApproved || approved) {
          try {
            const result = await bridgeCommand("browser_navigate", { url });
            if (!alreadyApproved) approveSite(url);
            else recordSiteAccess(url);
            auditLog("BROWSER_OPEN", url, "APPROVED");
            return JSON.stringify(result);
          } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            auditLog("BROWSER_OPEN", url, `ERROR: ${errMsg}`);
            return JSON.stringify({ error: errMsg });
          }
        }

        return JSON.stringify({
          error: "Bu site henüz onaylanmamış. Kullanıcıdan onay alın.",
          url,
          needsApproval: true,
        });
      },
    },

    // 2. Screenshot
    {
      name: "browser_screenshot",
      description:
        "Take a screenshot of the current browser page. Returns base64 PNG image. " +
        "This is a safe read-only operation — no approval needed.",
      parameters: {
        type: "object",
        properties: {},
      },
      execute: async () => {
        try {
          const result = await bridgeCommand("browser_screenshot") as { image: string };
          auditLog("BROWSER_SCREENSHOT", "captured", "AUTO");
          return JSON.stringify({
            success: true,
            image: result.image,
            note: "Screenshot captured (base64 PNG)",
          });
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          return JSON.stringify({ error: errMsg });
        }
      },
    },

    // 3. Click
    {
      name: "browser_click",
      description:
        "Click on an element in the browser page. " +
        "IMPORTANT: You MUST show the target to the user and get approval first. " +
        "Specify the element by CSS selector, visible text, or aria label.",
      parameters: {
        type: "object",
        properties: {
          target: {
            type: "string",
            description: 'Element to click — CSS selector (e.g., "#submit-btn") or visible text (e.g., "Login")',
          },
          approved: {
            type: "boolean",
            description: "Must be true — confirms user approved this click action",
          },
        },
        required: ["target", "approved"],
      },
      execute: async (args) => {
        const target = args["target"] as string;
        const approved = args["approved"] as boolean;

        if (!approved) {
          return JSON.stringify({
            error: "Bu tıklama işlemi için kullanıcı onayı gerekli.",
            target,
          });
        }

        try {
          const result = await bridgeCommand("browser_click", { target });
          auditLog("BROWSER_CLICK", target, "APPROVED");
          return JSON.stringify(result);
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          auditLog("BROWSER_CLICK", target, `ERROR: ${errMsg}`);
          return JSON.stringify({ error: errMsg });
        }
      },
    },

    // 4. Type
    {
      name: "browser_type",
      description:
        "Type text into an input field in the browser. " +
        "IMPORTANT: You MUST show what you want to type and get approval first. " +
        "For login/password fields, DOUBLE confirmation is required.",
      parameters: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: 'CSS selector of the input field (e.g., "#search-input", "textarea.prompt")',
          },
          text: {
            type: "string",
            description: "The text to type into the field",
          },
          approved: {
            type: "boolean",
            description: "Must be true — confirms user approved this text input",
          },
        },
        required: ["selector", "text", "approved"],
      },
      execute: async (args) => {
        const selector = args["selector"] as string;
        const text = args["text"] as string;
        const approved = args["approved"] as boolean;

        if (!approved) {
          return JSON.stringify({
            error: "Bu metin girişi için kullanıcı onayı gerekli.",
            selector,
            text: text.substring(0, 100),
          });
        }

        try {
          const result = await bridgeCommand("browser_type", { selector, text });
          auditLog("BROWSER_TYPE", `"${text.substring(0, 50)}" → ${selector}`, "APPROVED");
          return JSON.stringify(result);
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          return JSON.stringify({ error: errMsg });
        }
      },
    },

    // 5. Read Page
    {
      name: "browser_read",
      description:
        "Read the current page content as text. Returns title, URL, and visible text. " +
        "This is a safe read-only operation — no approval needed.",
      parameters: {
        type: "object",
        properties: {},
      },
      execute: async () => {
        try {
          const result = await bridgeCommand("browser_read");
          auditLog("BROWSER_READ", "page content read", "AUTO");
          return JSON.stringify(result);
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          return JSON.stringify({ error: errMsg });
        }
      },
    },

    // 6. Scroll
    {
      name: "browser_scroll",
      description:
        "Scroll the current browser page up or down. " +
        "This is a safe operation — no approval needed.",
      parameters: {
        type: "object",
        properties: {
          direction: {
            type: "string",
            description: 'Scroll direction: "up" or "down" (default: "down")',
          },
          amount: {
            type: "number",
            description: "Scroll amount in pixels (default: 500)",
          },
        },
      },
      execute: async (args) => {
        try {
          const result = await bridgeCommand("browser_scroll", {
            direction: args["direction"] || "down",
            amount: args["amount"] || 500,
          });
          return JSON.stringify({ success: true, result });
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          return JSON.stringify({ error: errMsg });
        }
      },
    },
  ];
}
