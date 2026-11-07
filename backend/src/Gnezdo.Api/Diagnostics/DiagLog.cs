using System.IO.Compression;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Gnezdo.Api.Diagnostics;

/// <summary>
/// The diagnostic log: what happened on the server and in the browsers, one JSON line per event in a
/// file per day (logs\gnezdo-2026-11-07.log), so a problem can be looked at afterwards ("Download log"
/// in Settings). Kept 30 days and at most 200 MB; it can be switched off in Settings (the switch is
/// stored in the logs folder, so it holds for the whole server and survives a restart). Writing never
/// stops the program: a log that cannot be written is skipped.
/// </summary>
public sealed class DiagLog
{
    public const int KeepDays = 30;
    public const long MaxBytes = 200L * 1024 * 1024;
    private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull };

    private readonly object _gate = new();
    private readonly TimeProvider _clock;
    private string _day = "";
    private volatile bool _enabled;

    public string Dir { get; }
    public bool Enabled => _enabled;
    private string SwitchFile => Path.Combine(Dir, "diagnostics.json");

    public DiagLog(string dir, TimeProvider clock)
    {
        Dir = Path.GetFullPath(dir);
        _clock = clock;
        try { Directory.CreateDirectory(Dir); } catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
        _enabled = ReadSwitch();
        Cleanup();
    }

    private bool ReadSwitch()
    {
        try { return JsonNode.Parse(File.ReadAllText(SwitchFile))?["enabled"]?.GetValue<bool>() ?? true; }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException or InvalidOperationException or FormatException) { return true; }
    }

    /// <summary>Settings -> Diagnostic log on/off (for everyone on this server).</summary>
    public void SetEnabled(bool on, string? by)
    {
        if (!on) Write("log", $"Diagnostic log switched off by {by ?? "someone"}");
        _enabled = on;
        try { File.WriteAllText(SwitchFile, new JsonObject { ["enabled"] = on, ["by"] = by, ["at"] = _clock.GetLocalNow().ToString("O") }.ToJsonString()); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
        if (on) Write("log", $"Diagnostic log switched on by {by ?? "someone"}");
    }

    /// <summary>One event. kind: api, error, nest, ui, report, log...; who: the user and browser it came from.</summary>
    public void Write(string kind, string message, object? data = null, string? user = null, string? browser = null, string? client = null, string? at = null)
    {
        if (!_enabled) return;
        var now = _clock.GetLocalNow();
        var line = JsonSerializer.Serialize(new Entry(now.ToString("yyyy-MM-dd HH:mm:ss.fff"), at, kind, Cut(message, 4000), user, browser, client, data), Json);
        lock (_gate)
        {
            try
            {
                var day = now.ToString("yyyy-MM-dd");
                if (day != _day) { _day = day; Cleanup(); }
                File.AppendAllText(Path.Combine(Dir, $"gnezdo-{day}.log"), line + "\n");
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
        }
    }

    private sealed record Entry(string T, string? ClientT, string Kind, string Msg, string? User, string? Browser, string? Client, object? Data);

    public static string Cut(string? s, int max) => s is null ? "" : s.Length <= max ? s : s[..max] + "...";

    private IEnumerable<FileInfo> Files()
    {
        try { return new DirectoryInfo(Dir).GetFiles("gnezdo-*.log"); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { return []; }
    }

    /// <summary>Older than 30 days, then the oldest while over 200 MB: deleted.</summary>
    private void Cleanup()
    {
        try
        {
            var files = Files().OrderBy(f => f.Name).ToList();
            var cut = _clock.GetLocalNow().AddDays(-KeepDays).ToString("yyyy-MM-dd");
            foreach (var f in files.Where(f => string.CompareOrdinal(f.Name, $"gnezdo-{cut}.log") < 0).ToList()) { f.Delete(); files.Remove(f); }
            var total = files.Sum(f => f.Length);
            foreach (var f in files.ToList())
            {
                if (total <= MaxBytes || files.Count <= 1) break;
                total -= f.Length; f.Delete(); files.Remove(f);
            }
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
    }

    /// <summary>For Settings: the folder, number of days kept and their size.</summary>
    public (int Files, long Bytes, string? Oldest) Summary()
    {
        var files = Files().ToList();
        return (files.Count, files.Sum(f => f.Length), files.Select(f => f.Name[7..^4]).OrderBy(n => n).FirstOrDefault());
    }

    /// <summary>The last days' log files as one zip ("Download log").</summary>
    public byte[] Zip(int days)
    {
        var from = _clock.GetLocalNow().AddDays(-Math.Max(1, days) + 1).ToString("yyyy-MM-dd");
        using var ms = new MemoryStream();
        using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, true))
        {
            lock (_gate)
            {
                foreach (var f in Files().Where(f => string.CompareOrdinal(f.Name, $"gnezdo-{from}.log") >= 0).OrderBy(f => f.Name))
                {
                    var e = zip.CreateEntry(f.Name, CompressionLevel.Optimal);
                    using var w = e.Open();
                    using var r = new FileStream(f.FullName, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
                    r.CopyTo(w);
                }
            }
        }
        return ms.ToArray();
    }
}
