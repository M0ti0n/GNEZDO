using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Gnezdo.Api.Endpoints;

namespace Gnezdo.Api.Tests;

/// <summary>Shared settings (machines) and a job's machine. Own database (class fixture).</summary>
public sealed class SettingsTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    [Fact]
    public async Task A_setting_is_null_until_saved_then_comes_back_as_saved()
    {
        Assert.Equal("null", await api.Client.GetStringAsync("/api/settings/machines"));
        var machines = new JsonObject
        {
            ["defaultId"] = "m1",
            ["list"] = new JsonArray(new JsonObject { ["id"] = "m1", ["name"] = "Laser 1", ["technology"] = "laser", ["cutLengthMm"] = 3000 }),
        };
        var put = await api.Client.PutAsJsonAsync("/api/settings/machines", new { value = machines, modifiedBy = "Fab" });
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        var back = JsonNode.Parse(await api.Client.GetStringAsync("/api/settings/machines"))!;
        Assert.Equal("Laser 1", back["list"]![0]!["name"]!.GetValue<string>());
        Assert.Equal(HttpStatusCode.NotFound, (await api.Client.GetAsync("/api/settings/nothere")).StatusCode);
    }

    [Fact]
    public async Task A_job_keeps_its_machine()
    {
        var part = (await api.Client.GetFromJsonAsync<List<PartDto>>("/api/parts"))![0];
        var res = await api.Client.PostAsJsonAsync("/api/jobs", new
        {
            name = "Machine job", machine = "plasma-1", parts = new[] { new { partId = part.Id, qty = 1 } },
        });
        var id = (await res.Content.ReadFromJsonAsync<JobSavedDto>())!.Id;
        var detail = (await api.Client.GetFromJsonAsync<JsonObject>($"/api/jobs/{id}"))!;
        Assert.Equal("plasma-1", detail["machine"]!.GetValue<string>());
    }
}
