// ── PC Bridge: Antigravity IDE Automation ────────────────────
// Automates the Antigravity IDE's chat panel to leverage Claude
// Opus/Sonnet for free via the user's existing subscription.
//
// Strategy: Use Playwright to interact with Antigravity's
// Electron app via its built-in Chrome DevTools Protocol.
// The IDE runs on Electron, which exposes CDP on a debug port.

import { chromium, type Browser, type Page } from "playwright";

let browser: Browser | null = null;
let page: Page | null = null;

// Antigravity uses Electron which can expose CDP
const AG_CDP_PORT = parseInt(process.env["AG_CDP_PORT"] || "9229", 10);

/**
 * Connect to the running Antigravity IDE instance via CDP.
 * Antigravity must be launched with --remote-debugging-port=9229
 */
export async function connect(): Promise<{ connected: boolean; title: string }> {
  if (browser?.isConnected() && page && !page.isClosed()) {
    return { connected: true, title: await page.title() };
  }

  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${AG_CDP_PORT}`);
    const contexts = browser.contexts();
    const ctx = contexts[0];
    if (!ctx) throw new Error("No Antigravity context found");

    // Find the main editor window (not devtools, not extensions)
    const pages = ctx.pages();
    page = pages.find(p => !p.url().includes("devtools") && !p.url().includes("extension")) || pages[0];
    if (!page) throw new Error("No Antigravity page found");

    console.log(`🧠 Connected to Antigravity IDE (CDP ${AG_CDP_PORT})`);
    return { connected: true, title: await page.title() };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Antigravity IDE'ye bağlanılamadı (CDP port ${AG_CDP_PORT}). ` +
      `IDE'yi --remote-debugging-port=${AG_CDP_PORT} ile başlat. Hata: ${msg}`
    );
  }
}

/**
 * Send a prompt to Antigravity's chat panel and wait for the response.
 * This types into the chat input, sends, and waits for the AI to finish.
 */
export async function sendPrompt(prompt: string, timeoutMs = 120000): Promise<{
  response: string;
  model: string;
  duration: number;
}> {
  if (!page || page.isClosed()) await connect();
  const p = page!;
  const startTime = Date.now();

  // Focus the chat input area
  // Antigravity's chat input is typically a textarea or contenteditable div
  const chatInput = p.locator('[data-testid="chat-input"], textarea.chat-input, .chat-input-area textarea, [placeholder*="message"], [placeholder*="Ask"]').first();
  
  await chatInput.waitFor({ state: "visible", timeout: 10000 });
  await chatInput.click();
  await chatInput.fill("");
  
  // Type the prompt (using fill for speed, keyboard.type for reliability)
  await chatInput.fill(prompt);
  
  // Send the message (Enter or click send button)
  await p.keyboard.press("Enter");

  // Wait for response to start appearing
  await p.waitForTimeout(2000);

  // Wait for the AI to finish generating (polling approach)
  let response = "";
  let lastResponse = "";
  let stableCount = 0;
  const pollInterval = 1500;
  const requiredStable = 3; // Need 3 stable readings to consider done

  const timeout = setTimeout(() => {
    throw new Error(`Antigravity yanıt zaman aşımı (${timeoutMs / 1000}s)`);
  }, timeoutMs);

  try {
    while (stableCount < requiredStable) {
      await p.waitForTimeout(pollInterval);

      // Read the last assistant message
      response = await p.evaluate(() => {
        const messages = document.querySelectorAll(
          '[data-role="assistant"], .assistant-message, .ai-response, .message-content'
        );
        if (messages.length === 0) return "";
        const last = messages[messages.length - 1];
        return last?.textContent?.trim() || "";
      });

      if (response === lastResponse && response.length > 0) {
        stableCount++;
      } else {
        stableCount = 0;
        lastResponse = response;
      }
    }
  } finally {
    clearTimeout(timeout);
  }

  // Try to detect which model was used
  const model = await p.evaluate(() => {
    const modelIndicator = document.querySelector(
      '[data-testid="model-name"], .model-indicator, .model-badge'
    );
    return modelIndicator?.textContent?.trim() || "unknown";
  });

  return {
    response,
    model,
    duration: Date.now() - startTime,
  };
}

/**
 * Take a screenshot of the Antigravity IDE window.
 */
export async function screenshot(): Promise<string> {
  if (!page || page.isClosed()) await connect();
  const buffer = await page!.screenshot({ type: "png", fullPage: false });
  return buffer.toString("base64");
}

/**
 * Get the current state of Antigravity (model, conversation, etc.)
 */
export async function getState(): Promise<{
  title: string;
  url: string;
  model: string;
  messageCount: number;
}> {
  if (!page || page.isClosed()) await connect();
  const p = page!;

  const title = await p.title();
  const url = p.url();

  const model = await p.evaluate(() => {
    const el = document.querySelector('[data-testid="model-name"], .model-indicator, .model-badge');
    return el?.textContent?.trim() || "unknown";
  });

  const messageCount = await p.evaluate(() => {
    return document.querySelectorAll('[data-role="user"], [data-role="assistant"], .message').length;
  });

  return { title, url, model, messageCount };
}

/**
 * Disconnect from Antigravity IDE
 */
export async function disconnect(): Promise<void> {
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
    page = null;
    console.log("🧠 Antigravity IDE disconnected");
  }
}
