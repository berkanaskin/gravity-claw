// ── Web Scraping Tools (Bot-side) ────────────────────────────
// These tools run on the VPS and send commands to the PC Bridge
// to perform web scraping via Scrapling (anti-bot) or Playwright.

import WebSocket from "ws";
import type { ToolDefinition } from "../agent.js";

// ── Bridge Connection (shared) ──────────────────────────────

let ws: WebSocket | null = null;
let pendingRequests = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let requestId = 0;

const BRIDGE_URL = process.env["PC_BRIDGE_URL"] || "ws://berkan:3847/ws";
const BRIDGE_TOKEN = process.env["PC_BRIDGE_TOKEN"] || "gravity-claw-bridge-2026";

async function ensureConnection(): Promise<WebSocket> {
  if (ws?.readyState === WebSocket.OPEN) return ws;

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${BRIDGE_URL}?token=${BRIDGE_TOKEN}`);
    const timeout = setTimeout(() => { socket.close(); reject(new Error("Bridge timeout")); }, 10000);

    socket.on("open", () => { clearTimeout(timeout); ws = socket; resolve(socket); });
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
    socket.on("error", (err: Error) => { clearTimeout(timeout); ws = null; reject(err); });
  });
}

async function bridgeCommand(action: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const socket = await ensureConnection();
  const id = `scrape_${++requestId}`;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pendingRequests.delete(id); reject(new Error(`Scrape timeout: ${action}`)); }, 60000);
    pendingRequests.set(id, {
      resolve: (v) => { clearTimeout(timeout); resolve(v); },
      reject: (e) => { clearTimeout(timeout); reject(e); },
    });
    socket.send(JSON.stringify({ id, action, params }));
  });
}

// ── Tool Definitions ────────────────────────────────────────

export function createScraperTools(): ToolDefinition[] {
  return [
    {
      name: "web_scrape",
      description:
        "Scrape a web page and extract text or HTML. Uses Scrapling (anti-bot proof) " +
        "with Playwright fallback. Great for reading articles, product pages, forum posts, etc. " +
        "No approval needed — read-only operation.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The URL to scrape (e.g., https://example.com/article)",
          },
          selector: {
            type: "string",
            description: "Optional CSS selector to target specific elements (e.g., '.article-body', '#main-content')",
          },
          useScrapling: {
            type: "boolean",
            description: "Use Scrapling for anti-bot pages (default: true). Set false for simple pages.",
          },
        },
        required: ["url"],
      },
      execute: async (args) => {
        try {
          const result = await bridgeCommand("web_scrape", {
            url: args["url"],
            selector: args["selector"],
            useScrapling: args["useScrapling"] !== false,
          });
          return JSON.stringify(result);
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          return JSON.stringify({ error: errMsg, hint: "PC Bridge bağlı ve Python kurulu olmalı." });
        }
      },
    },

    {
      name: "web_extract",
      description:
        "Extract structured data (lists, links, items) from a web page using CSS selectors. " +
        "Returns an array of items with text, href, src attributes. " +
        "Perfect for extracting product lists, search results, article links, etc.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The URL to extract data from",
          },
          pattern: {
            type: "string",
            description: "CSS selector pattern for elements to extract (e.g., '.product-card', 'article h2 a')",
          },
        },
        required: ["url", "pattern"],
      },
      execute: async (args) => {
        try {
          const result = await bridgeCommand("web_extract", {
            url: args["url"],
            pattern: args["pattern"],
          });
          return JSON.stringify(result);
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          return JSON.stringify({ error: errMsg });
        }
      },
    },
  ];
}
