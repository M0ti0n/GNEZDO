using System.Diagnostics;
using Gnezdo.Api.Auth;
using Gnezdo.Api.Data;
using Gnezdo.Api.Desktop;
using Gnezdo.Api.Diagnostics;
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

        // Start fresh: like a new install, without deleting any folder (an antivirus may guard the
        // window's browser profile, so deleting the data folder by hand can fail). A copy of the
        // database goes to data\backups first; then every table is emptied (the migration history
        // stays, so the file stays at the current version). The page then clears what it remembers.
        app.MapPost("/api/data/start-fresh", async (FreshForm f, GnezdoDb db, TimeProvider clock, DiagLog log, CancellationToken ct) =>
        {
            if (!string.Equals(f.Confirm?.Trim(), "DELETE", StringComparison.Ordinal))
                return Results.Json(new { message = "Type DELETE to confirm." }, statusCode: StatusCodes.Status400BadRequest);

            var dir = Path.Combine(desktop.DataDir, "backups");
            Directory.CreateDirectory(dir);
            var backup = Path.Combine(dir, $"gnezdo-before-start-fresh-{clock.GetLocalNow():yyyy-MM-dd-HHmmss}.db");
            await db.Database.ExecuteSqlRawAsync("VACUUM INTO {0}", [backup], ct);

            var conn = db.Database.GetDbConnection();
            await db.Database.OpenConnectionAsync(ct);
            var tables = new List<string>();   // sqlite_sequence too: new ids start at 1 again
            try
            {
                await using (var list = conn.CreateCommand())
                {
                    list.CommandText = "SELECT name FROM sqlite_master WHERE type = 'table' AND (name NOT LIKE 'sqlite_%' OR name = 'sqlite_sequence') AND name <> '__EFMigrationsHistory'";
                    await using var r = await list.ExecuteReaderAsync(ct);
                    while (await r.ReadAsync(ct)) tables.Add(r.GetString(0));
                }
                await db.Database.ExecuteSqlRawAsync("PRAGMA foreign_keys = OFF;", ct);
                await using (var tx = await conn.BeginTransactionAsync(ct))
                {
                    foreach (var t in tables)
                    {
                        await using var del = conn.CreateCommand();
                        del.Transaction = tx;
                        del.CommandText = $"DELETE FROM \"{t.Replace("\"", "\"\"")}\"";
                        await del.ExecuteNonQueryAsync(ct);
                    }
                    await tx.CommitAsync(ct);
                }
                await db.Database.ExecuteSqlRawAsync("PRAGMA foreign_keys = ON;", ct);
                await db.Database.ExecuteSqlRawAsync("VACUUM;", ct);
            }
            finally { await db.Database.CloseConnectionAsync(); }
            db.ChangeTracker.Clear();

            log.Write("data", "Started fresh: all data deleted", new { backup, tables = tables.Count });
            return Results.Ok(new { backup });
        });
    }

    public sealed record FreshForm(string? Confirm);
}
