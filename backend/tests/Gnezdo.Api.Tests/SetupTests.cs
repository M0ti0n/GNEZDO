using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.SqlClient;

namespace Gnezdo.Api.Tests;

/// <summary>
/// The server zip's first start without a database: "Set up the database" in the browser.
/// (SQL Server only: the server build's database.)
/// </summary>
public sealed class SetupTests : IAsyncLifetime
{
    private readonly string _config = Path.Combine(Path.GetTempPath(), $"gnezdo-setup-{Guid.NewGuid():N}.json");
    private readonly string _db = $"gnezdo_setup_{Guid.NewGuid():N}";
    private readonly string _other = $"gnezdo_other_{Guid.NewGuid():N}";
    private WebApplicationFactory<Program> _factory = null!;
    private HttpClient _client = null!;
    private SqlConnectionStringBuilder _server = null!;

    public async Task InitializeAsync()
    {
        _server = new SqlConnectionStringBuilder(TestDb.NewConnectionString("x")) { InitialCatalog = "" };
        await File.WriteAllTextAsync(_config, """{ "ConnectionStrings": { "Gnezdo": "" }, "Gnezdo": { "Setup": true, "TimeZone": "Europe/Ljubljana" } }""");
        _factory = new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
        {
            b.UseEnvironment("Testing");
            b.UseSetting("ConnectionStrings:Gnezdo", "");
            b.UseSetting("Gnezdo:Setup", "true");
            b.UseSetting("Gnezdo:ConfigFile", _config);
        });
        _client = _factory.CreateClient();
    }

    public async Task DisposeAsync()
    {
        await _factory.DisposeAsync();
        File.Delete(_config);
        if (TestDb.Sqlite) return;
        SqlConnection.ClearAllPools();
        await using var con = new SqlConnection(new SqlConnectionStringBuilder(_server.ConnectionString) { InitialCatalog = "master" }.ConnectionString);
        await con.OpenAsync();
        foreach (var db in new[] { _db, _other })
        {
            await using var cmd = new SqlCommand($"IF DB_ID('{db}') IS NOT NULL BEGIN ALTER DATABASE [{db}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{db}] END", con);
            await cmd.ExecuteNonQueryAsync();
        }
    }

    private object Form(string db) => new
    {
        server = _server.DataSource, database = db, windowsLogin = false,
        user = _server.UserID, password = _server.Password, trustCertificate = true,
    };

    [Fact]
    public async Task The_database_is_set_up_from_the_browser()
    {
        if (TestDb.Sqlite) return;

        var h = (await _client.GetFromJsonAsync<JsonObject>("/api/health"))!;
        Assert.True(h["setup"]!.GetValue<bool>());
        Assert.False(h["demo"]!.GetValue<bool>());
        // nothing else answers yet
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await _client.GetAsync("/api/parts")).StatusCode);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await _client.GetAsync("/api/auth/state")).StatusCode);

        // wrong password: says why
        var bad = await (await _client.PostAsJsonAsync("/api/setup/test", new { server = _server.DataSource, database = _db, user = _server.UserID, password = "wrong", trustCertificate = true })).Content.ReadFromJsonAsync<JsonObject>();
        Assert.False(bad!["ok"]!.GetValue<bool>());
        Assert.StartsWith("Could not connect", bad["message"]!.GetValue<string>());

        // a database of another program is refused
        await using (var con = new SqlConnection(new SqlConnectionStringBuilder(_server.ConnectionString) { InitialCatalog = "master" }.ConnectionString))
        {
            await con.OpenAsync();
            await using var cmd = new SqlCommand($"CREATE DATABASE [{_other}]; EXEC('USE [{_other}]; CREATE TABLE Artikli (Id int)')", con);
            await cmd.ExecuteNonQueryAsync();
        }
        var other = await (await _client.PostAsJsonAsync("/api/setup/save", Form(_other))).Content.ReadFromJsonAsync<JsonObject>();
        Assert.False(other!["ok"]!.GetValue<bool>());
        Assert.Contains("another program", other["message"]!.GetValue<string>());

        // a new one: checked, then made
        var test = await (await _client.PostAsJsonAsync("/api/setup/test", Form(_db))).Content.ReadFromJsonAsync<JsonObject>();
        Assert.True(test!["ok"]!.GetValue<bool>());
        Assert.Equal("new", test["found"]!.GetValue<string>());
        var save = await (await _client.PostAsJsonAsync("/api/setup/save", Form(_db))).Content.ReadFromJsonAsync<JsonObject>();
        Assert.True(save!["ok"]!.GetValue<bool>(), save["message"]?.ToString());

        // GNEZDO carries on: the first admin next; the connection is in config.json, Setup gone
        Assert.False((await _client.GetFromJsonAsync<JsonObject>("/api/health"))!["setup"]!.GetValue<bool>());
        var state = (await _client.GetFromJsonAsync<JsonObject>("/api/auth/state"))!;
        Assert.True(state["setupNeeded"]!.GetValue<bool>());
        var cfg = JsonNode.Parse(await File.ReadAllTextAsync(_config))!;
        Assert.Contains(_db, cfg["ConnectionStrings"]!["Gnezdo"]!.GetValue<string>());
        Assert.Null(cfg["Gnezdo"]!["Setup"]);
        Assert.Equal("Europe/Ljubljana", cfg["Gnezdo"]!["TimeZone"]!.GetValue<string>());

        // once set up, the page is closed to anyone not signed in as an admin
        Assert.Equal(HttpStatusCode.Unauthorized, (await _client.PostAsJsonAsync("/api/setup/test", Form(_db))).StatusCode);
    }
}
