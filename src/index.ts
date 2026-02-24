import { loadConfig } from "./config.js";
import { createBot } from "./bot.js";

// ── Main ─────────────────────────────────────────────────────

async function main() {
  console.log("🦀 Gravity Claw — Starting up...\n");

  const config = loadConfig();
  const { bot, memory, mcp } = await createBot(config);

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
  console.log("\n🤖 Agent Claw is online! (polling)\n");
  await bot.start();
}

main().catch((error) => {
  console.error("💥 Fatal error:", error instanceof Error ? error.message : error);
  process.exit(1);
});
