// ── PC Bridge: Desktop Control ───────────────────────────────
// PowerShell-based desktop automation: screenshot, click, type, hotkeys.
// Uses -EncodedCommand to avoid temp files (AV blocks .ps1) and escape issues.

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

/**
 * Run a PowerShell script using -EncodedCommand (Base64 UTF-16LE).
 * This avoids:
 * - Temp .ps1 files (blocked by antivirus)
 * - Quoting/escape hell with inline -Command
 * - Here-string parse errors
 */
async function runPowerShell(
  script: string,
  options: { timeout?: number; maxBuffer?: number } = {}
): Promise<string> {
  // PowerShell -EncodedCommand requires UTF-16LE Base64
  const encoded = Buffer.from(script, "utf16le").toString("base64");

  const { stdout } = await execAsync(
    `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`,
    {
      timeout: options.timeout ?? 10000,
      maxBuffer: options.maxBuffer ?? 1024 * 1024 * 10,
    }
  );

  return stdout.trim();
}

/** Take full desktop screenshot — returns base64 JPEG (smaller than PNG) */
export async function desktopScreenshot(): Promise<string> {
  const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bitmap = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)

# Save as JPEG with quality 70 for smaller file size
$ms = New-Object System.IO.MemoryStream
$jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
$encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]70)
$bitmap.Save($ms, $jpegCodec, $encoderParams)

$bytes = $ms.ToArray()
[System.Convert]::ToBase64String($bytes)

$graphics.Dispose()
$bitmap.Dispose()
$ms.Dispose()
`;

  return await runPowerShell(ps, { timeout: 15000 });
}

/** Click at screen coordinates */
export async function desktopClick(x: number, y: number, button: "left" | "right" = "left"): Promise<string> {
  const mouseEvents = button === "right"
    ? "[MouseInput]::mouse_event(0x0008, 0, 0, 0, 0); [MouseInput]::mouse_event(0x0010, 0, 0, 0, 0)"
    : "[MouseInput]::mouse_event(0x0002, 0, 0, 0, 0); [MouseInput]::mouse_event(0x0004, 0, 0, 0, 0)";

  const ps = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class MouseInput {
  [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int cButtons, int dwExtraInfo);
}
"@

Start-Sleep -Milliseconds 100
${mouseEvents}
`;

  await runPowerShell(ps, { timeout: 5000 });
  return `Clicked ${button} at (${x}, ${y})`;
}

/** Type text using SendKeys */
export async function desktopType(text: string): Promise<string> {
  // Escape special SendKeys characters
  const escaped = text
    .replace(/[+^%~(){}[\]]/g, "{$&}")
    .replace(/\n/g, "{ENTER}")
    .replace(/'/g, "''");

  const ps = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('${escaped}')
`;

  await runPowerShell(ps, { timeout: 5000 });
  return `Typed: ${text.substring(0, 100)}`;
}

/** Send keyboard hotkey using keybd_event (supports Win key properly) */
export async function desktopHotkey(hotkey: string): Promise<string> {
  // Virtual key codes
  const vkMap: Record<string, string> = {
    ctrl: "0x11",   // VK_CONTROL
    alt: "0x12",    // VK_MENU
    shift: "0x10",  // VK_SHIFT
    win: "0x5B",    // VK_LWIN
    enter: "0x0D",
    tab: "0x09",
    escape: "0x1B", esc: "0x1B",
    backspace: "0x08",
    delete: "0x2E",  del: "0x2E",
    up: "0x26",
    down: "0x28",
    left: "0x25",
    right: "0x27",
    space: "0x20",
    f1: "0x70", f2: "0x71", f3: "0x72", f4: "0x73",
    f5: "0x74", f6: "0x75", f7: "0x76", f8: "0x77",
    f9: "0x78", f10: "0x79", f11: "0x7A", f12: "0x7B",
    home: "0x24", end: "0x23",
    pageup: "0x21", pagedown: "0x22",
    // Letters & numbers
    a: "0x41", b: "0x42", c: "0x43", d: "0x44", e: "0x45",
    f: "0x46", g: "0x47", h: "0x48", i: "0x49", j: "0x4A",
    k: "0x4B", l: "0x4C", m: "0x4D", n: "0x4E", o: "0x4F",
    p: "0x50", q: "0x51", r: "0x52", s: "0x53", t: "0x54",
    u: "0x55", v: "0x56", w: "0x57", x: "0x58", y: "0x59", z: "0x5A",
    "0": "0x30", "1": "0x31", "2": "0x32", "3": "0x33", "4": "0x34",
    "5": "0x35", "6": "0x36", "7": "0x37", "8": "0x38", "9": "0x39",
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

  // Build PowerShell: press all keys down, then release in reverse
  const pressLines = vkCodes.map(vk => `[Keyboard]::keybd_event(${vk}, 0, 0, [UIntPtr]::Zero)`);
  const releaseLines = [...vkCodes].reverse().map(vk => `[Keyboard]::keybd_event(${vk}, 0, 0x0002, [UIntPtr]::Zero)`);

  const ps = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Keyboard {
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@

${pressLines.join("\n")}
Start-Sleep -Milliseconds 50
${releaseLines.join("\n")}
`;

  await runPowerShell(ps, { timeout: 5000 });
  return `Hotkey sent: ${hotkey}`;
}

/** Focus a window by title (partial match) */
export async function desktopFocusWindow(title: string): Promise<string> {
  // Sanitize title for PowerShell safety
  const safeTitle = title.replace(/['"\\]/g, "");

  const ps = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinFocus {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@

$proc = Get-Process | Where-Object { $_.MainWindowTitle -like "*${safeTitle}*" } | Select-Object -First 1
if ($proc) {
  [WinFocus]::ShowWindow($proc.MainWindowHandle, 9)
  [WinFocus]::SetForegroundWindow($proc.MainWindowHandle)
  $proc.MainWindowTitle
} else {
  "NOT_FOUND"
}
`;

  const result = await runPowerShell(ps, { timeout: 5000 });

  if (result === "NOT_FOUND") {
    return `Window not found: "${title}"`;
  }
  return `Focused: ${result}`;
}

/** Install program via winget */
export async function desktopInstall(packageId: string): Promise<string> {
  const safeId = packageId.replace(/['"\\]/g, "");
  const { stdout, stderr } = await execAsync(
    `winget install "${safeId}" --accept-package-agreements --accept-source-agreements`,
    { timeout: 120000, maxBuffer: 1024 * 1024 }
  );
  return stdout || stderr || "Installation completed";
}
