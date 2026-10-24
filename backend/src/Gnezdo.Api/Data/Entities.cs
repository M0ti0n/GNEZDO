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
    public int ImportBatchId { get; set; }
    public ImportBatch ImportBatch { get; set; } = null!;
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ModifiedAt { get; set; }
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
