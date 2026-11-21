using Gnezdo.Api.Data;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Gnezdo.Api.Tests;

/// <summary>
/// A fresh database for a test: SQL Server (GNEZDO_TEST_SQL, the server build), with
/// GNEZDO_TEST_DB=sqlite a new SQLite file (the desktop build), with GNEZDO_TEST_DB=postgres a new
/// PostgreSQL database (GNEZDO_TEST_PG). CI runs the tests on all three.
/// </summary>
public static class TestDb
{
    private static string Kind => (Environment.GetEnvironmentVariable("GNEZDO_TEST_DB") ?? "").Trim().ToLowerInvariant();
    public static bool Sqlite => Kind == "sqlite";
    public static bool Postgres => Kind is "postgres" or "postgresql";
    public static bool SqlServer => !Sqlite && !Postgres;

    public static string NewConnectionString(string prefix)
    {
        var id = $"{prefix}_{Guid.NewGuid():N}";
        if (Sqlite) return $"Data Source={Path.Combine(Path.GetTempPath(), "gnezdo-test", id + ".db")}";
        if (Postgres)
        {
            var pg = Environment.GetEnvironmentVariable("GNEZDO_TEST_PG") ?? "Host=localhost;Port=5432;Username=postgres;Password=Gnezdo_Test_123";
            return new Npgsql.NpgsqlConnectionStringBuilder(pg) { Database = id }.ConnectionString;
        }
        var server = Environment.GetEnvironmentVariable("GNEZDO_TEST_SQL")
            ?? "Server=localhost,1433;User Id=sa;Password=Gnezdo_Test_123;TrustServerCertificate=True;Encrypt=False";
        return new SqlConnectionStringBuilder(server) { InitialCatalog = id }.ConnectionString;
    }

    /// <summary>The app on that database.</summary>
    public static void Use(IWebHostBuilder b, string cs)
    {
        b.UseSetting("ConnectionStrings:Gnezdo", cs);
        b.UseSetting("Gnezdo:Database", Sqlite ? "sqlite" : Postgres ? "postgres" : "sqlserver");
    }

    /// <summary>The context alone (start-up tests).</summary>
    public static IServiceCollection AddDb(this IServiceCollection s, string cs) => Sqlite
        ? s.AddDbContext<GnezdoDb, GnezdoSqliteDb>(o => o.UseSqlite(cs))
        : Postgres ? s.AddDbContext<GnezdoDb, GnezdoPostgresDb>(o => o.UseNpgsql(cs))
        : s.AddDbContext<GnezdoDb>(o => o.UseSqlServer(cs));

    public static async Task DropAsync(GnezdoDb db)
    {
        if (Postgres) Npgsql.NpgsqlConnection.ClearAllPools();   // open pooled connections would keep the database from being dropped
        await db.Database.EnsureDeletedAsync();
        if (Sqlite) Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
    }
}
