import { getCurrentTime } from "./get-current-time.js";
import { createRememberTool } from "./remember.js";
import { createRecallTool } from "./recall.js";
import { createPcTools } from "./pc-control.js";
import { createWebSearchTool } from "./web-search.js";
import { createBrowserTools } from "./browser-control.js";
import { createDesktopTools } from "./desktop-control.js";
import type { ToolDefinition } from "../agent.js";
import type { MemorySystem } from "../memory/index.js";
import type { Config } from "../config.js";

// ── Tool Registry ────────────────────────────────────────────

export function createAllTools(memory: MemorySystem, config: Config): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    getCurrentTime,
    createRememberTool(memory),
    createRecallTool(memory),
    createWebSearchTool(config),
    ...createPcTools(),
  ];

  // Browser & Desktop tools (requires PC Bridge connection)
  if (config.enablePcBridge) {
    tools.push(...createBrowserTools(), ...createDesktopTools());
    console.log("   🖥️ PC Bridge tools: ✅ enabled (browser + desktop)");
  }

  return tools;
}

