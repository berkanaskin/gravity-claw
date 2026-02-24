// ── Desktop Control Tools (Bot-side) ────────────────────────
// These tools run on the VPS and send desktop commands to PC Bridge.

import type { ToolDefinition } from "../agent.js";
import * as fs from "node:fs";
import * as path from "node:path";

// Reuse the bridge connection from browser-control
// Import is dynamic to avoid circular deps — these share the same WS connection

const AUDIT_DIR = "memory";
const AUDIT_FILE = path.join(AUDIT_DIR, "desktop_audit.log");

function auditLog(action: string, detail: string, status: string): void {
  try {
    if (!fs.existsSync(AUDIT_DIR)) fs.mkdirSync(AUDIT_DIR, { recursive: true });
    const ts = new Date().toISOString().replace("T", " ").substring(0, 19);
    const entry = `[${ts}] ${status}: ${action} → ${detail.substring(0, 200)}\n`;
    fs.appendFileSync(AUDIT_FILE, entry, "utf-8");
  } catch { /* never crash on logging */ }
}

// Bridge command sender — injected at registration time to share WS connection
type BridgeCommandFn = (action: string, params?: Record<string, unknown>) => Promise<unknown>;
let bridgeCommand: BridgeCommandFn;

/** Set the bridge command function (called from tools/index.ts) */
export function setBridgeCommand(fn: BridgeCommandFn): void {
  bridgeCommand = fn;
}

export function createDesktopTools(): ToolDefinition[] {
  return [
    // 1. Desktop Screenshot (safe)
    {
      name: "desktop_screenshot",
      description:
        "Take a screenshot of the entire desktop (all screens). " +
        "Safe read-only operation — no approval needed.",
      parameters: {
        type: "object",
        properties: {},
      },
      execute: async () => {
        try {
          const result = await bridgeCommand("desktop_screenshot") as { image: string };
          auditLog("DESKTOP_SCREENSHOT", "captured", "AUTO");
          return JSON.stringify({
            success: true,
            image: result.image,
            note: "Desktop screenshot captured (base64 PNG)",
          });
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          return JSON.stringify({ error: errMsg });
        }
      },
    },

    // 2. Desktop Click (needs approval)
    {
      name: "desktop_click",
      description:
        "Click at a specific X, Y coordinate on the desktop. " +
        "IMPORTANT: You MUST show the coordinates and what you intend to click, " +
        "then get user approval first.",
      parameters: {
        type: "object",
        properties: {
          x: { type: "number", description: "X coordinate (pixels from left)" },
          y: { type: "number", description: "Y coordinate (pixels from top)" },
          button: { type: "string", description: '"left" or "right" (default: "left")' },
          approved: { type: "boolean", description: "Must be true — user approved this click" },
        },
        required: ["x", "y", "approved"],
      },
      execute: async (args) => {
        if (!args["approved"]) {
          return JSON.stringify({ error: "Masaüstü tıklama için kullanıcı onayı gerekli." });
        }
        try {
          const result = await bridgeCommand("desktop_click", {
            x: args["x"], y: args["y"], button: args["button"] || "left",
          });
          auditLog("DESKTOP_CLICK", `(${args["x"]}, ${args["y"]})`, "APPROVED");
          return JSON.stringify({ success: true, result });
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          return JSON.stringify({ error: errMsg });
        }
      },
    },

    // 3. Desktop Type (needs approval)
    {
      name: "desktop_type",
      description:
        "Type text on the desktop (into whichever window is focused). " +
        "IMPORTANT: Show what you want to type and get approval first.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Text to type" },
          approved: { type: "boolean", description: "Must be true — user approved" },
        },
        required: ["text", "approved"],
      },
      execute: async (args) => {
        if (!args["approved"]) {
          return JSON.stringify({ error: "Metin girişi için kullanıcı onayı gerekli." });
        }
        try {
          const result = await bridgeCommand("desktop_type", { text: args["text"] });
          auditLog("DESKTOP_TYPE", String(args["text"]).substring(0, 100), "APPROVED");
          return JSON.stringify({ success: true, result });
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          return JSON.stringify({ error: errMsg });
        }
      },
    },

    // 4. Desktop Hotkey (needs approval)
    {
      name: "desktop_hotkey",
      description:
        "Send a keyboard shortcut (e.g., 'ctrl+s', 'alt+tab', 'ctrl+shift+t'). " +
        "Show the hotkey and get approval first.",
      parameters: {
        type: "object",
        properties: {
          hotkey: { type: "string", description: 'Hotkey combo (e.g., "ctrl+s", "alt+tab")' },
          approved: { type: "boolean", description: "Must be true — user approved" },
        },
        required: ["hotkey", "approved"],
      },
      execute: async (args) => {
        if (!args["approved"]) {
          return JSON.stringify({ error: "Kısayol tuşu için kullanıcı onayı gerekli." });
        }
        try {
          const result = await bridgeCommand("desktop_hotkey", { hotkey: args["hotkey"] });
          auditLog("DESKTOP_HOTKEY", String(args["hotkey"]), "APPROVED");
          return JSON.stringify({ success: true, result });
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          return JSON.stringify({ error: errMsg });
        }
      },
    },

    // 5. Focus Window (needs approval)
    {
      name: "desktop_app_focus",
      description:
        "Focus/switch to a specific application window by its title. " +
        "Use partial title matching. Show what you intend to focus and get approval.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: 'Window title to focus (partial match, e.g., "Antigravity", "Chrome")' },
          approved: { type: "boolean", description: "Must be true — user approved" },
        },
        required: ["title", "approved"],
      },
      execute: async (args) => {
        if (!args["approved"]) {
          return JSON.stringify({ error: "Pencere değiştirme için kullanıcı onayı gerekli." });
        }
        try {
          const result = await bridgeCommand("desktop_focus", { title: args["title"] });
          auditLog("DESKTOP_FOCUS", String(args["title"]), "APPROVED");
          return JSON.stringify({ success: true, result });
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          return JSON.stringify({ error: errMsg });
        }
      },
    },

    // 6. Install Program (DOUBLE approval)
    {
      name: "desktop_install",
      description:
        "Install a program on the user's PC using winget. " +
        "⚠️ CRITICAL: This requires DOUBLE confirmation from the user. " +
        "1. Show what you want to install. " +
        '2. Ask "Emin misin?" and wait for second confirmation. ' +
        "3. ONLY then call with approved=true.",
      parameters: {
        type: "object",
        properties: {
          packageId: {
            type: "string",
            description: "Winget package ID (e.g., 'Google.Chrome', 'Microsoft.VisualStudioCode')",
          },
          approved: {
            type: "boolean",
            description: "Must be true — user gave DOUBLE confirmation",
          },
        },
        required: ["packageId", "approved"],
      },
      execute: async (args) => {
        if (!args["approved"]) {
          return JSON.stringify({ error: "Program kurulumu için ÇİFT onay gerekli." });
        }
        try {
          const result = await bridgeCommand("desktop_install", { packageId: args["packageId"] });
          auditLog("DESKTOP_INSTALL", String(args["packageId"]), "DOUBLE_APPROVED");
          return JSON.stringify({ success: true, result });
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          return JSON.stringify({ error: errMsg });
        }
      },
    },
  ];
}
