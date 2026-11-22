using System.Text.Json;
using System.Text.Json.Nodes;
using Gnezdo.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Gnezdo.Api.Endpoints;

/// <summary>One part of a job to save.</summary>
/// <summary>Material / ThicknessMm: in this job only (null or missing = the part's own).</summary>
public record JobPartSave(string PartId, int Qty, int? QtyMax, int? No, string? Material = null, decimal? ThicknessMm = null);

/// <summary>
/// A job as the job tab saves it (Work parts SAVE / SAVE AS): name, parts with quantities, the stock
/// sheets and its nesting, as the tab keeps them: { selected, solutions: [{ id, ..., result: { sheets } }] }
/// (null = not nested). The solution chosen for Process is picked there later.
/// </summary>
/// <param name="BaseModifiedAt">When the job was last saved as this client knows it (opened or saved by it): a
/// save over a job saved since by someone else is refused (409) unless <paramref name="Force"/>.</param>
public record JobSaveRequest(string Name, IReadOnlyList<JobPartSave> Parts, JsonArray? Stock, JsonObject? Nest, string? ModifiedBy, string? Machine = null,
    DateTimeOffset? BaseModifiedAt = null, bool Force = false);

/// <summary>JobFile: the job's file in the machine's job folder (when the machine writes one); JobFileError: why it was not written (the job is saved anyway).</summary>
public record JobSavedDto(string Id, string Name, string Status, int SheetCount, DateTimeOffset ModifiedAt, string? JobFile = null, string? JobFileError = null);

/// <summary>A saved job with its stock sheets and saved nest (the parts come from GET /api/jobs/{id}/parts).</summary>
public record JobDetailDto(string Id, string Name, string Status, int SheetCount, DateTimeOffset CreatedAt, DateTimeOffset ModifiedAt,
    string ModifiedBy, JsonNode? Stock, JsonNode? Nest, DateTimeOffset? NestedAt, string Machine = "");

public static class JobSave
{
    public static void MapJobEndpoints(this WebApplication app)
    {
        app.MapGet("/api/jobs/{id:int}", GetAsync);
        // signed in: the job is modified by who it really is
        // a new job is open in the tab that saved it
        app.MapPost("/api/jobs", async (JobSaveRequest r, HttpContext ctx, GnezdoDb db, TimeProvider clock, JobLocks locks, CancellationToken ct) =>
        {
            var res = await SaveAsync(null, r with { ModifiedBy = ctx.User.Identity?.Name ?? r.ModifiedBy }, db, clock, ct);
            if (res is IValueHttpResult { Value: JobSavedDto saved } && int.TryParse(saved.Id, out var nid) && JobLocks.PageOf(ctx) is { Length: > 0 } page)
                locks.TryTake(nid, page, JobLocks.UserOf(ctx), out _);
            return res;
        });
        // not over a job open somewhere else; saves of one job one at a time, so "saved by someone else since"
        // is decided on what is really there (eight saves at once with one version: one went in, not six)
        app.MapPut("/api/jobs/{id:int}", async (int id, JobSaveRequest r, HttpContext ctx, GnezdoDb db, TimeProvider clock, JobLocks locks, CancellationToken ct) =>
        {
            if (locks.Other(id, JobLocks.PageOf(ctx)) is { } other)
                return JobLocks.Refused(await NameOf(db, id, ct), other, "not saved. Close it there first, or save it as a new job (SAVE AS).");
            var gate = Saving.GetOrAdd(id, _ => new SemaphoreSlim(1, 1));
            await gate.WaitAsync(ct);
            try { return await SaveAsync(id, r with { ModifiedBy = ctx.User.Identity?.Name ?? r.ModifiedBy }, db, clock, ct); }
            finally { gate.Release(); }
        });

        // open in one tab at a time (JobLocks)
        app.MapPost("/api/jobs/{id:int}/open", async (int id, HttpContext ctx, GnezdoDb db, JobLocks locks, CancellationToken ct) =>
        {
            if (JobLocks.PageOf(ctx) is not { Length: > 0 } page) return Results.BadRequest(new { message = "No page id (X-Gnezdo-Page)." });
            if (!await db.Jobs.AnyAsync(j => j.Id == id, ct)) return Results.NotFound();
            return locks.TryTake(id, page, JobLocks.UserOf(ctx), out var other)
                ? Results.Ok(new { open = true })
                : JobLocks.Refused(await NameOf(db, id, ct), other!, "close it there first.");
        });
        app.MapPost("/api/jobs/{id:int}/keep", async (int id, HttpContext ctx, GnezdoDb db, JobLocks locks, CancellationToken ct) =>
        {
            if (JobLocks.PageOf(ctx) is not { Length: > 0 } page) return Results.BadRequest(new { message = "No page id (X-Gnezdo-Page)." });
            if (locks.Keep(id, page, JobLocks.UserOf(ctx))) return Results.Ok(new { open = true });
            return locks.Other(id, page) is { } other
                ? JobLocks.Refused(await NameOf(db, id, ct), other, "it was opened there while this computer was away.")
                : Results.Ok(new { open = true });
        });
        // also from navigator.sendBeacon when the page closes (no headers: ?page=)
        app.MapPost("/api/jobs/{id:int}/close", (int id, HttpContext ctx, JobLocks locks) =>
        {
            if (JobLocks.PageOf(ctx) is { Length: > 0 } page) locks.Release(id, page);
            return Results.NoContent();
        });
    }

    private static readonly System.Collections.Concurrent.ConcurrentDictionary<int, SemaphoreSlim> Saving = new();

    private static async Task<string> NameOf(GnezdoDb db, int id, CancellationToken ct) =>
        await db.Jobs.Where(j => j.Id == id).Select(j => j.Name).FirstOrDefaultAsync(ct) ?? $"Job {id}";

    private static JsonNode? Parse(string json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try { return JsonNode.Parse(json); } catch (JsonException) { return null; }
    }

    /// <summary>Sheets of the solution shown (else the last one); also { sheets } or { result: { sheets } }.</summary>
    private static int SheetCount(JsonObject? nest)
    {
        if (nest is null) return 0;
        if (nest["sheets"] is JsonArray direct) return direct.Count;
        if (nest["result"]?["sheets"] is JsonArray single) return single.Count;
        if (nest["solutions"] is not JsonArray { Count: > 0 } all) return 0;
        var selected = nest["selected"]?.GetValueKind() == JsonValueKind.String ? nest["selected"]!.GetValue<string>() : null;
        var shown = all.FirstOrDefault(s => s?["id"]?.GetValueKind() == JsonValueKind.String && s["id"]!.GetValue<string>() == selected) ?? all[^1];
        return shown?["result"]?["sheets"] is JsonArray a ? a.Count : 0;
    }

    /// <summary>GET /api/jobs/{id}</summary>
    public static async Task<IResult> GetAsync(int id, GnezdoDb db, CancellationToken ct)
    {
        var j = await db.Jobs.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        return j is null ? Results.NotFound() : Results.Ok(new JobDetailDto(
            j.Id.ToString(), j.Name, j.Status.ToString().ToLowerInvariant(), j.SheetCount, j.CreatedAt, j.ModifiedAt,
            j.ModifiedBy, Parse(j.Stock), Parse(j.Nest), j.NestedAt, j.Machine));
    }

    /// <summary>POST /api/jobs (new) and PUT /api/jobs/{id}: the whole job; its parts are replaced.</summary>
    public static async Task<IResult> SaveAsync(int? id, JobSaveRequest r, GnezdoDb db, TimeProvider clock, CancellationToken ct)
    {
        var errors = new Dictionary<string, string[]>();
        var name = r.Name?.Trim() ?? "";
        if (name.Length == 0) errors["name"] = ["Name is required."];
        else if (name.Length > 200) errors["name"] = ["Name is longer than 200 characters."];
        var parts = r.Parts ?? [];
        var ids = new List<int>();
        foreach (var p in parts)
        {
            if (!int.TryParse(p.PartId, out var pid)) { errors["parts"] = [$"Part {p.PartId} is not a saved part."]; break; }
            ids.Add(pid);
        }
        if (ids.Count != ids.Distinct().Count()) errors["parts"] = ["A part is in the list twice."];
        if (parts.Any(p => p.Qty < 0)) errors["qty"] = ["Qty req cannot be negative."];
        if (parts.Any(p => p.ThicknessMm is <= 0 or > 1000)) errors["thicknessMm"] = ["Thickness must be between 0 and 1000 mm."];
        if (parts.Any(p => p.Material is { Length: > 100 })) errors["material"] = ["Material is longer than 100 characters."];
        if (errors.Count > 0) return Results.ValidationProblem(errors);

        // deleted parts are allowed: a job keeps the parts it was made with
        var known = await db.Parts.Where(p => ids.Contains(p.Id)).Select(p => p.Id).ToListAsync(ct);
        var missing = ids.Except(known).ToList();
        if (missing.Count > 0) return Results.ValidationProblem(new Dictionary<string, string[]> { ["parts"] = [$"Parts not in the database: {string.Join(", ", missing)}."] });

        Job? job;
        var now = clock.GetUtcNow();
        if (id is null)
        {
            job = new Job { Name = name, CreatedAt = now };
            db.Jobs.Add(job);
        }
        else
        {
            job = await db.Jobs.Include(j => j.Parts).FirstOrDefaultAsync(j => j.Id == id, ct);
            if (job is null) return Results.NotFound();
            // a save must say which version of the job it changes (an older client or a script overwrote anything)
            if (!r.Force && r.BaseModifiedAt is null)
                return Results.Json(new
                {
                    message = $"Not saved: this save does not say which version of {job.Name} it changes. Open the job again, or save it as a new job.",
                    conflict = true,
                }, statusCode: StatusCodes.Status428PreconditionRequired);
            // saved by someone else since this client opened or saved it: not over their save without asking
            // (1 ms: a database may keep the time to the microsecond, the browser to the millisecond)
            if (!r.Force && r.BaseModifiedAt is { } seen && Math.Abs((job.ModifiedAt - seen).TotalMilliseconds) > 1)
                return Results.Json(new
                {
                    message = $"{job.Name} was saved by {(job.ModifiedBy is { Length: > 0 } who ? who : "someone else")} since you opened it.",
                    modifiedBy = job.ModifiedBy, modifiedAt = job.ModifiedAt, conflict = true,
                }, statusCode: StatusCodes.Status409Conflict);
            job.Name = name;
            db.JobParts.RemoveRange(job.Parts);
            job.Parts.Clear();
        }
        var n = 0;
        foreach (var (p, pid) in parts.Zip(ids))
        {
            n++;
            job.Parts.Add(new JobPart
            {
                PartId = pid, Qty = p.Qty, QtyMax = Math.Max(p.Qty, p.QtyMax ?? p.Qty), No = p.No is > 0 ? p.No.Value : n,
                Material = string.IsNullOrWhiteSpace(p.Material) ? null : p.Material.Trim(),
                ThicknessMm = p.ThicknessMm,
            });
        }
        job.Stock = r.Stock?.ToJsonString() ?? "";
        if (r.Machine is not null) job.Machine = r.Machine.Trim() is var m && m.Length > 50 ? m[..50] : r.Machine.Trim();
        var sheets = SheetCount(r.Nest);
        if (r.Nest is not null && sheets > 0)
        {
            if (job.Nest != r.Nest.ToJsonString()) job.NestedAt = now;
            job.Nest = r.Nest.ToJsonString();
            job.SheetCount = sheets;
            if (job.Status == JobStatus.Draft) job.Status = JobStatus.Nested;
        }
        else
        {
            job.Nest = "";
            job.NestedAt = null;
            job.SheetCount = 0;
            if (job.Status == JobStatus.Nested) job.Status = JobStatus.Draft;
        }
        job.ModifiedAt = now;
        job.ModifiedBy = (r.ModifiedBy ?? "").Trim() is { Length: > 0 } by ? by[..Math.Min(by.Length, 100)] : job.ModifiedBy;
        await db.SaveChangesAsync(ct);
        var (file, fileError) = await MachineFolders.WriteJobFileAsync(db, job, ct);
        var dto = new JobSavedDto(job.Id.ToString(), job.Name, job.Status.ToString().ToLowerInvariant(), job.SheetCount, job.ModifiedAt, file, fileError);
        return id is null ? Results.Created($"/api/jobs/{job.Id}", dto) : Results.Ok(dto);
    }
}
