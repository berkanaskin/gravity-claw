// ── Antigravity IDE Control Tools (Bot-side) ────────────────
// These tools run on the VPS and send commands to the PC Bridge
// to control the Antigravity IDE — enabling CENTO to leverage
// Claude Opus/Sonnet for free via the user's subscription.

import WebSocket from "ws";
import type { ToolDefinition } from "../agent.js";

// ── Bridge Connection (reuses same pattern) ──────────────────

let ws: WebSocket | null = null;
let pendingRequests = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let requestId = 0;

const BRIDGE_URL = process.env["PC_BRIDGE_URL"] || "ws://berkan:3847/ws";
const BRIDGE_TOKEN = process.env["PC_BRIDGE_TOKEN"] || "gravity-claw-bridge-2026";

async function ensureConnection(): Promise<WebSocket> {
  if (ws && ws.readyState === WebSocket.OPEN) return ws;

  return new Promise((resolve, reject) => {
    const url = `${BRIDGE_URL}?token=${BRIDGE_TOKEN}`;
    const socket = new WebSocket(url);

    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("Antigravity bağlantı zaman aşımı. PC Bridge açık mı?"));
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
          if (msg.success) pending.resolve(msg.result);
          else pending.reject(new Error(msg.error || "Bridge error"));
        }
      } catch { /* ignore */ }
    });

    socket.on("close", () => { ws = null; });
    socket.on("error", (err: Error) => {
      clearTimeout(timeout);
      ws = null;
      reject(new Error(`PC Bridge hata: ${err.message}`));
    });
  });
}

async function bridgeCommand(action: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const socket = await ensureConnection();
  const id = `ag_${++requestId}`;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`Antigravity timeout: ${action}`));
    }, 180000); // 3 min — AI responses can be slow

    pendingRequests.set(id, {
      resolve: (v) => { clearTimeout(timeout); resolve(v); },
      reject: (e) => { clearTimeout(timeout); reject(e); },
    });

    socket.send(JSON.stringify({ id, action, params }));
  });
}

// ── Tool Definitions ────────────────────────────────────────

export function createAntigravityTools(): ToolDefinition[] {
  return [
    {
      name: "antigravity_prompt",
      description:
        "Send a coding prompt to Antigravity IDE (Claude Opus/Sonnet). " +
        "Use this for complex coding tasks, code reviews, or any task " +
        "that benefits from Claude's deep reasoning. " +
        "Returns the AI's full response text. " +
        "⚠️ Requires Antigravity IDE to be running on the user's PC.",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "The coding prompt to send to Antigravity (Claude model)",
          },
          timeout: {
            type: "number",
            description: "Max wait time in ms (default: 120000 = 2 min)",
          },
        },
        required: ["prompt"],
      },
      execute: async (args) => {
        try {
          // First ensure connected
          await bridgeCommand("antigravity_connect");
          // Then send the prompt
          const result = await bridgeCommand("antigravity_prompt", {
            prompt: args["prompt"],
            timeout: args["timeout"] || 120000,
          });
          return JSON.stringify(result);
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          return JSON.stringify({
            error: errMsg,
            hint: "Antigravity IDE açık ve PC Bridge bağlı olmalı.",
          });
        }
      },
    },

    {
      name: "antigravity_state",
      description:
        "Get the current state of Antigravity IDE (model, conversation count, etc.). " +
        "Safe read-only operation.",
      parameters: {
        type: "object",
        properties: {},
      },
      execute: async () => {
        try {
          const result = await bridgeCommand("antigravity_state");
          return JSON.stringify(result);
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          return JSON.stringify({ error: errMsg });
        }
      },
    },
  ];
}
