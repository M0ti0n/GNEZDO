using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;

namespace Gnezdo.Api.Tests;

/// <summary>Recovery copies of job tabs with unsaved changes ("Restore unsaved work").</summary>
[Collection("api")]
public sealed class DraftTests(ApiFixture api)
{
    private readonly HttpClient _client = api.Client;

    private static JsonObject Save(string name, int parts) => new()
    {
        ["name"] = name, ["jobId"] = null, ["parts"] = parts, ["solutions"] = 1,
        ["content"] = new JsonObject { ["title"] = name, ["parts"] = new JsonArray(Enumerable.Range(0, parts).Select(i => (JsonNode)new JsonObject { ["id"] = i }).ToArray()) },
    };

    [Fact]
    public async Task A_draft_is_kept_updated_listed_and_removed()
    {
        var id = Guid.NewGuid().ToString();
        Assert.Equal(HttpStatusCode.OK, (await _client.PutAsJsonAsync($"/api/drafts/{id}", Save("Draft job", 2))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await _client.PutAsJsonAsync($"/api/drafts/{id}", Save("Draft job", 3))).StatusCode);

        var list = (await _client.GetFromJsonAsync<JsonArray>("/api/drafts"))!;
        var row = list.Single(r => r!["id"]!.GetValue<string>() == id)!;
        Assert.Equal("Draft job", row["name"]!.GetValue<string>());
        Assert.Equal(3, row["parts"]!.GetValue<int>());

        var full = (await _client.GetFromJsonAsync<JsonObject>($"/api/drafts/{id}"))!;
        Assert.Equal(3, full["content"]!["parts"]!.AsArray().Count);

        Assert.Equal(HttpStatusCode.NoContent, (await _client.DeleteAsync($"/api/drafts/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync($"/api/drafts/{id}")).StatusCode);
        Assert.DoesNotContain((await _client.GetFromJsonAsync<JsonArray>("/api/drafts"))!, r => r!["id"]!.GetValue<string>() == id);
    }

    [Fact]
    public async Task A_bad_id_or_no_content_is_refused()
    {
        Assert.Equal(HttpStatusCode.BadRequest, (await _client.PutAsJsonAsync("/api/drafts/not%20ok", Save("x", 1))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await _client.PutAsJsonAsync($"/api/drafts/{Guid.NewGuid()}", new { name = "x" })).StatusCode);
    }
}
