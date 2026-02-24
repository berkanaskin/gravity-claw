import type { Context } from "grammy";
import type { Agent } from "../agent.js";
import type { Synthesizer } from "../tts/index.js";
import { splitMessage, wantsVoiceReply, stripVoiceCommand } from "../utils.js";
import { InputFile } from "grammy";

export function registerTextHandler(
  bot: { on: Function },
  agent: Agent,
  synthesizer: Synthesizer | null
): void {
  bot.on("message:text", async (ctx: Context) => {
    const rawMessage = ctx.message!.text!;
    const userName = ctx.from?.first_name || "User";

    console.log(
      `💬 ${userName}: ${rawMessage.substring(0, 80)}${rawMessage.length > 80 ? "..." : ""}`
    );

    await ctx.replyWithChatAction("typing");

    // Keep "typing..." visible during long processing
    const typingInterval = setInterval(() => {
      ctx.replyWithChatAction("typing").catch(() => {});
    }, 5000);

    // Check if user wants a voice reply
    const voiceReply = synthesizer && wantsVoiceReply(rawMessage);
    const userMessage = voiceReply ? stripVoiceCommand(rawMessage) : rawMessage;

    try {
      const response = await agent.processMessage(userMessage);
      clearInterval(typingInterval);

      // Send text reply first (always)
      if (response.length <= 4096) {
        await ctx.reply(response);
      } else {
        const chunks = splitMessage(response, 4096);
        for (const chunk of chunks) {
          await ctx.reply(chunk);
        }
      }

      // Send voice reply if requested
      if (voiceReply && synthesizer) {
        await sendVoiceReply(ctx, synthesizer, response);
      }
    } catch (error) {
      clearInterval(typingInterval);
      const errMsg = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : "";
      console.error(`❌ Agent error: ${errMsg}`);
      if (stack) console.error(stack);
      await ctx.reply(
        "⚠️ Something went wrong processing your message. Please try again."
      );
    }
  });
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
    await ctx.reply("🔇 Sesli yanıt oluşturulamadı. Metin yanıtı yukarıda.");
  }
}
