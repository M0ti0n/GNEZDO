namespace Gnezdo.Api.Data;

/// <summary>Sheet material grade, e.g. "S235", "HARDOX", "INOX 1.4301".</summary>
public class Material
{
    public int Id { get; set; }
    public required string Name { get; set; }
}

/// <summary>Order or project number that parts are imported under.</summary>
public class Project
{
    public int Id { get; set; }
    public required string Code { get; set; }
    public string Name { get; set; } = "";
    public string? Customer { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public List<Part> Parts { get; set; } = [];
}

/// <summary>One run of the importer: a folder or a set of drawings.</summary>
public class ImportBatch
{
    public int Id { get; set; }
    public required string Source { get; set; }
    public int? ProjectId { get; set; }
    public Project? Project { get; set; }
    public DateTimeOffset ImportedAt { get; set; }
    public string ImportedBy { get; set; } = "";
    /// <summary>Parts that need attention (open contours, unknown layer, ...).</summary>
    public int Warnings { get; set; }
    public List<Part> Parts { get; set; } = [];
}

/// <summary>One part in the library = one imported drawing.</summary>
public class Part
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public string Description { get; set; } = "";
    public int? ProjectId { get; set; }
    public Project? Project { get; set; }
    public int MaterialId { get; set; }
    public Material Material { get; set; } = null!;
    public decimal ThicknessMm { get; set; }
    /// <summary>Ordered quantity from the import.</summary>
    public int Qty { get; set; }
    /// <summary>Bounding box as drawn [mm].</summary>
    public double WidthMm { get; set; }
    public double HeightMm { get; set; }
    public double AreaMm2 { get; set; }
    /// <summary>SVG path of outline and holes (y down, origin top-left), for thumbnails.</summary>
    public string OutlinePath { get; set; } = "";
    public bool Engraved { get; set; }
    /// <summary>Drawing entities with their roles (cut, trace, openCut), JSON, in mm, y up.</summary>
    public string Geometry { get; set; } = "";
    /// <summary>Rotation steps the nesting may use, e.g. "90,45"; empty = no rotation.</summary>
    public string Rotations { get; set; } = "";
    public bool Mirror { get; set; }
    /// <summary>File the part was imported from.</summary>
    public string SourceFile { get; set; } = "";
    /// <summary>Version number: 1 when first saved, +1 on every replace or restore.</summary>
    public int Revision { get; set; } = 1;
    /// <summary>Set when the part is deleted: it is hidden everywhere but kept, so jobs that use it stay intact.</summary>
    public DateTimeOffset? DeletedAt { get; set; }
    public List<PartRevision> History { get; set; } = [];
    public int ImportBatchId { get; set; }
    public ImportBatch ImportBatch { get; set; } = null!;
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ModifiedAt { get; set; }
}

/// <summary>
/// An earlier version of a part, kept when the part is replaced or restored.
/// Material and project are stored by name, so the version stays readable even if those change.
/// </summary>
public class PartRevision
{
    public int Id { get; set; }
    public int PartId { get; set; }
    public Part Part { get; set; } = null!;
    public int Revision { get; set; }
    public required string Name { get; set; }
    public string Description { get; set; } = "";
    public string ProjectCode { get; set; } = "";
    public required string MaterialName { get; set; }
    public decimal ThicknessMm { get; set; }
    public string Rotations { get; set; } = "";
    public bool Mirror { get; set; }
    public double WidthMm { get; set; }
    public double HeightMm { get; set; }
    public double AreaMm2 { get; set; }
    public string OutlinePath { get; set; } = "";
    public bool Engraved { get; set; }
    public string Geometry { get; set; } = "";
    public string SourceFile { get; set; } = "";
    /// <summary>When this version was saved (the part's ModifiedAt at that time).</summary>
    public DateTimeOffset SavedAt { get; set; }
    /// <summary>When it stopped being the current version.</summary>
    public DateTimeOffset ReplacedAt { get; set; }
}

public enum JobStatus { Draft, Nested, Released, Cut }

public class Job
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public JobStatus Status { get; set; }
    public int SheetCount { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ModifiedAt { get; set; }
    public string ModifiedBy { get; set; } = "";
    public List<JobPart> Parts { get; set; } = [];
}

/// <summary>A part in a job with the quantity to cut in that job.</summary>
public class JobPart
{
    public int JobId { get; set; }
    public Job Job { get; set; } = null!;
    public int PartId { get; set; }
    public Part Part { get; set; } = null!;
    public int Qty { get; set; }
}
