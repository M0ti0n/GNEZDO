using Gnezdo.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Gnezdo.Api.Endpoints;

/// <summary>A part is the same part when it has the same project (or both none) and the same name.</summary>
public record PartKey(string Name, string? Project);

public record ExistingPartDto(string Name, string Project, string Id, DateTimeOffset ModifiedAt);

/// <summary>A processed part from the import screen.</summary>
public record SavePartRequest(
    string Name, string? Project, string? Description, string Material, decimal ThicknessMm,
    IReadOnlyList<int>? Rotations, bool Mirror,
    double WidthMm, double HeightMm, double AreaMm2, string OutlinePath, bool Engraved,
    string Geometry, string? SourceFile,
    // Replace: true replaces a part with the same project and name; false leaves it and reports "exists".
    bool Replace);

public record SavePartsRequest(IReadOnlyList<SavePartRequest> Parts, string? Source, string? ImportedBy);

/// <summary>Status per part: created, replaced or exists (not saved).</summary>
public record SavedPartDto(string Name, string Project, string? Id, string Status);

public static class PartSave
{
    private static readonly int[] AllowedRotations = [90, 45, 30, 5];

    /// <summary>POST /api/parts/existing: which of these parts are already in the database.</summary>
    public static async Task<IResult> ExistingAsync(IReadOnlyList<PartKey> keys, GnezdoDb db, CancellationToken ct)
    {
        var names = keys.Select(k => k.Name.Trim()).Distinct().ToList();
        var candidates = await db.Parts.AsNoTracking()
            .Where(p => names.Contains(p.Name))
            .Select(p => new { p.Id, p.Name, Project = p.Project != null ? p.Project.Code : "", p.ModifiedAt })
            .ToListAsync(ct);
        var found = keys
            .SelectMany(k => candidates.Where(c => Same(c.Name, k.Name) && Same(c.Project, k.Project)))
            .DistinctBy(c => c.Id)
            .Select(c => new ExistingPartDto(c.Name, c.Project, c.Id.ToString(), c.ModifiedAt))
            .ToList();
        return Results.Ok(found);
    }

    /// <summary>POST /api/parts: saves processed parts to the library, in one import batch.</summary>
    public static async Task<IResult> SaveAsync(SavePartsRequest req, GnezdoDb db, TimeProvider clock, CancellationToken ct)
    {
        var errors = new Dictionary<string, string[]>();
        for (var i = 0; i < req.Parts.Count; i++)
        {
            var p = req.Parts[i];
            var e = new List<string>();
            if (string.IsNullOrWhiteSpace(p.Name)) e.Add("Name is required.");
            if (string.IsNullOrWhiteSpace(p.Material)) e.Add("Material is required.");
            if (p.ThicknessMm <= 0) e.Add("Thickness must be more than 0.");
            if (p.Rotations?.Any(r => !AllowedRotations.Contains(r)) == true) e.Add("Rotations can be 90, 45, 30 or 5.");
            if (string.IsNullOrWhiteSpace(p.Geometry)) e.Add("Geometry is required.");
            if (e.Count > 0) errors[$"parts[{i}]"] = [.. e];
        }
        if (req.Parts.Count == 0) errors["parts"] = ["Nothing to save."];
        if (errors.Count > 0) return Results.ValidationProblem(errors);

        var now = clock.GetUtcNow();
        var materials = new Dictionary<string, Material>(StringComparer.OrdinalIgnoreCase);
        var projects = new Dictionary<string, Project>(StringComparer.OrdinalIgnoreCase);

        async Task<Material> MaterialAsync(string name)
        {
            name = name.Trim();
            if (materials.TryGetValue(name, out var m)) return m;
            m = await db.Materials.FirstOrDefaultAsync(x => x.Name == name, ct) ?? db.Materials.Add(new Material { Name = name }).Entity;
            return materials[name] = m;
        }
        async Task<Project?> ProjectAsync(string? code)
        {
            if (string.IsNullOrWhiteSpace(code)) return null;
            code = code.Trim();
            if (projects.TryGetValue(code, out var p)) return p;
            p = await db.Projects.FirstOrDefaultAsync(x => x.Code == code, ct)
                ?? db.Projects.Add(new Project { Code = code, CreatedAt = now }).Entity;
            return projects[code] = p;
        }

        var firstProject = await ProjectAsync(req.Parts.Select(p => p.Project).FirstOrDefault(p => !string.IsNullOrWhiteSpace(p)));
        var batch = db.ImportBatches.Add(new ImportBatch
        {
            Source = string.IsNullOrWhiteSpace(req.Source) ? "Import" : req.Source.Trim(),
            Project = firstProject,
            ImportedAt = now,
            ImportedBy = req.ImportedBy?.Trim() ?? "",
        }).Entity;

        var results = new List<(SavePartRequest Req, Part? Part, string Status)>();
        foreach (var r in req.Parts)
        {
            var name = r.Name.Trim();
            var project = await ProjectAsync(r.Project);
            var existing = project is null
                ? await db.Parts.FirstOrDefaultAsync(p => p.Name == name && p.ProjectId == null, ct)
                : project.Id == 0 ? null
                : await db.Parts.FirstOrDefaultAsync(p => p.Name == name && p.ProjectId == project.Id, ct);
            existing ??= db.Parts.Local.FirstOrDefault(p => p.Name == name && p.Project == project && p.Id == 0);

            if (existing is not null && !r.Replace) { results.Add((r, existing, "exists")); continue; }

            var part = existing ?? db.Parts.Add(new Part { Name = name, CreatedAt = now, ImportBatch = batch }).Entity;
            part.Project = project;
            part.Description = r.Description?.Trim() ?? "";
            part.Material = await MaterialAsync(r.Material);
            part.ThicknessMm = r.ThicknessMm;
            part.WidthMm = r.WidthMm;
            part.HeightMm = r.HeightMm;
            part.AreaMm2 = r.AreaMm2;
            part.OutlinePath = r.OutlinePath;
            part.Engraved = r.Engraved;
            part.Geometry = r.Geometry;
            part.Rotations = string.Join(",", (r.Rotations ?? []).Distinct().OrderDescending());
            part.Mirror = r.Mirror;
            part.SourceFile = r.SourceFile?.Trim() ?? "";
            part.ModifiedAt = now;
            results.Add((r, part, existing is null ? "created" : "replaced"));
        }

        if (!results.Any(x => x.Status != "exists")) db.ImportBatches.Remove(batch);
        await db.SaveChangesAsync(ct);

        return Results.Ok(results.Select(x => new SavedPartDto(
            x.Req.Name.Trim(), x.Req.Project?.Trim() ?? "", x.Part?.Id.ToString(), x.Status)).ToList());
    }

    private static bool Same(string? a, string? b) =>
        string.Equals((a ?? "").Trim(), (b ?? "").Trim(), StringComparison.OrdinalIgnoreCase);
}
