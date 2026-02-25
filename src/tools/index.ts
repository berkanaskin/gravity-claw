import { getCurrentTime } from "./get-current-time.js";
import { createRememberTool } from "./remember.js";
import { createRecallTool } from "./recall.js";
import { createPcTools } from "./pc-control.js";
import { createWebSearchTool } from "./web-search.js";
import { createBrowserTools } from "./browser-control.js";
import { createDesktopTools } from "./desktop-control.js";
import { createSendImageTool } from "./send-image.js";
import { createAntigravityTools } from "./antigravity-control.js";
import { createScraperTools } from "./scraper-control.js";
import type { ToolDefinition } from "../agent.js";
import type { MemorySystem } from "../memory/index.js";
import type { Config } from "../config.js";
import type { Bot } from "grammy";

// ── Tool Registry ────────────────────────────────────────────

export function createAllTools(memory: MemorySystem, config: Config, bot?: Bot): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    getCurrentTime,
    createRememberTool(memory),
    createRecallTool(memory),
    createWebSearchTool(config),
    ...createPcTools(),
  ];

  // Browser & Desktop tools (requires PC Bridge connection)
  if (config.enablePcBridge) {
    tools.push(
      ...createBrowserTools(),
      ...createDesktopTools(),
      ...createAntigravityTools(),
      ...createScraperTools()
    );
    console.log("   🖥️ PC Bridge tools: ✅ enabled (browser + desktop + antigravity + scraper)");
  }

  // Send Image tool (requires bot instance)
  if (bot) {
    tools.push(createSendImageTool(bot, config));
    console.log("   🖼️ Send Image: ✅ enabled");
  }

  return tools;
}

