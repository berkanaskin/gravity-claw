import { loadConfig } from "./config.js";
import { createBot } from "./bot.js";
import { CentoOrchestrator } from "./orchestrator.js";

// ── Main ─────────────────────────────────────────────────────

async function main() {
  console.log("🦀 CENTO — Starting up...\n");

  const config = loadConfig();
  const { bot, memory, mcp } = await createBot(config);

  // Initialize CENTO Orchestrator
  let orchestrator: CentoOrchestrator | undefined;
  if (config.orchestratorEnabled && config.openaiApiKey) {
    orchestrator = new CentoOrchestrator(config);

    // Register Telegram notification callback
    orchestrator.onNotify(async (msg: string) => {
      for (const userId of config.allowedUserIds) {
        try {
          await bot.api.sendMessage(userId, msg, { parse_mode: "Markdown" });
        } catch (err) {
          console.error(`❌ CENTO notify failed for ${userId}:`, err);
        }
      }
    });

    const status = orchestrator.getStatus();
    console.log(`   CENTO agents: ${status.availableAgents.join(", ")}`);
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n🛑 ${signal} received — shutting down gracefully...`);
    bot.stop();
    await mcp.disconnectAll();
    memory.close();
    console.log("💾 All resources closed.");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Start long-polling (NO web server, NO exposed ports)
  console.log("\n🤖 CENTO is online! (polling)\n");
  await bot.start();
}

main().catch((error) => {
  console.error("💥 Fatal error:", error instanceof Error ? error.message : error);
  process.exit(1);
});
