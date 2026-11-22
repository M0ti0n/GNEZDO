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
    /// <summary>Settings shared by everyone, changed by an admin: the machines, special tools, stock and
    /// remnants, import rules and nesting rules. (Personal settings stay in each browser.)</summary>
    public static readonly string[] Keys = ["machines", "specialTools", "stock", "importRules", "nestingRules"];

    /// <param name="Base">The version this change was made on (the ETag the value was read with): when
    /// someone saved the setting since, the save is refused (409) instead of putting back what they changed.
    /// Missing: saved as before (scripts).</param>
    public record SettingSaveRequest(JsonNode? Value, string? ModifiedBy, string? Base = null);

    /// <summary>A setting's version: when it was last saved ("none": never).</summary>
    public static string VersionOf(AppSetting? s) => s is null || string.IsNullOrWhiteSpace(s.Value) ? "none" : $"v{s.ModifiedAt.UtcTicks}";

    private static readonly SemaphoreSlim Saving = new(1, 1);

    public static void MapSettingsEndpoints(this WebApplication app)
    {
        // every shared setting's version: a page checks this now and then (and before Auto cut and Post
        // process) and reads again what changed, instead of keeping what it read when it opened
        app.MapGet("/api/settings/versions", async (GnezdoDb db, CancellationToken ct) =>
        {
            var rows = await db.Settings.AsNoTracking().Where(x => Keys.Contains(x.Key)).ToListAsync(ct);
            return Results.Ok(Keys.ToDictionary(k => k, k => VersionOf(rows.FirstOrDefault(x => x.Key == k))));
        });
        // a setting never saved answers null, so the app uses its defaults; its version in the ETag
        app.MapGet("/api/settings/{key}", async (string key, GnezdoDb db, HttpContext ctx, CancellationToken ct) =>
        {
            if (!Keys.Contains(key)) return Results.NotFound();
            var s = await db.Settings.AsNoTracking().FirstOrDefaultAsync(x => x.Key == key, ct);
            ctx.Response.Headers.ETag = $"\"{VersionOf(s)}\"";
            return Results.Content(string.IsNullOrWhiteSpace(s?.Value) ? "null" : s.Value, "application/json");
        });
        app.MapPut("/api/settings/{key}", async (string key, SettingSaveRequest r, GnezdoDb db, TimeProvider clock, HttpContext ctx, CancellationToken ct) =>
        {
            if (!Keys.Contains(key)) return Results.NotFound();
            // shared by everyone (machines, ...): only an admin changes them
            if (!Gnezdo.Api.Auth.AuthEndpoints.Admin(ctx)) return Results.Json(new { message = "Only an admin can change this setting." }, statusCode: StatusCodes.Status403Forbidden);
            if (r.Value is null) return Results.ValidationProblem(new Dictionary<string, string[]> { ["value"] = ["A value is required."] });
            // one save at a time, so the version compared is the one really there
            await Saving.WaitAsync(ct);
            try
            {
                var s = await db.Settings.FirstOrDefaultAsync(x => x.Key == key, ct);
                // changed by someone since this page read it: not over their change (two admins: the second
                // save put the first one's change back without a word)
                if (r.Base is { Length: > 0 } seen && seen.Trim('"') != VersionOf(s))
                    return Results.Json(new
                    {
                        message = $"{(s?.ModifiedBy is { Length: > 0 } who ? who : "Someone")} changed these settings since you loaded them: your change was not saved.",
                        modifiedBy = s?.ModifiedBy, modifiedAt = s?.ModifiedAt, version = VersionOf(s), conflict = true,
                    }, statusCode: StatusCodes.Status409Conflict);
                if (s is null) { s = new AppSetting { Key = key }; db.Settings.Add(s); }
                s.Value = r.Value.ToJsonString();
                // to the millisecond (every database keeps that much: the version read back is the one given), and a
                // new version every time, even for two saves within one millisecond
                var now = clock.GetUtcNow();
                now = new DateTimeOffset(now.UtcTicks - now.UtcTicks % TimeSpan.TicksPerMillisecond, TimeSpan.Zero);
                s.ModifiedAt = now > s.ModifiedAt ? now : s.ModifiedAt.AddMilliseconds(1);
                s.ModifiedBy = ctx.User.Identity?.Name ?? ((r.ModifiedBy ?? "").Trim() is { Length: > 0 } by ? by[..Math.Min(100, by.Length)] : s.ModifiedBy);
                await db.SaveChangesAsync(ct);
                ctx.Response.Headers.ETag = $"\"{VersionOf(s)}\"";
                return Results.Ok(r.Value);
            }
            finally { Saving.Release(); }
        });
    }
}
