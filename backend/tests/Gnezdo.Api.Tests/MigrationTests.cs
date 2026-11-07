using Gnezdo.Api;
using Gnezdo.Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace Gnezdo.Api.Tests;

/// <summary>Start-up against databases in different states; each test uses its own database.</summary>
public sealed class MigrationTests
{
    private static string NewConnectionString() => TestDb.NewConnectionString("gnezdo_mig");

    private static ServiceProvider Services(string cs) => new ServiceCollection()
        .AddDb(cs)
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
            await TestDb.DropAsync(scope.ServiceProvider.GetRequiredService<GnezdoDb>());
        }
    }

    [Fact]
    public async Task A_database_from_before_migrations_is_refused_with_a_clear_message()
    {
        if (TestDb.Sqlite) return;   // only SQL Server databases were ever made that way
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
            await TestDb.DropAsync(scope.ServiceProvider.GetRequiredService<GnezdoDb>());
        }
    }
}
