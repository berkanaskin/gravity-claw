import { Bot } from "grammy";
import type { Config } from "./config.js";
import { Agent } from "./agent.js";
import { createAllTools } from "./tools/index.js";
import { MemorySystem } from "./memory/index.js";
import { McpManager } from "./mcp/index.js";
import { createTranscriber } from "./transcription/index.js";
import { createSynthesizer } from "./tts/index.js";
import { registerTextHandler, registerVoiceHandler, registerPhotoHandler, registerDocumentHandler } from "./handlers/index.js";
import type { ToolDefinition } from "./agent.js";
import { startHeartbeat, sendHeartbeat } from "./heartbeat.js";
import { startScheduler, triggerDailySummary } from "./scheduler.js";

export async function createBot(
  config: Config
): Promise<{ bot: Bot; memory: MemorySystem; mcp: McpManager }> {
  const bot = new Bot(config.telegramBotToken);

  // Initialize memory system
  const memory = new MemorySystem(config);
  const localTools: ToolDefinition[] = createAllTools(memory, config);

  // Initialize MCP — connect to external servers
  const mcp = new McpManager();
  if (config.enableMcp) {
    await mcp.connectAll();
  }

  // Merge local + MCP tools
  const mcpTools = mcp.getAllTools();
  const allTools = [...localTools, ...mcpTools];
  console.log(
    `   🔧 Tools: ${localTools.length} local + ${mcpTools.length} MCP = ${allTools.length} total`
  );

  const agent = new Agent(config, allTools, memory);
  const transcriber = createTranscriber(config);
  const synthesizer = createSynthesizer(config);

  // ── Allowlist Middleware ──────────────────────────────────
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId || !config.allowedUserIds.includes(userId)) {
      return;
    }
    await next();
  });

  // ── /start Command ───────────────────────────────────────
  bot.command("start", async (ctx) => {
    const ttsNote = synthesizer
      ? '\n• _"reply with voice"_ — sesli yanıt'
      : "";

    const mcpNote =
      mcp.connectedCount > 0
        ? `\n🔌 ${mcp.connectedCount} MCP server(s) connected.`
        : "";

    await ctx.reply(
      "🤖 *Agent Claw online.*\n\n" +
        "• _Mesaj yaz_ — AI yanıtı\n" +
        "• 🎤 _Ses mesajı_ — çözümle ve yanıtla\n" +
        "• `/remember <bilgi>` — belleğe kaydet\n" +
        "• `/recall <sorgu>` — bellekten ara" +
        ttsNote +
        `\n\n💾 ${memory.count()} memory(ies) loaded.` +
        mcpNote,
      { parse_mode: "Markdown" }
    );
  });

  // ── /remember Command ────────────────────────────────────
  bot.command("remember", async (ctx) => {
    const text = ctx.match;
    if (!text) {
      await ctx.reply("Usage: `/remember <information to store>`", {
        parse_mode: "Markdown",
      });
      return;
    }

    try {
      await ctx.replyWithChatAction("typing");
      const id = await memory.remember(text, "user-explicit");
      await ctx.reply(
        `💾 Remembered (id=${id}):\n_"${text}"_\n\nTotal memories: ${memory.count()}`,
        { parse_mode: "Markdown" }
      );
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`❌ Remember error: ${errMsg}`);
      await ctx.reply("⚠️ Belleğe kaydedemedim. Lütfen tekrar deneyin.");
    }
  });

  // ── /recall Command ──────────────────────────────────────
  bot.command("recall", async (ctx) => {
    const query = ctx.match;
    if (!query) {
      await ctx.reply("Usage: `/recall <search query>`", {
        parse_mode: "Markdown",
      });
      return;
    }

    try {
      await ctx.replyWithChatAction("typing");
      const results = await memory.recall(query, 5);

      if (results.length === 0) {
        await ctx.reply("🔍 No relevant memories found.");
        return;
      }

      const lines = results.map(
        (m, i) =>
          `${i + 1}. \\[${m.category}\\] _${m.content}_\n   📊 ${Math.round((m.similarity ?? 0) * 100)}% match · ${m.timestamp.substring(0, 10)}`
      );

      await ctx.reply(`🔍 *Recalled memories:*\n\n${lines.join("\n\n")}`, {
        parse_mode: "Markdown",
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`❌ Recall error: ${errMsg}`);
      await ctx.reply("⚠️ Bellekten arama yapılamadı. Lütfen tekrar deneyin.");
    }
  });

  // ── /heartbeat_test Command ─────────────────────────────
  bot.command("heartbeat_test", async (ctx) => {
    await sendHeartbeat(bot, config);
    console.log("💓 Manual heartbeat test triggered");
  });

  // ── /daily_summary Command ────────────────────────────────
  bot.command("daily_summary", async (ctx) => {
    await ctx.reply("📊 Günlük özet hazırlanıyor...");
    await triggerDailySummary(bot, config, agent);
    console.log("📊 Manual daily summary triggered");
  });

  // ── Register Handlers ─────────────────────────────────────
  registerTextHandler(bot, agent, synthesizer);
  registerVoiceHandler(bot, agent, transcriber, synthesizer);
  registerPhotoHandler(bot, agent, config);
  registerDocumentHandler(bot, agent, config);

  // ── Start Schedulers ───────────────────────────────────────
  startHeartbeat(bot, config);
  startScheduler(bot, config, agent);

  return { bot, memory, mcp };
}
