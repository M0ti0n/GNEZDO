using System.Text.Json.Nodes;
using Gnezdo.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Gnezdo.Api.Endpoints;

/// <summary>
/// Recovery copies of job tabs with unsaved changes (see <see cref="Draft"/>), each user's own.
/// On start the app offers them back: "Restore unsaved work".
/// </summary>
public static class DraftEndpoints
{
    public record DraftSave(string? Name, int? JobId, int Parts, int Solutions, JsonNode? Content);
    public record DraftRow(string Id, string Name, int? JobId, int Parts, int Solutions, string Browser, DateTimeOffset SavedAt);

    /// <summary>Kept this long when never restored nor discarded.</summary>
    public static readonly TimeSpan KeepFor = TimeSpan.FromDays(30);

    private static string Me(HttpContext ctx) => ctx.User.Identity?.IsAuthenticated == true ? ctx.User.Identity.Name ?? "" : "";

    private static string Fit(string? s, int max) => s is null ? "" : s.Length <= max ? s : s[..max];

    private static bool ValidId(string id) => id.Length is > 0 and <= 40 && id.All(c => char.IsAsciiLetterOrDigit(c) || c == '-');

    public static void MapDraftEndpoints(this WebApplication app)
    {
        app.MapGet("/api/drafts", async (HttpContext ctx, GnezdoDb db, TimeProvider clock, CancellationToken ct) =>
        {
            var me = Me(ctx);
            var old = clock.GetUtcNow() - KeepFor;
            await db.Drafts.Where(d => d.User == me && d.SavedAt < old).ExecuteDeleteAsync(ct);
            var rows = await db.Drafts.AsNoTracking().Where(d => d.User == me)
                .OrderByDescending(d => d.SavedAt)
                .Select(d => new DraftRow(d.Id, d.Name, d.JobId, d.Parts, d.Solutions, d.Browser, d.SavedAt))
                .ToListAsync(ct);
            return Results.Ok(rows);
        });

        app.MapGet("/api/drafts/{id}", async (string id, HttpContext ctx, GnezdoDb db, CancellationToken ct) =>
        {
            var me = Me(ctx);
            var d = await db.Drafts.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id && x.User == me, ct);
            return d is null ? Results.NotFound()
                : Results.Ok(new { d.Id, d.Name, d.JobId, d.Parts, d.Solutions, d.Browser, d.SavedAt, content = JsonNode.Parse(d.Content) });
        });

        app.MapPut("/api/drafts/{id}", async (string id, DraftSave r, HttpContext ctx, GnezdoDb db, TimeProvider clock, CancellationToken ct) =>
        {
            if (!ValidId(id)) return Results.ValidationProblem(new Dictionary<string, string[]> { ["id"] = ["A draft id is letters, digits and dashes (up to 40)."] });
            if (r.Content is null) return Results.ValidationProblem(new Dictionary<string, string[]> { ["content"] = ["Content is required."] });
            var me = Me(ctx);
            var d = await db.Drafts.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (d is not null && d.User != me) return Results.NotFound();   // someone else's
            if (d is null) db.Drafts.Add(d = new Draft { Id = id, User = me });
            d.Name = Fit(r.Name, 200);
            d.JobId = r.JobId;
            d.Parts = r.Parts;
            d.Solutions = r.Solutions;
            d.Browser = Fit(ctx.Request.Headers["X-Gnezdo-Browser"].FirstOrDefault(), 40);
            d.Content = r.Content.ToJsonString();
            d.SavedAt = clock.GetUtcNow();
            await db.SaveChangesAsync(ct);
            return Results.Ok(new { d.Id, d.SavedAt });
        });

        app.MapDelete("/api/drafts/{id}", async (string id, HttpContext ctx, GnezdoDb db, CancellationToken ct) =>
        {
            var me = Me(ctx);
            await db.Drafts.Where(x => x.Id == id && x.User == me).ExecuteDeleteAsync(ct);
            return Results.NoContent();
        });
    }
}
