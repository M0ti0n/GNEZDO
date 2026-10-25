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

/// <summary>One version of a part; Current is the one in use, the others can be restored.</summary>
public record PartVersionDto(
    int Revision, bool Current, string Name, string Project, string Description, string Material, decimal ThicknessMm,
    IReadOnlyList<int> Rotations, bool Mirror, double W, double H, double AreaMm2, string Path, bool Engraved,
    string SourceFile, DateTimeOffset SavedAt, DateTimeOffset? ReplacedAt);

public record RestoreRequest(int Revision);

public static class PartSave
{
    internal static readonly int[] AllowedRotations = [90, 45, 30, 5];

    /// <summary>POST /api/parts/existing: which of these parts are already in the database.</summary>
    public static async Task<IResult> ExistingAsync(IReadOnlyList<PartKey> keys, GnezdoDb db, CancellationToken ct)
    {
        var names = keys.Select(k => k.Name.Trim()).Distinct().ToList();
        var candidates = await db.Parts.AsNoTracking().Live()
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
        // Projects must exist: they are saved on purpose ("Save new project"), never created by saving a part.
        foreach (var code in req.Parts.Select(p => p.Project?.Trim()).Where(c => !string.IsNullOrEmpty(c)).Distinct(StringComparer.OrdinalIgnoreCase))
        {
            var found = await db.Projects.FirstOrDefaultAsync(x => x.Code == code, ct);
            if (found is null) errors["project"] = [$"Project {code} is not in the database. Save the project first."];
            else projects[code!] = found;
        }
        if (errors.Count > 0) return Results.ValidationProblem(errors);

        Task<Project?> ProjectAsync(string? code) =>
            Task.FromResult(string.IsNullOrWhiteSpace(code) ? null : projects[code.Trim()]);

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
                ? await db.Parts.Live().FirstOrDefaultAsync(p => p.Name == name && p.ProjectId == null, ct)
                : project.Id == 0 ? null
                : await db.Parts.Live().FirstOrDefaultAsync(p => p.Name == name && p.ProjectId == project.Id, ct);
            existing ??= db.Parts.Local.FirstOrDefault(p => p.Name == name && p.Project == project && p.Id == 0);

            if (existing is not null && !r.Replace) { results.Add((r, existing, "exists")); continue; }
            // keep the version that is being replaced
            if (existing is { Id: > 0 }) await KeepVersionAsync(db, existing, now, ct);

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

    /// <summary>Copies the part as it is now into its history and moves it to the next revision.</summary>
    internal static async Task KeepVersionAsync(GnezdoDb db, Part part, DateTimeOffset now, CancellationToken ct)
    {
        await db.Entry(part).Reference(p => p.Material).LoadAsync(ct);
        await db.Entry(part).Reference(p => p.Project).LoadAsync(ct);
        db.PartRevisions.Add(new PartRevision
        {
            PartId = part.Id, Revision = part.Revision,
            Name = part.Name, Description = part.Description, ProjectCode = part.Project?.Code ?? "",
            MaterialName = part.Material.Name, ThicknessMm = part.ThicknessMm,
            Rotations = part.Rotations, Mirror = part.Mirror,
            WidthMm = part.WidthMm, HeightMm = part.HeightMm, AreaMm2 = part.AreaMm2,
            OutlinePath = part.OutlinePath, Engraved = part.Engraved, Geometry = part.Geometry, SourceFile = part.SourceFile,
            SavedAt = part.ModifiedAt, ReplacedAt = now,
        });
        part.Revision++;
    }

    internal static IReadOnlyList<int> RotationList(string s) =>
        s.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Select(int.Parse).ToList();

    /// <summary>GET /api/parts/{id}/history: the current version first, then older ones, newest first.</summary>
    public static async Task<IResult> HistoryAsync(int id, GnezdoDb db, CancellationToken ct)
    {
        var part = await db.Parts.AsNoTracking().Live().Include(p => p.Material).Include(p => p.Project)
            .FirstOrDefaultAsync(p => p.Id == id, ct);
        if (part is null) return Results.NotFound();
        var old = await db.PartRevisions.AsNoTracking().Where(r => r.PartId == id).OrderByDescending(r => r.Revision).ToListAsync(ct);

        var list = new List<PartVersionDto>
        {
            new(part.Revision, true, part.Name, part.Project?.Code ?? "", part.Description, part.Material.Name, part.ThicknessMm,
                RotationList(part.Rotations), part.Mirror, part.WidthMm, part.HeightMm, part.AreaMm2, part.OutlinePath, part.Engraved,
                part.SourceFile, part.ModifiedAt, null),
        };
        list.AddRange(old.Select(r => new PartVersionDto(
            r.Revision, false, r.Name, r.ProjectCode, r.Description, r.MaterialName, r.ThicknessMm,
            RotationList(r.Rotations), r.Mirror, r.WidthMm, r.HeightMm, r.AreaMm2, r.OutlinePath, r.Engraved,
            r.SourceFile, r.SavedAt, r.ReplacedAt)));
        return Results.Ok(list);
    }

    /// <summary>
    /// POST /api/parts/{id}/restore: makes an older version current again. The version in use
    /// goes into the history first, so a restore never loses anything and can itself be undone.
    /// </summary>
    public static async Task<IResult> RestoreAsync(int id, RestoreRequest req, GnezdoDb db, TimeProvider clock, CancellationToken ct)
    {
        var part = await db.Parts.Live().FirstOrDefaultAsync(p => p.Id == id, ct);
        if (part is null) return Results.NotFound();
        var old = await db.PartRevisions.AsNoTracking().FirstOrDefaultAsync(r => r.PartId == id && r.Revision == req.Revision, ct);
        if (old is null)
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["revision"] = [$"Part {id} has no older version {req.Revision}."] });

        var now = clock.GetUtcNow();
        await KeepVersionAsync(db, part, now, ct);

        part.Description = old.Description;
        part.Material = await db.Materials.FirstOrDefaultAsync(m => m.Name == old.MaterialName, ct)
            ?? db.Materials.Add(new Material { Name = old.MaterialName }).Entity;
        part.ThicknessMm = old.ThicknessMm;
        part.Rotations = old.Rotations;
        part.Mirror = old.Mirror;
        part.WidthMm = old.WidthMm;
        part.HeightMm = old.HeightMm;
        part.AreaMm2 = old.AreaMm2;
        part.OutlinePath = old.OutlinePath;
        part.Engraved = old.Engraved;
        part.Geometry = old.Geometry;
        part.SourceFile = old.SourceFile;
        part.ModifiedAt = now;
        await db.SaveChangesAsync(ct);

        var dto = await db.Parts.AsNoTracking().Where(p => p.Id == id).Select(PartEndpoints.ToDto).FirstAsync(ct);
        return Results.Ok(dto);
    }

    private static bool Same(string? a, string? b) =>
        string.Equals((a ?? "").Trim(), (b ?? "").Trim(), StringComparison.OrdinalIgnoreCase);
}
