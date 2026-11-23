namespace Gnezdo.Api.Desktop;

/// <summary>How to start the desktop window's browser: the program, the arguments before the browser's own
/// (flatpak run …), and the folder for GNEZDO's own browser profile (one the browser may write to).</summary>
public sealed record BrowserLaunch(string File, IReadOnlyList<string> Before, string ProfileDir, string Kind);

/// <summary>
/// Finds a Chromium-family browser on Linux however it was installed: an ordinary package (on the PATH or in
/// /opt), a snap, a flatpak or an AppImage. Ungoogled Chromium first, then Chromium, Chrome, Edge, Brave.
/// A snap may only write in ~/snap/&lt;name&gt;, so its profile goes there; a flatpak gets GNEZDO's profile
/// folder opened to it for the run (flatpak run --filesystem=…).
/// </summary>
public static class BrowserFinder
{
    private static readonly string[] Names =
    [
        "ungoogled-chromium", "chromium", "chromium-browser", "google-chrome", "google-chrome-stable",
        "microsoft-edge", "microsoft-edge-stable", "brave-browser", "brave",
    ];
    private static readonly string[] Opt =
    [
        "/opt/ungoogled-chromium/chrome", "/opt/ungoogled-chromium/ungoogled-chromium", "/opt/chromium/chrome",
        "/opt/google/chrome/chrome", "/opt/microsoft/msedge/msedge", "/opt/brave.com/brave/brave",
    ];
    private static readonly string[] Snaps = ["ungoogled-chromium", "chromium", "google-chrome", "microsoft-edge", "brave"];
    private static readonly string[] Flatpaks =
    [
        "io.github.ungoogled_software.ungoogled_chromium", "org.chromium.Chromium", "com.google.Chrome",
        "com.microsoft.Edge", "com.brave.Browser",
    ];
    /// <summary>AppImage names, in that order (the newest file of a kind first)</summary>
    private static readonly string[] AppImageKinds = ["ungoogled", "chromium", "chrome", "edge", "brave"];

    /// <param name="home">the user's home folder</param>
    /// <param name="path">the PATH</param>
    /// <param name="profile">GNEZDO's browser profile folder (data/browser)</param>
    /// <param name="root">the file system's root ("/"; a test folder in tests)</param>
    public static BrowserLaunch? FindLinux(string home, string? path, string profile, string root = "/")
    {
        string R(string p) => root == "/" ? p : Path.Combine(root, p.TrimStart('/'));
        var dirs = (path ?? "").Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries);

        // 1. an ordinary package on the PATH (a wrapper that only starts the snap counts as the snap)
        foreach (var n in Names)
            foreach (var d in dirs)
            {
                var f = Path.Combine(d, n);
                if (!IsFile(f)) continue;
                if (SnapWrapper(f) is { } snap) return SnapLaunch(snap, home, R) ?? new BrowserLaunch(f, [], profile, "package");
                return new BrowserLaunch(f, [], profile, "package");
            }
        // 2. installed in /opt
        foreach (var f in Opt.Select(R)) if (IsFile(f)) return new BrowserLaunch(f, [], profile, "package");
        // 3. a snap (/snap/bin is not always on the PATH of a program started from the menu)
        foreach (var s in Snaps) if (SnapLaunch(s, home, R) is { } l) return l;
        // 4. a flatpak (for the whole system or this user): started with flatpak run, the profile folder opened to it
        var flatpak = new[] { "flatpak" }.SelectMany(n => dirs.Select(d => Path.Combine(d, n))).Concat([R("/usr/bin/flatpak")]).FirstOrDefault(IsFile);
        foreach (var id in Flatpaks)
        {
            var exp = new[] { R("/var/lib/flatpak/exports/bin/" + id), Path.Combine(home, ".local/share/flatpak/exports/bin", id) }.FirstOrDefault(IsFile);
            if (exp is null) continue;
            return flatpak is not null
                ? new BrowserLaunch(flatpak, ["run", $"--filesystem={profile}", id], profile, "flatpak")
                : new BrowserLaunch(exp, [], profile, "flatpak");
        }
        // 5. an AppImage in one of the usual folders
        var where = new[] { "Applications", "applications", "AppImages", "Apps", "apps", ".local/bin", "bin", "Downloads", "Desktop" }
            .Select(d => Path.Combine(home, d)).Concat([R("/opt"), R("/opt/appimages"), R("/usr/local/bin")]);
        var images = where.Where(Directory.Exists)
            .SelectMany(d => { try { return Directory.EnumerateFiles(d); } catch (Exception e) when (e is IOException or UnauthorizedAccessException) { return Enumerable.Empty<string>(); } })
            .Where(f => f.EndsWith(".appimage", StringComparison.OrdinalIgnoreCase) && Executable(f))
            .ToList();
        foreach (var kind in AppImageKinds)
        {
            var f = images.Where(i => Path.GetFileName(i).Contains(kind, StringComparison.OrdinalIgnoreCase))
                .OrderByDescending(File.GetLastWriteTimeUtc).FirstOrDefault();
            if (f is not null) return new BrowserLaunch(f, [], profile, "AppImage");
        }
        return null;
    }

    /// <summary>The browser named in config.json (Gnezdo:Browser): a program, an AppImage, or a flatpak's id.</summary>
    public static BrowserLaunch Named(string own, string home, string? path, string profile, string root = "/")
    {
        string R(string p) => root == "/" ? p : Path.Combine(root, p.TrimStart('/'));
        var dirs = (path ?? "").Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries);
        if (IsFile(own)) return new BrowserLaunch(own, [], profile, "named");
        var onPath = dirs.Select(d => Path.Combine(d, own)).FirstOrDefault(IsFile);
        if (onPath is not null) return new BrowserLaunch(onPath, [], profile, "named");
        // a flatpak's id (org.chromium.Chromium)
        if (!OperatingSystem.IsWindows() && !own.Contains('/') && own.Count(c => c == '.') >= 2)
        {
            var flatpak = dirs.Select(d => Path.Combine(d, "flatpak")).Concat([R("/usr/bin/flatpak")]).FirstOrDefault(IsFile) ?? "flatpak";
            return new BrowserLaunch(flatpak, ["run", $"--filesystem={profile}", own], profile, "flatpak");
        }
        return new BrowserLaunch(own, [], profile, "named");
    }

    private static BrowserLaunch? SnapLaunch(string name, string home, Func<string, string> r)
    {
        var f = r("/snap/bin/" + name);
        return IsFile(f) ? new BrowserLaunch(f, [], Path.Combine(home, "snap", name, "common", "gnezdo-browser"), "snap") : null;
    }

    /// <summary>A small script on the PATH that only starts a snap (Ubuntu's chromium-browser): the snap's name.</summary>
    private static string? SnapWrapper(string f)
    {
        try
        {
            var target = new FileInfo(f).ResolveLinkTarget(true)?.FullName ?? f;
            if (target.Contains("/snap/bin/") || target.EndsWith("/usr/bin/snap")) return Path.GetFileName(f) is "chromium-browser" ? "chromium" : Path.GetFileName(f);
            if (new FileInfo(target).Length > 8192) return null;
            var text = File.ReadAllText(target);
            if (!text.StartsWith("#!")) return null;
            var m = System.Text.RegularExpressions.Regex.Match(text, @"/snap/bin/([\w-]+)");
            return m.Success ? m.Groups[1].Value : null;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { return null; }
    }

    private static bool IsFile(string f) => File.Exists(f);

    private static bool Executable(string f)
    {
        if (OperatingSystem.IsWindows()) return true;
        try { return (File.GetUnixFileMode(f) & (UnixFileMode.UserExecute | UnixFileMode.GroupExecute | UnixFileMode.OtherExecute)) != 0; }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { return false; }
    }
}
