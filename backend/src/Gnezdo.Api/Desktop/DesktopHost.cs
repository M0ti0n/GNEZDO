using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text.Json;
using Gnezdo.Api.Diagnostics;

namespace Gnezdo.Api.Desktop;

/// <summary>
/// The desktop build (GNEZDO --desktop): one person on one PC. The data (an SQLite file), the log and
/// the browser profile are in the user's own app-data folder (see PickRoot); the program answers only this PC; the window is Edge (Windows) or Chromium / Chrome
/// (Linux) in app mode. Closing the window stops GNEZDO 30 s later, unless the window comes back
/// (a reload, or GNEZDO started again in the meantime). Started twice, the second start only opens a window.
/// </summary>
public sealed class DesktopHost
{
    public const int DefaultPort = 8095;
    /// <summary>After the last window closes: time to come back before GNEZDO stops.</summary>
    public static readonly TimeSpan Grace = TimeSpan.FromSeconds(30);
    /// <summary>No window at all after the start (the browser did not open): GNEZDO stops.</summary>
    public static readonly TimeSpan StartWait = TimeSpan.FromMinutes(3);

    public string Root { get; }
    public string DataDir => Path.Combine(Root, "data");
    public string LogDir => Path.Combine(Root, "logs");
    public int Port { get; private set; }
    public string Url => $"http://127.0.0.1:{Port}/";
    /// <summary>Another GNEZDO desktop already runs on this data: only its window is opened.</summary>
    public bool AlreadyRunning { get; private set; }

    private readonly IConfiguration _config;
    private FileStream? _lock;
    private readonly object _gate = new();
    private int _windows;
    private DateTimeOffset _since = DateTimeOffset.UtcNow;
    private bool _everOpened;

    private DesktopHost(IConfiguration config, string root)
    {
        _config = config;
        Root = root;
    }

    private string InfoFile => Path.Combine(DataDir, "desktop.json");

    /// <summary>
    /// Before the app is built: where the data goes, whether it already runs, the port. Program then
    /// uses SQLite, no sign-in, this PC only.
    /// </summary>
    public static DesktopHost Prepare(WebApplicationBuilder builder)
    {
        var cfg = builder.Configuration;
        var root = cfg["Gnezdo:DesktopRoot"] is { Length: > 0 } r ? r : PickRoot();
        var host = new DesktopHost(cfg, root);
        Directory.CreateDirectory(host.DataDir);
        try
        {
            host._lock = new FileStream(Path.Combine(host.DataDir, "desktop.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
        }
        catch (IOException)
        {
            host.AlreadyRunning = true;
            host.Port = host.ReadInfo() ?? DefaultPort;
            return host;
        }

        host.Port = cfg.GetValue<int?>("Gnezdo:DesktopPort") ?? FreePort(host.ReadInfo() ?? DefaultPort);
        File.WriteAllText(host.InfoFile, JsonSerializer.Serialize(new { port = host.Port, pid = Environment.ProcessId }));
        return host;
    }

    /// <summary>The desktop build's database: always its own SQLite file (no SQL Server).</summary>
    public string Database => new Microsoft.Data.Sqlite.SqliteConnectionStringBuilder { DataSource = Path.Combine(DataDir, "gnezdo.db") }.ToString();

    /// <summary>
    /// The user's own app-data folder, never the program's folder (an update or a deleted GNEZDO
    /// folder must not take the data with it): %LOCALAPPDATA%\GNEZDO on Windows (not Documents:
    /// often synced by OneDrive, which does not go well with a database being written),
    /// ~/.local/share/gnezdo on Linux. "Gnezdo:DesktopRoot" in config.json sets another folder.
    /// </summary>
    private static string PickRoot()
    {
        var own = Environment.GetEnvironmentVariable("XDG_DATA_HOME") is { Length: > 0 } xdg && !OperatingSystem.IsWindows()
            ? Path.Combine(xdg, "gnezdo")
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData, Environment.SpecialFolderOption.Create),
                OperatingSystem.IsWindows() ? "GNEZDO" : "gnezdo");
        Directory.CreateDirectory(own);
        return own;
    }

    private int? ReadInfo()
    {
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(InfoFile));
            return doc.RootElement.GetProperty("port").GetInt32();
        }
        catch (Exception e) when (e is IOException or JsonException or KeyNotFoundException or InvalidOperationException) { return null; }
    }

    /// <summary>The same port as last time when free (the browser keeps its settings per port), else the next free one.</summary>
    private static int FreePort(int wanted)
    {
        for (var p = wanted; p < wanted + 40; p++)
        {
            try
            {
                var l = new TcpListener(IPAddress.Loopback, p);
                l.Start();
                l.Stop();
                return p;
            }
            catch (SocketException) { }
        }
        return 0;   // let the system choose
    }

    // ---- the window ---------------------------------------------------------

    /// <summary>
    /// Edge / Chromium / Chrome / Brave in app mode, with a browser profile of GNEZDO's own (its own
    /// window, settings and size; nothing mixed with the person's own browsing). None found: the
    /// default browser. "Gnezdo:Browser" in config.json names another one.
    /// </summary>
    public void OpenWindow(DiagLog? log = null)
    {
        var browser = FindBrowser();
        try
        {
            if (browser is not null)
            {
                var psi = new ProcessStartInfo(browser) { UseShellExecute = false };
                psi.ArgumentList.Add($"--app={Url}");
                psi.ArgumentList.Add($"--user-data-dir={Path.Combine(DataDir, "browser")}");
                psi.ArgumentList.Add("--no-first-run");
                psi.ArgumentList.Add("--no-default-browser-check");
                if (OperatingSystem.IsLinux()) psi.ArgumentList.Add("--class=GNEZDO");
                Process.Start(psi);
                log?.Write("desktop", $"Window opened in {Path.GetFileName(browser)}", new { browser, url = Url });
                return;
            }
        }
        catch (Exception e) when (e is System.ComponentModel.Win32Exception or IOException or InvalidOperationException)
        {
            log?.Write("desktop", $"{browser} could not start: {e.Message}; opening the default browser");
        }
        try
        {
            if (OperatingSystem.IsWindows()) Process.Start(new ProcessStartInfo(Url) { UseShellExecute = true });
            else Process.Start(new ProcessStartInfo("xdg-open", Url) { UseShellExecute = false });
            log?.Write("desktop", "No Edge or Chromium found: opened in the default browser", new { url = Url });
        }
        catch (Exception e) when (e is System.ComponentModel.Win32Exception or IOException or InvalidOperationException)
        {
            Fail($"GNEZDO runs, but no browser could be opened.\nOpen {Url} in a browser.");
        }
    }

    private string? FindBrowser()
    {
        if (_config["Gnezdo:Browser"] is { Length: > 0 } own) return File.Exists(own) ? own : OnPath(own) ?? own;
        if (OperatingSystem.IsWindows())
        {
            var bases = new[]
            {
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            }.Where(b => b.Length > 0);
            var rel = new[]
            {
                @"Microsoft\Edge\Application\msedge.exe",
                @"Google\Chrome\Application\chrome.exe",
                @"Chromium\Application\chrome.exe",
                @"BraveSoftware\Brave-Browser\Application\brave.exe",
            };
            return rel.SelectMany(r => bases.Select(b => Path.Combine(b, r))).FirstOrDefault(File.Exists);
        }
        return new[]
        {
            "chromium", "chromium-browser", "google-chrome", "google-chrome-stable",
            "microsoft-edge", "microsoft-edge-stable", "brave-browser", "brave",
        }.Select(OnPath).FirstOrDefault(p => p is not null);
    }

    private static string? OnPath(string name) =>
        (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries)
            .Select(d => Path.Combine(d, name)).FirstOrDefault(File.Exists);

    // ---- open windows -------------------------------------------------------

    /// <summary>A window is open (its /api/desktop/session connection).</summary>
    public void WindowOpened()
    {
        lock (_gate) { _windows++; _everOpened = true; }
    }

    public void WindowClosed()
    {
        lock (_gate) { _windows--; _since = DateTimeOffset.UtcNow; }
    }

    /// <summary>Time to stop: no window for the grace time (or none ever came).</summary>
    public string? ShouldStop(DateTimeOffset now)
    {
        lock (_gate)
        {
            if (_windows > 0) return null;
            if (_everOpened && now - _since >= Grace) return "the window was closed";
            if (!_everOpened && now - _since >= StartWait) return "no window was opened";
            return null;
        }
    }

    public void Release()
    {
        try { File.Delete(InfoFile); } catch (IOException) { }
        _lock?.Dispose();
        _lock = null;
    }

    /// <summary>A message the person sees (no console in the desktop build).</summary>
    public static void Fail(string message)
    {
        Console.Error.WriteLine(message);
        try
        {
            if (OperatingSystem.IsWindows()) _ = MessageBoxW(IntPtr.Zero, message, "GNEZDO", 0x10);
            else if (OnPath("zenity") is { } z) Process.Start(z, ["--error", "--title=GNEZDO", $"--text={message}"])?.WaitForExit(60_000);
            else if (OnPath("notify-send") is { } n) Process.Start(n, ["GNEZDO", message]);
        }
        catch (Exception e) when (e is System.ComponentModel.Win32Exception or IOException or InvalidOperationException) { }
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int MessageBoxW(IntPtr hWnd, string text, string caption, uint type);
}

/// <summary>Stops GNEZDO once its window has been closed for the grace time.</summary>
public sealed class DesktopWatch(DesktopHost host, IHostApplicationLifetime life, DiagLog log, TimeProvider clock) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        try
        {
            while (!ct.IsCancellationRequested)
            {
                await Task.Delay(TimeSpan.FromSeconds(2), ct);
                if (host.ShouldStop(clock.GetUtcNow()) is { } why)
                {
                    log.Write("desktop", $"GNEZDO stops: {why}");
                    life.StopApplication();
                    return;
                }
            }
        }
        catch (OperationCanceledException) { }
    }
}

public static class DesktopEndpoints
{
    /// <summary>
    /// The window holds this open as long as it is open (an event stream: not slowed down when the
    /// window is minimised, unlike timers). A reload drops it for a moment and opens it again.
    /// </summary>
    public static void MapDesktopEndpoints(this WebApplication app, DesktopHost host)
    {
        app.MapGet("/api/desktop/session", async (HttpContext ctx) =>
        {
            var ct = ctx.RequestAborted;
            ctx.Response.ContentType = "text/event-stream";
            ctx.Response.Headers.CacheControl = "no-cache";
            host.WindowOpened();
            try
            {
                await ctx.Response.WriteAsync("retry: 1000\n\n", ct);
                await ctx.Response.Body.FlushAsync(ct);
                while (!ct.IsCancellationRequested)
                {
                    await Task.Delay(TimeSpan.FromSeconds(15), ct);
                    await ctx.Response.WriteAsync(": still here\n\n", ct);
                    await ctx.Response.Body.FlushAsync(ct);
                }
            }
            catch (Exception e) when (e is OperationCanceledException or IOException) { }
            finally { host.WindowClosed(); }
        });
    }
}
