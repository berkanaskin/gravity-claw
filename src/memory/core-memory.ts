import * as fs from "node:fs";
import * as path from "node:path";

const MEMORY_DIR = "memory";
const CORE_FILE = path.join(MEMORY_DIR, "core_memory.md");
const SOUL_FILE = path.join(MEMORY_DIR, "soul.md");

const DEFAULT_CONTENT = `# Core Memory — Agent Claw

This file contains stable information about you (the user).
Edit this directly — Agent Claw reads it at startup.

## About You
- Name: (your name)
- Language: Turkish / English
- Timezone: Europe/Istanbul (UTC+3)

## Preferences
- Response style: concise, friendly
- (add your preferences here)

## Important Notes
- (add anything the bot should always know)
`;

/**
 * Reads the core memory file. Creates default if missing.
 */
export function readCoreMemory(): string {
  ensureFile();
  return fs.readFileSync(CORE_FILE, "utf-8");
}

/**
 * Reads the soul file (communication style guide).
 */
export function readSoul(): string {
  if (!fs.existsSync(SOUL_FILE)) {
    return "";
  }
  return fs.readFileSync(SOUL_FILE, "utf-8");
}

/**
 * Returns core memory + soul formatted for the system prompt.
 */
export function getCoreMemoryContext(): string {
  const coreContent = readCoreMemory();
  const soulContent = readSoul();

  let context = `\n\n--- CORE MEMORY (user-defined, always available) ---\n${coreContent}\n--- END CORE MEMORY ---`;

  if (soulContent) {
    context += `\n\n--- SOUL (communication style guide) ---\n${soulContent}\n--- END SOUL ---`;
  }

  return context;
}

function ensureFile(): void {
  if (!fs.existsSync(MEMORY_DIR)) {
    fs.mkdirSync(MEMORY_DIR, { recursive: true });
  }
  if (!fs.existsSync(CORE_FILE)) {
    fs.writeFileSync(CORE_FILE, DEFAULT_CONTENT, "utf-8");
    console.log(`   📝 Created default ${CORE_FILE}`);
  }
}
