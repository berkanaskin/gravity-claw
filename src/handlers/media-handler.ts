import type { Context } from "grammy";
import type { Agent } from "../agent.js";
import {
  GoogleGenerativeAI,
  type Part,
} from "@google/generative-ai";
import type { Config } from "../config.js";
import https from "node:https";
import http from "node:http";

// ── Photo Handler ────────────────────────────────────────────
// When user sends a photo, download it and send to Gemini Vision for analysis.

export function registerPhotoHandler(
  bot: { on: Function },
  agent: Agent,
  config: Config
): void {
  bot.on("message:photo", async (ctx: Context) => {
    const userName = ctx.from?.first_name || "User";
    console.log(`📸 ${userName}: sent a photo`);

    await ctx.replyWithChatAction("typing");

    try {
      // Get the highest resolution photo
      const photos = ctx.message!.photo!;
      const bestPhoto = photos.at(-1)!;
      const file = await ctx.api.getFile(bestPhoto.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;

      // Download the image
      const imageBuffer = await downloadFile(fileUrl);
      const base64Image = imageBuffer.toString("base64");
      const mimeType = "image/jpeg";

      // Get caption if any
      const caption = ctx.message!.caption || "";
      const prompt = caption
        ? `Kullanıcı bu fotoğrafı şu mesajla gönderdi: "${caption}". Fotoğrafı analiz et ve yanıtla.`
        : "Bu fotoğrafı analiz et. Ne görüyorsun? Kısa ve öz açıkla.";

      // Use Gemini Vision directly
      const genAI = new GoogleGenerativeAI(config.modelApiKey);
      const model = genAI.getGenerativeModel({ model: config.modelName });

      const imagePart: Part = {
        inlineData: {
          data: base64Image,
          mimeType,
        },
      };

      const result = await model.generateContent([prompt, imagePart]);
      const response = result.response.text();

      if (response.length <= 4096) {
        await ctx.reply(response);
      } else {
        // Split long responses
        for (let i = 0; i < response.length; i += 4096) {
          await ctx.reply(response.substring(i, i + 4096));
        }
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`❌ Photo analysis error: ${errMsg}`);
      await ctx.reply("⚠️ Fotoğraf analiz edilemedi. Lütfen tekrar deneyin.");
    }
  });
}

// ── Document Handler ─────────────────────────────────────────
// When user sends a document (PDF, Excel, etc.), analyze it.

const SUPPORTED_MIME_TYPES = [
  "application/pdf",
  "text/plain",
  "text/csv",
  "text/html",
  "text/markdown",
  "application/json",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

function isSupportedMime(mimeType: string): boolean {
  return SUPPORTED_MIME_TYPES.some((t) => mimeType.startsWith(t));
}

function isTextMime(mimeType: string): boolean {
  return mimeType.startsWith("text/") || mimeType === "application/json";
}

async function sendSplitReply(ctx: Context, response: string): Promise<void> {
  if (response.length <= 4096) {
    await ctx.reply(response);
    return;
  }
  for (let i = 0; i < response.length; i += 4096) {
    await ctx.reply(response.substring(i, i + 4096));
  }
}

export function registerDocumentHandler(
  bot: { on: Function },
  agent: Agent,
  config: Config
): void {
  bot.on("message:document", async (ctx: Context) => {
    const userName = ctx.from?.first_name || "User";
    const doc = ctx.message!.document!;
    const fileName = doc.file_name || "unknown";
    const mimeType = doc.mime_type || "application/octet-stream";

    console.log(`📄 ${userName}: sent document "${fileName}" (${mimeType})`);

    if (doc.file_size && doc.file_size > 20 * 1024 * 1024) {
      await ctx.reply("⚠️ Dosya çok büyük (max 20MB). Daha küçük bir dosya gönderin.");
      return;
    }

    if (!isSupportedMime(mimeType)) {
      await ctx.reply(
        `⚠️ Bu dosya türü desteklenmiyor: ${mimeType}\n` +
        `Desteklenen: PDF, TXT, CSV, JSON, resim dosyaları`
      );
      return;
    }

    await ctx.replyWithChatAction("typing");

    try {
      const file = await ctx.api.getFile(doc.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
      const fileBuffer = await downloadFile(fileUrl);

      const caption = ctx.message!.caption || "";
      const prompt = caption
        ? `Kullanıcı "${fileName}" dosyasını şu mesajla gönderdi: "${caption}". Dosyayı analiz et.`
        : `"${fileName}" dosyasını analiz et. İçeriğini kısaca özetle.`;

      if (isTextMime(mimeType)) {
        const textContent = fileBuffer.toString("utf-8");
        const truncated = textContent.length > 30000
          ? textContent.substring(0, 30000) + "\n\n...[dosya kısaltıldı]"
          : textContent;

        const response = await agent.processMessage(
          `${prompt}\n\nDosya içeriği:\n\`\`\`\n${truncated}\n\`\`\``
        );
        await ctx.reply(response);
      } else {
        const genAI = new GoogleGenerativeAI(config.modelApiKey);
        const model = genAI.getGenerativeModel({ model: config.modelName });

        const filePart: Part = {
          inlineData: {
            data: fileBuffer.toString("base64"),
            mimeType,
          },
        };

        const result = await model.generateContent([prompt, filePart]);
        await sendSplitReply(ctx, result.response.text());
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`❌ Document analysis error: ${errMsg}`);
      await ctx.reply("⚠️ Dosya analiz edilemedi. Lütfen tekrar deneyin.");
    }
  });
}

// ── Helper: Download file from URL ───────────────────────────

function downloadFile(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    client.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}
