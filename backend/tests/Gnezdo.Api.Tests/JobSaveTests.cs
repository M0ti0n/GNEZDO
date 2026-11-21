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
    public async Task A_save_over_someone_elses_save_since_is_refused_unless_forced()
    {
        var ids = await PartIds(1);
        object Req(int qty, DateTimeOffset? seen, bool force = false) => new
        {
            name = "Conflict job", parts = new[] { new { partId = ids[0], qty, qtyMax = qty, no = 1 } },
            stock = new JsonArray(), nest = Nest(1), modifiedBy = "A", baseModifiedAt = seen, force,
        };
        var created = (await (await api.Client.PostAsJsonAsync("/api/jobs", Req(1, null))).Content.ReadFromJsonAsync<JobSavedDto>())!;
        await Task.Delay(30);
        // A saves over the version both opened: fine
        var a = await api.Client.PutAsJsonAsync($"/api/jobs/{created.Id}", Req(10, created.ModifiedAt));
        Assert.Equal(HttpStatusCode.OK, a.StatusCode);
        var aSaved = (await a.Content.ReadFromJsonAsync<JobSavedDto>())!;
        // B still has the version from before A's save: refused, told who saved
        var b = await api.Client.PutAsJsonAsync($"/api/jobs/{created.Id}", Req(20, created.ModifiedAt));
        Assert.Equal(HttpStatusCode.Conflict, b.StatusCode);
        var why = (await b.Content.ReadFromJsonAsync<JsonObject>())!;
        Assert.True(why["conflict"]!.GetValue<bool>());
        Assert.Contains("saved by", why["message"]!.GetValue<string>());
        var parts = (await api.Client.GetFromJsonAsync<List<JobPartDto>>($"/api/jobs/{created.Id}/parts"))!;
        Assert.Equal(10, parts[0].Qty);
        // asked and saved over it; A's own next save from its version goes on
        Assert.Equal(HttpStatusCode.OK, (await api.Client.PutAsJsonAsync($"/api/jobs/{created.Id}", Req(20, created.ModifiedAt, force: true))).StatusCode);
        Assert.Equal(20, (await api.Client.GetFromJsonAsync<List<JobPartDto>>($"/api/jobs/{created.Id}/parts"))![0].Qty);
        Assert.Equal(HttpStatusCode.Conflict, (await api.Client.PutAsJsonAsync($"/api/jobs/{created.Id}", Req(30, aSaved.ModifiedAt))).StatusCode);
        // a client that does not say what it saw (older pages) saves as before
        Assert.Equal(HttpStatusCode.OK, (await api.Client.PutAsJsonAsync($"/api/jobs/{created.Id}", Req(40, null))).StatusCode);
    }

    private async Task<HttpResponseMessage> AsPage(HttpMethod how, string url, string page, string user, object? body = null)
    {
        var m = new HttpRequestMessage(how, url) { Content = body is null ? null : JsonContent.Create(body) };
        m.Headers.Add("X-Gnezdo-Page", page);
        m.Headers.Add("X-Gnezdo-User", user);
        return await api.Client.SendAsync(m);
    }

    [Fact]
    public async Task A_job_open_on_another_computer_is_not_opened_or_saved_over_until_it_is_closed_there()
    {
        var ids = await PartIds(1);
        object Req(int qty) => new { name = "Locked job", parts = new[] { new { partId = ids[0], qty, no = 1 } }, nest = Nest(1) };
        // made in Fab's tab: open there
        var made = await AsPage(HttpMethod.Post, "/api/jobs", "page-a", "Fab", Req(1));
        var id = (await made.Content.ReadFromJsonAsync<JobSavedDto>())!.Id;
        Assert.Equal(HttpStatusCode.OK, (await AsPage(HttpMethod.Post, $"/api/jobs/{id}/open", "page-a", "Fab")).StatusCode);
        // another computer: refused, told who has it; so is its save, and its renewal
        var b = await AsPage(HttpMethod.Post, $"/api/jobs/{id}/open", "page-b", "Mia");
        Assert.Equal(HttpStatusCode.Locked, b.StatusCode);
        var why = (await b.Content.ReadFromJsonAsync<JsonObject>())!;
        Assert.Equal("Fab", why["user"]!.GetValue<string>());
        Assert.Contains("Locked job is open on another computer by Fab", why["message"]!.GetValue<string>());
        Assert.Equal(HttpStatusCode.Locked, (await AsPage(HttpMethod.Put, $"/api/jobs/{id}", "page-b", "Mia", Req(5))).StatusCode);
        Assert.Equal(HttpStatusCode.Locked, (await AsPage(HttpMethod.Post, $"/api/jobs/{id}/keep", "page-b", "Mia")).StatusCode);
        // the same user in another browser: the same
        Assert.Equal(HttpStatusCode.Locked, (await AsPage(HttpMethod.Post, $"/api/jobs/{id}/open", "page-c", "Fab")).StatusCode);
        // the page that has it saves and renews; someone else's close does not let it go
        Assert.Equal(HttpStatusCode.OK, (await AsPage(HttpMethod.Put, $"/api/jobs/{id}", "page-a", "Fab", Req(2))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await AsPage(HttpMethod.Post, $"/api/jobs/{id}/keep", "page-a", "Fab")).StatusCode);
        await AsPage(HttpMethod.Post, $"/api/jobs/{id}/close", "page-b", "Mia");
        Assert.Equal(HttpStatusCode.Locked, (await AsPage(HttpMethod.Post, $"/api/jobs/{id}/open", "page-b", "Mia")).StatusCode);
        // closed there (as the page's beacon does it: ?page=): it opens here
        Assert.Equal(HttpStatusCode.NoContent, (await api.Client.PostAsync($"/api/jobs/{id}/close?page=page-a", null)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await AsPage(HttpMethod.Post, $"/api/jobs/{id}/open", "page-b", "Mia")).StatusCode);
        Assert.Equal(HttpStatusCode.Locked, (await AsPage(HttpMethod.Post, $"/api/jobs/{id}/open", "page-a", "Fab")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await AsPage(HttpMethod.Post, "/api/jobs/999999/open", "page-a", "Fab")).StatusCode);
    }

    private sealed class Clock : TimeProvider
    {
        public DateTimeOffset Now = new(2026, 11, 21, 12, 0, 0, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => Now;
    }

    [Fact]
    public void A_job_held_by_a_computer_that_stopped_renewing_lets_go_after_the_lapse()
    {
        var clock = new Clock();
        var locks = new JobLocks(clock);
        Assert.True(locks.TryTake(1, "a", "Fab", out _));
        clock.Now += JobLocks.Lapse / 2;
        Assert.False(locks.TryTake(1, "b", "Mia", out var other));
        Assert.Equal("Fab", other!.User);
        Assert.True(locks.Keep(1, "a", "Fab"));
        clock.Now += JobLocks.Lapse - TimeSpan.FromSeconds(1);
        Assert.NotNull(locks.Other(1, "b"));
        clock.Now += TimeSpan.FromSeconds(2);
        Assert.Null(locks.Other(1, "b"));
        Assert.True(locks.TryTake(1, "b", "Mia", out _));
        // the stopped computer comes back: it lost the job
        Assert.False(locks.Keep(1, "a", "Fab"));
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
    public async Task All_solutions_are_kept_and_the_one_shown_gives_the_sheet_count()
    {
        var ids = await PartIds(1);
        JsonObject Sol(string id, int sheets) => new() { ["id"] = id, ["mode"] = "fast", ["result"] = new JsonObject { ["sheets"] = Nest(sheets)["sheets"]!.DeepClone() } };
        var res = await api.Client.PostAsJsonAsync("/api/jobs", new
        {
            name = "Test job 3",
            parts = new[] { new { partId = ids[0], qty = 2 } },
            nest = new JsonObject { ["selected"] = "b", ["solutions"] = new JsonArray(Sol("a", 1), Sol("b", 3), Sol("c", 2)) },
        });
        var saved = (await res.Content.ReadFromJsonAsync<JobSavedDto>())!;
        Assert.Equal(3, saved.SheetCount);
        Assert.Equal("nested", saved.Status);
        var detail = (await api.Client.GetFromJsonAsync<JsonObject>($"/api/jobs/{saved.Id}"))!;
        Assert.Equal(3, detail["nest"]!["solutions"]!.AsArray().Count);
    }

    [Fact]
    public async Task Material_and_thickness_can_be_set_for_the_job_only()
    {
        var ids = await PartIds(2);
        var before = (await api.Client.GetFromJsonAsync<List<PartDto>>("/api/parts"))!.Single(p => p.Id == ids[0]);
        var req = new
        {
            name = "Job with its own material",
            parts = new object[] { new { partId = ids[0], qty = 2, material = "HARDOX 450", thicknessMm = 6.5m }, new { partId = ids[1], qty = 1 } },
            stock = new JsonArray(), nest = (JsonObject?)null, modifiedBy = "Fab",
        };
        var res = await api.Client.PostAsJsonAsync("/api/jobs", req);
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        var saved = (await res.Content.ReadFromJsonAsync<JobSavedDto>())!;
        var parts = (await api.Client.GetFromJsonAsync<List<JobPartDto>>($"/api/jobs/{saved.Id}/parts"))!;
        var p0 = parts.Single(p => p.Part.Id == ids[0]);
        Assert.Equal("HARDOX 450", p0.Material);
        Assert.Equal(6.5m, p0.ThicknessMm);
        Assert.Equal(before.Material, p0.Part.Material);          // the part itself keeps its own
        Assert.Null(parts.Single(p => p.Part.Id == ids[1]).Material);
        var after = (await api.Client.GetFromJsonAsync<List<PartDto>>("/api/parts"))!.Single(p => p.Id == ids[0]);
        Assert.Equal(before.Material, after.Material);
        Assert.Equal(before.ThicknessMm, after.ThicknessMm);

        var bad = await api.Client.PostAsJsonAsync("/api/jobs", new { name = "x", parts = new[] { new { partId = ids[0], qty = 1, thicknessMm = -1m } } });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
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
