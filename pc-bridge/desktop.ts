// ── PC Bridge: Desktop Control ───────────────────────────────
// Uses native compiled DesktopHelper.exe — no PowerShell, no AMSI issues.
// The helper is pre-compiled with csc.exe from DesktopHelper.cs

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

// Resolve helper path relative to this file's compiled location
const __dirname_resolved = typeof __dirname !== "undefined"
  ? __dirname
  : dirname(fileURLToPath(import.meta.url));

const HELPER_EXE = join(__dirname_resolved, "..", "helper", "DesktopHelper.exe");

/**
 * Run the native DesktopHelper.exe with given arguments.
 */
async function runHelper(
  args: string[],
  options: { timeout?: number; maxBuffer?: number } = {}
): Promise<string> {
  if (!existsSync(HELPER_EXE)) {
    throw new Error(
      `DesktopHelper.exe not found at: ${HELPER_EXE}\n` +
      `Compile it with: csc.exe /optimize /out:helper\\DesktopHelper.exe ` +
      `/reference:System.Windows.Forms.dll /reference:System.Drawing.dll helper\\DesktopHelper.cs`
    );
  }

  const { stdout, stderr } = await execFileAsync(HELPER_EXE, args, {
    timeout: options.timeout ?? 10000,
    maxBuffer: options.maxBuffer ?? 1024 * 1024 * 10, // 10MB for screenshots
  });

  if (stderr && stderr.trim()) {
    throw new Error(stderr.trim());
  }

  return stdout.trim();
}

/** Take full desktop screenshot (ALL monitors) — returns base64 JPEG */
export async function desktopScreenshot(): Promise<string> {
  return await runHelper(["screenshot", "all"], { timeout: 15000 });
}

/** Click at screen coordinates */
export async function desktopClick(
  x: number,
  y: number,
  button: "left" | "right" = "left"
): Promise<string> {
  await runHelper(["click", String(x), String(y), button], { timeout: 5000 });
  return `Clicked ${button} at (${x}, ${y})`;
}

/** Type text */
export async function desktopType(text: string): Promise<string> {
  await runHelper(["type", text], { timeout: 5000 });
  return `Typed: ${text.substring(0, 100)}`;
}

/** Send keyboard hotkey using virtual key codes */
export async function desktopHotkey(hotkey: string): Promise<string> {
  // Virtual key code map
  const vkMap: Record<string, string> = {
    ctrl: "0x11", alt: "0x12", shift: "0x10", win: "0x5B",
    enter: "0x0D", tab: "0x09", escape: "0x1B", esc: "0x1B",
    backspace: "0x08", delete: "0x2E", del: "0x2E",
    up: "0x26", down: "0x28", left: "0x25", right: "0x27",
    space: "0x20",
    f1: "0x70", f2: "0x71", f3: "0x72", f4: "0x73",
    f5: "0x74", f6: "0x75", f7: "0x76", f8: "0x77",
    f9: "0x78", f10: "0x79", f11: "0x7A", f12: "0x7B",
    home: "0x24", end: "0x23", pageup: "0x21", pagedown: "0x22",
    a: "0x41", b: "0x42", c: "0x43", d: "0x44", e: "0x45",
    f: "0x46", g: "0x47", h: "0x48", i: "0x49", j: "0x4A",
    k: "0x4B", l: "0x4C", m: "0x4D", n: "0x4E", o: "0x4F",
    p: "0x50", q: "0x51", r: "0x52", s: "0x53", t: "0x54",
    u: "0x55", v: "0x56", w: "0x57", x: "0x58", y: "0x59", z: "0x5A",
    "0": "0x30", "1": "0x31", "2": "0x32", "3": "0x33", "4": "0x34",
    "5": "0x35", "6": "0x36", "7": "0x37", "8": "0x38", "9": "0x39",
    prtscn: "0x2C", printscreen: "0x2C", snapshot: "0x2C",
    insert: "0x2D", ins: "0x2D",
    numlock: "0x90", scrolllock: "0x91",
    pause: "0x13", break: "0x13",
  };

  const parts = hotkey.toLowerCase().split("+").map(p => p.trim());
  const vkCodes: string[] = [];

  for (const part of parts) {
    const vk = vkMap[part];
    if (!vk) {
      return `Error: Unknown key "${part}" in hotkey "${hotkey}"`;
    }
    vkCodes.push(vk);
  }

  await runHelper(["hotkey", ...vkCodes], { timeout: 5000 });
  return `Hotkey sent: ${hotkey}`;
}

/** Focus a window by title (partial match) */
export async function desktopFocusWindow(title: string): Promise<string> {
  const result = await runHelper(["focus", title], { timeout: 5000 });

  if (result === "NOT_FOUND") {
    return `Window not found: "${title}"`;
  }
  return `Focused: ${result}`;
}

/** Install program via winget */
export async function desktopInstall(packageId: string): Promise<string> {
  const safeId = packageId.replace(/['"\\]/g, "");
  const { stdout, stderr } = await execFileAsync(
    "winget",
    ["install", safeId, "--accept-package-agreements", "--accept-source-agreements"],
    { timeout: 120000, maxBuffer: 1024 * 1024 }
  );
  return stdout || stderr || "Installation completed";
}
