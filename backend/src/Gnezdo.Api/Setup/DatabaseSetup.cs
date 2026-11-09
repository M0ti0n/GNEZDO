using System.Text.Json;
using System.Text.Json.Nodes;
using Gnezdo.Api.Auth;
using Gnezdo.Api.Data;
using Gnezdo.Api.Diagnostics;
using Microsoft.Data.SqlClient;

namespace Gnezdo.Api.Setup;

/// <summary>
/// The server build (Windows zip) started without a database ("Gnezdo:Setup" in config.json and no
/// connection string): the browser shows "Set up the database" instead of GNEZDO. The answers go into
/// config.json and GNEZDO carries on without a restart. Later an admin may point it at another
/// database (Settings -> Data); that one is used after a restart.
/// </summary>
public sealed class SetupState(bool pending, string? configFile)
{
    /// <summary>No database yet: everything but the setup and /api/health waits.</summary>
    public bool Pending { get; set; } = pending;
    /// <summary>Where the connection is written (config.json next to start.bat).</summary>
    public string ConfigFile { get; } = configFile ?? Path.Combine(AppContext.BaseDirectory, "..", "config.json");
}

public static class DatabaseSetup
{
    public record DbForm(string? Server, string? Database, bool WindowsLogin, string? User, string? Password, bool TrustCertificate = true);

    /// <summary>What was found: "new" (to be made), "empty", "gnezdo" (an earlier GNEZDO database), "other" (refused).</summary>
    public record DbCheck(bool Ok, string Message, string? Found);

    public static string ConnectionString(DbForm f, string? database = null) => new SqlConnectionStringBuilder
    {
        DataSource = f.Server?.Trim() ?? "",
        InitialCatalog = database ?? f.Database?.Trim() ?? "",
        IntegratedSecurity = f.WindowsLogin,
        UserID = f.WindowsLogin ? "" : f.User?.Trim() ?? "",
        Password = f.WindowsLogin ? "" : f.Password ?? "",
        TrustServerCertificate = f.TrustCertificate,
        Encrypt = f.TrustCertificate ? SqlConnectionEncryptOption.Optional : SqlConnectionEncryptOption.Mandatory,
        ConnectTimeout = 8,
    }.ConnectionString;

    /// <summary>
    /// Can GNEZDO use this server and database? A database of another program (an ERP, other nesting software, ...)
    /// is refused: GNEZDO must have a database of its own.
    /// </summary>
    public static async Task<DbCheck> Check(DbForm f, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(f.Server)) return new(false, "Enter the SQL Server (e.g. SERVER\\SQLEXPRESS).", null);
        var db = f.Database?.Trim() ?? "";
        if (db.Length is 0 or > 100 || db.Any(c => !(char.IsLetterOrDigit(c) || c is '_' or '-')))
            return new(false, "The database name is letters, digits, _ and - (e.g. gnezdo).", null);
        if (!f.WindowsLogin && string.IsNullOrWhiteSpace(f.User)) return new(false, "Enter the SQL login, or use Windows sign-in.", null);
        try
        {
            await using var con = new SqlConnection(ConnectionString(f, "master"));
            await con.OpenAsync(ct);
            await using (var cmd = new SqlCommand("SELECT DB_ID(@db)", con))
            {
                cmd.Parameters.AddWithValue("@db", db);
                if (await cmd.ExecuteScalarAsync(ct) is null or DBNull)
                    return new(true, $"Connected. The database \"{db}\" does not exist yet: GNEZDO will create it.", "new");
            }
            await con.ChangeDatabaseAsync(db, ct);
            await using var tables = new SqlCommand(
                "SELECT COUNT(*), SUM(CASE WHEN name IN ('__EFMigrationsHistory', 'Parts', 'Jobs', 'Materials') THEN 1 ELSE 0 END) FROM sys.tables", con);
            await using var r = await tables.ExecuteReaderAsync(ct);
            await r.ReadAsync(ct);
            var all = r.GetInt32(0);
            var ours = r.IsDBNull(1) ? 0 : r.GetInt32(1);
            if (all == 0) return new(true, $"Connected. The database \"{db}\" is empty: GNEZDO will set it up.", "empty");
            if (ours == 4) return new(true, $"Connected. \"{db}\" is a GNEZDO database ({all} tables): GNEZDO will use it as it is.", "gnezdo");
            return new(false, $"\"{db}\" belongs to another program ({all} tables). GNEZDO needs a database of its own: choose another name.", "other");
        }
        catch (SqlException e)
        {
            return new(false, $"Could not connect: {e.Message}", null);
        }
        catch (InvalidOperationException e)
        {
            return new(false, $"Could not connect: {e.Message}", null);
        }
    }

    /// <summary>The connection into config.json (keeping everything else there).</summary>
    public static void WriteConfig(string file, string connection)
    {
        JsonObject root;
        try { root = File.Exists(file) ? JsonNode.Parse(File.ReadAllText(file)) as JsonObject ?? [] : []; }
        catch (JsonException) { throw new InvalidOperationException($"{file} is not valid JSON: correct it in Notepad first."); }
        if (root["ConnectionStrings"] is not JsonObject cs) root["ConnectionStrings"] = cs = [];
        cs["Gnezdo"] = connection;
        if (root["Gnezdo"] is JsonObject g) g.Remove("Setup");
        File.WriteAllText(file, root.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
    }

    /// <summary>Until the database is set up only the setup answers; the rest says so.</summary>
    public static void UseDatabaseSetup(this WebApplication app)
    {
        var state = app.Services.GetRequiredService<SetupState>();
        app.Use(async (ctx, next) =>
        {
            var p = ctx.Request.Path;
            if (state.Pending && p.StartsWithSegments("/api") && !p.StartsWithSegments("/api/setup") && !p.StartsWithSegments("/api/health"))
            {
                ctx.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
                await ctx.Response.WriteAsJsonAsync(new { message = "Set up the database first.", setup = true });
                return;
            }
            await next(ctx);
        });
    }

    public static void MapDatabaseSetup(this WebApplication app)
    {
        var state = app.Services.GetRequiredService<SetupState>();
        // first start: anyone at the page sets it up; later: only an admin
        bool Allowed(HttpContext ctx) => state.Pending || AuthEndpoints.Admin(ctx);
        IResult NotAllowed() => Results.Json(new { message = "Only an admin can change the database." }, statusCode: StatusCodes.Status403Forbidden);

        app.MapPost("/api/setup/test", async (DbForm f, HttpContext ctx, CancellationToken ct) =>
            Allowed(ctx) ? Results.Ok(await Check(f, ct)) : NotAllowed());

        app.MapPost("/api/setup/save", async (DbForm f, HttpContext ctx, IConfiguration config, DiagLog log, CancellationToken ct) =>
        {
            if (!Allowed(ctx)) return NotAllowed();
            var check = await Check(f, ct);
            if (!check.Ok) return Results.Ok(new { ok = false, message = check.Message });
            var cs = ConnectionString(f);
            try { WriteConfig(state.ConfigFile, cs); }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException or InvalidOperationException)
            {
                return Results.Ok(new { ok = false, message = $"Could not write {state.ConfigFile}: {e.Message}" });
            }
            var where = $"{f.Server?.Trim()} / {f.Database?.Trim()}";
            if (!state.Pending)
            {
                log.Write("setup", $"Database changed to {where} by {ctx.User.Identity?.Name}: used after a restart");
                return Results.Ok(new { ok = true, restart = true, message = $"Saved. GNEZDO uses {where} after it is started again." });
            }
            config["ConnectionStrings:Gnezdo"] = cs;
            try
            {
                await DbInitializer.InitializeAsync(app.Services, app.Logger, ct, attempts: 1);
            }
            catch (Exception e)
            {
                return Results.Ok(new { ok = false, message = $"Connected, but the database could not be set up: {e.Message}" });
            }
            state.Pending = false;
            log.Write("setup", $"Database set up: {where} ({check.Found})");
            return Results.Ok(new { ok = true, restart = false, message = check.Message });
        });
    }
}
