using Gnezdo.Api.Data;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Gnezdo.Api.Tests;

/// <summary>
/// A fresh database for a test: SQL Server (GNEZDO_TEST_SQL, the server build), or with
/// GNEZDO_TEST_DB=sqlite a new SQLite file (the desktop build). CI runs the tests on both.
/// </summary>
public static class TestDb
{
    public static bool Sqlite => string.Equals(Environment.GetEnvironmentVariable("GNEZDO_TEST_DB"), "sqlite", StringComparison.OrdinalIgnoreCase);

    public static string NewConnectionString(string prefix)
    {
        var id = $"{prefix}_{Guid.NewGuid():N}";
        if (Sqlite) return $"Data Source={Path.Combine(Path.GetTempPath(), "gnezdo-test", id + ".db")}";
        var server = Environment.GetEnvironmentVariable("GNEZDO_TEST_SQL")
            ?? "Server=localhost,1433;User Id=sa;Password=Gnezdo_Test_123;TrustServerCertificate=True;Encrypt=False";
        return new SqlConnectionStringBuilder(server) { InitialCatalog = id }.ConnectionString;
    }

    /// <summary>The app on that database.</summary>
    public static void Use(IWebHostBuilder b, string cs)
    {
        b.UseSetting("ConnectionStrings:Gnezdo", cs);
        b.UseSetting("Gnezdo:Database", Sqlite ? "sqlite" : "sqlserver");
    }

    /// <summary>The context alone (start-up tests).</summary>
    public static IServiceCollection AddDb(this IServiceCollection s, string cs) => Sqlite
        ? s.AddDbContext<GnezdoDb, GnezdoSqliteDb>(o => o.UseSqlite(cs))
        : s.AddDbContext<GnezdoDb>(o => o.UseSqlServer(cs));

    public static async Task DropAsync(GnezdoDb db)
    {
        await db.Database.EnsureDeletedAsync();
        if (Sqlite) Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
    }
}
