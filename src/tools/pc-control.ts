import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ToolDefinition } from "../agent.js";

const execAsync = promisify(exec);

// ── Security: Blocked patterns (NEVER execute) ──────────────

const BLOCKED_PATTERNS = [
  // Destructive system commands
  /\bformat\b/i,
  /\bfdisk\b/i,
  /\bdiskpart\b/i,
  /\brm\s+-rf\b/i,
  /\bdel\s+\/s\s+\/q\s+[A-Z]:\\/i,  // del /s /q C:\
  /\brd\s+\/s\s+\/q\s+[A-Z]:\\/i,   // rd /s /q C:\
  // Registry
  /\breg\s+(delete|add)\b/i,
  /\bregedit\b/i,
  // System modification
  /\bbcdedit\b/i,
  /\bsfc\b/i,
  /\bchkdsk\b/i,
  /\bnet\s+user\b/i,
  /\bnet\s+localgroup\b/i,
  // Network exposure
  /\bnetsh\s+advfirewall\b/i,
  /\bnetsh\s+firewall\b/i,
  // Crypto / mining
  /\bxmrig\b/i,
  /\bcryptominer\b/i,
  // PowerShell bypass
  /\bSet-ExecutionPolicy\b/i,
  /\b-ExecutionPolicy\s+Bypass\b/i,
  /\bInvoke-Expression\b.*\bNet\.WebClient\b/i, // Download-and-execute
  // Shutdown
  /\bshutdown\b/i,
  /\bRestart-Computer\b/i,
  /\bStop-Computer\b/i,
];

// ── Security: Safe patterns (no approval needed) ────────────

const SAFE_PATTERNS = [
  /^(Get-ChildItem|ls|dir|gci)\b/i,
  /^(Get-Content|cat|type|gc)\b/i,
  /^(Get-Item|gi)\b/i,
  /^(Get-ItemProperty|gp)\b/i,
  /^(Get-Process|gps|ps)\b/i,
  /^(Get-Service|gsv)\b/i,
  /^(Get-Date)\b/i,
  /^(Get-ComputerInfo)\b/i,
  /^(Get-Disk|Get-Volume)\b/i,
  /^(Get-NetIPAddress)\b/i,
  /^(hostname|whoami|systeminfo)\b/i,
  /^(pwd|cd)\b/i,
  /^(Test-Path)\b/i,
  /^(Measure-Object)\b/i,
  /^(Select-String|findstr|grep)\b/i,
  /^(Get-FileHash)\b/i,
  /^(echo|Write-Output|Write-Host)\b/i,
  /^([a-z]:\\)/i, // Just a path — likely file listing
];

// ── Danger Level Classification ─────────────────────────────

type DangerLevel = "blocked" | "safe" | "normal" | "dangerous";

function classifyCommand(command: string): DangerLevel {
  const trimmed = command.trim();

  // Check blocked patterns first
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(trimmed)) return "blocked";
  }

  // Check safe patterns
  for (const pattern of SAFE_PATTERNS) {
    if (pattern.test(trimmed)) return "safe";
  }

  // Destructive file operations need extra confirmation
  if (/\b(Remove-Item|del|rm|erase|rd|rmdir)\b/i.test(trimmed)) return "dangerous";
  if (/\b(Move-Item|mv|move|ren|rename)\b/i.test(trimmed)) return "normal";
  if (/\b(Copy-Item|cp|copy|xcopy|robocopy)\b/i.test(trimmed)) return "normal";

  // Installation commands
  if (/\b(winget|choco|npm|pip)\s+install\b/i.test(trimmed)) return "normal";
  if (/\b(Start-Process|start|Invoke-Item|ii)\b/i.test(trimmed)) return "normal";

  // Everything else is normal (needs single approval)
  return "normal";
}

// ── Audit Log ───────────────────────────────────────────────

const AUDIT_DIR = "memory";
const AUDIT_FILE = path.join(AUDIT_DIR, "pc_audit.log");

function auditLog(command: string, result: string, approved: boolean): void {
  try {
    if (!fs.existsSync(AUDIT_DIR)) fs.mkdirSync(AUDIT_DIR, { recursive: true });
    const ts = new Date().toISOString().replace("T", " ").substring(0, 19);
    const status = approved ? "EXECUTED" : "BLOCKED";
    const entry = `[${ts}] ${status}: ${command}\n  → ${result.substring(0, 200)}\n\n`;
    fs.appendFileSync(AUDIT_FILE, entry, "utf-8");
  } catch { /* never crash on logging */ }
}

// ── Tool Definitions ────────────────────────────────────────

export function createPcTools(): ToolDefinition[] {
  return [
    // 1. System Info (always safe)
    {
      name: "pc_system_info",
      description: "Get current system information: OS, CPU, RAM, disk, hostname.",
      parameters: {
        type: "object",
        properties: {},
      },
      execute: async () => {
        const info = {
          hostname: os.hostname(),
          platform: os.platform(),
          arch: os.arch(),
          cpus: os.cpus().length,
          totalMemoryGB: (os.totalmem() / 1073741824).toFixed(1),
          freeMemoryGB: (os.freemem() / 1073741824).toFixed(1),
          uptime: `${(os.uptime() / 3600).toFixed(1)} hours`,
          homeDir: os.homedir(),
          user: os.userInfo().username,
        };
        return JSON.stringify(info, null, 2);
      },
    },

    // 2. List Files (always safe)
    {
      name: "pc_list_files",
      description:
        "List files and folders in a directory. Returns names, sizes, and types. " +
        "Use this to browse the user's file system.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Directory path to list (e.g., C:\\Users\\berka\\Desktop)",
          },
        },
        required: ["path"],
      },
      execute: async (args) => {
        const dirPath = args["path"] as string;

        if (!fs.existsSync(dirPath)) {
          return JSON.stringify({ error: `Path not found: ${dirPath}` });
        }

        const stat = fs.statSync(dirPath);
        if (!stat.isDirectory()) {
          // If it's a file, return file info
          return JSON.stringify({
            type: "file",
            name: path.basename(dirPath),
            size: `${(stat.size / 1024).toFixed(1)} KB`,
            modified: stat.mtime.toISOString(),
          });
        }

        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        const items = entries.slice(0, 50).map((entry) => {
          const fullPath = path.join(dirPath, entry.name);
          try {
            const s = fs.statSync(fullPath);
            return {
              name: entry.name,
              type: entry.isDirectory() ? "folder" : "file",
              size: entry.isFile() ? `${(s.size / 1024).toFixed(1)} KB` : undefined,
              modified: s.mtime.toISOString().substring(0, 10),
            };
          } catch {
            return { name: entry.name, type: "unknown" };
          }
        });

        return JSON.stringify({
          path: dirPath,
          totalItems: entries.length,
          showing: items.length,
          items,
        }, null, 2);
      },
    },

    // 3. Execute Command (approval handled by agent via system prompt)
    {
      name: "pc_execute",
      description:
        "Execute a PowerShell command on the user's PC. " +
        "Safe commands (Get-*, ls, dir, hostname, etc.) run automatically. " +
        "Normal commands (copy, move, start) run automatically. " +
        "ONLY ask for confirmation for DANGEROUS commands (delete, remove, format, registry). " +
        "Blocked commands (shutdown, diskpart, format) are always rejected.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The PowerShell command to execute",
          },
          approved: {
            type: "boolean",
            description: "Must be true — confirms the user has approved this command",
          },
        },
        required: ["command", "approved"],
      },
      execute: async (args) => {
        const command = args["command"] as string;
        const approved = args["approved"] as boolean;

        // Double-check approval flag
        if (!approved) {
          return JSON.stringify({
            error: "Command not approved. Ask the user for confirmation first.",
          });
        }

        // Security check
        const danger = classifyCommand(command);

        if (danger === "blocked") {
          auditLog(command, "BLOCKED by security policy", false);
          return JSON.stringify({
            error: "🚫 Bu komut güvenlik politikası tarafından engellendi.",
            command,
            reason: "Bu komut potansiyel olarak tehlikeli ve çalıştırılamaz.",
          });
        }

        try {
          const { stdout, stderr } = await execAsync(command, {
            shell: "powershell.exe",
            timeout: 30000, // 30 second timeout
            maxBuffer: 1024 * 1024, // 1MB output limit
            cwd: os.homedir(),
          });

          const output = stdout || stderr || "(komut çıktı üretmedi)";
          const truncated = output.length > 3000
            ? output.substring(0, 3000) + "\n...[çıktı kısaltıldı]"
            : output;

          auditLog(command, truncated, true);

          return JSON.stringify({
            success: true,
            command,
            output: truncated,
          });
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          auditLog(command, `ERROR: ${errMsg}`, true);
          return JSON.stringify({
            success: false,
            command,
            error: errMsg.substring(0, 500),
          });
        }
      },
    },

    // 4. Open File/App (convenience, still needs approval via prompt)
    {
      name: "pc_open",
      description:
        "Open a file or application. Examples: open a PDF, start an app, open a folder in Explorer. " +
        "Ask the user for approval before opening anything.",
      parameters: {
        type: "object",
        properties: {
          target: {
            type: "string",
            description: "File path or application name to open",
          },
        },
        required: ["target"],
      },
      execute: async (args) => {
        const target = args["target"] as string;

        // Security: block opening system dirs
        if (/system32|syswow64|windows\\system/i.test(target)) {
          return JSON.stringify({ error: "Sistem dizinleri açılamaz." });
        }

        try {
          await execAsync(`Start-Process "${target}"`, {
            shell: "powershell.exe",
            timeout: 10000,
          });

          auditLog(`OPEN: ${target}`, "opened successfully", true);
          return JSON.stringify({ success: true, opened: target });
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          return JSON.stringify({ success: false, error: errMsg.substring(0, 300) });
        }
      },
    },
  ];
}
