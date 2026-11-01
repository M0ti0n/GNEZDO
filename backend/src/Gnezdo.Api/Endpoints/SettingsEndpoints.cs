using System.Text.Json.Nodes;
using Gnezdo.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Gnezdo.Api.Endpoints;

/// <summary>
/// Settings shared by everyone, stored on the server as JSON under a known key. The app owns the
/// shape of each value; the server keeps it as it comes.
/// </summary>
public static class SettingsEndpoints
{
    /// <summary>Keys that may be stored (more come as settings move to the server).</summary>
    public static readonly string[] Keys = ["machines"];

    public record SettingSaveRequest(JsonNode? Value, string? ModifiedBy);

    public static void MapSettingsEndpoints(this WebApplication app)
    {
        // a setting never saved answers null, so the app uses its defaults
        app.MapGet("/api/settings/{key}", async (string key, GnezdoDb db, CancellationToken ct) =>
        {
            if (!Keys.Contains(key)) return Results.NotFound();
            var s = await db.Settings.AsNoTracking().FirstOrDefaultAsync(x => x.Key == key, ct);
            return Results.Content(string.IsNullOrWhiteSpace(s?.Value) ? "null" : s.Value, "application/json");
        });
        app.MapPut("/api/settings/{key}", async (string key, SettingSaveRequest r, GnezdoDb db, TimeProvider clock, CancellationToken ct) =>
        {
            if (!Keys.Contains(key)) return Results.NotFound();
            if (r.Value is null) return Results.ValidationProblem(new Dictionary<string, string[]> { ["value"] = ["A value is required."] });
            var s = await db.Settings.FirstOrDefaultAsync(x => x.Key == key, ct);
            if (s is null) { s = new AppSetting { Key = key }; db.Settings.Add(s); }
            s.Value = r.Value.ToJsonString();
            s.ModifiedAt = clock.GetUtcNow();
            s.ModifiedBy = (r.ModifiedBy ?? "").Trim() is { Length: > 0 } by ? by[..Math.Min(100, by.Length)] : s.ModifiedBy;
            await db.SaveChangesAsync(ct);
            return Results.Ok(r.Value);
        });
    }
}
