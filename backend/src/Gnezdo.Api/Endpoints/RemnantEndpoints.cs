using System.Text.Json.Nodes;
using Gnezdo.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Gnezdo.Api.Endpoints;

public record RemnantSaveRequest(JsonArray? Items);
public record RemnantDeleteRequest(string[]? Names);

/// <summary>
/// The saved remnants (Process -> Remnant -> SAVE): one list, kept as JSON under the "remnants" key of
/// the settings table until the Stock &amp; remnants page brings its own table. Each remnant is an object
/// the app owns; its "name" (REM_job_S1_1) is the key: saving one of the same name replaces it.
/// </summary>
public static class RemnantEndpoints
{
    private const string Key = "remnants";

    private static async Task<(AppSetting Row, JsonArray List)> LoadAsync(GnezdoDb db, CancellationToken ct)
    {
        var s = await db.Settings.FirstOrDefaultAsync(x => x.Key == Key, ct);
        if (s is null) { s = new AppSetting { Key = Key, Value = "[]" }; db.Settings.Add(s); }
        JsonArray list;
        try { list = JsonNode.Parse(string.IsNullOrWhiteSpace(s.Value) ? "[]" : s.Value) as JsonArray ?? new JsonArray(); }
        catch (System.Text.Json.JsonException) { list = new JsonArray(); }
        return (s, list);
    }

    private static string NameOf(JsonNode? n) => n is JsonObject o && o["name"] is JsonValue v && v.TryGetValue<string>(out var s) ? s : "";

    public static void MapRemnantEndpoints(this WebApplication app)
    {
        app.MapGet("/api/remnants", async (GnezdoDb db, CancellationToken ct) =>
        {
            var s = await db.Settings.AsNoTracking().FirstOrDefaultAsync(x => x.Key == Key, ct);
            return Results.Content(string.IsNullOrWhiteSpace(s?.Value) ? "[]" : s.Value, "application/json");
        });

        app.MapPost("/api/remnants", async (RemnantSaveRequest r, GnezdoDb db, TimeProvider clock, HttpContext ctx, CancellationToken ct) =>
        {
            var items = (r.Items ?? new JsonArray()).OfType<JsonObject>().Where(o => NameOf(o).Length > 0).ToList();
            if (items.Count == 0) return Results.ValidationProblem(new Dictionary<string, string[]> { ["items"] = ["No remnants to save."] });
            var (row, list) = await LoadAsync(db, ct);
            var names = items.Select(NameOf).ToHashSet();
            var kept = list.Where(n => !names.Contains(NameOf(n))).Select(n => n!.DeepClone()).ToList();
            var by = ctx.User.Identity?.Name ?? "";
            foreach (var o in items)
            {
                var c = (JsonObject)o.DeepClone();
                c["savedAt"] = clock.GetUtcNow();
                if (by.Length > 0) c["savedBy"] = by;
                kept.Add(c);
            }
            row.Value = new JsonArray(kept.ToArray()).ToJsonString();
            row.ModifiedAt = clock.GetUtcNow();
            row.ModifiedBy = by;
            await db.SaveChangesAsync(ct);
            return Results.Ok(new { saved = items.Count, total = kept.Count });
        });

        app.MapPost("/api/remnants/delete", async (RemnantDeleteRequest r, GnezdoDb db, TimeProvider clock, CancellationToken ct) =>
        {
            var names = (r.Names ?? []).ToHashSet();
            var (row, list) = await LoadAsync(db, ct);
            var kept = list.Where(n => !names.Contains(NameOf(n))).Select(n => n!.DeepClone()).ToList();
            var removed = list.Count - kept.Count;
            row.Value = new JsonArray(kept.ToArray()).ToJsonString();
            row.ModifiedAt = clock.GetUtcNow();
            await db.SaveChangesAsync(ct);
            return Results.Ok(new { removed, total = kept.Count });
        });
    }
}
