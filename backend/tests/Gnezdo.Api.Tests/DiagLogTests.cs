using System.IO.Compression;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Gnezdo.Api.Tests;

/// <summary>The diagnostic log: browser events, problem reports, the download, the on/off switch.</summary>
public sealed class DiagLogTests : IAsyncLifetime
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "gnezdo-log-test-" + Guid.NewGuid().ToString("N")[..8]);
    private WebApplicationFactory<Program> _factory = null!;
    private HttpClient _client = null!;

    public Task InitializeAsync()
    {
        _factory = new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
        {
            b.UseEnvironment("Testing");
            b.UseSetting("ConnectionStrings:Gnezdo", "");   // demo: no database, the log works anyway
            b.UseSetting("Diagnostics:Dir", _dir);
        });
        _client = _factory.CreateClient();
        _client.DefaultRequestHeaders.Add("X-Gnezdo-User", "Tester");
        _client.DefaultRequestHeaders.Add("X-Gnezdo-Browser", "b-test");
        return Task.CompletedTask;
    }

    public async Task DisposeAsync()
    {
        await _factory.DisposeAsync();
        try { Directory.Delete(_dir, true); } catch (IOException) { }
    }

    /// <summary>All lines of the downloaded log.</summary>
    private async Task<string> Download()
    {
        var res = await _client.GetAsync("/api/logs/download?days=2");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal("application/zip", res.Content.Headers.ContentType?.MediaType);
        using var zip = new ZipArchive(await res.Content.ReadAsStreamAsync());
        var text = "";
        foreach (var e in zip.Entries)
        {
            using var r = new StreamReader(e.Open());
            text += await r.ReadToEndAsync();
        }
        return text;
    }

    [Fact]
    public async Task Browser_events_and_a_report_are_in_the_download()
    {
        var batch = new JsonObject
        {
            ["user"] = "Tester", ["browser"] = "b-test",
            ["events"] = new JsonArray(new JsonObject { ["t"] = "2026-11-07T08:00:00", ["kind"] = "tool", ["msg"] = "Arrange 12 parts" }),
        };
        Assert.Equal(HttpStatusCode.NoContent, (await _client.PostAsJsonAsync("/api/logs/client", batch)).StatusCode);
        var rep = await _client.PostAsJsonAsync("/api/logs/report", new { user = "Tester", browser = "b-test", text = "Nest stuck at 80 %" });
        Assert.Equal(HttpStatusCode.OK, rep.StatusCode);

        var log = await Download();
        Assert.Contains("Arrange 12 parts", log);
        Assert.Contains("\"kind\":\"ui:tool\"", log);
        Assert.Contains("PROBLEM REPORTED: Nest stuck at 80 %", log);
        Assert.Contains("\"user\":\"Tester\"", log);
        Assert.Contains("GNEZDO started", log);
        var s = await _client.GetFromJsonAsync<JsonObject>("/api/logs/settings");
        Assert.True(s!["enabled"]!.GetValue<bool>());
        Assert.True(s["files"]!.GetValue<int>() >= 1);
    }

    [Fact]
    public async Task An_empty_report_is_refused()
    {
        var res = await _client.PostAsJsonAsync("/api/logs/report", new { text = "  " });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Switched_off_nothing_more_is_written()
    {
        Assert.Equal(HttpStatusCode.OK, (await _client.PutAsJsonAsync("/api/logs/settings", new { enabled = false, by = "Tester" })).StatusCode);
        var s = await _client.GetFromJsonAsync<JsonObject>("/api/logs/settings");
        Assert.False(s!["enabled"]!.GetValue<bool>());
        var batch = new JsonObject { ["events"] = new JsonArray(new JsonObject { ["kind"] = "tool", ["msg"] = "should not be kept" }) };
        await _client.PostAsJsonAsync("/api/logs/client", batch);
        Assert.Equal(HttpStatusCode.Conflict, (await _client.PostAsJsonAsync("/api/logs/report", new { text = "x" })).StatusCode);
        var log = await Download();
        Assert.DoesNotContain("should not be kept", log);
        Assert.Contains("switched off by Tester", log);
        // the switch is kept in the logs folder: a restart stays off
        Assert.Contains("\"enabled\":false", await File.ReadAllTextAsync(Path.Combine(_dir, "diagnostics.json")));
        await _client.PutAsJsonAsync("/api/logs/settings", new { enabled = true, by = "Tester" });
        Assert.Contains("switched on by Tester", await Download());
    }

    [Fact]
    public async Task A_failed_call_is_logged_with_who_made_it()
    {
        await _client.PostAsJsonAsync("/api/nest", new JsonObject { ["mode"] = "nope" });
        var log = await Download();
        Assert.Contains("POST /api/nest", log);
        Assert.Contains("\"browser\":\"b-test\"", log);
    }
}
