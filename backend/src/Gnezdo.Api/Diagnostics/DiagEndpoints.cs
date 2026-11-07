using System.Diagnostics;
using System.Text.Json.Nodes;

namespace Gnezdo.Api.Diagnostics;

/// <summary>
/// The diagnostic log over HTTP: the browsers' own events, "Report a problem", "Download log", the
/// on/off switch; and a record of every API call that changes something, fails or is slow.
/// </summary>
public static class DiagEndpoints
{
    public record ClientEvent(string? T, string? Kind, string? Msg, JsonNode? Data);
    public record ClientBatch(string? User, string? Browser, List<ClientEvent>? Events);
    public record ProblemReport(string? User, string? Browser, string? Text, JsonNode? Context);
    public record LogSwitch(bool Enabled, string? By);

    /// <summary>The browser's user and id (sent with every call), and the PC's address.</summary>
    public static (string? User, string? Browser, string? Client) Who(HttpContext ctx) => (
        ctx.User.Identity?.IsAuthenticated == true ? ctx.User.Identity.Name   // signed in: who it really is
        : DiagLog.Cut(ctx.Request.Headers["X-Gnezdo-User"].FirstOrDefault(), 100) is { Length: > 0 } u ? u : null,
        DiagLog.Cut(ctx.Request.Headers["X-Gnezdo-Browser"].FirstOrDefault(), 40) is { Length: > 0 } b ? b : null,
        ctx.Request.Headers["X-Forwarded-For"].FirstOrDefault()?.Split(',')[0].Trim() is { Length: > 0 } f ? f : ctx.Connection.RemoteIpAddress?.ToString());

    /// <summary>Calls that change something, fail or take long (over 2 s) are written; the polling
    /// (nest progress, CPU meter) and the log's own calls only when they fail.</summary>
    public static void UseDiagLog(this WebApplication app)
    {
        app.Use(async (ctx, next) =>
        {
            var path = ctx.Request.Path.Value ?? "";
            if (!path.StartsWith("/api", StringComparison.OrdinalIgnoreCase)) { await next(ctx); return; }
            var log = ctx.RequestServices.GetRequiredService<DiagLog>();
            var sw = Stopwatch.StartNew();
            try
            {
                await next(ctx);
            }
            catch (Exception ex)
            {
                var (u, b, c) = Who(ctx);
                log.Write("error", $"{ctx.Request.Method} {path} failed: {ex.Message}", new { error = ex.ToString() }, u, b, c);
                throw;
            }
            var status = ctx.Response.StatusCode;
            var ms = sw.ElapsedMilliseconds;
            var quiet = path.StartsWith("/api/logs", StringComparison.OrdinalIgnoreCase) || HttpMethods.IsGet(ctx.Request.Method);
            if (!quiet || status >= 400 || ms > 2000)
            {
                var (u, b, c) = Who(ctx);
                log.Write(status >= 500 ? "error" : "api", $"{ctx.Request.Method} {path}{ctx.Request.QueryString} {status} {ms} ms", null, u, b, c);
            }
        });
    }

    public static void MapDiagEndpoints(this WebApplication app)
    {
        app.MapGet("/api/logs/settings", (DiagLog log) =>
        {
            var (files, bytes, oldest) = log.Summary();
            return Results.Ok(new { enabled = log.Enabled, dir = log.Dir, files, sizeMb = Math.Round(bytes / 1048576.0, 1), oldest, keepDays = DiagLog.KeepDays });
        });
        app.MapPut("/api/logs/settings", (LogSwitch s, DiagLog log, HttpContext ctx) =>
        {
            if (!Gnezdo.Api.Auth.AuthEndpoints.Admin(ctx)) return Results.Json(new { message = "Only an admin can switch the log on or off." }, statusCode: StatusCodes.Status403Forbidden);
            log.SetEnabled(s.Enabled, ctx.User.Identity?.Name ?? DiagLog.Cut(s.By, 100));
            return Results.Ok(new { enabled = log.Enabled });
        });
        // the browsers' own events: what was clicked, run and failed there
        app.MapPost("/api/logs/client", (ClientBatch batch, HttpContext ctx, DiagLog log) =>
        {
            if (!log.Enabled) return Results.NoContent();
            var (_, _, client) = Who(ctx);
            foreach (var e in (batch.Events ?? []).Take(500))
                log.Write($"ui:{DiagLog.Cut(e.Kind, 30)}", e.Msg ?? "", e.Data, DiagLog.Cut(batch.User, 100), DiagLog.Cut(batch.Browser, 40), client, DiagLog.Cut(e.T, 40));
            return Results.NoContent();
        });
        // Settings -> Report a problem: a marked entry at the moment it happened
        app.MapPost("/api/logs/report", (ProblemReport r, HttpContext ctx, DiagLog log) =>
        {
            if (string.IsNullOrWhiteSpace(r.Text))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["text"] = ["Say what went wrong."] });
            if (!log.Enabled) return Results.Conflict(new { message = "The diagnostic log is switched off (Settings)." });
            var (_, _, client) = Who(ctx);
            log.Write("REPORT", $"PROBLEM REPORTED: {r.Text.Trim()}", r.Context, DiagLog.Cut(r.User, 100), DiagLog.Cut(r.Browser, 40), client);
            return Results.Ok(new { ok = true });
        });
        app.MapGet("/api/logs/download", (int? days, DiagLog log, TimeProvider clock) =>
        {
            var d = Math.Clamp(days ?? 3, 1, DiagLog.KeepDays);
            return Results.File(log.Zip(d), "application/zip", $"gnezdo-log-{clock.GetLocalNow():yyyyMMdd-HHmm}-{d}d.zip");
        });
    }
}
