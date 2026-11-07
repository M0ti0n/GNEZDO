using Gnezdo.Api;
using Gnezdo.Api.Data;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;

namespace Gnezdo.Api.Tests;

/// <summary>
/// Starts the API against a fresh database (SQL Server, or SQLite: see TestDb) filled with the sample data.
/// The server comes from the GNEZDO_TEST_SQL environment variable (a connection string
/// without a database name); each test run gets its own database, dropped afterwards.
/// </summary>
public sealed class ApiFixture : IAsyncLifetime
{
    private readonly WebApplicationFactory<Program> _factory;

    public ApiFixture()
    {
        var cs = TestDb.NewConnectionString("gnezdo_test");

        _factory = new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
        {
            b.UseEnvironment("Testing");
            TestDb.Use(b, cs);
            b.UseSetting("Gnezdo:SeedSampleData", "true");
            b.UseSetting("Gnezdo:TimeZone", "Europe/Ljubljana");
            b.UseSetting("Gnezdo:RequireSignIn", "false");   // these tests are about the data; sign-in has AuthTests
        });
    }

    public HttpClient Client { get; private set; } = null!;

    public ShopTime Time => _factory.Services.GetRequiredService<ShopTime>();

    public Task InitializeAsync()
    {
        Client = _factory.CreateClient(); // starts the app: creates and seeds the database
        return Task.CompletedTask;
    }

    public async Task DisposeAsync()
    {
        using (var scope = _factory.Services.CreateScope())
        {
            await TestDb.DropAsync(scope.ServiceProvider.GetRequiredService<GnezdoDb>());
        }
        await _factory.DisposeAsync();
    }
}

[CollectionDefinition("api")]
public sealed class ApiCollection : ICollectionFixture<ApiFixture> { }
