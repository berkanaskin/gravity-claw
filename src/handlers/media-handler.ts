import type { Context } from "grammy";
import type { Agent } from "../agent.js";
import {
  GoogleGenerativeAI,
  type Part,
} from "@google/generative-ai";
import OpenAI from "openai";
import type { Config } from "../config.js";
import https from "node:https";
import http from "node:http";

// ── Helper: Is OpenAI config? ────────────────────────────────

function isOpenAIConfig(config: Config): boolean {
  return !!(config.modelApiBase?.includes("openai.com")) ||
    config.modelName.startsWith("gpt-") ||
    config.modelName.startsWith("o1") ||
    config.modelName.startsWith("o3") ||
    config.modelName.startsWith("o4");
}

// ── Photo Handler ─────────────────────────────────────────────

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
      const photos = ctx.message!.photo!;
      const bestPhoto = photos.at(-1)!;
      const file = await ctx.api.getFile(bestPhoto.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
      const imageBuffer = await downloadFile(fileUrl);
      const base64Image = imageBuffer.toString("base64");
      const caption = ctx.message!.caption || "";
      const prompt = caption
        ? `Kullanıcı bu fotoğrafı şu mesajla gönderdi: "${caption}". Fotoğrafı analiz et ve yanıtla.`
        : "Bu fotoğrafı analiz et. Ne görüyorsun? Kısa ve öz açıkla.";

      let response: string;

      if (isOpenAIConfig(config) && config.openaiApiKey) {
        // GPT-5.2 Vision
        const openai = new OpenAI({
          apiKey: config.openaiApiKey,
          baseURL: config.modelApiBase ?? undefined,
        });
        const result = await openai.chat.completions.create({
          model: config.modelName,
          messages: [{
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}`, detail: "high" } },
            ],
          }],
        });
        response = result.choices[0]?.message?.content || "(No response)";
      } else {
        // Gemini Vision
        const genAI = new GoogleGenerativeAI(config.modelApiKey);
        const model = genAI.getGenerativeModel({ model: config.modelName });
        const imagePart: Part = { inlineData: { data: base64Image, mimeType: "image/jpeg" } };
        const result = await model.generateContent([prompt, imagePart]);
        response = result.response.text();
      }

      await sendSplitReply(ctx, response);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`❌ Photo analysis error: ${errMsg}`);
      await ctx.reply("⚠️ Fotoğraf analiz edilemedi. Lütfen tekrar deneyin.");
    }
  });
}

// ── Document Handler ──────────────────────────────────────────

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

function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith("image/");
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
        // Text files: pass as message text to full agent (with tool support)
        const textContent = fileBuffer.toString("utf-8");
        const truncated = textContent.length > 30000
          ? textContent.substring(0, 30000) + "\n\n...[dosya kısaltıldı]"
          : textContent;

        const response = await agent.processMessage(
          `${prompt}\n\nDosya içeriği:\n\`\`\`\n${truncated}\n\`\`\``
        );
        await sendSplitReply(ctx, response);

      } else if (isImageMime(mimeType) && isOpenAIConfig(config) && config.openaiApiKey) {
        // Image documents via GPT Vision
        const openai = new OpenAI({
          apiKey: config.openaiApiKey,
          baseURL: config.modelApiBase ?? undefined,
        });
        const base64 = fileBuffer.toString("base64");
        const result = await openai.chat.completions.create({
          model: config.modelName,
          messages: [{
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}`, detail: "high" } },
            ],
          }],
        });
        await sendSplitReply(ctx, result.choices[0]?.message?.content || "(No response)");

      } else if (isImageMime(mimeType)) {
        // Image documents via Gemini Vision
        const genAI = new GoogleGenerativeAI(config.modelApiKey);
        const model = genAI.getGenerativeModel({ model: config.modelName });
        const filePart: Part = { inlineData: { data: fileBuffer.toString("base64"), mimeType } };
        const result = await model.generateContent([prompt, filePart]);
        await sendSplitReply(ctx, result.response.text());

      } else {
        // PDF and other binary documents — Gemini handles natively, GPT via base64
        if (isOpenAIConfig(config) && config.openaiApiKey && mimeType === "application/pdf") {
          // GPT-5.2 doesn't support native PDF — extract text via message
          await ctx.reply("📄 PDF analizi yapılıyor (metin çıkarma)...");
          const response = await agent.processMessage(
            `${prompt}\n\n[PDF dosyası alındı: ${fileName}, ${Math.round((doc.file_size ?? 0) / 1024)}KB — ` +
            `Dosyayı analiz edemiyorum doğrudan, ama içeriği metin olarak yapıştırabilirsin.]`
          );
          await sendSplitReply(ctx, response);
        } else {
          // Gemini native PDF support
          const genAI = new GoogleGenerativeAI(config.modelApiKey);
          const model = genAI.getGenerativeModel({ model: config.modelName });
          const filePart: Part = { inlineData: { data: fileBuffer.toString("base64"), mimeType } };
          const result = await model.generateContent([prompt, filePart]);
          await sendSplitReply(ctx, result.response.text());
        }
      }

    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`❌ Document analysis error: ${errMsg}`);
      await ctx.reply("⚠️ Dosya analiz edilemedi. Lütfen tekrar deneyin.");
    }
  });
}

// ── Video Handler (NEW — GPT-5.2 only) ───────────────────────

export function registerVideoHandler(
  bot: { on: Function },
  agent: Agent,
  config: Config
): void {
  bot.on("message:video", async (ctx: Context) => {
    const userName = ctx.from?.first_name || "User";
    const video = ctx.message!.video!;
    console.log(`🎥 ${userName}: sent a video (${Math.round((video.file_size ?? 0) / 1024)}KB, ${video.duration}s)`);

    // Size check — Telegram bots can only download up to 20MB
    if (video.file_size && video.file_size > 20 * 1024 * 1024) {
      await ctx.reply("⚠️ Video çok büyük (max 20MB). Daha kısa/küçük bir video gönderin.");
      return;
    }

    // GPT-5.2 Vision supports video frames — Gemini also supports video
    await ctx.replyWithChatAction("upload_video");

    try {
      const file = await ctx.api.getFile(video.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
      const videoBuffer = await downloadFile(fileUrl);
      const caption = ctx.message!.caption || "";
      const prompt = caption
        ? `Kullanıcı bu videoyu şu mesajla gönderdi: "${caption}". Videoyu analiz et.`
        : "Bu videoyu analiz et. Ne oluyor? Kısaca açıkla.";

      let response: string;

      if (isOpenAIConfig(config) && config.openaiApiKey) {
        // GPT-5.2: Video as base64 (mp4)
        const openai = new OpenAI({
          apiKey: config.openaiApiKey,
          baseURL: config.modelApiBase ?? undefined,
        });
        const base64Video = videoBuffer.toString("base64");
        const mimeType = "video/mp4";
        const result = await openai.chat.completions.create({
          model: config.modelName,
          messages: [{
            role: "user",
            content: [
              { type: "text", text: prompt },
              // GPT-5.2 video input
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Video}` } },
            ],
          }],
        });
        response = result.choices[0]?.message?.content || "(No response)";
      } else {
        // Gemini: Native video support
        const genAI = new GoogleGenerativeAI(config.modelApiKey);
        const model = genAI.getGenerativeModel({ model: config.modelName });
        const videoPart: Part = {
          inlineData: { data: videoBuffer.toString("base64"), mimeType: "video/mp4" },
        };
        const result = await model.generateContent([prompt, videoPart]);
        response = result.response.text();
      }

      await sendSplitReply(ctx, response);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`❌ Video analysis error: ${errMsg}`);
      await ctx.reply("⚠️ Video analiz edilemedi. Lütfen tekrar deneyin.");
    }
  });
}

// ── Shared Helper ─────────────────────────────────────────────

async function sendSplitReply(ctx: Context, response: string): Promise<void> {
  if (response.length <= 4096) {
    await ctx.reply(response);
    return;
  }
  for (let i = 0; i < response.length; i += 4096) {
    await ctx.reply(response.substring(i, i + 4096));
  }
}

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
