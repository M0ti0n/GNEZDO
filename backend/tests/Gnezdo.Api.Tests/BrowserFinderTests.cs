using Gnezdo.Api.Desktop;

namespace Gnezdo.Api.Tests;

/// <summary>The Linux desktop window's browser, however it was installed (BrowserFinder): a fake file system.</summary>
public sealed class BrowserFinderTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "gnezdo-browsers-" + Guid.NewGuid().ToString("N")[..8]);
    private string Home => Path.Combine(_root, "home/user");
    private string Profile => Path.Combine(Home, ".local/share/gnezdo/data/browser");

    public void Dispose() { try { Directory.Delete(_root, true); } catch (IOException) { } }

    private string Put(string p, string text = "x", bool exec = true)
    {
        var f = Path.Combine(_root, p.TrimStart('/'));
        Directory.CreateDirectory(Path.GetDirectoryName(f)!);
        File.WriteAllText(f, text);
        if (!OperatingSystem.IsWindows() && !exec) File.SetUnixFileMode(f, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        if (!exec || OperatingSystem.IsWindows()) return f;
        File.SetUnixFileMode(f, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        return f;
    }

    private BrowserLaunch? Find(params string[] path) =>
        BrowserFinder.FindLinux(Home, string.Join(Path.PathSeparator, path.Select(p => Path.Combine(_root, p.TrimStart('/')))), Profile, _root);

    [Fact]
    public void Nothing_installed_finds_nothing()
    {
        Directory.CreateDirectory(Home);
        Assert.Null(Find("/usr/bin"));
    }

    [Fact]
    public void Ungoogled_chromium_on_the_path_comes_first()
    {
        Put("/usr/bin/chromium");
        var u = Put("/usr/bin/ungoogled-chromium");
        var b = Find("/usr/bin");
        Assert.Equal(u, b!.File);
        Assert.Empty(b.Before);
        Assert.Equal(Profile, b.ProfileDir);
    }

    [Fact]
    public void A_package_in_opt()
    {
        var c = Put("/opt/google/chrome/chrome");
        Assert.Equal(c, Find("/usr/bin")!.File);
    }

    [Fact]
    public void A_snap_gets_its_profile_in_its_own_folder()
    {
        var s = Put("/snap/bin/chromium");
        var b = Find("/usr/bin")!;
        Assert.Equal(s, b.File);
        Assert.Equal("snap", b.Kind);
        Assert.Equal(Path.Combine(Home, "snap/chromium/common/gnezdo-browser"), b.ProfileDir);
    }

    [Fact]
    public void A_wrapper_that_starts_the_snap_counts_as_the_snap()
    {
        Put("/usr/bin/chromium-browser", "#!/bin/sh\nexec /snap/bin/chromium \"$@\"\n");
        Put("/snap/bin/chromium");
        var b = Find("/usr/bin")!;
        Assert.Equal("snap", b.Kind);
        Assert.EndsWith("snap/chromium/common/gnezdo-browser", b.ProfileDir.Replace('\\', '/'));
    }

    [Fact]
    public void A_flatpak_runs_with_the_profile_folder_opened_to_it()
    {
        var fp = Put("/usr/bin/flatpak");
        Put("/var/lib/flatpak/exports/bin/io.github.ungoogled_software.ungoogled_chromium");
        var b = Find("/usr/bin")!;
        Assert.Equal(fp, b.File);
        Assert.Equal(new[] { "run", $"--filesystem={Profile}", "io.github.ungoogled_software.ungoogled_chromium" }, b.Before);
        Assert.Equal("flatpak", b.Kind);
    }

    [Fact]
    public void A_flatpak_for_this_user_only()
    {
        Put("/usr/bin/flatpak");
        Put("/home/user/.local/share/flatpak/exports/bin/org.chromium.Chromium");
        Assert.Equal("org.chromium.Chromium", Find("/usr/bin")!.Before[^1]);
    }

    [Fact]
    public void An_appimage_in_the_home_folder()
    {
        Put("/home/user/Downloads/notes.txt");
        Put("/home/user/Applications/brave-1.70.AppImage");
        var u = Put("/home/user/Applications/ungoogled-chromium_131.0-1.AppImage");
        var b = Find("/usr/bin")!;
        Assert.Equal(u, b.File);
        Assert.Equal("AppImage", b.Kind);
    }

    [Fact]
    public void An_appimage_that_cannot_run_is_left_out()
    {
        if (OperatingSystem.IsWindows()) return;
        Put("/home/user/Applications/chromium.AppImage", exec: false);
        Assert.Null(Find("/usr/bin"));
    }

    [Fact]
    public void A_broken_link_left_by_an_uninstalled_browser_is_passed_over()
    {
        if (OperatingSystem.IsWindows()) return;
        Directory.CreateDirectory(Path.Combine(_root, "usr/bin"));
        File.CreateSymbolicLink(Path.Combine(_root, "usr/bin/google-chrome-stable"), Path.Combine(_root, "usr/bin/google-chrome"));
        var s = Put("/snap/bin/chromium");
        Assert.Equal(s, Find("/usr/bin")!.File);
    }

    [Fact]
    public void Every_browser_found_best_first_for_trying_the_next()
    {
        var u = Put("/usr/bin/ungoogled-chromium");
        var o = Put("/opt/google/chrome/chrome");
        Put("/usr/bin/flatpak");
        Put("/var/lib/flatpak/exports/bin/org.chromium.Chromium");
        var a = Put("/home/user/Applications/chromium.AppImage");
        var all = BrowserFinder.CandidatesLinux(Home, Path.Combine(_root, "usr/bin"), Profile, _root).ToList();
        Assert.Equal(new[] { u, o, Path.Combine(_root, "usr/bin/flatpak"), a }, all.Select(b => b.File));
        Assert.Equal(new[] { "package", "package", "flatpak", "AppImage" }, all.Select(b => b.Kind));
    }

    [Fact]
    public void A_flatpak_named_in_config_json()
    {
        var fp = Put("/usr/bin/flatpak");
        var b = BrowserFinder.Named("com.brave.Browser", Home, Path.Combine(_root, "usr/bin"), Profile, _root);
        Assert.Equal(fp, b.File);
        Assert.Equal(new[] { "run", $"--filesystem={Profile}", "com.brave.Browser" }, b.Before);
    }
}
