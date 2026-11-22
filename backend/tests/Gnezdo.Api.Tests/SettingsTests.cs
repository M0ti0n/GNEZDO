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
    public async Task Cost_prices_are_a_shared_setting()
    {
        Assert.Equal("null", await api.Client.GetStringAsync("/api/settings/costPrices"));
        var prices = new JsonObject { ["currency"] = "€", ["fixed"] = 25, ["materials"] = new JsonObject { ["S355"] = new JsonObject { ["kg"] = 1.4, ["min"] = 2 } } };
        Assert.Equal(HttpStatusCode.OK, (await api.Client.PutAsJsonAsync("/api/settings/costPrices", new { value = prices, modifiedBy = "Fab" })).StatusCode);
        var back = JsonNode.Parse(await api.Client.GetStringAsync("/api/settings/costPrices"))!;
        Assert.Equal(1.4, back["materials"]!["S355"]!["kg"]!.GetValue<double>());
        var versions = JsonNode.Parse(await api.Client.GetStringAsync("/api/settings/versions"))!;
        Assert.NotNull(versions["costPrices"]);
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
