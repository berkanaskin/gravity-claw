// ── Shared Utilities ─────────────────────────────────────────

export function splitMessage(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitIndex = remaining.lastIndexOf("\n", maxLength);
    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      splitIndex = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      splitIndex = maxLength;
    }

    chunks.push(remaining.substring(0, splitIndex));
    remaining = remaining.substring(splitIndex).trimStart();
  }

  return chunks;
}

// ── Voice Reply Detection ────────────────────────────────────

const VOICE_TRIGGERS = [
  "reply with voice",
  "sesli yanıtla",
  "sesli yanıt ver",
  "sesli cevapla",
  "voice reply",
];

/**
 * Checks if the user's message contains a voice reply trigger.
 * Case-insensitive matching.
 */
export function wantsVoiceReply(message: string): boolean {
  const lower = message.toLowerCase();
  return VOICE_TRIGGERS.some((trigger) => lower.includes(trigger));
}

/**
 * Strips voice command triggers from the message,
 * leaving only the actual content for the agent.
 */
export function stripVoiceCommand(message: string): string {
  let cleaned = message;
  for (const trigger of VOICE_TRIGGERS) {
    const regex = new RegExp(trigger, "gi");
    cleaned = cleaned.replace(regex, "");
  }
  // Clean up leftover punctuation and whitespace
  return cleaned.replace(/^\s*[,.:;!?-]+\s*/, "").replace(/\s*[,.:;!?-]+\s*$/, "").trim();
}
