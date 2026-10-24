using Gnezdo.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Gnezdo.Api.Endpoints;

/// <summary>Lists on the home page, the import list of the parts panel, and job search.</summary>
public static class HomeEndpoints
{
    public static void MapHomeEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/imports/recent", (GnezdoDb db, int? take, CancellationToken ct) => ImportsAsync(db, Take(take, 8, 50), ct));
        app.MapGet("/api/imports", (GnezdoDb db, CancellationToken ct) => ImportsAsync(db, 200, ct));
        app.MapGet("/api/jobs/recent", RecentJobsAsync);
        app.MapGet("/api/jobs", SearchJobsAsync);
        app.MapGet("/api/jobs/{id:int}/parts", JobPartsAsync);
        app.MapGet("/api/projects/recent", RecentProjectsAsync);
    }

    private static int Take(int? requested, int fallback, int max) => Math.Clamp(requested ?? fallback, 1, max);

    // ---- imports -----------------------------------------------------------

    private static async Task<List<ImportSummaryDto>> ImportsAsync(GnezdoDb db, int take, CancellationToken ct)
    {
        var batches = await db.ImportBatches.AsNoTracking()
            .OrderByDescending(i => i.ImportedAt)
            .Take(take)
            .Select(i => new
            {
                i.Id, i.Source, Project = i.Project != null ? i.Project.Code : "",
                PartCount = i.Parts.Count, i.ImportedAt, i.ImportedBy, i.Warnings,
            })
            .ToListAsync(ct);

        var ids = batches.Select(b => b.Id).ToList();
        var materials = await db.Parts.AsNoTracking()
            .Where(p => ids.Contains(p.ImportBatchId))
            .Select(p => new { p.ImportBatchId, Material = p.Material.Name, p.ThicknessMm })
            .Distinct()
            .ToListAsync(ct);
        var byBatch = materials.ToLookup(m => m.ImportBatchId);

        return batches.Select(b => new ImportSummaryDto(
            b.Id.ToString(), b.Source, b.Project, b.PartCount,
            byBatch[b.Id].OrderBy(m => m.Material).ThenBy(m => m.ThicknessMm)
                .Select(m => Format.MaterialKey(m.Material, m.ThicknessMm)).ToList(),
            b.ImportedAt, b.ImportedBy, b.Warnings)).ToList();
    }

    // ---- jobs --------------------------------------------------------------

    private static async Task<List<JobSummaryDto>> RecentJobsAsync(GnezdoDb db, int? take, CancellationToken ct)
    {
        var jobs = db.Jobs.AsNoTracking().OrderByDescending(j => j.ModifiedAt).Take(Take(take, 8, 50));
        return await SummariesAsync(db, jobs, ct);
    }

    private static async Task<IResult> SearchJobsAsync(
        GnezdoDb db, string? text, string? status, string? material, int? days, CancellationToken ct)
    {
        IQueryable<Job> jobs = db.Jobs.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(text))
        {
            var t = text.Trim();
            jobs = jobs.Where(j => j.Name.Contains(t));
        }
        if (!string.IsNullOrWhiteSpace(status))
        {
            if (!Enum.TryParse<JobStatus>(status, ignoreCase: true, out var s))
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["status"] = ["Use draft, nested, released or cut."],
                });
            jobs = jobs.Where(j => j.Status == s);
        }
        if (days is > 0)
        {
            var since = DateTimeOffset.UtcNow.AddDays(-days.Value);
            jobs = jobs.Where(j => j.ModifiedAt >= since);
        }

        var list = await SummariesAsync(db, jobs.OrderByDescending(j => j.ModifiedAt).Take(500), ct);
        if (!string.IsNullOrWhiteSpace(material))
            list = list.Where(j => Format.MaterialKey(j.Material, j.ThicknessMm) == material.Trim()).ToList();
        return Results.Ok(list);
    }

    /// <summary>
    /// Job rows with part count and main material (the material/thickness with the most pieces).
    /// </summary>
    private static async Task<List<JobSummaryDto>> SummariesAsync(GnezdoDb db, IQueryable<Job> jobs, CancellationToken ct)
    {
        var rows = await jobs
            .Select(j => new { j.Id, j.Name, j.Status, j.SheetCount, j.ModifiedAt, j.ModifiedBy })
            .ToListAsync(ct);
        var ids = rows.Select(r => r.Id).ToList();
        var lines = await db.JobParts.AsNoTracking()
            .Where(jp => ids.Contains(jp.JobId))
            .Select(jp => new { jp.JobId, jp.Qty, Material = jp.Part.Material.Name, jp.Part.ThicknessMm })
            .ToListAsync(ct);
        var byJob = lines.ToLookup(l => l.JobId);

        return rows.Select(r =>
        {
            var main = byJob[r.Id]
                .GroupBy(l => (l.Material, l.ThicknessMm))
                .OrderByDescending(g => g.Sum(l => l.Qty))
                .Select(g => g.Key)
                .FirstOrDefault(("", 0m));
            return new JobSummaryDto(
                r.Id.ToString(), r.Name, main.Material, main.ThicknessMm,
                byJob[r.Id].Sum(l => l.Qty), r.SheetCount,
                r.Status.ToString().ToLowerInvariant(), r.ModifiedAt, r.ModifiedBy);
        }).ToList();
    }

    private static async Task<IResult> JobPartsAsync(int id, GnezdoDb db, CancellationToken ct)
    {
        if (!await db.Jobs.AnyAsync(j => j.Id == id, ct)) return Results.NotFound();
        var parts = await db.JobParts.AsNoTracking()
            .Where(jp => jp.JobId == id)
            .OrderBy(jp => jp.Part.Name)
            .Select(jp => new { jp.Part, jp.Qty })
            .Select(x => new JobPartDto(
                new PartDto(
                    x.Part.Id.ToString(), x.Part.Name, x.Part.Project != null ? x.Part.Project.Code : "",
                    x.Part.Material.Name, x.Part.ThicknessMm, x.Part.Qty, x.Part.WidthMm, x.Part.HeightMm,
                    x.Part.AreaMm2, x.Part.OutlinePath, x.Part.Description, x.Part.Engraved,
                    x.Part.ImportBatchId.ToString(), x.Part.ImportBatch.ImportedAt, x.Part.CreatedAt, x.Part.ModifiedAt),
                x.Qty))
            .ToListAsync(ct);
        return Results.Ok(parts);
    }

    // ---- projects ----------------------------------------------------------

    /// <summary>
    /// Projects ordered by last activity (newest part change or job change).
    /// Cut progress is 0 until cut sheets are tracked.
    /// </summary>
    private static async Task<List<ProjectSummaryDto>> RecentProjectsAsync(GnezdoDb db, int? take, CancellationToken ct)
    {
        var n = Take(take, 8, 50);

        var partStats = await db.Parts.AsNoTracking()
            .Where(p => p.ProjectId != null)
            .GroupBy(p => p.ProjectId!.Value)
            .Select(g => new { ProjectId = g.Key, Count = g.Count(), Last = g.Max(p => p.ModifiedAt) })
            .ToListAsync(ct);

        var jobLinks = await db.JobParts.AsNoTracking()
            .Where(jp => jp.Part.ProjectId != null)
            .Select(jp => new { ProjectId = jp.Part.ProjectId!.Value, jp.JobId, jp.Job.ModifiedAt })
            .Distinct()
            .ToListAsync(ct);
        var jobsByProject = jobLinks.ToLookup(l => l.ProjectId);

        var projects = await db.Projects.AsNoTracking()
            .Select(p => new { p.Id, p.Code, p.Name, p.Customer, p.CreatedAt })
            .ToListAsync(ct);
        var stats = partStats.ToDictionary(s => s.ProjectId);

        return projects
            .Select(p =>
            {
                var s = stats.GetValueOrDefault(p.Id);
                var jobs = jobsByProject[p.Id].ToList();
                var last = new[] { p.CreatedAt, s?.Last ?? p.CreatedAt }
                    .Concat(jobs.Select(j => j.ModifiedAt)).Max();
                return new ProjectSummaryDto(
                    p.Id.ToString(), p.Code, p.Name, p.Customer, s?.Count ?? 0,
                    jobs.Select(j => j.JobId).Distinct().Count(), 0, last);
            })
            .OrderByDescending(p => p.LastActivityAt)
            .Take(n)
            .ToList();
    }
}
