using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Gnezdo.Api.Tests;

/// <summary>
/// Nesting runs through the API, in demo mode (no database), with a stand-in for the engine:
/// a small Python script that behaves like `nestprep_cli.py run` (progress.json, result.json,
/// the stop file) without nesting anything. The real engine is tested in nesting.yml.
/// </summary>
public sealed class NestTests : IAsyncLifetime
{
    private const string FakeEngine = """
        import json, os, sys, time
        req_p, rundir = sys.argv[2], sys.argv[3]
        req = json.load(open(req_p))
        def write(name, obj):
            with open(os.path.join(rundir, name + ".tmp"), "w") as f: json.dump(obj, f)
            os.replace(os.path.join(rundir, name + ".tmp"), os.path.join(rundir, name))
        groups = [{"material": "S235", "thicknessMm": 10, "stage": "nest", "sheets": 2}]
        write("progress.json", {"state": "running", "groups": groups})
        state = "done"
        sheet = {"sheetId": req["sheets"][0]["id"], "lengthMm": 3000, "widthMm": 1500,
                 "parts": [{"partId": p["id"], "x": 5, "y": 5, "angle": 0, "mirror": False} for p in req["parts"]]}
        write("best.json", {"sheets": [sheet]})
        if req["mode"] == "custom":
            while not os.path.exists(os.path.join(rundir, "stop")):
                time.sleep(0.05)
            state = "stopped"
        nested = {p["id"]: p["qty"] for p in req["parts"]}
        sheet = {"sheetId": req["sheets"][0]["id"], "lengthMm": 3000, "widthMm": 1500,
                 "parts": [{"partId": p["id"], "x": 5, "y": 5, "angle": 0, "mirror": False} for p in req["parts"]]}
        write("result.json", {"state": state, "sheets": [sheet], "nested": nested, "skipped": [], "valid": True, "errors": []})
        write("progress.json", {"state": state, "groups": groups})
        """;

    private readonly string _dir = Path.Combine(Path.GetTempPath(), "gnezdo-nest-test-" + Guid.NewGuid().ToString("N")[..8]);
    private WebApplicationFactory<Program> _factory = null!;
    private HttpClient _client = null!;

    private WebApplicationFactory<Program> App(string script, string solver) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
        {
            b.UseEnvironment("Testing");
            b.UseSetting("ConnectionStrings:Gnezdo", "");  // demo: no database
            b.UseSetting("Nesting:Python", OperatingSystem.IsWindows() ? "python" : "python3");
            b.UseSetting("Nesting:Script", script);
            b.UseSetting("Nesting:Solver", solver);
            b.UseSetting("Nesting:RunsDir", Path.Combine(_dir, "runs"));
        });

    public Task InitializeAsync()
    {
        Directory.CreateDirectory(_dir);
        var script = Path.Combine(_dir, "fake_engine.py");
        File.WriteAllText(script, FakeEngine);
        var solver = Path.Combine(_dir, "packingsolver_irregular");
        File.WriteAllText(solver, "");
        _factory = App(script, solver);
        _client = _factory.CreateClient();
        return Task.CompletedTask;
    }

    public async Task DisposeAsync()
    {
        await _factory.DisposeAsync();
        try { Directory.Delete(_dir, true); } catch (IOException) { }
    }

    private static JsonObject Request(string mode) => new()
    {
        ["mode"] = mode,
        ["minutes"] = null,
        ["partGapMm"] = 5,
        ["edgeGapMm"] = 5,
        ["parts"] = new JsonArray(
            new JsonObject { ["id"] = "7", ["path"] = "M0 0 L100 0 L100 50 L0 50Z", ["qty"] = 3, ["material"] = "S235", ["thicknessMm"] = 10 },
            new JsonObject { ["id"] = "8", ["path"] = "M0 0 L60 0 L60 60 L0 60Z", ["qty"] = 2, ["material"] = "S235", ["thicknessMm"] = 10 }),
        ["sheets"] = new JsonArray(new JsonObject { ["id"] = "s1", ["material"] = "S235", ["thicknessMm"] = 10, ["lengthMm"] = 3000, ["widthMm"] = 1500 }),
    };

    private async Task<JsonObject> WaitFor(string id, params string[] states)
    {
        for (var i = 0; i < 200; i++)
        {
            var run = (await _client.GetFromJsonAsync<JsonObject>($"/api/nest/{id}"))!;
            if (states.Contains(run["state"]!.GetValue<string>())) return run;
            await Task.Delay(100);
        }
        throw new TimeoutException($"run {id} did not reach {string.Join("/", states)}");
    }

    [Fact]
    public async Task Status_says_available()
    {
        var s = await _client.GetFromJsonAsync<JsonObject>("/api/nest/status");
        Assert.True(s!["available"]!.GetValue<bool>());
    }

    [Fact]
    public async Task Fast_nest_runs_to_the_end_with_counts_per_part()
    {
        var res = await _client.PostAsJsonAsync("/api/nest", Request("fast"));
        Assert.Equal(HttpStatusCode.Accepted, res.StatusCode);
        var id = (await res.Content.ReadFromJsonAsync<JsonObject>())!["id"]!.GetValue<string>();
        var run = await WaitFor(id, "done", "error");
        Assert.Equal("done", run["state"]!.GetValue<string>());
        var nested = run["result"]!["nested"]!.AsObject();
        Assert.Equal(3, nested["7"]!.GetValue<int>());
        Assert.Equal(2, nested["8"]!.GetValue<int>());
        Assert.Single(run["result"]!["sheets"]!.AsArray());
    }

    [Fact]
    public async Task Custom_nest_runs_until_stopped_and_keeps_the_layout()
    {
        var res = await _client.PostAsJsonAsync("/api/nest", Request("custom"));
        var id = (await res.Content.ReadFromJsonAsync<JsonObject>())!["id"]!.GetValue<string>();
        await WaitFor(id, "running");
        await Task.Delay(300);
        var live = (await _client.GetFromJsonAsync<JsonObject>($"/api/nest/{id}"))!;
        Assert.Equal("running", live["state"]!.GetValue<string>());
        Assert.Single(live["best"]!["sheets"]!.AsArray());  // the best layout so far, while it runs
        var stop = await _client.PostAsync($"/api/nest/{id}/stop", null);
        Assert.Equal(HttpStatusCode.OK, stop.StatusCode);
        var run = await WaitFor(id, "stopped", "error");
        Assert.Equal("stopped", run["state"]!.GetValue<string>());
        Assert.NotNull(run["result"]!["sheets"]);
    }

    [Fact]
    public async Task No_sheets_is_refused()
    {
        var req = Request("fast");
        req["sheets"] = new JsonArray();
        var res = await _client.PostAsJsonAsync("/api/nest", req);
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Unknown_run_is_not_found()
    {
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync("/api/nest/nothere")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.PostAsync("/api/nest/nothere/stop", null)).StatusCode);
    }

    [Fact]
    public async Task Without_the_engine_nesting_is_unavailable()
    {
        await using var app = App(Path.Combine(_dir, "missing.py"), Path.Combine(_dir, "missing"));
        var client = app.CreateClient();
        var s = await client.GetFromJsonAsync<JsonObject>("/api/nest/status");
        Assert.False(s!["available"]!.GetValue<bool>());
        var res = await client.PostAsJsonAsync("/api/nest", Request("fast"));
        Assert.Equal(HttpStatusCode.ServiceUnavailable, res.StatusCode);
    }
}
