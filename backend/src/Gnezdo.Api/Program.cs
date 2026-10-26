using Gnezdo.Api;
using Gnezdo.Api.Data;
using Gnezdo.Api.Endpoints;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

// Windows build: settings in config.json (database, port) - in the GNEZDO folder, next to start.bat
// (the program itself sits in its "program" subfolder), or next to the exe, or where GNEZDO_CONFIG
// points. Without a database connection GNEZDO runs as a demo on sample data and saves nothing.
var configFile = new[]
{
    Environment.GetEnvironmentVariable("GNEZDO_CONFIG"),
    Path.Combine(AppContext.BaseDirectory, "config.json"),
    Path.Combine(AppContext.BaseDirectory, "..", "config.json"),
}.FirstOrDefault(f => !string.IsNullOrEmpty(f) && File.Exists(f));
if (configFile is not null) builder.Configuration.AddJsonFile(Path.GetFullPath(configFile), optional: true, reloadOnChange: false);
var demo = string.IsNullOrWhiteSpace(builder.Configuration.GetConnectionString("Gnezdo"));
if (builder.Configuration["Urls"] is { Length: > 0 } urls) builder.WebHost.UseUrls(urls);

builder.Services.Configure<GnezdoOptions>(builder.Configuration.GetSection("Gnezdo"));
builder.Services.AddSingleton<ShopTime>();
builder.Services.AddSingleton(TimeProvider.System);
// Connection string is read when the first DbContext is created, so tests and Docker can override it.
if (!demo) builder.Services.AddDbContext<GnezdoDb>((sp, o) => o.UseSqlServer(
    sp.GetRequiredService<IConfiguration>().GetConnectionString("Gnezdo")
    ?? throw new InvalidOperationException("Connection string 'Gnezdo' is not set.")));
builder.Services.AddProblemDetails();

var app = builder.Build();

app.UseExceptionHandler();
app.UseStatusCodePages();

if (!demo) await DbInitializer.InitializeAsync(app.Services, app.Logger);

app.MapGet("/api/health", () => Results.Ok(new { status = "ok", demo }));
if (!demo)
{
    app.MapPartEndpoints();
    app.MapHomeEndpoints();
}

// Windows build: the web pages are next to the program (wwwroot uses the database,
// wwwroot-demo the sample data). In Docker nginx serves them instead and these folders are absent.
var web = Path.Combine(AppContext.BaseDirectory, demo ? "wwwroot-demo" : "wwwroot");
if (Directory.Exists(web))
{
    var files = new Microsoft.Extensions.FileProviders.PhysicalFileProvider(web);
    app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = files });
    app.UseStaticFiles(new StaticFileOptions { FileProvider = files });
    app.MapFallback(async ctx =>
    {
        if (ctx.Request.Path.StartsWithSegments("/api")) { ctx.Response.StatusCode = 404; return; }
        ctx.Response.ContentType = "text/html; charset=utf-8";
        await ctx.Response.SendFileAsync(Path.Combine(web, "index.html"));
    });
    app.Lifetime.ApplicationStarted.Register(() => Console.WriteLine(
        $"GNEZDO {(demo ? "DEMO - sample data, nothing is saved" : "with the database")}. Open {string.Join(", ", app.Urls).Replace("0.0.0.0", "localhost")} in a browser. Close this window to stop GNEZDO."));
}

try
{
    app.Run();
}
catch (IOException ex) when (Directory.Exists(web))
{
    // Windows build: say plainly why it cannot start (port taken or not allowed on this PC)
    Console.Error.WriteLine();
    Console.Error.WriteLine($"GNEZDO could not start: {ex.Message}");
    Console.Error.WriteLine("The port is used by another program or not allowed on this PC.");
    Console.Error.WriteLine("Open config.json in Notepad, change 8090 in \"Urls\" to another number (e.g. 8091),");
    Console.Error.WriteLine("save it and start GNEZDO again; then open http://localhost:8091");
    Environment.ExitCode = 1;
}

/// <summary>Entry point; public so integration tests can start the app.</summary>
public partial class Program { }
