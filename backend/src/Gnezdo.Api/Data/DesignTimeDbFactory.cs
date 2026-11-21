using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Gnezdo.Api.Data;

/// <summary>
/// Used only by the "dotnet ef" tool to build the model when creating migrations.
/// No database is contacted, so the connection string is a placeholder.
/// </summary>
public sealed class DesignTimeDbFactory : IDesignTimeDbContextFactory<GnezdoDb>
{
    public GnezdoDb CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<GnezdoDb>()
            .UseSqlServer("Server=design-time;Database=Gnezdo;Trusted_Connection=True;TrustServerCertificate=True")
            .Options);
}

/// <summary>The same for the desktop build's SQLite database (dotnet ef ... --context GnezdoSqliteDb).</summary>
public sealed class DesignTimeSqliteDbFactory : IDesignTimeDbContextFactory<GnezdoSqliteDb>
{
    public GnezdoSqliteDb CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<GnezdoSqliteDb>().UseSqlite("Data Source=design-time.db").Options);
}

/// <summary>The same for a server on PostgreSQL (dotnet ef ... --context GnezdoPostgresDb).</summary>
public sealed class DesignTimePostgresDbFactory : IDesignTimeDbContextFactory<GnezdoPostgresDb>
{
    public GnezdoPostgresDb CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<GnezdoPostgresDb>().UseNpgsql("Host=design-time;Database=gnezdo").Options);
}
