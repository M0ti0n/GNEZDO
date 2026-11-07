using Gnezdo.Api;
using Gnezdo.Api.Auth;
using Gnezdo.Api.Data;
using Gnezdo.Api.Desktop;
using Gnezdo.Api.Diagnostics;
using Gnezdo.Api.Endpoints;
using Gnezdo.Api.Nesting;
using Microsoft.EntityFrameworkCore;

// start.bat runs "GNEZDO.exe --check" first, to find out whether this PC lets the program run at all
if (args.Contains("--check")) { Console.WriteLine("GNEZDO can run on this PC"); return; }

// "--desktop": the desktop build (one person, one PC, SQLite, its own window); see DesktopHost
var desktopMode = args.Contains("--desktop");
var builder = WebApplication.CreateBuilder(args.Where(a => a != "--desktop").ToArray());

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
DesktopHost? desktop = null;
if (desktopMode || builder.Configuration.GetValue<bool>("Gnezdo:Desktop"))
{
    desktop = DesktopHost.Prepare(builder, configFile);
    // started a second time: open a window to the GNEZDO that already runs, and stop
    if (desktop.AlreadyRunning) { desktop.OpenWindow(); return; }
    builder.Services.AddSingleton(desktop);
    builder.Services.AddHostedService<DesktopWatch>();
}
var demo = desktop is null && string.IsNullOrWhiteSpace(builder.Configuration.GetConnectionString("Gnezdo"));
if (desktop is not null) builder.WebHost.UseUrls($"http://127.0.0.1:{desktop.Port}");   // this PC only
else if (builder.Configuration["Urls"] is { Length: > 0 } urls) builder.WebHost.UseUrls(urls);

builder.Services.Configure<GnezdoOptions>(builder.Configuration.GetSection("Gnezdo"));
builder.Services.AddSingleton<ShopTime>();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.Configure<NestingOptions>(builder.Configuration.GetSection("Nesting"));
// the diagnostic log (Settings -> Diagnostic log): GNEZDO\logs next to config.json (Windows build),
// else logs next to the program; "Diagnostics:Dir" sets another folder
var logDir = builder.Configuration["Diagnostics:Dir"] is { Length: > 0 } ld ? ld
    : desktop is not null ? desktop.LogDir
    : configFile is not null ? Path.Combine(Path.GetDirectoryName(Path.GetFullPath(configFile))!, "logs")
    : Path.Combine(AppContext.BaseDirectory, "logs");
builder.Services.AddSingleton(sp => new DiagLog(logDir, sp.GetRequiredService<TimeProvider>()));
// GNEZDO's own data next to config.json (Windows build) or the program: the sign-in keys; "Gnezdo:DataDir" sets another folder
var dataDir = builder.Configuration["Gnezdo:DataDir"] is { Length: > 0 } dd ? dd
    : desktop is not null ? desktop.DataDir
    : configFile is not null ? Path.Combine(Path.GetDirectoryName(Path.GetFullPath(configFile))!, "data")
    : Path.Combine(AppContext.BaseDirectory, "data");
// sign-in (server build): users added by the admin; not in the demo (no database)
builder.AddGnezdoAuth(desktop is null && AuthEndpoints.Required(builder.Configuration, demo), Path.Combine(dataDir, "keys"));
builder.Services.AddSingleton<NestRunner>();
builder.Services.AddSingleton<ServerLoad>();
// Connection string is read when the first DbContext is created, so tests and Docker can override it.
// "Gnezdo:Database": sqlserver (server build, the default) or sqlite (desktop build: one file).
string Cs(IServiceProvider sp) => sp.GetRequiredService<IConfiguration>().GetConnectionString("Gnezdo")
    ?? throw new InvalidOperationException("Connection string 'Gnezdo' is not set.");
var sqlite = string.Equals(builder.Configuration["Gnezdo:Database"], "sqlite", StringComparison.OrdinalIgnoreCase);
if (desktop is not null) builder.Services.AddDbContext<GnezdoDb, GnezdoSqliteDb>(o => o.UseSqlite(desktop.Database));
else if (!demo && sqlite) builder.Services.AddDbContext<GnezdoDb, GnezdoSqliteDb>((sp, o) => o.UseSqlite(Cs(sp)));
else if (!demo) builder.Services.AddDbContext<GnezdoDb>((sp, o) => o.UseSqlServer(Cs(sp)));
builder.Services.AddProblemDetails();

var app = builder.Build();

app.UseExceptionHandler();
app.UseStatusCodePages();
app.UseAuthentication();
app.UseDiagLog();
app.UseGnezdoAuth();
app.Services.GetRequiredService<DiagLog>().Write("start", $"GNEZDO started{(demo ? " (demo, no database)" : "")}", new { version = typeof(Program).Assembly.GetName().Version?.ToString(), machine = Environment.MachineName });

if (!demo)
{
    try { await DbInitializer.InitializeAsync(app.Services, app.Logger); }
    catch (Exception ex) when (desktop is not null)
    {
        DesktopHost.Fail($"GNEZDO could not open its data ({desktop.DataDir}):\n{ex.Message}");
        desktop.Release();
        Environment.ExitCode = 1;
        return;
    }
}

// desktop: the window's name is the PC's user (there is no sign-in)
app.MapGet("/api/health", () => Results.Ok(new { status = "ok", demo, desktop = desktop is not null, user = desktop is not null ? Environment.UserName : null }));
if (desktop is not null)
{
    app.MapDesktopEndpoints(desktop);
    var diag = app.Services.GetRequiredService<DiagLog>();
    app.Lifetime.ApplicationStarted.Register(() => desktop.OpenWindow(diag));
    app.Lifetime.ApplicationStopped.Register(desktop.Release);
}
// nesting works in the demo too: the job tab sends everything a run needs
app.MapNestEndpoints();
app.MapDiagEndpoints();
app.MapAuthEndpoints();
if (!demo)
{
    app.MapPartEndpoints();
    app.MapHomeEndpoints();
    app.MapJobEndpoints();
    app.MapSettingsEndpoints();
    app.MapDraftEndpoints();
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
catch (IOException ex) when (desktop is not null)
{
    DesktopHost.Fail($"GNEZDO could not start on port {desktop.Port}: {ex.Message}\nSet another port in config.json (\"Gnezdo\": {{ \"DesktopPort\": 8096 }}).");
    desktop.Release();
    Environment.ExitCode = 1;
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
