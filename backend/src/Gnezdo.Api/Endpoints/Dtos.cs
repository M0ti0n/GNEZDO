using System.Globalization;

namespace Gnezdo.Api.Endpoints;

// Response shapes. Property names match frontend/src/api/types.ts (JSON is camelCase).

public record PartDto(
    string Id, string Name, string Project, string Material, decimal ThicknessMm, int Qty,
    double W, double H, double AreaMm2, string Path, string Description, bool Engraved,
    string ImportId, DateTimeOffset ImportedAt, DateTimeOffset CreatedAt, DateTimeOffset ModifiedAt);

public record ThicknessFacet(string Material, decimal ThicknessMm);

public record PartFacetsDto(IReadOnlyList<string> Materials, IReadOnlyList<ThicknessFacet> Thicknesses);

public record JobSummaryDto(
    string Id, string Name, string Material, decimal ThicknessMm, int PartCount, int SheetCount,
    string Status, DateTimeOffset CreatedAt, DateTimeOffset ModifiedAt, string ModifiedBy,
    IReadOnlyList<string> Projects,
    /// <summary>All materials in the job, A–Z.</summary>
    IReadOnlyList<string> Materials,
    /// <summary>All thicknesses in the job, thin to thick.</summary>
    IReadOnlyList<decimal> Thicknesses);

public record JobPartDto(PartDto Part, int Qty);

public record ImportSummaryDto(
    string Id, string Source, string Project, int PartCount, IReadOnlyList<string> Materials,
    DateTimeOffset ImportedAt, string ImportedBy, int Warnings);

/// <summary>A project in a pick list.</summary>
public record ProjectOptionDto(string Code, string Name, string? Customer);

public record ProjectSummaryDto(
    string Id, string Code, string Name, string? Customer, int PartCount, int JobCount,
    int CutPercent, DateTimeOffset LastActivityAt);

public static class Format
{
    /// <summary>"S235 3 mm", "HARDOX 1 mm", "S355 2.5 mm".</summary>
    public static string MaterialKey(string material, decimal thicknessMm) =>
        $"{material} {thicknessMm.ToString("0.##", CultureInfo.InvariantCulture)} mm";
}
