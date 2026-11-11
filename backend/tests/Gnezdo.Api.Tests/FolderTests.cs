using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Gnezdo.Api.Endpoints;

namespace Gnezdo.Api.Tests;

/// <summary>A machine's folders: NC programs and job files written by the server. Own database (class fixture).</summary>
public sealed class FolderTests(ApiFixture api) : IClassFixture<ApiFixture>, IDisposable
{
    private readonly string _dir = Directory.CreateTempSubdirectory("gnezdo-folders-").FullName;

    public void Dispose() { try { Directory.Delete(_dir, true); } catch (IOException) { } }

    private async Task Machines(JsonObject? folders)
    {
        var m = new JsonObject { ["id"] = "p1", ["name"] = "Plasma", ["technology"] = "plasma" };
        if (folders is not null) m["folders"] = folders;
        var put = await api.Client.PutAsJsonAsync("/api/settings/machines", new
        {
            value = new JsonObject { ["defaultId"] = "p1", ["list"] = new JsonArray(m) },
        });
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
    }

    [Fact]
    public async Task A_folder_is_checked_by_the_server()
    {
        var ok = await (await api.Client.PostAsJsonAsync("/api/folders/check", new { path = _dir })).Content.ReadFromJsonAsync<JsonObject>();
        Assert.True(ok!["ok"]!.GetValue<bool>());
        var missing = await (await api.Client.PostAsJsonAsync("/api/folders/check", new { path = Path.Combine(_dir, "nothere") })).Content.ReadFromJsonAsync<JsonObject>();
        Assert.False(missing!["ok"]!.GetValue<bool>());
        var relative = await (await api.Client.PostAsJsonAsync("/api/folders/check", new { path = "nc" })).Content.ReadFromJsonAsync<JsonObject>();
        Assert.False(relative!["ok"]!.GetValue<bool>());
    }

    [Fact]
    public async Task An_nc_program_goes_to_the_machines_folder_and_a_job_file_when_asked()
    {
        var nc = Directory.CreateDirectory(Path.Combine(_dir, "nc")).FullName;
        var jobs = Directory.CreateDirectory(Path.Combine(_dir, "jobs")).FullName;

        await Machines(null);
        Assert.Equal(HttpStatusCode.Conflict, (await api.Client.PostAsJsonAsync("/api/machines/p1/nc", new { name = "A.NCP", content = "%1" })).StatusCode);

        await Machines(new JsonObject { ["nc"] = nc, ["jobs"] = jobs, ["jobFile"] = true });
        var res = await api.Client.PostAsJsonAsync("/api/machines/p1/nc", new { name = "..\\SHEET 1.NCP", content = "%1\nM30\n" });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var written = Assert.Single(Directory.GetFiles(nc));
        Assert.Equal("%1\nM30\n", await File.ReadAllTextAsync(written));
        Assert.Empty(Directory.GetFiles(_dir));   // nothing outside the folder

        var part = (await api.Client.GetFromJsonAsync<List<PartDto>>("/api/parts"))![0];
        var saved = await (await api.Client.PostAsJsonAsync("/api/jobs", new
        {
            name = "Folder job", machine = "p1", parts = new[] { new { partId = part.Id, qty = 2 } },
        })).Content.ReadFromJsonAsync<JobSavedDto>();
        Assert.NotNull(saved!.JobFile);
        Assert.Null(saved.JobFileError);
        var file = JsonNode.Parse(await File.ReadAllTextAsync(saved.JobFile!))!;
        Assert.Equal("gnezdo-job", file["format"]!.GetValue<string>());
        Assert.Equal(2, file["parts"]![0]!["qty"]!.GetValue<int>());

        // not ticked: only the database
        await Machines(new JsonObject { ["nc"] = nc, ["jobs"] = jobs, ["jobFile"] = false });
        var again = await (await api.Client.PutAsJsonAsync($"/api/jobs/{saved.Id}", new
        {
            name = "Folder job", machine = "p1", parts = new[] { new { partId = part.Id, qty = 3 } },
        })).Content.ReadFromJsonAsync<JobSavedDto>();
        Assert.Null(again!.JobFile);
        Assert.Equal(2, JsonNode.Parse(await File.ReadAllTextAsync(saved.JobFile!))!["parts"]![0]!["qty"]!.GetValue<int>());
    }
}
