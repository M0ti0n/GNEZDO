using System.Runtime.InteropServices;

namespace Gnezdo.Api.Nesting;

/// <summary>
/// How busy the machine GNEZDO runs on is: the share of all CPU threads in use (the whole machine,
/// not only GNEZDO), sampled every 2 s. Windows: GetSystemTimes; Linux: /proc/stat; elsewhere unknown.
/// The top bar shows it, so a user sees when nesting (or anything else) keeps the server busy.
/// </summary>
public sealed class ServerLoad : IDisposable
{
    private readonly Timer _timer;
    private (ulong Idle, ulong Total)? _last;
    private double? _cpu;   // 0..100, smoothed

    public ServerLoad()
    {
        _timer = new Timer(_ => Sample(), null, TimeSpan.Zero, TimeSpan.FromSeconds(2));
    }

    /// <summary>CPU use of the whole machine [%], or null when it cannot be read here.</summary>
    public int? Cpu => _cpu is { } c ? (int)Math.Round(c) : null;

    private void Sample()
    {
        var t = Read();
        if (t is null) return;
        if (_last is { } l && t.Value.Total > l.Total)
        {
            var busy = 100.0 * (1.0 - (double)(t.Value.Idle - l.Idle) / (t.Value.Total - l.Total));
            busy = Math.Clamp(busy, 0, 100);
            _cpu = _cpu is { } c ? 0.5 * c + 0.5 * busy : busy;
        }
        _last = t;
    }

    private static (ulong Idle, ulong Total)? Read()
    {
        try
        {
            if (OperatingSystem.IsWindows())
            {
                // kernel time includes idle time
                return GetSystemTimes(out var idle, out var kernel, out var user) ? (idle, kernel + user) : null;
            }
            if (OperatingSystem.IsLinux())
            {
                var line = File.ReadLines("/proc/stat").First();   // cpu user nice system idle iowait irq softirq steal ...
                var v = line.Split(' ', StringSplitOptions.RemoveEmptyEntries).Skip(1).Take(8).Select(x => ulong.Parse(x, System.Globalization.CultureInfo.InvariantCulture)).ToArray();
                return (v[3] + v[4], v.Aggregate(0UL, (a, b) => a + b));
            }
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or FormatException or OverflowException
                                   or InvalidOperationException or IndexOutOfRangeException or DllNotFoundException or EntryPointNotFoundException) { }
        return null;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetSystemTimes(out ulong idleTime, out ulong kernelTime, out ulong userTime);

    public void Dispose() => _timer.Dispose();
}
