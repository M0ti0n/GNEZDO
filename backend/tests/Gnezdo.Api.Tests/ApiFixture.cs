using Gnezdo.Api;
using Gnezdo.Api.Data;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.DependencyInjection;

namespace Gnezdo.Api.Tests;

/// <summary>
/// Starts the API against a fresh SQL Server database filled with the sample data.
/// The server comes from the GNEZDO_TEST_SQL environment variable (a connection string
/// without a database name); each test run gets its own database, dropped afterwards.
/// </summary>
public sealed class ApiFixture : IAsyncLifetime
{
    private readonly WebApplicationFactory<Program> _factory;

    public ApiFixture()
    {
        var server = Environment.GetEnvironmentVariable("GNEZDO_TEST_SQL")
            ?? "Server=localhost,1433;User Id=sa;Password=Gnezdo_Test_123;TrustServerCertificate=True;Encrypt=False";
        var cs = new SqlConnectionStringBuilder(server)
        {
            InitialCatalog = $"gnezdo_test_{Guid.NewGuid():N}",
        }.ConnectionString;

        _factory = new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
        {
            b.UseEnvironment("Testing");
            b.UseSetting("ConnectionStrings:Gnezdo", cs);
            b.UseSetting("Gnezdo:SeedSampleData", "true");
            b.UseSetting("Gnezdo:TimeZone", "Europe/Ljubljana");
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
            await scope.ServiceProvider.GetRequiredService<GnezdoDb>().Database.EnsureDeletedAsync();
        }
        await _factory.DisposeAsync();
    }
}

[CollectionDefinition("api")]
public sealed class ApiCollection : ICollectionFixture<ApiFixture> { }
