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
    /// <summary>
    /// Filler: a part used very often and usually cut in bulk. Nesting puts it only into gaps
    /// left among the other parts, and never adds or fills a sheet just for fillers.
    /// </summary>
    public bool Filler { get; set; }
    /// <summary>
    /// Common cut: the part may share straight cut lines with its neighbours on the sheet (cut once
    /// for both). Off by default; which lines may be shared is in the geometry (operations).
    /// </summary>
    public bool CommonCut { get; set; }
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
    public bool Filler { get; set; }
    public bool CommonCut { get; set; }
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

/// <summary>
/// A setting shared by everyone (machines, later materials, technology tables, ...): its value is JSON
/// as the app keeps it, under a fixed key.
/// </summary>
/// <summary>Someone who may sign in (server build). The admin adds users; a password is optional.</summary>
public class User
{
    public int Id { get; set; }
    public required string Name { get; set; }
    /// <summary>PBKDF2 hash ("pbkdf2-sha256$iterations$salt$hash"); null: signs in by name alone.</summary>
    public string? PasswordHash { get; set; }
    public bool IsAdmin { get; set; }
    /// <summary>Changes when the password or rights change, or the user is removed: older sign-ins end.</summary>
    public string Stamp { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? LastSignInAt { get; set; }
}

public class AppSetting
{
    public required string Key { get; set; }
    public string Value { get; set; } = "";
    public DateTimeOffset ModifiedAt { get; set; }
    public string ModifiedBy { get; set; } = "";
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
    /// <summary>The machine the job is nested for (id in the "machines" setting); empty = the default machine.</summary>
    public string Machine { get; set; } = "";
    /// <summary>Stock sheets of the job (the STOCK panel), JSON array as the job tab keeps them.</summary>
    public string Stock { get; set; } = "";
    /// <summary>The saved nest solution (sheets with placed parts, counts, mode, origin), JSON; empty = not nested.</summary>
    public string Nest { get; set; } = "";
    public DateTimeOffset? NestedAt { get; set; }
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
    /// <summary>Nesting may add copies up to this into space that would be scrap (at least Qty).</summary>
    public int QtyMax { get; set; }
    /// <summary>The part's ID number in the job (the work part list's ID column).</summary>
    public int No { get; set; }
    /// <summary>Material in this job only (null = the part's own); the part in the database is not changed.</summary>
    public string? Material { get; set; }
    /// <summary>Thickness in this job only (null = the part's own).</summary>
    public decimal? ThicknessMm { get; set; }
}

/// <summary>
/// A recovery copy of a job tab with unsaved changes, written every few seconds while it is open:
/// after a crash, a closed window or a lost connection the job can be restored. Deleted once the job
/// is saved or its changes are discarded.
/// </summary>
public class Draft
{
    /// <summary>Made by the browser for the job tab (a GUID).</summary>
    public required string Id { get; set; }
    /// <summary>The signed-in user ("" without sign-in: the desktop build).</summary>
    public string User { get; set; } = "";
    /// <summary>The browser it came from (diagnostic id).</summary>
    public string Browser { get; set; } = "";
    /// <summary>The saved job it changes; null for a job never saved.</summary>
    public int? JobId { get; set; }
    public string Name { get; set; } = "";
    public int Parts { get; set; }
    public int Solutions { get; set; }
    /// <summary>The job tab as JSON: parts, stock, machine, finished solutions.</summary>
    public string Content { get; set; } = "";
    public DateTimeOffset SavedAt { get; set; }
}

