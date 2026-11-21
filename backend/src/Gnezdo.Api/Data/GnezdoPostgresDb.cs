using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Gnezdo.Api.Data;

/// <summary>
/// The server on PostgreSQL ("Gnezdo:Database": "postgres", e.g. a Linux server): the same tables as on
/// SQL Server, with its own migrations (Data/PostgresMigrations), made to behave like SQL Server: text
/// is citext, so names, unique keys, sorting and searches ignore case ("fab" is "Fab"), as SQL Server's
/// collation does; times are stored in UTC (PostgreSQL keeps no offset).
/// </summary>
public sealed class GnezdoPostgresDb(DbContextOptions<GnezdoPostgresDb> options) : GnezdoDb(options)
{
    protected override void OnModelCreating(ModelBuilder b)
    {
        base.OnModelCreating(b);
        // case-insensitive text (contrib's citext: the database owner may create it, PostgreSQL 13 and up)
        b.HasPostgresExtension("citext");
        // one live part per project and name: the filter in PostgreSQL's quoting
        b.Entity<Part>().HasIndex(x => new { x.ProjectId, x.Name }).HasFilter("\"DeletedAt\" IS NULL");
    }

    protected override void ConfigureConventions(ModelConfigurationBuilder b)
    {
        base.ConfigureConventions(b);
        b.Properties<string>().HaveColumnType("citext");
        b.Properties<DateTimeOffset>().HaveConversion<UtcConverter>();
    }

    /// <summary>A time as UTC on the way in (timestamptz takes only offset 0); it comes back as UTC, the same moment.</summary>
    private sealed class UtcConverter() : ValueConverter<DateTimeOffset, DateTimeOffset>(v => v.ToUniversalTime(), v => v);
}
