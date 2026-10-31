using System.Text.Json;
using System.Text.Json.Nodes;
using Gnezdo.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Gnezdo.Api.Endpoints;

/// <summary>One part of a job to save.</summary>
public record JobPartSave(string PartId, int Qty, int? QtyMax, int? No);

/// <summary>
/// A job as the job tab saves it (Work parts SAVE): name, parts with quantities, the stock sheets
/// and the saved nest solution (both as the tab keeps them; null nest = not nested).
/// </summary>
public record JobSaveRequest(string Name, IReadOnlyList<JobPartSave> Parts, JsonArray? Stock, JsonObject? Nest, string? ModifiedBy);

public record JobSavedDto(string Id, string Name, string Status, int SheetCount, DateTimeOffset ModifiedAt);

/// <summary>A saved job with its stock sheets and saved nest (the parts come from GET /api/jobs/{id}/parts).</summary>
public record JobDetailDto(string Id, string Name, string Status, int SheetCount, DateTimeOffset CreatedAt, DateTimeOffset ModifiedAt,
    string ModifiedBy, JsonNode? Stock, JsonNode? Nest, DateTimeOffset? NestedAt);

public static class JobSave
{
    public static void MapJobEndpoints(this WebApplication app)
    {
        app.MapGet("/api/jobs/{id:int}", GetAsync);
        app.MapPost("/api/jobs", (JobSaveRequest r, GnezdoDb db, TimeProvider clock, CancellationToken ct) => SaveAsync(null, r, db, clock, ct));
        app.MapPut("/api/jobs/{id:int}", (int id, JobSaveRequest r, GnezdoDb db, TimeProvider clock, CancellationToken ct) => SaveAsync(id, r, db, clock, ct));
    }

    private static JsonNode? Parse(string json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try { return JsonNode.Parse(json); } catch (JsonException) { return null; }
    }

    /// <summary>GET /api/jobs/{id}</summary>
    public static async Task<IResult> GetAsync(int id, GnezdoDb db, CancellationToken ct)
    {
        var j = await db.Jobs.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        return j is null ? Results.NotFound() : Results.Ok(new JobDetailDto(
            j.Id.ToString(), j.Name, j.Status.ToString().ToLowerInvariant(), j.SheetCount, j.CreatedAt, j.ModifiedAt,
            j.ModifiedBy, Parse(j.Stock), Parse(j.Nest), j.NestedAt));
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
            job.Name = name;
            db.JobParts.RemoveRange(job.Parts);
            job.Parts.Clear();
        }
        var n = 0;
        foreach (var (p, pid) in parts.Zip(ids))
        {
            n++;
            job.Parts.Add(new JobPart { PartId = pid, Qty = p.Qty, QtyMax = Math.Max(p.Qty, p.QtyMax ?? p.Qty), No = p.No is > 0 ? p.No.Value : n });
        }
        job.Stock = r.Stock?.ToJsonString() ?? "";
        var sheets = r.Nest?["sheets"] is JsonArray a ? a.Count : 0;
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
        var dto = new JobSavedDto(job.Id.ToString(), job.Name, job.Status.ToString().ToLowerInvariant(), job.SheetCount, job.ModifiedAt);
        return id is null ? Results.Created($"/api/jobs/{job.Id}", dto) : Results.Ok(dto);
    }
}
