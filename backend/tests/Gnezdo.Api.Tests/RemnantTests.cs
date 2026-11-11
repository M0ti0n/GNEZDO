using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;

namespace Gnezdo.Api.Tests;

/// <summary>Saved remnants: saved by name (same name replaces), listed, deleted. Own database.</summary>
public sealed class RemnantTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    [Fact]
    public async Task Remnants_are_saved_replaced_by_name_and_deleted()
    {
        Assert.Empty((await api.Client.GetFromJsonAsync<JsonArray>("/api/remnants"))!);
        var save = await api.Client.PostAsJsonAsync("/api/remnants", new
        {
            items = new JsonArray(
                new JsonObject { ["name"] = "REM_job_S1_1", ["areaMm2"] = 1000 },
                new JsonObject { ["name"] = "REM_job_S1_2", ["areaMm2"] = 500 }),
        });
        Assert.Equal(HttpStatusCode.OK, save.StatusCode);
        await api.Client.PostAsJsonAsync("/api/remnants", new { items = new JsonArray(new JsonObject { ["name"] = "REM_job_S1_1", ["areaMm2"] = 900 }) });
        var list = (await api.Client.GetFromJsonAsync<JsonArray>("/api/remnants"))!;
        Assert.Equal(2, list.Count);
        Assert.Equal(900, list.Single(n => n!["name"]!.GetValue<string>() == "REM_job_S1_1")!["areaMm2"]!.GetValue<int>());
        Assert.NotNull(list[0]!["savedAt"]);

        await api.Client.PostAsJsonAsync("/api/remnants/delete", new { names = new[] { "REM_job_S1_2" } });
        list = (await api.Client.GetFromJsonAsync<JsonArray>("/api/remnants"))!;
        Assert.Equal("REM_job_S1_1", Assert.Single(list)!["name"]!.GetValue<string>());

        Assert.Equal(HttpStatusCode.BadRequest, (await api.Client.PostAsJsonAsync("/api/remnants", new { items = new JsonArray() })).StatusCode);
    }
}
