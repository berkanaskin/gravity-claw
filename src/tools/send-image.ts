/**
 * send-image.ts — Telegram'a fotoğraf/görsel gönderme tool'u
 *
 * Agent bu tool'u kullanarak kullanıcıya:
 * - Screenshot gönderebilir
 * - Oluşturduğu görselleri gönderebilir
 * - URL'den fotoğraf gönderebilir
 * - PC Bridge'den alınan screenshot'ları forward edebilir
 */

import * as fs from "node:fs";
import type { Bot } from "grammy";
import { InputFile } from "grammy";
import type { ToolDefinition } from "../agent.js";
import type { Config } from "../config.js";

export function createSendImageTool(bot: Bot, config: Config): ToolDefinition {
  return {
    name: "send_image",
    description:
      "Send an image/photo to the user via Telegram. " +
      "Use this to share screenshots, generated images, or any visual content. " +
      "Supports: local file path, URL, or base64-encoded image data. " +
      "Always add a caption describing the image.",
    parameters: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description:
            "Image source: a local file path (e.g. /tmp/screenshot.png), " +
            "a URL (https://...), or base64 data (data:image/png;base64,...)",
        },
        caption: {
          type: "string",
          description: "Caption text to display with the image (supports Markdown)",
        },
      },
      required: ["source", "caption"],
    },
    execute: async (input: Record<string, unknown>): Promise<string> => {
      const source = typeof input.source === "string" ? input.source : "";
      const caption = typeof input.caption === "string" ? input.caption : "";

      if (!source) {
        return JSON.stringify({ error: "Image source is required" });
      }

      try {
        for (const userId of config.allowedUserIds) {
          if (source.startsWith("http://") || source.startsWith("https://")) {
            // URL-based image
            await bot.api.sendPhoto(userId, source, {
              caption,
              parse_mode: "Markdown",
            });
          } else if (source.startsWith("data:image/")) {
            // Base64 with data URI prefix
            const base64Data = source.replace(/^data:image\/\w+;base64,/, "");
            const buffer = Buffer.from(base64Data, "base64");
            const formatMatch = /^data:image\/(\w+);/.exec(source);
            const ext = formatMatch ? formatMatch[1].replace("jpeg", "jpg") : "jpg";
            await bot.api.sendPhoto(userId, new InputFile(buffer, `image.${ext}`), {
              caption,
              parse_mode: "Markdown",
            });
          } else if (fs.existsSync(source)) {
            // Local file path
            await bot.api.sendPhoto(userId, new InputFile(source), {
              caption,
              parse_mode: "Markdown",
            });
          } else if (source.length > 200 && /^[A-Za-z0-9+/=\s]+$/.test(source.substring(0, 100))) {
            // Raw base64 data (no data URI prefix) — from PC Bridge screenshots
            const buffer = Buffer.from(source, "base64");
            await bot.api.sendPhoto(userId, new InputFile(buffer, "screenshot.jpg"), {
              caption,
              parse_mode: "Markdown",
            });
          } else {
            return JSON.stringify({ error: `Image not found: ${source.substring(0, 100)}` });
          }
        }

        return JSON.stringify({ success: true, message: "Image sent successfully" });
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        return JSON.stringify({ error: `Failed to send image: ${errMsg}` });
      }
    },
  };
}
