import type { Bot } from "grammy";

// ── Pending Approval Store ──────────────────────────────────
// Maps chatId → pending action (only one at a time per user)

interface PendingAction {
  type: "email_send";
  description: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  timestamp: number;
}

const pendingActions = new Map<number, PendingAction>();

const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// ── Tools that require approval before execution ────────────

const APPROVAL_REQUIRED_TOOLS = new Set([
  "gmail.send",
  "gmail.sendDraft",
]);

/**
 * Check if a tool call requires user approval.
 */
export function needsApproval(toolName: string): boolean {
  return APPROVAL_REQUIRED_TOOLS.has(toolName);
}

/**
 * Request approval from the user via Telegram.
 * Returns false — the tool should NOT execute yet.
 */
export async function requestApproval(
  bot: Bot,
  chatId: number,
  toolName: string,
  toolArgs: Record<string, unknown>
): Promise<void> {
  // Build human-readable description
  const to = (toolArgs["to"] as string) || "?";
  const subject = (toolArgs["subject"] as string) || "(konu yok)";
  const bodyPreview = ((toolArgs["body"] as string) || "").substring(0, 200);

  const description =
    `📧 **E-posta göndermek istiyorum:**\n\n` +
    `**Kime:** ${to}\n` +
    `**Konu:** ${subject}\n` +
    `**İçerik:**\n_${bodyPreview}${bodyPreview.length >= 200 ? "..." : ""}_\n\n` +
    `✅ Onaylamak için **"gönder"** yaz\n` +
    `❌ İptal etmek için **"iptal"** yaz\n` +
    `⏱️ 5 dakika içinde yanıt vermezsen otomatik iptal olur.`;

  pendingActions.set(chatId, {
    type: "email_send",
    description,
    toolName,
    toolArgs,
    timestamp: Date.now(),
  });

  await bot.api.sendMessage(chatId, description, { parse_mode: "Markdown" });
  console.log(`⏳ Approval requested for ${toolName} → user ${chatId}`);
}

/**
 * Check if a user message is an approval/rejection response.
 * Returns: { handled: true, approved: boolean, action } or { handled: false }
 */
export function checkApprovalResponse(
  chatId: number,
  message: string
): { handled: boolean; approved?: boolean; action?: PendingAction } {
  const pending = pendingActions.get(chatId);
  if (!pending) return { handled: false };

  // Check timeout
  if (Date.now() - pending.timestamp > APPROVAL_TIMEOUT_MS) {
    pendingActions.delete(chatId);
    console.log(`⏱️ Approval timed out for user ${chatId}`);
    return { handled: false };
  }

  const lower = message.toLowerCase().trim();

  // Approval keywords
  if (["gönder", "onayla", "evet", "ok", "yes", "send", "✅"].includes(lower)) {
    const action = { ...pending };
    pendingActions.delete(chatId);
    console.log(`✅ Approval granted for ${action.toolName} → user ${chatId}`);
    return { handled: true, approved: true, action };
  }

  // Rejection keywords
  if (["iptal", "hayır", "no", "cancel", "❌", "vazgeç"].includes(lower)) {
    pendingActions.delete(chatId);
    console.log(`❌ Approval rejected for ${pending.toolName} → user ${chatId}`);
    return { handled: true, approved: false };
  }

  return { handled: false };
}

/**
 * Check if there's a pending approval for a user.
 */
export function hasPendingApproval(chatId: number): boolean {
  const pending = pendingActions.get(chatId);
  if (!pending) return false;

  // Auto-expire
  if (Date.now() - pending.timestamp > APPROVAL_TIMEOUT_MS) {
    pendingActions.delete(chatId);
    return false;
  }
  return true;
}
