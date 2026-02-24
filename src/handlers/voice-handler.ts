import type { Context } from "grammy";
import type { Agent } from "../agent.js";
import type { Transcriber } from "../transcription/index.js";
import type { Synthesizer } from "../tts/index.js";
import { splitMessage } from "../utils.js";
import { InputFile } from "grammy";

export function registerVoiceHandler(
  bot: { on: Function },
  agent: Agent,
  transcriber: Transcriber,
  synthesizer: Synthesizer | null
): void {
  bot.on("message:voice", async (ctx: Context) => {
    const userName = ctx.from?.first_name || "User";
    console.log(`🎤 ${userName}: [voice message]`);

    await ctx.replyWithChatAction("typing");

    // ── Step 1: Download ─────────────────────────────────────
    let audioBuffer: Buffer;
    try {
      const file = await ctx.getFile();
      const fileUrl = `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`;

      const response = await fetch(fileUrl);
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      audioBuffer = Buffer.from(arrayBuffer);

      if (audioBuffer.length === 0) {
        throw new Error("Empty audio file");
      }

      console.log(
        `   📥 Downloaded voice: ${(audioBuffer.length / 1024).toFixed(1)} KB`
      );
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`❌ Voice download error: ${errMsg}`);
      await ctx.reply("🎤 Ses dosyasını indiremedim. Lütfen tekrar deneyin.");
      return;
    }

    // ── Step 2: Transcribe ───────────────────────────────────
    let transcription: string;
    try {
      transcription = await transcriber.transcribe(audioBuffer, "audio/ogg");
      console.log(
        `   📝 Transcribed: "${transcription.substring(0, 60)}${transcription.length > 60 ? "..." : ""}"`
      );
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`❌ Transcription error: ${errMsg}`);
      await ctx.reply(
        "🎤 Ses mesajını çözemedim. Lütfen daha net bir şekilde tekrar deneyin veya yazarak gönderin."
      );
      return;
    }

    // ── Step 3: Send transcription ───────────────────────────
    await ctx.reply(`📝 *Transcript:*\n_${escapeMarkdown(transcription)}_`, {
      parse_mode: "Markdown",
    });

    // ── Step 4: Agent response ───────────────────────────────
    await ctx.replyWithChatAction("typing");

    try {
      const agentResponse = await agent.processMessage(transcription);

      if (agentResponse.length <= 4096) {
        await ctx.reply(agentResponse);
      } else {
        const chunks = splitMessage(agentResponse, 4096);
        for (const chunk of chunks) {
          await ctx.reply(chunk);
        }
      }

      // Voice replies to voice messages if TTS is available
      if (synthesizer) {
        await sendVoiceReply(ctx, synthesizer, agentResponse);
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`❌ Agent error (voice): ${errMsg}`);
      await ctx.reply(
        "⚠️ Yanıt oluştururken bir hata oluştu. Lütfen tekrar deneyin."
      );
    }
  });
}

// ── Helpers ──────────────────────────────────────────────────

function escapeMarkdown(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, "\\$1");
}

async function sendVoiceReply(
  ctx: Context,
  synthesizer: Synthesizer,
  text: string
): Promise<void> {
  try {
    await ctx.replyWithChatAction("record_voice");
    const result = await synthesizer.synthesize(text);
    try {
      await ctx.replyWithVoice(new InputFile(result.filePath));
    } finally {
      result.cleanup();
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`❌ TTS error: ${errMsg}`);
    // Don't send error for voice replies on voice messages — text is already sent
  }
}
