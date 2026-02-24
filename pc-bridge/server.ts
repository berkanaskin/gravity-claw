// ── PC Bridge: WebSocket Server ──────────────────────────────
// Runs on the user's Windows PC. Receives commands from the VPS
// bot via WebSocket and executes browser/desktop actions.

import "dotenv/config";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import http from "node:http";
import * as browser from "./browser.js";
import * as desktop from "./desktop.js";

const PORT = parseInt(process.env["BRIDGE_PORT"] || "3847", 10);
const AUTH_TOKEN = process.env["BRIDGE_AUTH_TOKEN"] || "gravity-claw-bridge-2026";

// ── Express health check ────────────────────────────────────
const app = express();
app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), timestamp: new Date().toISOString() });
});

const server = http.createServer(app);

// ── WebSocket Server ────────────────────────────────────────
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  // Simple token auth via query param
  const url = new URL(req.url || "", `http://localhost:${PORT}`);
  const token = url.searchParams.get("token");

  if (token !== AUTH_TOKEN) {
    console.log("❌ Unauthorized WebSocket connection attempt");
    ws.close(4001, "Unauthorized");
    return;
  }

  console.log("✅ Bot connected via WebSocket");

  ws.on("message", async (data) => {
    let msg: { id: string; action: string; params: Record<string, unknown> };

    try {
      msg = JSON.parse(data.toString());
    } catch {
      ws.send(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    const { id, action, params } = msg;
    console.log(`📨 Command: ${action}`, params ? JSON.stringify(params).substring(0, 100) : "");

    try {
      let result: unknown;

      switch (action) {
        // ── Browser Actions ──────────────────────
        case "browser_connect":
          await browser.connectBrowser();
          result = { connected: true };
          break;

        case "browser_navigate":
          result = await browser.navigate(params.url as string);
          break;

        case "browser_screenshot":
          result = { image: await browser.screenshot() };
          break;

        case "browser_click":
          result = await browser.click(params.target as string);
          break;

        case "browser_type":
          result = await browser.type(
            params.selector as string,
            params.text as string
          );
          break;

        case "browser_read":
          result = await browser.readPage();
          break;

        case "browser_scroll":
          result = await browser.scroll(
            (params.direction as "down" | "up") || "down",
            (params.amount as number) || 500
          );
          break;

        case "browser_press_key":
          result = await browser.pressKey(params.key as string);
          break;

        case "browser_list_tabs":
          result = await browser.listTabs();
          break;

        case "browser_switch_tab":
          result = await browser.switchTab(params.index as number);
          break;

        // ── Desktop Actions ──────────────────────
        case "desktop_screenshot":
          result = { image: await desktop.desktopScreenshot() };
          break;

        case "desktop_click":
          result = await desktop.desktopClick(
            params.x as number,
            params.y as number,
            (params.button as "left" | "right") || "left"
          );
          break;

        case "desktop_type":
          result = await desktop.desktopType(params.text as string);
          break;

        case "desktop_hotkey":
          result = await desktop.desktopHotkey(params.hotkey as string);
          break;

        case "desktop_focus":
          result = await desktop.desktopFocusWindow(params.title as string);
          break;

        case "desktop_install":
          result = await desktop.desktopInstall(params.packageId as string);
          break;

        // ── Ping ─────────────────────────────────
        case "ping":
          result = { pong: true, timestamp: Date.now() };
          break;

        default:
          result = { error: `Unknown action: ${action}` };
      }

      ws.send(JSON.stringify({ id, success: true, result }));
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`❌ Action failed: ${action} — ${errMsg}`);
      ws.send(JSON.stringify({ id, success: false, error: errMsg }));
    }
  });

  ws.on("close", () => {
    console.log("🔌 Bot disconnected");
  });

  ws.on("error", (err) => {
    console.error("⚠️ WebSocket error:", err.message);
  });
});

// ── Start Server ────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║  🖥️  Gravity Claw PC Bridge                      ║
║  Port: ${PORT}                                      ║
║  WebSocket: ws://localhost:${PORT}/ws               ║
║  Health: http://localhost:${PORT}/health             ║
║                                                  ║
║  Waiting for bot connection...                   ║
╚══════════════════════════════════════════════════╝
`);
});

// ── Graceful Shutdown ───────────────────────────────────────
process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down PC Bridge...");
  await browser.disconnect();
  wss.close();
  server.close();
  process.exit(0);
});
