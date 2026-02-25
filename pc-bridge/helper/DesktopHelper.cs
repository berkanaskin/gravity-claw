using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

/// <summary>
/// Gravity Claw PC Bridge — Native Desktop Helper v3
/// Uses Win32 BitBlt for reliable screen capture (no DPI/GDI issues).
/// Compiled once with csc.exe, called by Node.js bridge.
/// </summary>
class DesktopHelper
{
    // ── Win32: Screen Capture ──────────────────────────────────
    [DllImport("user32.dll")]
    static extern IntPtr GetDesktopWindow();

    [DllImport("user32.dll")]
    static extern IntPtr GetWindowDC(IntPtr hWnd);

    [DllImport("user32.dll")]
    static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

    [DllImport("gdi32.dll")]
    static extern bool BitBlt(IntPtr hdcDest, int xDest, int yDest, int wDest, int hDest, IntPtr hdcSrc, int xSrc, int ySrc, int rop);

    [DllImport("gdi32.dll")]
    static extern IntPtr CreateCompatibleDC(IntPtr hDC);

    [DllImport("gdi32.dll")]
    static extern IntPtr CreateCompatibleBitmap(IntPtr hDC, int nWidth, int nHeight);

    [DllImport("gdi32.dll")]
    static extern IntPtr SelectObject(IntPtr hDC, IntPtr hObject);

    [DllImport("gdi32.dll")]
    static extern bool DeleteDC(IntPtr hDC);

    [DllImport("gdi32.dll")]
    static extern bool DeleteObject(IntPtr hObject);

    [DllImport("user32.dll")]
    static extern int GetSystemMetrics(int nIndex);

    const int SRCCOPY = 0x00CC0020;
    const int SM_XVIRTUALSCREEN = 76;
    const int SM_YVIRTUALSCREEN = 77;
    const int SM_CXVIRTUALSCREEN = 78;
    const int SM_CYVIRTUALSCREEN = 79;
    const int SM_CXSCREEN = 0;
    const int SM_CYSCREEN = 1;

    // ── Win32: Keyboard & Mouse ────────────────────────────────
    [DllImport("user32.dll")]
    static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    [DllImport("user32.dll")]
    static extern void mouse_event(int dwFlags, int dx, int dy, int cButtons, int dwExtraInfo);

    [DllImport("user32.dll")]
    static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    // ── DPI Awareness ──────────────────────────────────────────
    [DllImport("user32.dll", SetLastError = true)]
    static extern bool SetProcessDPIAware();

    const uint KEYEVENTF_KEYUP = 0x0002;
    const int MOUSEEVENTF_LEFTDOWN = 0x0002;
    const int MOUSEEVENTF_LEFTUP = 0x0004;
    const int MOUSEEVENTF_RIGHTDOWN = 0x0008;
    const int MOUSEEVENTF_RIGHTUP = 0x0010;

    // Max dimension for Telegram photo API
    const int TELEGRAM_MAX_DIMENSION = 2560;

    static int Main(string[] args)
    {
        SetProcessDPIAware();

        if (args.Length == 0)
        {
            Console.Error.WriteLine("Usage: DesktopHelper <command> [args]");
            return 1;
        }

        try
        {
            switch (args[0].ToLower())
            {
                case "screenshot": return TakeScreenshot(args);
                case "hotkey": return SendHotkey(args);
                case "click": return ClickAt(args);
                case "focus": return FocusWindow(args);
                case "type": return TypeText(args);
                case "monitors": return ListMonitors();
                default:
                    Console.Error.WriteLine("Unknown command: " + args[0]);
                    return 1;
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("ERROR: " + ex.Message);
            return 1;
        }
    }

    // ── Screenshot (Native BitBlt) ─────────────────────────────
    // Usage: screenshot [all|primary]
    static int TakeScreenshot(string[] args)
    {
        string mode = args.Length > 1 ? args[1].ToLower() : "primary";

        int srcX, srcY, width, height;

        if (mode == "all")
        {
            srcX = GetSystemMetrics(SM_XVIRTUALSCREEN);
            srcY = GetSystemMetrics(SM_YVIRTUALSCREEN);
            width = GetSystemMetrics(SM_CXVIRTUALSCREEN);
            height = GetSystemMetrics(SM_CYVIRTUALSCREEN);
        }
        else
        {
            // "primary" or default
            srcX = 0;
            srcY = 0;
            width = GetSystemMetrics(SM_CXSCREEN);
            height = GetSystemMetrics(SM_CYSCREEN);
        }

        // Native BitBlt capture — most reliable method
        IntPtr desktopHwnd = GetDesktopWindow();
        IntPtr desktopDC = GetWindowDC(desktopHwnd);
        IntPtr memDC = CreateCompatibleDC(desktopDC);
        IntPtr hBitmap = CreateCompatibleBitmap(desktopDC, width, height);
        IntPtr oldBitmap = SelectObject(memDC, hBitmap);

        BitBlt(memDC, 0, 0, width, height, desktopDC, srcX, srcY, SRCCOPY);

        SelectObject(memDC, oldBitmap);

        using (var captured = Image.FromHbitmap(hBitmap))
        {
            // Downscale for Telegram if needed
            Bitmap finalBitmap;
            bool needsDispose = false;

            if (captured.Width > TELEGRAM_MAX_DIMENSION || captured.Height > TELEGRAM_MAX_DIMENSION)
            {
                float scale = Math.Min(
                    (float)TELEGRAM_MAX_DIMENSION / captured.Width,
                    (float)TELEGRAM_MAX_DIMENSION / captured.Height);
                int newW = (int)(captured.Width * scale);
                int newH = (int)(captured.Height * scale);

                finalBitmap = new Bitmap(newW, newH);
                needsDispose = true;
                using (var g = Graphics.FromImage(finalBitmap))
                {
                    g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    g.DrawImage(captured, 0, 0, newW, newH);
                }
            }
            else
            {
                finalBitmap = new Bitmap(captured);
                needsDispose = true;
            }

            using (var ms = new MemoryStream())
            {
                var jpegCodec = GetJpegEncoder();
                if (jpegCodec != null)
                {
                    var encoderParams = new EncoderParameters(1);
                    encoderParams.Param[0] = new EncoderParameter(
                        System.Drawing.Imaging.Encoder.Quality, 70L);
                    finalBitmap.Save(ms, jpegCodec, encoderParams);
                }
                else
                {
                    finalBitmap.Save(ms, ImageFormat.Jpeg);
                }

                Console.Write(Convert.ToBase64String(ms.ToArray()));
            }

            if (needsDispose) finalBitmap.Dispose();
        }

        // Cleanup native resources
        DeleteObject(hBitmap);
        DeleteDC(memDC);
        ReleaseDC(desktopHwnd, desktopDC);

        return 0;
    }

    static ImageCodecInfo GetJpegEncoder()
    {
        foreach (var codec in ImageCodecInfo.GetImageEncoders())
        {
            if (codec.MimeType == "image/jpeg") return codec;
        }
        return null;
    }

    // ── List Monitors ──────────────────────────────────────────
    static int ListMonitors()
    {
        var screens = Screen.AllScreens;
        for (int i = 0; i < screens.Length; i++)
        {
            var s = screens[i];
            Console.WriteLine(i + ": " + s.Bounds.Width + "x" + s.Bounds.Height
                + (s.Primary ? " (primary)" : "")
                + " at " + s.Bounds.X + "," + s.Bounds.Y);
        }
        Console.Write("Virtual: " + GetSystemMetrics(SM_CXVIRTUALSCREEN) + "x" + GetSystemMetrics(SM_CYVIRTUALSCREEN));
        return 0;
    }

    // ── Hotkey ──────────────────────────────────────────────────
    static int SendHotkey(string[] args)
    {
        if (args.Length < 2)
        {
            Console.Error.WriteLine("Usage: hotkey <vk1> <vk2> ...");
            return 1;
        }

        var keys = new byte[args.Length - 1];
        for (int i = 1; i < args.Length; i++)
        {
            keys[i - 1] = (byte)Convert.ToInt32(args[i], 16);
        }

        foreach (var key in keys)
            keybd_event(key, 0, 0, UIntPtr.Zero);

        System.Threading.Thread.Sleep(50);

        for (int i = keys.Length - 1; i >= 0; i--)
            keybd_event(keys[i], 0, KEYEVENTF_KEYUP, UIntPtr.Zero);

        Console.Write("OK");
        return 0;
    }

    // ── Click ───────────────────────────────────────────────────
    static int ClickAt(string[] args)
    {
        if (args.Length < 3)
        {
            Console.Error.WriteLine("Usage: click <x> <y> [left|right]");
            return 1;
        }

        int x = int.Parse(args[1]);
        int y = int.Parse(args[2]);
        string button = args.Length > 3 ? args[3].ToLower() : "left";

        Cursor.Position = new Point(x, y);
        System.Threading.Thread.Sleep(100);

        if (button == "right")
        {
            mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0);
            mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0);
        }
        else
        {
            mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
            mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
        }

        Console.Write("OK");
        return 0;
    }

    // ── Focus Window ────────────────────────────────────────────
    static int FocusWindow(string[] args)
    {
        if (args.Length < 2)
        {
            Console.Error.WriteLine("Usage: focus <title>");
            return 1;
        }

        string title = args[1].ToLower();
        Process found = null;

        foreach (var proc in Process.GetProcesses())
        {
            try
            {
                if (!string.IsNullOrEmpty(proc.MainWindowTitle) &&
                    proc.MainWindowTitle.ToLower().Contains(title))
                {
                    found = proc;
                    break;
                }
            }
            catch { }
        }

        if (found == null)
        {
            Console.Write("NOT_FOUND");
            return 0;
        }

        ShowWindow(found.MainWindowHandle, 9);
        SetForegroundWindow(found.MainWindowHandle);
        Console.Write(found.MainWindowTitle);
        return 0;
    }

    // ── Type Text ───────────────────────────────────────────────
    static int TypeText(string[] args)
    {
        if (args.Length < 2)
        {
            Console.Error.WriteLine("Usage: type <text>");
            return 1;
        }

        string text = args[1]
            .Replace("{", "{{}")
            .Replace("}", "{}}")
            .Replace("+", "{+}")
            .Replace("^", "{^}")
            .Replace("%", "{%}")
            .Replace("~", "{~}")
            .Replace("(", "{(}")
            .Replace(")", "{)}")
            .Replace("[", "{[}")
            .Replace("]", "{]}")
            .Replace("\n", "{ENTER}");

        SendKeys.SendWait(text);
        Console.Write("OK");
        return 0;
    }
}
