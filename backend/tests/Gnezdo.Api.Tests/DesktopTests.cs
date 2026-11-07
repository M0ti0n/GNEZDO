using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Gnezdo.Api.Tests;

/// <summary>
/// The desktop build (Gnezdo:Desktop): its data in its own folder (SQLite), no sign-in, the PC's
/// user name. The window and stopping after it closes are tested on the real builds (windows-build.yml).
/// </summary>
public sealed class DesktopTests : IAsyncLifetime
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "gnezdo-desktop-test-" + Guid.NewGuid().ToString("N")[..8]);
    private WebApplicationFactory<Program> _factory = null!;
    private HttpClient _client = null!;

    public Task InitializeAsync()
    {
        _factory = new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
        {
            b.UseEnvironment("Testing");
            b.UseSetting("ConnectionStrings:Gnezdo", "");      // the desktop build picks its own SQLite file
            b.UseSetting("Gnezdo:Desktop", "true");
            b.UseSetting("Gnezdo:DesktopRoot", _root);
            b.UseSetting("Gnezdo:Browser", OperatingSystem.IsWindows() ? @"C:\Windows\System32\whoami.exe" : "/bin/true");
        });
        _client = _factory.CreateClient();
        return Task.CompletedTask;
    }

    public async Task DisposeAsync()
    {
        await _factory.DisposeAsync();
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        try { Directory.Delete(_root, true); } catch (IOException) { }
    }

    [Fact]
    public async Task Runs_on_its_own_file_without_sign_in()
    {
        var h = (await _client.GetFromJsonAsync<JsonObject>("/api/health"))!;
        Assert.True(h["desktop"]!.GetValue<bool>());
        Assert.False(h["demo"]!.GetValue<bool>());
        Assert.Equal(Environment.UserName, h["user"]!.GetValue<string>());
        Assert.True(File.Exists(Path.Combine(_root, "data", "gnezdo.db")));
        Assert.True(File.Exists(Path.Combine(_root, "data", "desktop.json")));

        var state = (await _client.GetFromJsonAsync<JsonObject>("/api/auth/state"))!;
        Assert.False(state["required"]!.GetValue<bool>());
        // shared settings: the one person may change them
        var put = await _client.PutAsJsonAsync("/api/settings/machines", new { value = new JsonArray() });
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await _client.GetAsync("/api/parts")).StatusCode);
        // the log is in the desktop's folder too
        Assert.True(Directory.EnumerateFiles(Path.Combine(_root, "logs"), "gnezdo-*.log").Any());
    }

    [Fact]
    public async Task Data_shows_the_folder_and_a_backup_is_a_whole_database()
    {
        var d = (await _client.GetFromJsonAsync<JsonObject>("/api/data"))!;
        Assert.Equal("file", d["kind"]!.GetValue<string>());
        Assert.Equal(_root, d["folder"]!.GetValue<string>());

        await _client.PutAsJsonAsync("/api/settings/machines", new { value = new JsonArray() });
        var res = await _client.GetAsync("/api/data/backup");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.StartsWith("gnezdo-backup-", res.Content.Headers.ContentDisposition!.FileName!.Trim('"'));
        var copy = Path.Combine(_root, "copy.db");
        await File.WriteAllBytesAsync(copy, await res.Content.ReadAsByteArrayAsync());
        // a real SQLite database with GNEZDO's tables
        await using var con = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={copy}");
        await con.OpenAsync();
        await using var cmd = con.CreateCommand();
        cmd.CommandText = "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('Parts', 'Jobs', 'Settings', '__EFMigrationsHistory')";
        Assert.Equal(4L, (long)(await cmd.ExecuteScalarAsync())!);
    }
}
