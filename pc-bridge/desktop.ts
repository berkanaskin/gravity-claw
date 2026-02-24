// ── PC Bridge: Desktop Control ───────────────────────────────
// PowerShell-based desktop automation: screenshot, click, type, hotkeys.

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

/** Take full desktop screenshot using PowerShell */
export async function desktopScreenshot(): Promise<string> {
  // Use PowerShell to capture screen via .NET
  const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bitmap = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
$ms = New-Object System.IO.MemoryStream
$bitmap.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$bytes = $ms.ToArray()
[System.Convert]::ToBase64String($bytes)
$graphics.Dispose()
$bitmap.Dispose()
$ms.Dispose()
`.trim();

  const { stdout } = await execAsync(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"').replace(/\n/g, '; ')}"`, {
    timeout: 15000,
    maxBuffer: 1024 * 1024 * 10, // 10MB for screenshot
  });

  return stdout.trim();
}

/** Click at screen coordinates */
export async function desktopClick(x: number, y: number, button: "left" | "right" = "left"): Promise<string> {
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
${button === "right"
    ? "[MouseInput]::mouse_event(0x0008, 0, 0, 0, 0); [MouseInput]::mouse_event(0x0010, 0, 0, 0, 0)"
    : "[MouseInput]::mouse_event(0x0002, 0, 0, 0, 0); [MouseInput]::mouse_event(0x0004, 0, 0, 0, 0)"}
`.trim();

  await execAsync(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"').replace(/\n/g, '; ')}"`, {
    timeout: 5000,
  });

  return `Clicked ${button} at (${x}, ${y})`;
}

/** Type text using SendKeys */
export async function desktopType(text: string): Promise<string> {
  // Escape special SendKeys characters
  const escaped = text
    .replace(/[+^%~(){}[\]]/g, "{$&}")
    .replace(/\n/g, "{ENTER}");

  const ps = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('${escaped.replace(/'/g, "''")}')
`.trim();

  await execAsync(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"').replace(/\n/g, '; ')}"`, {
    timeout: 5000,
  });

  return `Typed: ${text.substring(0, 100)}`;
}

/** Send keyboard hotkey (e.g., "ctrl+s", "alt+tab") */
export async function desktopHotkey(hotkey: string): Promise<string> {
  // Convert human-readable to SendKeys format
  const keyMap: Record<string, string> = {
    ctrl: "^", alt: "%", shift: "+", win: "^{ESC}",
    enter: "{ENTER}", tab: "{TAB}", escape: "{ESC}",
    backspace: "{BACKSPACE}", delete: "{DELETE}",
    up: "{UP}", down: "{DOWN}", left: "{LEFT}", right: "{RIGHT}",
    f1: "{F1}", f2: "{F2}", f3: "{F3}", f4: "{F4}", f5: "{F5}",
    f6: "{F6}", f7: "{F7}", f8: "{F8}", f9: "{F9}", f10: "{F10}",
    f11: "{F11}", f12: "{F12}",
    home: "{HOME}", end: "{END}",
    pageup: "{PGUP}", pagedown: "{PGDN}",
  };

  const parts = hotkey.toLowerCase().split("+");
  let sendKeys = "";
  for (const part of parts) {
    const mapped = keyMap[part.trim()];
    sendKeys += mapped || part.trim();
  }

  const ps = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('${sendKeys.replace(/'/g, "''")}')
`.trim();

  await execAsync(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"').replace(/\n/g, '; ')}"`, {
    timeout: 5000,
  });

  return `Hotkey sent: ${hotkey}`;
}

/** Focus a window by title (partial match) */
export async function desktopFocusWindow(title: string): Promise<string> {
  const ps = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinFocus {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
$proc = Get-Process | Where-Object { $_.MainWindowTitle -like "*${title.replace(/"/g, '')}*" } | Select-Object -First 1
if ($proc) {
  [WinFocus]::ShowWindow($proc.MainWindowHandle, 9)
  [WinFocus]::SetForegroundWindow($proc.MainWindowHandle)
  $proc.MainWindowTitle
} else {
  "NOT_FOUND"
}
`.trim();

  const { stdout } = await execAsync(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"').replace(/\n/g, '; ')}"`, {
    timeout: 5000,
  });

  const result = stdout.trim();
  if (result === "NOT_FOUND") {
    return `Window not found: "${title}"`;
  }
  return `Focused: ${result}`;
}

/** Install program via winget */
export async function desktopInstall(packageId: string): Promise<string> {
  const { stdout, stderr } = await execAsync(
    `winget install "${packageId}" --accept-package-agreements --accept-source-agreements`,
    { timeout: 120000, maxBuffer: 1024 * 1024 }
  );
  return stdout || stderr || "Installation completed";
}
