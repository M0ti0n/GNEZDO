using System.Diagnostics;
using Gnezdo.Api.Auth;
using Gnezdo.Api.Data;
using Gnezdo.Api.Desktop;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Gnezdo.Api.Endpoints;

/// <summary>
/// Settings -> Data: where GNEZDO keeps its data. The desktop: its folder (open it) and a backup
/// copy of the database file. The server: which SQL Server and database (no password).
/// </summary>
public static class DataEndpoints
{
    public static void MapDataEndpoints(this WebApplication app, DesktopHost? desktop, bool demo, bool canChangeDb)
    {
        app.MapGet("/api/data", (IConfiguration config, HttpContext ctx) =>
        {
            if (demo) return Results.Ok(new { kind = "demo" });
            if (desktop is not null)
            {
                var file = Path.Combine(desktop.DataDir, "gnezdo.db");
                return Results.Ok(new
                {
                    kind = "file", folder = desktop.Root, file,
                    sizeMb = File.Exists(file) ? Math.Round(new FileInfo(file).Length / 1048576.0, 1) : 0,
                });
            }
            var cs = config.GetConnectionString("Gnezdo") ?? "";
            if (config["Gnezdo:Database"] is { } d && d.Equals("sqlite", StringComparison.OrdinalIgnoreCase))
                return Results.Ok(new { kind = "sqlite", file = new Microsoft.Data.Sqlite.SqliteConnectionStringBuilder(cs).DataSource });
            var b = new SqlConnectionStringBuilder(cs);
            return Results.Ok(new
            {
                kind = "sqlserver", server = b.DataSource, database = b.InitialCatalog,
                login = b.IntegratedSecurity ? "Windows sign-in" : b.UserID,
                canChange = canChangeDb && AuthEndpoints.Admin(ctx),
            });
        });

        if (desktop is null) return;

        // the desktop: show the folder in Explorer / the file manager
        app.MapPost("/api/data/open-folder", () =>
        {
            try
            {
                if (OperatingSystem.IsWindows()) Process.Start(new ProcessStartInfo("explorer.exe", $"\"{desktop.Root}\"") { UseShellExecute = false });
                else Process.Start(new ProcessStartInfo("xdg-open", desktop.Root) { UseShellExecute = false });
                return Results.NoContent();
            }
            catch (Exception e) when (e is System.ComponentModel.Win32Exception or IOException or InvalidOperationException)
            {
                return Results.Json(new { message = $"Could not open {desktop.Root}: {e.Message}" }, statusCode: StatusCodes.Status500InternalServerError);
            }
        });

        // a copy of the database while GNEZDO runs (SQLite's own VACUUM INTO: complete and consistent)
        app.MapGet("/api/data/backup", async (GnezdoDb db, TimeProvider clock, CancellationToken ct) =>
        {
            var tmp = Path.Combine(Path.GetTempPath(), $"gnezdo-backup-{Guid.NewGuid():N}.db");
            await db.Database.ExecuteSqlRawAsync("VACUUM INTO {0}", [tmp], ct);
            var bytes = await File.ReadAllBytesAsync(tmp, ct);
            File.Delete(tmp);
            return Results.File(bytes, "application/vnd.sqlite3", $"gnezdo-backup-{clock.GetLocalNow():yyyy-MM-dd-HHmm}.db");
        });
    }
}
