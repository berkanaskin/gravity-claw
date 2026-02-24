// ── PC Bridge: Browser Control via Playwright ───────────────
// Connects to user's existing Chrome instance via CDP
// and provides structured browser automation.

import { chromium, type Browser, type Page, type BrowserContext } from "playwright";

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let activePage: Page | null = null;

const CDP_PORT = parseInt(process.env["CDP_PORT"] || "9222", 10);

/** Connect to or launch Chrome */
export async function connectBrowser(): Promise<void> {
  if (browser?.isConnected()) return;

  try {
    // Try connecting to existing Chrome with remote debugging
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
    const contexts = browser.contexts();
    context = contexts[0] || await browser.newContext();
    const pages = context.pages();
    activePage = pages[0] || await context.newPage();
    console.log(`🌐 Connected to Chrome (CDP port ${CDP_PORT}), ${pages.length} tab(s) found`);
  } catch (err) {
    console.error("⚠️ Could not connect to Chrome via CDP. Starting standalone...");
    browser = await chromium.launch({
      headless: false,
      channel: "chrome",
    });
    context = await browser.newContext();
    activePage = await context.newPage();
    console.log("🌐 Launched standalone Chrome");
  }
}

/** Ensure we have an active page */
async function ensurePage(): Promise<Page> {
  if (!activePage || activePage.isClosed()) {
    await connectBrowser();
  }
  return activePage!;
}

/** Navigate to URL */
export async function navigate(url: string): Promise<{ title: string; url: string }> {
  const page = await ensurePage();
  const fullUrl = url.startsWith("http") ? url : `https://${url}`;
  await page.goto(fullUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  return { title: await page.title(), url: page.url() };
}

/** Take screenshot of current page */
export async function screenshot(): Promise<string> {
  const page = await ensurePage();
  const buffer = await page.screenshot({
    type: "png",
    fullPage: false,
  });
  return buffer.toString("base64");
}

/** Click an element by selector or visible text */
export async function click(target: string): Promise<{ clicked: string; url: string }> {
  const page = await ensurePage();

  // Try as text first, then as selector
  try {
    await page.getByText(target, { exact: false }).first().click({ timeout: 5000 });
  } catch {
    await page.click(target, { timeout: 5000 });
  }

  // Wait for navigation if any
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  return { clicked: target, url: page.url() };
}

/** Type text into a focused or targeted element */
export async function type(selector: string, text: string): Promise<{ typed: string; into: string }> {
  const page = await ensurePage();

  try {
    await page.fill(selector, text);
  } catch {
    // Fallback: click then type
    await page.click(selector, { timeout: 5000 });
    await page.keyboard.type(text, { delay: 30 });
  }

  return { typed: text, into: selector };
}

/** Read page content as text */
export async function readPage(): Promise<{ title: string; url: string; text: string }> {
  const page = await ensurePage();
  const title = await page.title();
  const url = page.url();

  // Get visible text content, truncated
  const text = await page.evaluate(() => {
    const body = document.body;
    if (!body) return "(boş sayfa)";
    return body.innerText.substring(0, 5000);
  });

  return { title, url, text };
}

/** Scroll the page */
export async function scroll(direction: "down" | "up" = "down", amount = 500): Promise<string> {
  const page = await ensurePage();
  const delta = direction === "down" ? amount : -amount;
  await page.mouse.wheel(0, delta);
  await new Promise(r => setTimeout(r, 300)); // Wait for scroll animation
  return `Scrolled ${direction} by ${amount}px`;
}

/** Press keyboard key (Enter, Tab, Escape, etc.) */
export async function pressKey(key: string): Promise<string> {
  const page = await ensurePage();
  await page.keyboard.press(key);
  return `Pressed key: ${key}`;
}

/** Get list of open tabs */
export async function listTabs(): Promise<Array<{ index: number; title: string; url: string }>> {
  if (!context) await connectBrowser();
  const pages = context!.pages();
  const tabs = [];
  for (let i = 0; i < pages.length; i++) {
    tabs.push({
      index: i,
      title: await pages[i].title(),
      url: pages[i].url(),
    });
  }
  return tabs;
}

/** Switch to a specific tab by index */
export async function switchTab(index: number): Promise<{ title: string; url: string }> {
  if (!context) await connectBrowser();
  const pages = context!.pages();
  if (index < 0 || index >= pages.length) {
    throw new Error(`Tab index ${index} out of range (${pages.length} tabs)`);
  }
  activePage = pages[index];
  await activePage.bringToFront();
  return { title: await activePage.title(), url: activePage.url() };
}

/** Close browser connection */
export async function disconnect(): Promise<void> {
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
    context = null;
    activePage = null;
    console.log("🌐 Browser disconnected");
  }
}
