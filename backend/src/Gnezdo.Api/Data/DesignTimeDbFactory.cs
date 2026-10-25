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
