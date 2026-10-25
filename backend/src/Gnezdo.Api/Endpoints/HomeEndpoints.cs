using Gnezdo.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Gnezdo.Api.Endpoints;

/// <summary>Query string of GET /api/jobs (the Job search panel). Empty fields are ignored.</summary>
public sealed class JobQuery
{
    public string? Name { get; set; }
    public string? Material { get; set; }
    public decimal? ThicknessMm { get; set; }
    /// <summary>Jobs containing parts of a project whose code contains this text.</summary>
    public string? Project { get; set; }
    /// <summary>"on:yyyy-mm-dd", "upTo:yyyy-mm-dd" or "from:yyyy-mm-dd".</summary>
    public string? Created { get; set; }
    public string? Modified { get; set; }
    /// <summary>Jobs that use a part whose name contains this text.</summary>
    public string? Part { get; set; }
    public string? Status { get; set; }
    /// <summary>name, created, modified (default), material, thickness, project.</summary>
    public string? Sort { get; set; }
    /// <summary>asc or desc; dates default to desc, others to asc.</summary>
    public string? Dir { get; set; }
    public int? Take { get; set; }
}

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
        app.MapGet("/api/projects", ProjectOptionsAsync);
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
        [AsParameters] JobQuery q, GnezdoDb db, ShopTime time, CancellationToken ct)
    {
        var errors = new Dictionary<string, string[]>();
        DateFilter? created = null, modified = null;
        if (!string.IsNullOrWhiteSpace(q.Created))
        {
            if (DateFilter.TryParse(q.Created, out var f)) created = f;
            else errors["created"] = ["Use on:yyyy-mm-dd, upTo:yyyy-mm-dd or from:yyyy-mm-dd."];
        }
        if (!string.IsNullOrWhiteSpace(q.Modified))
        {
            if (DateFilter.TryParse(q.Modified, out var f)) modified = f;
            else errors["modified"] = ["Use on:yyyy-mm-dd, upTo:yyyy-mm-dd or from:yyyy-mm-dd."];
        }
        JobStatus? status = null;
        if (!string.IsNullOrWhiteSpace(q.Status))
        {
            if (Enum.TryParse<JobStatus>(q.Status, ignoreCase: true, out var s)) status = s;
            else errors["status"] = ["Use draft, nested, released or cut."];
        }
        if (!Sort.TryParse(q.Sort, q.Dir, out var sort, out var sortError))
            errors[sortError!.StartsWith("dir") ? "dir" : "sort"] = [sortError];
        if (errors.Count > 0) return Results.ValidationProblem(errors);

        IQueryable<Job> jobs = db.Jobs.AsNoTracking();

        var name = Clean(q.Name);
        if (name is not null) jobs = jobs.Where(j => j.Name.Contains(name));

        // Material and thickness must match on the same part of the job.
        var material = Clean(q.Material);
        if (material is not null || q.ThicknessMm is not null)
        {
            var t = q.ThicknessMm;
            jobs = jobs.Where(j => j.Parts.Any(jp =>
                (material == null || jp.Part.Material.Name == material) &&
                (t == null || jp.Part.ThicknessMm == t)));
        }

        // Project: jobs that contain parts of a project whose code contains the text.
        var project = Clean(q.Project);
        if (project is not null)
            jobs = jobs.Where(j => j.Parts.Any(jp => jp.Part.Project != null && jp.Part.Project.Code.Contains(project)));

        // Part name: every job the part is used in.
        var part = Clean(q.Part);
        if (part is not null) jobs = jobs.Where(j => j.Parts.Any(jp => jp.Part.Name.Contains(part)));

        if (created is { } c)
        {
            var (from, to) = c.ToRange(time);
            if (from is { } f) jobs = jobs.Where(j => j.CreatedAt >= f);
            if (to is { } tt) jobs = jobs.Where(j => j.CreatedAt < tt);
        }
        if (modified is { } m)
        {
            var (from, to) = m.ToRange(time);
            if (from is { } f) jobs = jobs.Where(j => j.ModifiedAt >= f);
            if (to is { } tt) jobs = jobs.Where(j => j.ModifiedAt < tt);
        }
        if (status is { } st) jobs = jobs.Where(j => j.Status == st);

        var take = Math.Clamp(q.Take ?? 500, 1, 500);
        return Results.Ok(await SummariesAsync(db, sort.Apply(jobs).Take(take), ct));
    }

    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    /// <summary>
    /// Job rows with part count and main material (the material/thickness with the most pieces).
    /// </summary>
    private static async Task<List<JobSummaryDto>> SummariesAsync(GnezdoDb db, IQueryable<Job> jobs, CancellationToken ct)
    {
        var rows = await jobs
            .Select(j => new { j.Id, j.Name, j.Status, j.SheetCount, j.CreatedAt, j.ModifiedAt, j.ModifiedBy })
            .ToListAsync(ct);
        var ids = rows.Select(r => r.Id).ToList();
        var lines = await db.JobParts.AsNoTracking()
            .Where(jp => ids.Contains(jp.JobId))
            .Select(jp => new
            {
                jp.JobId, jp.Qty, Material = jp.Part.Material.Name, jp.Part.ThicknessMm,
                Project = jp.Part.Project != null ? jp.Part.Project.Code : null,
            })
            .ToListAsync(ct);
        var byJob = lines.ToLookup(l => l.JobId);

        return rows.Select(r =>
        {
            (string Material, decimal ThicknessMm) main = byJob[r.Id]
                .GroupBy(l => (Material: l.Material, ThicknessMm: l.ThicknessMm))
                .OrderByDescending(g => g.Sum(l => l.Qty))
                .Select(g => g.Key)
                .FirstOrDefault((Material: "", ThicknessMm: 0m));
            return new JobSummaryDto(
                r.Id.ToString(), r.Name, main.Material, main.ThicknessMm,
                byJob[r.Id].Sum(l => l.Qty), r.SheetCount,
                r.Status.ToString().ToLowerInvariant(), r.CreatedAt, r.ModifiedAt, r.ModifiedBy,
                byJob[r.Id].Select(l => l.Project).OfType<string>().Distinct().Order(StringComparer.OrdinalIgnoreCase).ToList(),
                byJob[r.Id].Select(l => l.Material).Distinct().Order(StringComparer.OrdinalIgnoreCase).ToList(),
                byJob[r.Id].Select(l => l.ThicknessMm).Distinct().Order().ToList());
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

    /// <summary>GET /api/projects: every project code for pick lists, newest first.</summary>
    private static async Task<List<ProjectOptionDto>> ProjectOptionsAsync(GnezdoDb db, CancellationToken ct) =>
        await db.Projects.AsNoTracking()
            .OrderByDescending(p => p.CreatedAt).ThenByDescending(p => p.Code)
            .Select(p => new ProjectOptionDto(p.Code, p.Name, p.Customer))
            .ToListAsync(ct);

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
