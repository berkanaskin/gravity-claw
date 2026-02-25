// ── PC Bridge: Web Scraping via Scrapling ────────────────────
// Uses Python's Scrapling library for stealthy, anti-bot-proof
// web scraping. Falls back to Playwright for simpler pages.

import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs";
import * as path from "node:path";
import * as browser from "./browser.js";

const execAsync = promisify(exec);

// Temp dir for scrapling results
const TEMP_DIR = path.join(process.cwd(), "temp");
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

/**
 * Smart scrape: try Scrapling first (handles anti-bot), fall back to Playwright.
 */
export async function scrape(url: string, options: {
  selector?: string;
  waitFor?: string;
  useScrapling?: boolean;
  timeout?: number;
} = {}): Promise<{
  title: string;
  url: string;
  text: string;
  html?: string;
  method: string;
}> {
  // Try Scrapling first if requested or by default
  if (options.useScrapling !== false) {
    try {
      return await scraplingFetch(url, options);
    } catch (err) {
      console.log(`⚠️ Scrapling failed, falling back to Playwright: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Fallback: Playwright
  return await playwrightFetch(url, options);
}

/**
 * Scrapling-based fetch (handles anti-bot protection)
 */
async function scraplingFetch(url: string, options: {
  selector?: string;
  timeout?: number;
}): Promise<{
  title: string;
  url: string;
  text: string;
  html?: string;
  method: string;
}> {
  const outputFile = path.join(TEMP_DIR, `scrape_${Date.now()}.json`);
  const selectorArg = options.selector ? `--selector "${options.selector}"` : "";
  const timeoutArg = options.timeout ? `--timeout ${options.timeout}` : "";

  // Python script that uses Scrapling
  const pythonScript = `
import json, sys
try:
    from scrapling import Fetcher
except ImportError:
    from scrapling import StealthyFetcher as Fetcher

url = "${url}"
selector = ${options.selector ? `"${options.selector}"` : "None"}

fetcher = Fetcher()
page = fetcher.get(url, timeout=${options.timeout || 30})

result = {
    "title": page.title or "",
    "url": str(page.url),
    "text": "",
    "method": "scrapling"
}

if selector:
    elements = page.css(selector)
    result["text"] = "\\n".join([el.text for el in elements])
    result["html"] = "\\n".join([str(el) for el in elements[:5]])
else:
    result["text"] = page.get_all_text()[:8000]

with open("${outputFile.replace(/\\/g, "\\\\")}", "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False)

print("OK")
`;

  const scriptFile = path.join(TEMP_DIR, `scrape_${Date.now()}.py`);
  fs.writeFileSync(scriptFile, pythonScript, "utf-8");

  try {
    await execAsync(`python "${scriptFile}"`, { timeout: (options.timeout || 30) * 1000 + 5000 });
    const resultText = fs.readFileSync(outputFile, "utf-8");
    return JSON.parse(resultText);
  } finally {
    // Cleanup temp files
    try { fs.unlinkSync(scriptFile); } catch { /* ignore */ }
    try { fs.unlinkSync(outputFile); } catch { /* ignore */ }
  }
}

/**
 * Playwright-based fetch (simpler, uses existing browser)
 */
async function playwrightFetch(url: string, options: {
  selector?: string;
  waitFor?: string;
  timeout?: number;
}): Promise<{
  title: string;
  url: string;
  text: string;
  html?: string;
  method: string;
}> {
  await browser.connectBrowser();
  const result = await browser.navigate(url);

  // Wait for specific element if requested
  // (handled by the caller via browser tools)

  let text: string;
  if (options.selector) {
    const page = await browser.navigate(url);
    // Re-read with selector
    const pageContent = await browser.readPage();
    text = pageContent.text;
  } else {
    const pageContent = await browser.readPage();
    text = pageContent.text;
  }

  return {
    title: result.title,
    url: result.url,
    text: text.substring(0, 8000),
    method: "playwright",
  };
}

/**
 * Extract structured data from a URL (tables, lists, etc.)
 */
export async function extractData(url: string, pattern: string): Promise<{
  data: Array<Record<string, string>>;
  count: number;
  method: string;
}> {
  const pythonScript = `
import json, sys
try:
    from scrapling import Fetcher
except ImportError:
    from scrapling import StealthyFetcher as Fetcher

url = "${url}"
pattern = "${pattern}"

fetcher = Fetcher()
page = fetcher.get(url, timeout=30)

elements = page.css(pattern)
data = []
for el in elements[:50]:
    item = {"text": el.text.strip()}
    for attr in ["href", "src", "title", "alt"]:
        val = el.attrib.get(attr)
        if val:
            item[attr] = val
    data.append(item)

print(json.dumps({"data": data, "count": len(data), "method": "scrapling"}, ensure_ascii=False))
`;

  const scriptFile = path.join(TEMP_DIR, `extract_${Date.now()}.py`);
  fs.writeFileSync(scriptFile, pythonScript, "utf-8");

  try {
    const { stdout } = await execAsync(`python "${scriptFile}"`, { timeout: 35000 });
    return JSON.parse(stdout.trim());
  } finally {
    try { fs.unlinkSync(scriptFile); } catch { /* ignore */ }
  }
}
