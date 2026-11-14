using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Gnezdo.Api.Endpoints;

namespace Gnezdo.Api.Tests;

/// <summary>
/// The status API (/api/v1): API keys, what POST PROCESS records as sent, and a project's parts with
/// where they stand. Its own database (class fixture).
/// </summary>
public sealed class StatusApiTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    [Fact]
    public void Part_names_split_into_drawing_position_and_pieces()
    {
        var a = StatusApi.ParseName("1234-56-78_P2_3kos");
        Assert.Equal(("1234-56-78", "P2", (int?)3), (a.Drawing, a.Position, a.Pieces));
        var b = StatusApi.ParseName("1234-56-78-P3A-2kos");
        Assert.Equal(("1234-56-78", "P3A", (int?)2), (b.Drawing, b.Position, b.Pieces));
        var c = StatusApi.ParseName("1234-56-78ZR_p1");
        Assert.Equal(("1234-56-78ZR", "P1", (int?)null), (c.Drawing, c.Position, c.Pieces));
        var d = StatusApi.ParseName("BRACKET_PANEL_LEFT");
        Assert.Equal(("BRACKET_PANEL_LEFT", "", (int?)null), (d.Drawing, d.Position, d.Pieces));
    }

    [Fact]
    public void Nested_pieces_come_from_the_solution_shown()
    {
        var nest = new JsonObject
        {
            ["selected"] = "b",
            ["solutions"] = new JsonArray(
                new JsonObject { ["id"] = "a", ["result"] = new JsonObject { ["nested"] = new JsonObject { ["7"] = 9 } } },
                new JsonObject
                {
                    ["id"] = "b",
                    ["result"] = new JsonObject
                    {
                        ["sheets"] = new JsonArray(
                            new JsonObject { ["cutNumber"] = 2, ["parts"] = new JsonArray(new JsonObject { ["partId"] = "7" }, new JsonObject { ["partId"] = "8" }) },
                            new JsonObject { ["parts"] = new JsonArray(new JsonObject { ["partId"] = "7" }) }),
                    },
                }),
        };
        var n = StatusApi.NestedOf(nest.ToJsonString());
        Assert.Equal(3, n["7"]);
        Assert.Equal(2, n["8"]);
        Assert.Empty(StatusApi.NestedOf(""));
    }

    private static HttpRequestMessage WithKey(HttpMethod m, string url, string key, object? body = null)
    {
        var r = new HttpRequestMessage(m, url);
        r.Headers.Add(StatusApi.KeyHeader, key);
        if (body is not null) r.Content = JsonContent.Create(body);
        return r;
    }

    private async Task<string> NewKey(string name)
    {
        var res = await api.Client.PostAsJsonAsync("/api/apikeys", new { name });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        return (await res.Content.ReadFromJsonAsync<JsonObject>())!["key"]!.GetValue<string>();
    }

    [Fact]
    public async Task Without_a_valid_key_nothing_is_shown()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await api.Client.GetAsync("/api/v1/projects/26-0412")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await api.Client.SendAsync(WithKey(HttpMethod.Get, "/api/v1", "gz_not_a_key"))).StatusCode);

        var key = await NewKey("Test app");
        Assert.Equal(HttpStatusCode.OK, (await api.Client.SendAsync(WithKey(HttpMethod.Get, "/api/v1", key))).StatusCode);

        // listed by name and prefix, never the key itself; removed, it no longer works
        var list = (await api.Client.GetFromJsonAsync<JsonArray>("/api/apikeys"))!;
        var row = list.First(x => x!["name"]!.GetValue<string>() == "Test app")!;
        Assert.StartsWith(row["prefix"]!.GetValue<string>(), key);
        Assert.DoesNotContain(key, list.ToJsonString());
        Assert.Equal(HttpStatusCode.NoContent, (await api.Client.DeleteAsync($"/api/apikeys/{row["id"]}")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await api.Client.SendAsync(WithKey(HttpMethod.Get, "/api/v1", key))).StatusCode);
    }

    [Fact]
    public async Task A_project_shows_its_parts_in_jobs_nested_and_sent_and_missing_drawings()
    {
        var key = await NewKey("BOM app");
        var part = (await api.Client.GetFromJsonAsync<List<PartDto>>("/api/parts"))!.First(p => p.Project != "");
        var code = part.Project;

        // a job with 5 of it, 4 nested; sheet 1 (3 of it) post processed, twice: the second replaces the first
        var nest = new JsonObject
        {
            ["selected"] = "s1",
            ["solutions"] = new JsonArray(new JsonObject
            {
                ["id"] = "s1",
                ["result"] = new JsonObject
                {
                    ["sheets"] = new JsonArray(new JsonObject { ["lengthMm"] = 3000, ["widthMm"] = 1500, ["parts"] = new JsonArray(new JsonObject { ["partId"] = part.Id }) }),
                    ["nested"] = new JsonObject { [part.Id] = 4 },
                },
            }),
        };
        var saved = await api.Client.PostAsJsonAsync("/api/jobs", new
        {
            name = "Status API job",
            parts = new[] { new { partId = part.Id, qty = 5, qtyMax = 5, no = 1 } },
            stock = new JsonArray(),
            nest,
            modifiedBy = "Test",
        });
        Assert.Equal(HttpStatusCode.Created, saved.StatusCode);
        var jobId = (await saved.Content.ReadFromJsonAsync<JsonObject>())!["id"]!.GetValue<string>();
        var report = new { machine = "laser", all = true, sheets = new[] { new { sheet = 1, file = "STATUS_1.nc", parts = new Dictionary<string, int> { [part.Id] = 3 } } } };
        Assert.Equal(HttpStatusCode.OK, (await api.Client.PostAsJsonAsync($"/api/jobs/{jobId}/sent", report)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await api.Client.PostAsJsonAsync($"/api/jobs/{jobId}/sent", report)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await api.Client.PostAsJsonAsync("/api/jobs/999999/sent", report)).StatusCode);

        var res = await api.Client.SendAsync(WithKey(HttpMethod.Get, $"/api/v1/projects/{Uri.EscapeDataString(code)}", key));
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = JsonNode.Parse(await res.Content.ReadAsStringAsync())!;
        var p = body["parts"]!.AsArray().First(x => x!["id"]!.GetValue<string>() == part.Id)!;
        Assert.True(p["inJobs"]!.GetValue<int>() >= 5);
        Assert.True(p["nested"]!.GetValue<int>() >= 4);
        Assert.Equal(3, p["sent"]!.GetValue<int>());
        Assert.Contains(p["status"]!.GetValue<string>(), new[] { "sent", "partlySent" });
        var line = p["jobs"]!.AsArray().First(j => j!["id"]!.GetValue<string>() == jobId)!;
        Assert.Equal("STATUS_1.nc", line["sheets"]![0]!["file"]!.GetValue<string>());

        // the order's drawings: this one 3 of 10 sent, another never imported
        var name = StatusApi.ParseName(part.Name);
        var check = await api.Client.SendAsync(WithKey(HttpMethod.Post, $"/api/v1/projects/{Uri.EscapeDataString(code)}/check", key, new
        {
            drawings = new object[]
            {
                new { drawing = name.Drawing, position = name.Position, needed = 10 },
                new { drawing = "9999-99-99", position = "P1", needed = 2 },
            },
        }));
        Assert.Equal(HttpStatusCode.OK, check.StatusCode);
        var c = JsonNode.Parse(await check.Content.ReadAsStringAsync())!;
        Assert.True(c["projectFound"]!.GetValue<bool>());
        var items = c["items"]!.AsArray();
        Assert.Equal(7, items[0]!["short"]!.GetValue<int>());
        Assert.Equal("missing", items[1]!["status"]!.GetValue<string>());
        Assert.DoesNotContain(part.Name, c["notInList"]!.AsArray().Select(x => x!.GetValue<string>()));

        // the operator marks the job as cut: its sent pieces count as cut; unmarked, they do not
        var cut = await api.Client.PutAsJsonAsync($"/api/jobs/{jobId}/cut", new { cut = true, by = "Operator" });
        Assert.Equal(HttpStatusCode.OK, cut.StatusCode);
        Assert.Equal("cut", (await cut.Content.ReadFromJsonAsync<JsonObject>())!["status"]!.GetValue<string>());
        async Task<JsonNode> PartNow() => JsonNode.Parse(await (await api.Client.SendAsync(WithKey(HttpMethod.Get, $"/api/v1/projects/{Uri.EscapeDataString(code)}", key))).Content.ReadAsStringAsync())!
            ["parts"]!.AsArray().First(x => x!["id"]!.GetValue<string>() == part.Id)!;
        var after = await PartNow();
        Assert.Equal(3, after["cut"]!.GetValue<int>());
        var cutLine = after["jobs"]!.AsArray().First(j => j!["id"]!.GetValue<string>() == jobId)!;
        Assert.True(cutLine["isCut"]!.GetValue<bool>());
        Assert.Equal("Operator", cutLine["cutBy"]!.GetValue<string>());
        Assert.Equal(HttpStatusCode.OK, (await api.Client.PutAsJsonAsync($"/api/jobs/{jobId}/cut", new { cut = false })).StatusCode);
        Assert.Equal(0, (await PartNow())["cut"]!.GetValue<int>());

        // an unknown project: 404 for its status, every drawing missing in a check
        Assert.Equal(HttpStatusCode.NotFound, (await api.Client.SendAsync(WithKey(HttpMethod.Get, "/api/v1/projects/NO-SUCH-1", key))).StatusCode);
        var none = JsonNode.Parse(await (await api.Client.SendAsync(WithKey(HttpMethod.Post, "/api/v1/projects/NO-SUCH-1/check", key,
            new { drawings = new[] { new { drawing = "1-2-3", position = "", needed = 1 } } }))).Content.ReadAsStringAsync())!;
        Assert.False(none["projectFound"]!.GetValue<bool>());
        Assert.Equal("missing", none["items"]![0]!["status"]!.GetValue<string>());
    }
}
