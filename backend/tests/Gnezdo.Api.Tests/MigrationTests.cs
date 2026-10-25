using Gnezdo.Api;
using Gnezdo.Api.Data;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace Gnezdo.Api.Tests;

/// <summary>Start-up against databases in different states; each test uses its own database.</summary>
public sealed class MigrationTests
{
    private static string NewConnectionString()
    {
        var server = Environment.GetEnvironmentVariable("GNEZDO_TEST_SQL")
            ?? "Server=localhost,1433;User Id=sa;Password=Gnezdo_Test_123;TrustServerCertificate=True;Encrypt=False";
        return new SqlConnectionStringBuilder(server) { InitialCatalog = $"gnezdo_mig_{Guid.NewGuid():N}" }.ConnectionString;
    }

    private static ServiceProvider Services(string cs) => new ServiceCollection()
        .AddDbContext<GnezdoDb>(o => o.UseSqlServer(cs))
        .Configure<GnezdoOptions>(o => o.SeedSampleData = false)
        .BuildServiceProvider();

    [Fact]
    public async Task A_new_database_gets_every_migration()
    {
        var cs = NewConnectionString();
        await using var sp = Services(cs);
        try
        {
            await DbInitializer.InitializeAsync(sp, NullLogger.Instance);
            await DbInitializer.InitializeAsync(sp, NullLogger.Instance);   // a second start changes nothing

            using var scope = sp.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<GnezdoDb>();
            Assert.Empty(await db.Database.GetPendingMigrationsAsync());
            Assert.Equal(db.Database.GetMigrations(), await db.Database.GetAppliedMigrationsAsync());
            Assert.Equal(0, await db.Parts.CountAsync());
        }
        finally
        {
            using var scope = sp.CreateScope();
            await scope.ServiceProvider.GetRequiredService<GnezdoDb>().Database.EnsureDeletedAsync();
        }
    }

    [Fact]
    public async Task A_database_from_before_migrations_is_refused_with_a_clear_message()
    {
        var cs = NewConnectionString();
        await using var sp = Services(cs);
        try
        {
            using (var scope = sp.CreateScope())
                await scope.ServiceProvider.GetRequiredService<GnezdoDb>().Database.EnsureCreatedAsync();   // the old way

            var ex = await Assert.ThrowsAsync<OldDatabaseException>(() => DbInitializer.InitializeAsync(sp, NullLogger.Instance));
            Assert.Contains("drop it once", ex.Message);
        }
        finally
        {
            using var scope = sp.CreateScope();
            await scope.ServiceProvider.GetRequiredService<GnezdoDb>().Database.EnsureDeletedAsync();
        }
    }
}
