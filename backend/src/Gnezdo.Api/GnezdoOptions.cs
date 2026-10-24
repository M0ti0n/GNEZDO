namespace Gnezdo.Api;

/// <summary>Settings from the "Gnezdo" section of appsettings / environment.</summary>
public class GnezdoOptions
{
    /// <summary>Time zone of the shop. "On this date" filters use local calendar days here.</summary>
    public string TimeZone { get; set; } = "Europe/Ljubljana";

    /// <summary>Fill an empty database with sample parts, imports and jobs (development, tests).</summary>
    public bool SeedSampleData { get; set; }

    /// <summary>Upper limit for one part search response.</summary>
    public int MaxSearchResults { get; set; } = 500;
}
