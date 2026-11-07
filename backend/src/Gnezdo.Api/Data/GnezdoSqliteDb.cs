using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Gnezdo.Api.Data;

/// <summary>
/// The desktop build's database: one SQLite file in GNEZDO's data folder. The same tables as on
/// SQL Server, with its own migrations (Data/SqliteMigrations), and made to behave like SQL Server:
/// text compared without regard to case, times and thicknesses that can be sorted and compared.
/// </summary>
public sealed class GnezdoSqliteDb(DbContextOptions<GnezdoSqliteDb> options) : GnezdoDb(options)
{
    protected override void ConfigureConventions(ModelConfigurationBuilder b)
    {
        base.ConfigureConventions(b);
        // SQL Server's collation ignores case ("fab" is "Fab" for names, unique keys, sorting)
        b.Properties<string>().UseCollation("NOCASE");
        // SQLite cannot sort or compare DateTimeOffset or decimal: kept as numbers instead
        b.Properties<DateTimeOffset>().HaveConversion<DateTimeOffsetToBinaryConverter>();
        b.Properties<decimal>().HaveConversion<double>();
    }
}
