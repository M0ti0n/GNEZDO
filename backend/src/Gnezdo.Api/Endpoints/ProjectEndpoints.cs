using Gnezdo.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Gnezdo.Api.Endpoints;

/// <summary>A project as Settings -> Projects and parts lists it.</summary>
public record ProjectRowDto(string Code, string Name, string? Customer, DateTimeOffset CreatedAt, int PartCount, int JobCount);

/// <summary>A job a part is used in.</summary>
public record JobRefDto(string Id, string Name);

/// <summary>A part of a project with the jobs it is used in.</summary>
public record ProjectPartDto(PartDto Part, IReadOnlyList<JobRefDto> Jobs);

// Settings -> Projects and parts: every project with its parts. A project cannot be renamed; it can be
// deleted only when no part is in it (parts move to another project in their Part properties).
public static class ProjectEndpoints
{
    public static void MapProjectEndpoints(this WebApplication app)
    {
        app.MapGet("/api/projects/browse", BrowseAsync);
        app.MapGet("/api/projects/parts", PartsAsync);
        app.MapDelete("/api/projects", DeleteAsync);
    }

    /// <summary>GET /api/projects/browse?part=: every project (with part: the ones with a part whose name has that text).</summary>
    public static async Task<List<ProjectRowDto>> BrowseAsync(string? part, GnezdoDb db, CancellationToken ct)
    {
        var projects = db.Projects.AsNoTracking();
        var text = part?.Trim();
        if (!string.IsNullOrEmpty(text))
        {
            var pat = TextSearch.Pattern(db, text);
            projects = projects.Where(p => p.Parts.Any(x => x.DeletedAt == null && EF.Functions.Like(x.Name, pat, TextSearch.Escape)));
        }
        var rows = await projects
            .Select(p => new { p.Id, p.Code, p.Name, p.Customer, p.CreatedAt, Parts = p.Parts.Count(x => x.DeletedAt == null) })
            .ToListAsync(ct);
        var ids = rows.Select(r => r.Id).ToList();
        var jobs = await db.JobParts.AsNoTracking()
            .Where(jp => jp.Part.ProjectId != null && ids.Contains(jp.Part.ProjectId!.Value))
            .Select(jp => new { ProjectId = jp.Part.ProjectId!.Value, jp.JobId })
            .Distinct()
            .ToListAsync(ct);
        var jobCount = jobs.GroupBy(j => j.ProjectId).ToDictionary(g => g.Key, g => g.Count());
        return rows
            .Select(r => new ProjectRowDto(r.Code, r.Name, r.Customer, r.CreatedAt, r.Parts, jobCount.GetValueOrDefault(r.Id)))
            .OrderByDescending(r => r.CreatedAt).ThenBy(r => r.Code)
            .ToList();
    }

    /// <summary>GET /api/projects/parts?code=: the project's parts, each with the jobs it is used in.</summary>
    public static async Task<IResult> PartsAsync(string? code, GnezdoDb db, CancellationToken ct)
    {
        var c = code?.Trim() ?? "";
        var project = await db.Projects.AsNoTracking().FirstOrDefaultAsync(p => p.Code == c, ct);
        if (project is null) return Results.NotFound(new { message = $"There is no project {c}." });
        var parts = await db.Parts.AsNoTracking().Live().Where(p => p.ProjectId == project.Id)
            .OrderBy(p => p.Name)
            .Select(p => new PartDto(
                p.Id.ToString(), p.Name, project.Code, p.Material.Name, p.ThicknessMm, p.Qty,
                p.WidthMm, p.HeightMm, p.AreaMm2, p.OutlinePath, p.Description, p.Engraved,
                p.ImportBatchId.ToString(), p.ImportBatch.ImportedAt, p.CreatedAt, p.ModifiedAt, p.Revision))
            .ToListAsync(ct);
        var ids = parts.Select(p => int.Parse(p.Id)).ToList();
        var used = await db.JobParts.AsNoTracking().Where(jp => ids.Contains(jp.PartId))
            .Select(jp => new { jp.PartId, jp.JobId, jp.Job.Name, jp.Job.ModifiedAt })
            .ToListAsync(ct);
        var byPart = used.ToLookup(u => u.PartId);
        return Results.Ok(parts.Select(p => new ProjectPartDto(p,
            byPart[int.Parse(p.Id)].OrderByDescending(u => u.ModifiedAt).Select(u => new JobRefDto(u.JobId.ToString(), u.Name)).ToList())).ToList());
    }

    /// <summary>DELETE /api/projects?code=: only a project without parts (409 otherwise).</summary>
    public static async Task<IResult> DeleteAsync(string? code, GnezdoDb db, CancellationToken ct)
    {
        var c = code?.Trim() ?? "";
        var project = await db.Projects.FirstOrDefaultAsync(p => p.Code == c, ct);
        if (project is null) return Results.NotFound(new { message = $"There is no project {c}." });
        var live = await db.Parts.Live().CountAsync(p => p.ProjectId == project.Id, ct);
        if (live > 0)
            return Results.Conflict(new { message = $"Project {c} still has {live} {(live == 1 ? "part" : "parts")}: move them to another project or delete them first." });
        // deleted parts (kept for the jobs that use them) and imports keep their place without it
        await db.Parts.Where(p => p.ProjectId == project.Id).ExecuteUpdateAsync(s => s.SetProperty(p => p.ProjectId, (int?)null), ct);
        await db.ImportBatches.Where(b => b.ProjectId == project.Id).ExecuteUpdateAsync(s => s.SetProperty(b => b.ProjectId, (int?)null), ct);
        db.Projects.Remove(project);
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }
}
