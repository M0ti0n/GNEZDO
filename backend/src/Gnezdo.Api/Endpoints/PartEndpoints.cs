using Gnezdo.Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Gnezdo.Api.Endpoints;

/// <summary>Query string of GET /api/parts. Empty fields are ignored.</summary>
public sealed class PartQuery
{
    public string? Name { get; set; }
    public string? Material { get; set; }
    public decimal? ThicknessMm { get; set; }
    public string? Project { get; set; }
    public string? Description { get; set; }
    /// <summary>"on:yyyy-mm-dd", "upTo:yyyy-mm-dd" or "from:yyyy-mm-dd".</summary>
    public string? Created { get; set; }
    public string? Modified { get; set; }
    public double? XMin { get; set; }
    public double? XMax { get; set; }
    public double? YMin { get; set; }
    public double? YMax { get; set; }
    public bool? Engraved { get; set; }
    /// <summary>name, created, modified (default), material, thickness, project.</summary>
    public string? Sort { get; set; }
    /// <summary>asc or desc; dates default to desc, others to asc.</summary>
    public string? Dir { get; set; }
    public int? Take { get; set; }
}

public static class PartEndpoints
{
    public static void MapPartEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/parts", SearchAsync);
        app.MapGet("/api/parts/facets", FacetsAsync);
    }

    private static async Task<IResult> SearchAsync(
        [AsParameters] PartQuery q, GnezdoDb db, ShopTime time, IOptions<GnezdoOptions> options, CancellationToken ct)
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
        if (!Sort.TryParse(q.Sort, q.Dir, out var sort, out var sortError))
            errors[sortError!.StartsWith("dir") ? "dir" : "sort"] = [sortError];
        if (errors.Count > 0) return Results.ValidationProblem(errors);

        IQueryable<Part> parts = db.Parts.AsNoTracking();

        var name = Clean(q.Name);
        if (name is not null) parts = parts.Where(p => p.Name.Contains(name));
        var material = Clean(q.Material);
        if (material is not null) parts = parts.Where(p => p.Material.Name == material);
        if (q.ThicknessMm is { } thickness) parts = parts.Where(p => p.ThicknessMm == thickness);
        var project = Clean(q.Project);
        if (project is not null) parts = parts.Where(p => p.Project != null && p.Project.Code.Contains(project));
        var description = Clean(q.Description);
        if (description is not null) parts = parts.Where(p => p.Description.Contains(description));

        if (created is { } c)
        {
            var (from, to) = c.ToRange(time);
            if (from is { } f) parts = parts.Where(p => p.CreatedAt >= f);
            if (to is { } t) parts = parts.Where(p => p.CreatedAt < t);
        }
        if (modified is { } m)
        {
            var (from, to) = m.ToRange(time);
            if (from is { } f) parts = parts.Where(p => p.ModifiedAt >= f);
            if (to is { } t) parts = parts.Where(p => p.ModifiedAt < t);
        }

        if (q.XMin is { } xMin) parts = parts.Where(p => p.WidthMm >= xMin);
        if (q.XMax is { } xMax) parts = parts.Where(p => p.WidthMm <= xMax);
        if (q.YMin is { } yMin) parts = parts.Where(p => p.HeightMm >= yMin);
        if (q.YMax is { } yMax) parts = parts.Where(p => p.HeightMm <= yMax);
        if (q.Engraved == true) parts = parts.Where(p => p.Engraved);

        var max = options.Value.MaxSearchResults;
        var take = Math.Clamp(q.Take ?? max, 1, max);

        var rows = await sort.Apply(parts)
            .Take(take)
            .Select(ToDto)
            .ToListAsync(ct);
        return Results.Ok(rows);
    }

    private static async Task<PartFacetsDto> FacetsAsync(GnezdoDb db, CancellationToken ct)
    {
        var pairs = await db.Parts.AsNoTracking()
            .Select(p => new { Material = p.Material.Name, p.ThicknessMm })
            .Distinct()
            .ToListAsync(ct);
        var materials = pairs.Select(p => p.Material).Distinct().Order(StringComparer.OrdinalIgnoreCase).ToList();
        var thicknesses = pairs.OrderBy(p => p.ThicknessMm).ThenBy(p => p.Material)
            .Select(p => new ThicknessFacet(p.Material, p.ThicknessMm)).ToList();
        return new PartFacetsDto(materials, thicknesses);
    }

    /// <summary>Projection used by every endpoint that returns parts.</summary>
    internal static readonly System.Linq.Expressions.Expression<Func<Part, PartDto>> ToDto = p => new PartDto(
        p.Id.ToString(),
        p.Name,
        p.Project != null ? p.Project.Code : "",
        p.Material.Name,
        p.ThicknessMm,
        p.Qty,
        p.WidthMm,
        p.HeightMm,
        p.AreaMm2,
        p.OutlinePath,
        p.Description,
        p.Engraved,
        p.ImportBatchId.ToString(),
        p.ImportBatch.ImportedAt,
        p.CreatedAt,
        p.ModifiedAt);

    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
