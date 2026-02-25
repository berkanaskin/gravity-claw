using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

/// <summary>
/// Gravity Claw PC Bridge — Native Desktop Helper
/// Compiled once with csc.exe, called by Node.js bridge.
/// Avoids PowerShell AMSI scanning entirely.
/// 
/// Usage:
///   DesktopHelper.exe screenshot
///   DesktopHelper.exe hotkey 0x11 0x5B 0x27    (ctrl+win+right)
///   DesktopHelper.exe click 500 300 left
///   DesktopHelper.exe focus "Notion"
///   DesktopHelper.exe type "Hello World"
/// </summary>
class DesktopHelper
{
    // ── Win32 Imports ──────────────────────────────────────────
    [DllImport("user32.dll")]
    static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    [DllImport("user32.dll")]
    static extern void mouse_event(int dwFlags, int dx, int dy, int cButtons, int dwExtraInfo);

    [DllImport("user32.dll")]
    static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    // DPI awareness — CRITICAL for correct screenshot dimensions
    [DllImport("user32.dll")]
    static extern bool SetProcessDPIAware();

    const uint KEYEVENTF_KEYUP = 0x0002;
    const int MOUSEEVENTF_LEFTDOWN = 0x0002;
    const int MOUSEEVENTF_LEFTUP = 0x0004;
    const int MOUSEEVENTF_RIGHTDOWN = 0x0008;
    const int MOUSEEVENTF_RIGHTUP = 0x0010;

    static int Main(string[] args)
    {
        // Must be called before ANY screen operations
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

    // ── Screenshot ─────────────────────────────────────────────
    // Usage: screenshot [all|primary|N]
    //   all     — capture all monitors as one wide image (default)
    //   primary — capture primary monitor only
    //   0,1,2.. — capture specific monitor by index
    static int TakeScreenshot(string[] args)
    {
        string mode = args.Length > 1 ? args[1].ToLower() : "all";

        Rectangle bounds;
        Point sourcePoint;

        if (mode == "primary")
        {
            bounds = Screen.PrimaryScreen.Bounds;
            sourcePoint = bounds.Location;
        }
        else
        {
            int monitorIndex;
            if (int.TryParse(mode, out monitorIndex))
            {
                var screens = Screen.AllScreens;
                if (monitorIndex < 0 || monitorIndex >= screens.Length)
                {
                    Console.Error.WriteLine("Monitor index " + monitorIndex + " out of range (0-" + (screens.Length - 1) + ")");
                    return 1;
                }
                bounds = screens[monitorIndex].Bounds;
                sourcePoint = bounds.Location;
            }
            else
            {
                // "all" — capture entire virtual screen (all monitors)
                bounds = SystemInformation.VirtualScreen;
                sourcePoint = bounds.Location;
            }
        }

        using (var bitmap = new Bitmap(bounds.Width, bounds.Height))
        using (var graphics = Graphics.FromImage(bitmap))
        using (var ms = new MemoryStream())
        {
            graphics.CopyFromScreen(sourcePoint, Point.Empty, bounds.Size);

            // JPEG quality 70 for small file size
            var jpegCodec = GetJpegEncoder();
            if (jpegCodec != null)
            {
                var encoderParams = new EncoderParameters(1);
                encoderParams.Param[0] = new EncoderParameter(
                    System.Drawing.Imaging.Encoder.Quality, 70L);
                bitmap.Save(ms, jpegCodec, encoderParams);
            }
            else
            {
                bitmap.Save(ms, ImageFormat.Png);
            }

            Console.Write(Convert.ToBase64String(ms.ToArray()));
        }
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

    // ── Hotkey ──────────────────────────────────────────────────
    // Args: hotkey 0x11 0x5B 0x27 (hex VK codes)
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

        // Press all keys down
        foreach (var key in keys)
        {
            keybd_event(key, 0, 0, UIntPtr.Zero);
        }

        System.Threading.Thread.Sleep(50);

        // Release all keys in reverse order
        for (int i = keys.Length - 1; i >= 0; i--)
        {
            keybd_event(keys[i], 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        }

        Console.Write("OK");
        return 0;
    }

    // ── Click ───────────────────────────────────────────────────
    // Args: click <x> <y> [left|right]
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
    // Args: focus "Window Title"
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

        ShowWindow(found.MainWindowHandle, 9); // SW_RESTORE
        SetForegroundWindow(found.MainWindowHandle);
        Console.Write(found.MainWindowTitle);
        return 0;
    }

    // ── Type Text ───────────────────────────────────────────────
    // Args: type "text to type"
    static int TypeText(string[] args)
    {
        if (args.Length < 2)
        {
            Console.Error.WriteLine("Usage: type <text>");
            return 1;
        }

        // Escape special SendKeys characters
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
