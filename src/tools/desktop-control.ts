// ── Desktop Control Tools (Bot-side) ────────────────────────
// These tools run on the VPS and send desktop commands to PC Bridge.
// Shares the WS bridge connection with browser-control.

import WebSocket from "ws";
import type { Bot } from "grammy";
import { InputFile } from "grammy";
import type { ToolDefinition } from "../agent.js";
import type { Config } from "../config.js";
import * as fs from "node:fs";
import * as path from "node:path";

// ── Bridge Connection (shared pattern with browser-control) ──

let ws: WebSocket | null = null;
let pendingRequests = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let requestId = 0;

const BRIDGE_URL = process.env["PC_BRIDGE_URL"] || "ws://localhost:3847/ws";
const BRIDGE_TOKEN = process.env["PC_BRIDGE_TOKEN"] || "gravity-claw-bridge-2026";

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

/** Connect to PC Bridge */
async function ensureConnection(): Promise<WebSocket> {
  if (ws && ws.readyState === WebSocket.OPEN) return ws;

  return new Promise((resolve, reject) => {
    const url = `${BRIDGE_URL}?token=${BRIDGE_TOKEN}`;
    const socket = new WebSocket(url);

    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(
        "PC Bridge'e bağlanılamadı (10s timeout). " +
        "Bilgisayarında PC Bridge çalışıyor mu? SSH tunnel açık mı?"
      ));
    }, 10000);

    socket.on("open", () => {
      clearTimeout(timeout);
      ws = socket;
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
  const id = `desktop_${++requestId}`;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`Bridge command timeout: ${action}`));
    }, 60000);

    pendingRequests.set(id, {
      resolve: (v) => { clearTimeout(timeout); resolve(v); },
      reject: (e) => { clearTimeout(timeout); reject(e); },
    });

    socket.send(JSON.stringify({ id, action, params }));
  });
}

/** User-friendly error message for bridge failures */
function bridgeError(errMsg: string): string {
  if (errMsg.includes("bağlanılamadı") || errMsg.includes("ECONNREFUSED") || errMsg.includes("timeout")) {
    return JSON.stringify({
      error: "PC Bridge'e ulaşılamıyor.",
      details: errMsg,
      hint: "Bilgisayarında PC Bridge çalışmıyor veya SSH tunnel bağlı değil. " +
            "PC Bridge'i başlatmak için: (1) Chrome CDP aç, (2) start-bridge.bat çalıştır, (3) SSH tunnel başlat.",
    });
  }
  return JSON.stringify({ error: errMsg });
}

export function createDesktopTools(bot?: Bot, config?: Config): ToolDefinition[] {
  return [
    // 1. Desktop Screenshot — sends DIRECTLY to Telegram (bypasses Gemini context)
    {
      name: "desktop_screenshot",
      description:
        "Take a screenshot of the user's desktop and send it directly to Telegram. " +
        "This tool captures AND sends — you do NOT need to call send_image afterward. " +
        "Safe read-only operation — no approval needed. " +
        "⚠️ Requires PC Bridge to be running on the user's computer.",
      parameters: {
        type: "object",
        properties: {
          caption: {
            type: "string",
            description: "Caption for the screenshot (e.g., 'Masaüstü ekran görüntüsü')",
          },
        },
      },
      execute: async (args) => {
        try {
          const result = await bridgeCommand("desktop_screenshot") as { image: string };
          auditLog("DESKTOP_SCREENSHOT", `captured (${result.image.length} chars)`, "AUTO");

          // Send DIRECTLY to Telegram — do NOT pass through Gemini context
          if (bot && config) {
            const buffer = Buffer.from(result.image, "base64");
            const caption = String(args?.caption || "🖥️ Desktop screenshot");

            for (const userId of config.allowedUserIds) {
              await bot.api.sendPhoto(userId, new InputFile(buffer, "screenshot.jpg"), {
                caption,
                parse_mode: "Markdown",
              });
            }

            return JSON.stringify({
              success: true,
              message: "Screenshot alındı ve Telegram'a gönderildi.",
              dimensions: `${buffer.length} bytes JPEG`,
            });
          } else {
            // Fallback: return base64 if bot not available (shouldn't happen)
            return JSON.stringify({
              success: true,
              image: result.image,
              note: "Screenshot captured but bot not available for direct send",
            });
          }
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          auditLog("DESKTOP_SCREENSHOT", errMsg, "ERROR");
          return bridgeError(errMsg);
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
          return bridgeError(errMsg);
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
          return bridgeError(errMsg);
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
          return bridgeError(errMsg);
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
          return bridgeError(errMsg);
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
          return bridgeError(errMsg);
        }
      },
    },
  ];
}
