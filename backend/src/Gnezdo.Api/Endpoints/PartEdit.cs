using Gnezdo.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Gnezdo.Api.Endpoints;

/// <summary>A part with everything its Properties window shows.</summary>
public record PartDetailDto(PartDto Part, IReadOnlyList<int> Rotations, bool Mirror, string SourceFile);

/// <summary>Changed properties of a saved part (geometry stays as it is).</summary>
public record PartUpdateRequest(
    string Name, string? Project, string? Description, string Material, decimal ThicknessMm,
    IReadOnlyList<int>? Rotations, bool Mirror);

public record ProjectCreateRequest(string Code, string? Name, string? Customer);

public static class PartQueries
{
    /// <summary>Parts that are not deleted.</summary>
    public static IQueryable<Part> Live(this IQueryable<Part> parts) => parts.Where(p => p.DeletedAt == null);
}

public static class PartEdit
{
    /// <summary>GET /api/parts/{id}</summary>
    public static async Task<IResult> GetAsync(int id, GnezdoDb db, CancellationToken ct)
    {
        var row = await db.Parts.AsNoTracking().Live().Where(p => p.Id == id)
            .Select(p => new { Dto = new PartDto(
                p.Id.ToString(), p.Name, p.Project != null ? p.Project.Code : "", p.Material.Name, p.ThicknessMm, p.Qty,
                p.WidthMm, p.HeightMm, p.AreaMm2, p.OutlinePath, p.Description, p.Engraved,
                p.ImportBatchId.ToString(), p.ImportBatch.ImportedAt, p.CreatedAt, p.ModifiedAt, p.Revision),
                p.Rotations, p.Mirror, p.SourceFile })
            .FirstOrDefaultAsync(ct);
        return row is null ? Results.NotFound()
            : Results.Ok(new PartDetailDto(row.Dto, PartSave.RotationList(row.Rotations), row.Mirror, row.SourceFile));
    }

    /// <summary>
    /// PUT /api/parts/{id}: changes the properties. The version before the change is kept in the
    /// history, so a wrong change can be undone with Restore.
    /// </summary>
    public static async Task<IResult> UpdateAsync(int id, PartUpdateRequest r, GnezdoDb db, TimeProvider clock, CancellationToken ct)
    {
        var part = await db.Parts.Live().Include(p => p.Material).Include(p => p.Project).FirstOrDefaultAsync(p => p.Id == id, ct);
        if (part is null) return Results.NotFound();

        var errors = new Dictionary<string, string[]>();
        var name = r.Name?.Trim() ?? "";
        if (name.Length == 0) errors["name"] = ["Name is required."];
        if (string.IsNullOrWhiteSpace(r.Material)) errors["material"] = ["Material is required."];
        if (r.ThicknessMm <= 0) errors["thicknessMm"] = ["Thickness must be more than 0."];
        if (r.Rotations?.Any(x => !PartSave.AllowedRotations.Contains(x)) == true) errors["rotations"] = ["Rotations can be 90, 45, 30 or 5."];
        Project? project = null;
        if (!string.IsNullOrWhiteSpace(r.Project))
        {
            var code = r.Project.Trim();
            project = await db.Projects.FirstOrDefaultAsync(p => p.Code == code, ct);
            if (project is null) errors["project"] = [$"Project {code} is not in the database. Save the project first."];
        }
        if (errors.Count > 0) return Results.ValidationProblem(errors);

        // the same project and name may be used by one part only
        int? projectId = project?.Id;
        var clash = await db.Parts.Live().AnyAsync(p => p.Id != id && p.Name == name && p.ProjectId == projectId, ct);
        if (clash)
            return Results.Conflict(new { message = $"Another part is already called {name} in {(project?.Code ?? "no project")}." });

        var now = clock.GetUtcNow();
        await PartSave.KeepVersionAsync(db, part, now, ct);
        var material = r.Material.Trim();
        part.Name = name;
        part.Project = project;
        part.Description = r.Description?.Trim() ?? "";
        part.Material = await db.Materials.FirstOrDefaultAsync(m => m.Name == material, ct) ?? db.Materials.Add(new Material { Name = material }).Entity;
        part.ThicknessMm = r.ThicknessMm;
        part.Rotations = string.Join(",", (r.Rotations ?? []).Distinct().OrderDescending());
        part.Mirror = r.Mirror;
        part.ModifiedAt = now;
        await db.SaveChangesAsync(ct);
        return await GetAsync(id, db, ct);
    }

    /// <summary>
    /// DELETE /api/parts/{id}: the part disappears from searches and lists, but stays in the database
    /// (with its history), so jobs that use it keep working and it can be brought back.
    /// </summary>
    public static async Task<IResult> DeleteAsync(int id, GnezdoDb db, TimeProvider clock, CancellationToken ct)
    {
        var part = await db.Parts.Live().FirstOrDefaultAsync(p => p.Id == id, ct);
        if (part is null) return Results.NotFound();
        part.DeletedAt = clock.GetUtcNow();
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    /// <summary>POST /api/projects: saves a new project (code, optional name and customer).</summary>
    public static async Task<IResult> CreateProjectAsync(ProjectCreateRequest r, GnezdoDb db, TimeProvider clock, CancellationToken ct)
    {
        var code = r.Code?.Trim() ?? "";
        if (code.Length == 0 || code.Length > 60)
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["code"] = ["Project code is required (up to 60 characters)."] });
        if (await db.Projects.AnyAsync(p => p.Code == code, ct))
            return Results.Conflict(new { message = $"Project {code} is already in the database." });
        var p = db.Projects.Add(new Project
        {
            Code = code, Name = r.Name?.Trim() ?? "", Customer = string.IsNullOrWhiteSpace(r.Customer) ? null : r.Customer.Trim(),
            CreatedAt = clock.GetUtcNow(),
        }).Entity;
        await db.SaveChangesAsync(ct);
        return Results.Created($"/api/projects/{p.Id}", new ProjectOptionDto(p.Code, p.Name, p.Customer));
    }
}
