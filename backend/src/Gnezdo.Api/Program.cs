using Gnezdo.Api;
using Gnezdo.Api.Data;
using Gnezdo.Api.Endpoints;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<GnezdoOptions>(builder.Configuration.GetSection("Gnezdo"));
builder.Services.AddSingleton<ShopTime>();
// Connection string is read when the first DbContext is created, so tests and Docker can override it.
builder.Services.AddDbContext<GnezdoDb>((sp, o) => o.UseSqlServer(
    sp.GetRequiredService<IConfiguration>().GetConnectionString("Gnezdo")
    ?? throw new InvalidOperationException("Connection string 'Gnezdo' is not set.")));
builder.Services.AddProblemDetails();

var app = builder.Build();

app.UseExceptionHandler();
app.UseStatusCodePages();

await DbInitializer.InitializeAsync(app.Services, app.Logger);

app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }));
app.MapPartEndpoints();
app.MapHomeEndpoints();

app.Run();

/// <summary>Entry point; public so integration tests can start the app.</summary>
public partial class Program { }
