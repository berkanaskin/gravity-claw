import cron from "node-cron";
import type { Bot } from "grammy";
import type { Config } from "./config.js";
import type { Agent } from "./agent.js";

// ── Proactive Notifications ──────────────────────────────────
// Checks calendar every hour and sends reminders for upcoming events.

const PROACTIVE_CRON = "0 * * * *"; // Every hour, on the hour

async function sendProactiveCheck(
  bot: Bot,
  config: Config,
  agent: Agent
): Promise<void> {
  // Skip entirely if no calendar tools are connected
  if (!agent.hasToolMatching("calendar")) {
    console.log("⏭️ Proactive check skipped — no calendar tools available");
    return;
  }

  const now = new Date();
  const hour = now.getHours();

  // Only send during waking hours (07:00 - 23:00)
  if (hour < 7 || hour > 23) return;

  for (const userId of config.allowedUserIds) {
    try {
      const prompt =
        `Şu anki saat: ${now.toLocaleTimeString("tr-TR")}. ` +
        `Takvimimi kontrol et. Önümüzdeki 2 saat içinde bir etkinlik var mı? ` +
        `Eğer varsa kısa bir hatırlatma yaz. Yoksa hiçbir şey yazma, ` +
        `sadece "YOK" de.`;

      const response = await agent.processMessage(prompt);

      // Only send if there's actually something to report
      if (!response.includes("YOK") && response.length > 5) {
        await bot.api.sendMessage(userId, `🔔 ${response}`, {
          parse_mode: "Markdown",
        });
        console.log(`🔔 Proactive notification sent to user ${userId}`);
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`❌ Proactive check failed for user ${userId}: ${errMsg}`);
    }
  }
}

// ── Daily Summary (Evening) ──────────────────────────────────
// Sends a comprehensive daily summary at 21:00.

const DAILY_SUMMARY_CRON = "0 21 * * *"; // Every day at 21:00

async function sendDailySummary(
  bot: Bot,
  config: Config,
  agent: Agent
): Promise<void> {
  const hasCalendar = agent.hasToolMatching("calendar");
  const hasGmail = agent.hasToolMatching("gmail");

  // Skip entirely if no MCP tools are connected
  if (!hasCalendar && !hasGmail) {
    console.log("⏭️ Daily summary skipped — no calendar/gmail tools available");
    return;
  }

  for (const userId of config.allowedUserIds) {
    try {
      // Build prompt based on available tools
      const tasks: string[] = [];
      if (hasCalendar) {
        tasks.push("1. Bugün takvimde neler vardı? (calendar.listEvents kullan)");
        tasks.push("2. Yarın için ne planlanmış?");
      }
      if (hasGmail) {
        tasks.push(`${tasks.length + 1}. Bugün önemli e-postalar geldi mi? (gmail.search kullan)`);
      }

      const prompt =
        `Bugünün günlük özetini hazırla. Şunları kontrol et:\n` +
        tasks.join("\n") + `\n\n` +
        `Kısa ve öz bir akşam özeti formatında yaz. ` +
        `Bulamadığın bilgiyi atla, sadece bulabildiklerini özetle. ` +
        `Emoji kullan, Telegram formatında yaz.`;

      const response = await agent.processMessage(prompt);

      const header = `📊 *Günlük Özet — ${new Date().toLocaleDateString("tr-TR")}*\n\n`;
      await bot.api.sendMessage(userId, header + response, {
        parse_mode: "Markdown",
      });
      console.log(`📊 Daily summary sent to user ${userId}`);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`❌ Daily summary failed for user ${userId}: ${errMsg}`);
    }
  }
}

// ── Exported: /daily_summary Test Command ────────────────────
export async function triggerDailySummary(
  bot: Bot,
  config: Config,
  agent: Agent
): Promise<void> {
  await sendDailySummary(bot, config, agent);
}

// ── Start All Scheduled Jobs ─────────────────────────────────
export function startScheduler(bot: Bot, config: Config, agent: Agent): void {
  // Proactive calendar reminders (every hour)
  cron.schedule(PROACTIVE_CRON, () => {
    console.log(`🔔 Proactive check at ${new Date().toLocaleTimeString()}`);
    sendProactiveCheck(bot, config, agent).catch((err) =>
      console.error("❌ Proactive cron error:", err)
    );
  });
  console.log(`   Proactive alerts: ✅ enabled (every hour, 07-23)`);

  // Daily summary (21:00)
  cron.schedule(DAILY_SUMMARY_CRON, () => {
    console.log(`📊 Daily summary triggered at ${new Date().toLocaleTimeString()}`);
    sendDailySummary(bot, config, agent).catch((err) =>
      console.error("❌ Daily summary cron error:", err)
    );
  });
  console.log(`   Daily summary: ✅ enabled (21:00)`);
}
