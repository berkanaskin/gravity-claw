import cron from "node-cron";
import type { Bot } from "grammy";
import type { Config } from "./config.js";

const HEARTBEAT_MESSAGE = `☀️ Günaydın! Günlük check-in:

1️⃣ Bugün #1 önceliğin ne?
2️⃣ Kaldırmam gereken bir engel var mı?

_Kısa yaz, gerisini ben hallederim_ 💪`;

// ── Send heartbeat to all allowed users ───────────────────
export async function sendHeartbeat(
  bot: Bot,
  config: Config
): Promise<void> {
  if (!config.heartbeatEnabled) {
    console.log("💓 Heartbeat skipped (disabled)");
    return;
  }

  for (const userId of config.allowedUserIds) {
    try {
      await bot.api.sendMessage(userId, HEARTBEAT_MESSAGE, {
        parse_mode: "Markdown",
      });
      console.log(`💓 Heartbeat sent to user ${userId}`);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`❌ Heartbeat failed for user ${userId}: ${errMsg}`);
    }
  }
}

// ── Schedule the daily cron job ───────────────────────────
export function startHeartbeat(bot: Bot, config: Config): void {
  if (!config.heartbeatEnabled) {
    console.log("   Heartbeat: ⬚ disabled (set HEARTBEAT_ENABLED=true)");
    return;
  }

  const cronExpr = config.heartbeatCron;

  if (!cron.validate(cronExpr)) {
    console.error(`❌ Invalid HEARTBEAT_CRON expression: "${cronExpr}"`);
    return;
  }

  cron.schedule(cronExpr, () => {
    console.log(`💓 Heartbeat triggered at ${new Date().toLocaleString()}`);
    sendHeartbeat(bot, config).catch((err) =>
      console.error("❌ Heartbeat cron error:", err)
    );
  });

  console.log(`   Heartbeat: ✅ enabled (cron: ${cronExpr})`);
}
