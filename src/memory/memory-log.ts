import * as fs from "fs";
import * as path from "path";

const MEMORY_DIR = "memory";
const LOG_FILE = path.join(MEMORY_DIR, "memory_log.md");

/**
 * Append a timestamped entry to the memory log.
 * This is append-only — entries are never deleted.
 */
export function appendMemoryLog(action: string, content: string): void {
  ensureFile();

  const timestamp = new Date().toISOString().replace("T", " ").substring(0, 19);
  // Truncate content for the log (safe summary, no secrets)
  const safe = content.substring(0, 200).replace(/\n/g, " ");
  const entry = `- [${timestamp}] **${action}:** ${safe}\n`;

  fs.appendFileSync(LOG_FILE, entry, "utf-8");
}

function ensureFile(): void {
  if (!fs.existsSync(MEMORY_DIR)) {
    fs.mkdirSync(MEMORY_DIR, { recursive: true });
  }
  if (!fs.existsSync(LOG_FILE)) {
    fs.writeFileSync(
      LOG_FILE,
      "# Memory Log — Agent Claw\n\nAppend-only log of stored memories.\n\n",
      "utf-8"
    );
  }
}
