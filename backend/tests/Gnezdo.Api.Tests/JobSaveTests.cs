using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Gnezdo.Api.Endpoints;

namespace Gnezdo.Api.Tests;

/// <summary>
/// Saving a job (Work parts SAVE): parts with Qty req / Qty max / ID, stock sheets and the saved nest.
/// Its own database (class fixture), so the jobs made here do not change the counts other tests expect.
/// </summary>
public sealed class JobSaveTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private async Task<List<string>> PartIds(int n) =>
        (await api.Client.GetFromJsonAsync<List<PartDto>>("/api/parts"))!.Take(n).Select(p => p.Id).ToList();

    private static JsonObject Nest(int sheets) => new()
    {
        ["mode"] = "fast",
        ["origin"] = "top-left",
        ["sheets"] = new JsonArray(Enumerable.Range(0, sheets).Select(_ => (JsonNode)new JsonObject
        {
            ["lengthMm"] = 3000, ["widthMm"] = 1500, ["parts"] = new JsonArray(),
        }).ToArray()),
    };

    [Fact]
    public async Task New_job_is_saved_with_parts_stock_and_nest()
    {
        var ids = await PartIds(2);
        var stock = new JsonArray(new JsonObject { ["id"] = "s1", ["material"] = "S235", ["thicknessMm"] = 5, ["lengthMm"] = 3000, ["widthMm"] = 1500, ["qty"] = 1, ["unlimited"] = true });
        var req = new
        {
            name = "Test job 1",
            parts = new[] { new { partId = ids[0], qty = 4, qtyMax = 6, no = 2 }, new { partId = ids[1], qty = 3, qtyMax = 1, no = 1 } },
            stock,
            nest = Nest(2),
            modifiedBy = "Fab",
        };
        var res = await api.Client.PostAsJsonAsync("/api/jobs", req);
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        var saved = (await res.Content.ReadFromJsonAsync<JobSavedDto>())!;
        Assert.Equal("nested", saved.Status);
        Assert.Equal(2, saved.SheetCount);

        var detail = (await api.Client.GetFromJsonAsync<JsonObject>($"/api/jobs/{saved.Id}"))!;
        Assert.Equal("Test job 1", detail["name"]!.GetValue<string>());
        Assert.Equal("S235", detail["stock"]![0]!["material"]!.GetValue<string>());
        Assert.Equal(2, detail["nest"]!["sheets"]!.AsArray().Count);

        // parts in ID order; Qty max never below Qty req
        var parts = (await api.Client.GetFromJsonAsync<List<JobPartDto>>($"/api/jobs/{saved.Id}/parts"))!;
        Assert.Equal(new[] { ids[1], ids[0] }, parts.Select(p => p.Part.Id));
        Assert.Equal(new[] { 3, 4 }, parts.Select(p => p.Qty));
        Assert.Equal(new[] { 3, 6 }, parts.Select(p => p.QtyMax));
        Assert.Equal(new[] { 1, 2 }, parts.Select(p => p.No));
    }

    [Fact]
    public async Task Saving_again_replaces_parts_and_without_a_nest_it_is_a_draft()
    {
        var ids = await PartIds(3);
        var first = await api.Client.PostAsJsonAsync("/api/jobs", new
        {
            name = "Test job 2",
            parts = new[] { new { partId = ids[0], qty = 1 }, new { partId = ids[1], qty = 2 } },
            nest = Nest(1),
        });
        var id = (await first.Content.ReadFromJsonAsync<JobSavedDto>())!.Id;

        var res = await api.Client.PutAsJsonAsync($"/api/jobs/{id}", new
        {
            name = "Test job 2b",
            parts = new[] { new { partId = ids[2], qty = 5 } },
        });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var saved = (await res.Content.ReadFromJsonAsync<JobSavedDto>())!;
        Assert.Equal("draft", saved.Status);
        Assert.Equal(0, saved.SheetCount);
        var parts = (await api.Client.GetFromJsonAsync<List<JobPartDto>>($"/api/jobs/{id}/parts"))!;
        Assert.Equal(ids[2], Assert.Single(parts).Part.Id);
        var detail = (await api.Client.GetFromJsonAsync<JsonObject>($"/api/jobs/{id}"))!;
        Assert.Equal("Test job 2b", detail["name"]!.GetValue<string>());
        Assert.Null(detail["nest"]);
    }

    [Fact]
    public async Task Bad_jobs_are_refused()
    {
        var ids = await PartIds(1);
        Assert.Equal(HttpStatusCode.BadRequest, (await api.Client.PostAsJsonAsync("/api/jobs", new { name = " ", parts = Array.Empty<object>() })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await api.Client.PostAsJsonAsync("/api/jobs", new { name = "X", parts = new[] { new { partId = "999999", qty = 1 } } })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await api.Client.PostAsJsonAsync("/api/jobs", new { name = "X", parts = new[] { new { partId = ids[0], qty = 1 }, new { partId = ids[0], qty = 2 } } })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await api.Client.PutAsJsonAsync("/api/jobs/999999", new { name = "X", parts = Array.Empty<object>() })).StatusCode);
    }

    [Fact]
    public async Task Seed_jobs_get_qty_max_and_ids()
    {
        var jobs = (await api.Client.GetFromJsonAsync<List<JobSummaryDto>>("/api/jobs/recent"))!;
        var parts = (await api.Client.GetFromJsonAsync<List<JobPartDto>>($"/api/jobs/{jobs.Last().Id}/parts"))!;
        Assert.All(parts, p => Assert.True(p.QtyMax >= p.Qty));
        Assert.Equal(Enumerable.Range(1, parts.Count), parts.Select(p => p.No));
    }
}
