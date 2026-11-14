using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Gnezdo.Api.Auth;
using Gnezdo.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Gnezdo.Api.Endpoints;

public record ApiKeyCreate(string? Name);
public record SentSheet(int Sheet, string? File, Dictionary<string, int>? Parts);
public record SentReport(string? Machine, bool All, IReadOnlyList<SentSheet>? Sheets, string? SentBy);
public record CheckItem(string? Drawing, string? Position, int? Needed);
public record CheckRequest(IReadOnlyList<CheckItem>? Drawings);
public record JobCutRequest(bool Cut, string? By);

/// <summary>
/// The status API (/api/v1, read only): other apps (a BOM app, a workflow overview) see which parts of an
/// order are in GNEZDO, in jobs, nested and sent to a machine, and which drawings never got imported.
/// They sign in with an API key (header X-Api-Key) an admin makes in the user menu; nothing can be
/// changed through it. "Sent" comes from POST PROCESS: every NC program written for a sheet of a saved
/// job is recorded (POST /api/jobs/{id}/sent, by the app itself).
/// See docs/STATUS-API.md.
/// </summary>
public static partial class StatusApi
{
    public const string KeyHeader = "X-Api-Key";

    public static string HashOf(string key) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(key.Trim())));

    // ------------------------------------------------------------------ part names

    /// <summary>A part name as the drawings name laser parts: {drawing}_{BOM position}_{pieces}kos
    /// (1234-56-78_P2_3kos; "-" also between them). Without a position: the whole name is the drawing.</summary>
    public sealed record NameParts(string Drawing, string Position, int? Pieces);

    [GeneratedRegex(@"^(?<d>.+?)[_-](?<p>P\d+[A-Z]*)(?:[_-](?<n>\d+)\s*(?:kos|kom|pcs)?)?$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex NameRx();

    public static NameParts ParseName(string name)
    {
        var t = name.Trim();
        var m = NameRx().Match(t);
        if (!m.Success) return new NameParts(t, "", null);
        int? n = m.Groups["n"].Success && int.TryParse(m.Groups["n"].Value, NumberStyles.None, CultureInfo.InvariantCulture, out var k) ? k : null;
        return new NameParts(m.Groups["d"].Value.Trim(), m.Groups["p"].Value.ToUpperInvariant(), n);
    }

    private static string Norm(string? s) => (s ?? "").Trim().Replace(" ", "", StringComparison.Ordinal).ToUpperInvariant();

    // ------------------------------------------------------------------ what a job's nest holds

    /// <summary>Pieces per part id of a job's saved nest (the solution shown), else empty.</summary>
    public static Dictionary<string, int> NestedOf(string nestJson)
    {
        var out_ = new Dictionary<string, int>();
        if (string.IsNullOrWhiteSpace(nestJson)) return out_;
        JsonNode? nest;
        try { nest = JsonNode.Parse(nestJson); } catch (JsonException) { return out_; }
        JsonNode? result = nest?["result"];
        if (result is null && nest?["solutions"] is JsonArray { Count: > 0 } all)
        {
            var selected = nest["selected"]?.GetValueKind() == JsonValueKind.String ? nest["selected"]!.GetValue<string>() : null;
            var shown = all.FirstOrDefault(s => s?["id"]?.GetValueKind() == JsonValueKind.String && s["id"]!.GetValue<string>() == selected) ?? all[^1];
            result = shown?["result"];
        }
        var sheets = result?["sheets"] as JsonArray ?? nest?["sheets"] as JsonArray;
        if (result?["nested"] is JsonObject counted)
        {
            foreach (var (k, v) in counted) if (v is JsonValue jv && jv.TryGetValue<double>(out var d)) out_[k] = (int)Math.Round(d);
            return out_;
        }
        foreach (var sh in sheets ?? new JsonArray())
        {
            var times = sh?["cutNumber"] is JsonValue c && c.TryGetValue<double>(out var cn) && cn >= 1 ? (int)cn : 1;
            foreach (var p in sh?["parts"] as JsonArray ?? new JsonArray())
                if (p?["partId"] is JsonValue id && id.TryGetValue<string>(out var pid)) out_[pid] = out_.GetValueOrDefault(pid) + times;
        }
        return out_;
    }

    private static Dictionary<string, int> PartsOf(string json)
    {
        try { return JsonSerializer.Deserialize<Dictionary<string, int>>(json) ?? []; }
        catch (JsonException) { return []; }
    }

    // ------------------------------------------------------------------ the status of a project's parts

    public sealed record SheetSent(int Sheet, string File, string Machine, int Pieces, DateTimeOffset SentAt, string SentBy);
    public sealed record JobLine(string Id, string Name, string Machine, int Qty, int Nested, int Sent,
        /// <summary>marked as cut by the operator: its pieces (sent, else nested) count as cut</summary>
        bool IsCut, DateTimeOffset? CutAt, string CutBy, int Cut, DateTimeOffset ModifiedAt, IReadOnlyList<SheetSent> Sheets);
    public sealed record PartStatus(
        string Id, string Name, string Drawing, string Position, int? PiecesPerDrawing, int Qty, string Material, decimal ThicknessMm,
        DateTimeOffset ImportedAt, int InJobs, int Nested, int Sent, DateTimeOffset? LastSentAt, int Cut,
        /// <summary>imported | inJob | nested | partlySent | sent | partlyCut | cut</summary>
        string Status, IReadOnlyList<JobLine> Jobs);

    private static string StatusOf(int qty, int inJobs, int nested, int sent, int cut) =>
        cut > 0 ? (cut >= Math.Max(1, qty) ? "cut" : "partlyCut") :
        sent > 0 ? (sent >= Math.Max(1, qty) ? "sent" : "partlySent") : nested > 0 ? "nested" : inJobs > 0 ? "inJob" : "imported";

    /// <summary>Every live part of the project with where it stands; null when there is no such project.</summary>
    private static async Task<(Project Project, List<PartStatus> Parts)?> ProjectStatusAsync(GnezdoDb db, string code, CancellationToken ct)
    {
        var project = await db.Projects.AsNoTracking().FirstOrDefaultAsync(p => p.Code == code.Trim(), ct);
        if (project is null) return null;
        var parts = await db.Parts.AsNoTracking().Live().Where(p => p.ProjectId == project.Id)
            .OrderBy(p => p.Name)
            .Select(p => new { p.Id, p.Name, p.Qty, Material = p.Material.Name, p.ThicknessMm, p.CreatedAt })
            .ToListAsync(ct);
        var ids = parts.Select(p => p.Id).ToList();
        var jobParts = await db.JobParts.AsNoTracking().Where(jp => ids.Contains(jp.PartId))
            .Select(jp => new { jp.JobId, jp.PartId, jp.Qty }).ToListAsync(ct);
        var jobIds = jobParts.Select(j => j.JobId).Distinct().ToList();
        var jobs = (await db.Jobs.AsNoTracking().Where(j => jobIds.Contains(j.Id))
            .Select(j => new { j.Id, j.Name, j.Machine, j.Nest, j.ModifiedAt, j.CutAt, j.CutBy }).ToListAsync(ct)).ToDictionary(j => j.Id);
        var nested = jobs.ToDictionary(j => j.Key, j => NestedOf(j.Value.Nest));
        var sent = (await db.NcSent.AsNoTracking().Where(s => jobIds.Contains(s.JobId)).ToListAsync(ct))
            .Select(s => (Row: s, Parts: PartsOf(s.Parts))).ToList();

        var list = new List<PartStatus>();
        foreach (var p in parts)
        {
            var key = p.Id.ToString(CultureInfo.InvariantCulture);
            var js = new List<JobLine>();
            foreach (var jp in jobParts.Where(x => x.PartId == p.Id).OrderBy(x => x.JobId))
            {
                if (!jobs.TryGetValue(jp.JobId, out var j)) continue;
                var sheets = sent.Where(s => s.Row.JobId == j.Id && s.Parts.GetValueOrDefault(key) > 0).OrderBy(s => s.Row.Sheet)
                    .Select(s => new SheetSent(s.Row.Sheet, s.Row.File, s.Row.Machine, s.Parts[key], s.Row.SentAt, s.Row.SentBy)).ToList();
                int nestedN = nested[j.Id].GetValueOrDefault(key), sentN = sheets.Sum(s => s.Pieces);
                js.Add(new JobLine(j.Id.ToString(CultureInfo.InvariantCulture), j.Name, j.Machine, jp.Qty, nestedN, sentN,
                    j.CutAt is not null, j.CutAt, j.CutBy, j.CutAt is null ? 0 : sentN > 0 ? sentN : nestedN, j.ModifiedAt, sheets));
            }
            var n = ParseName(p.Name);
            int inJobs = js.Sum(j => j.Qty), nest = js.Sum(j => j.Nested), sentT = js.Sum(j => j.Sent), cutT = js.Sum(j => j.Cut);
            var last = js.SelectMany(j => j.Sheets).Select(s => (DateTimeOffset?)s.SentAt).Max();
            list.Add(new PartStatus(key, p.Name, n.Drawing, n.Position, n.Pieces, p.Qty, p.Material, p.ThicknessMm, p.CreatedAt,
                inJobs, nest, sentT, last, cutT, StatusOf(p.Qty, inJobs, nest, sentT, cutT), js));
        }
        return (project, list);
    }

    // ------------------------------------------------------------------ endpoints

    public static void MapStatusApi(this WebApplication app)
    {
        // ---- API keys (admin): made, listed, removed
        app.MapGet("/api/apikeys", async (HttpContext ctx, GnezdoDb db, CancellationToken ct) =>
        {
            if (!AuthEndpoints.Admin(ctx)) return Forbidden();
            var keys = await db.ApiKeys.AsNoTracking().OrderBy(k => k.Name).ToListAsync(ct);
            return Results.Ok(keys.Select(View));
        });
        app.MapPost("/api/apikeys", async (ApiKeyCreate r, HttpContext ctx, GnezdoDb db, TimeProvider clock, CancellationToken ct) =>
        {
            if (!AuthEndpoints.Admin(ctx)) return Forbidden();
            var name = r.Name?.Trim() ?? "";
            if (name.Length is 0 or > 100) return Results.ValidationProblem(new Dictionary<string, string[]> { ["name"] = ["Give the key a name (the app that uses it), up to 100 characters."] });
            var key = "gz_" + Convert.ToBase64String(RandomNumberGenerator.GetBytes(30)).Replace('+', '-').Replace('/', '_').TrimEnd('=');
            var row = new ApiKey { Name = name, Hash = HashOf(key), Prefix = key[..10], CreatedAt = clock.GetUtcNow(), CreatedBy = ctx.User.Identity?.Name ?? "" };
            db.ApiKeys.Add(row);
            await db.SaveChangesAsync(ct);
            // the key itself only now: it is not kept
            return Results.Ok(new { key, info = View(row) });
        });
        app.MapDelete("/api/apikeys/{id:int}", async (int id, HttpContext ctx, GnezdoDb db, CancellationToken ct) =>
        {
            if (!AuthEndpoints.Admin(ctx)) return Forbidden();
            var row = await db.ApiKeys.FirstOrDefaultAsync(k => k.Id == id, ct);
            if (row is null) return Results.NotFound();
            db.ApiKeys.Remove(row);
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        // ---- POST PROCESS: what was sent to the machine (NC programs of a saved job's sheets)
        app.MapPost("/api/jobs/{id:int}/sent", async (int id, SentReport r, HttpContext ctx, GnezdoDb db, TimeProvider clock, CancellationToken ct) =>
        {
            var job = await db.Jobs.AsNoTracking().FirstOrDefaultAsync(j => j.Id == id, ct);
            if (job is null) return Results.NotFound(new { message = "Save the job first: there is no such saved job." });
            var sheets = (r.Sheets ?? []).Where(s => s.Sheet > 0).GroupBy(s => s.Sheet).Select(g => g.Last()).ToList();
            var numbers = sheets.Select(s => s.Sheet).ToHashSet();
            var old = await db.NcSent.Where(s => s.JobId == id).ToListAsync(ct);
            // the same sheets written again replace their records; all sheets: the job's others are gone
            db.NcSent.RemoveRange(old.Where(s => numbers.Contains(s.Sheet) || r.All));
            var now = clock.GetUtcNow();
            var by = ctx.User.Identity?.Name ?? (r.SentBy ?? "").Trim();
            foreach (var s in sheets)
            {
                var parts = (s.Parts ?? []).Where(kv => kv.Value > 0).ToDictionary(kv => kv.Key, kv => kv.Value);
                db.NcSent.Add(new NcSent
                {
                    JobId = id, JobName = Cut(job.Name, 200), Sheet = s.Sheet, Machine = Cut(r.Machine ?? job.Machine, 50),
                    File = Cut(s.File ?? "", 260), Parts = JsonSerializer.Serialize(parts), SentAt = now, SentBy = Cut(by, 100),
                });
            }
            await db.SaveChangesAsync(ct);
            return Results.Ok(new { recorded = sheets.Count });
        });

        // ---- the operator marks a saved job as cut (or not): other apps see it
        app.MapPut("/api/jobs/{id:int}/cut", async (int id, JobCutRequest r, HttpContext ctx, GnezdoDb db, TimeProvider clock, CancellationToken ct) =>
        {
            var job = await db.Jobs.FirstOrDefaultAsync(j => j.Id == id, ct);
            if (job is null) return Results.NotFound(new { message = "There is no such saved job." });
            if (r.Cut)
            {
                job.CutAt ??= clock.GetUtcNow();
                job.CutBy = Cut(ctx.User.Identity?.Name ?? (r.By ?? "").Trim(), 100);
                job.Status = Data.JobStatus.Cut;
            }
            else
            {
                job.CutAt = null;
                job.CutBy = "";
                job.Status = job.SheetCount > 0 ? Data.JobStatus.Nested : Data.JobStatus.Draft;
            }
            await db.SaveChangesAsync(ct);
            return Results.Ok(new { id = job.Id.ToString(CultureInfo.InvariantCulture), status = job.Status.ToString().ToLowerInvariant(), cutAt = job.CutAt, cutBy = job.CutBy });
        });

        // ---- the status API itself: an API key for every call
        var v1 = app.MapGroup("/api/v1").AddEndpointFilter(async (fc, next) =>
        {
            var http = fc.HttpContext;
            var given = http.Request.Headers[KeyHeader].FirstOrDefault();
            if (string.IsNullOrWhiteSpace(given) && http.Request.Headers.Authorization.FirstOrDefault() is { } auth && auth.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
                given = auth[7..];
            if (string.IsNullOrWhiteSpace(given))
                return Results.Json(new { message = $"An API key is needed (header {KeyHeader}). An admin makes one in GNEZDO: user menu → Status API keys." }, statusCode: StatusCodes.Status401Unauthorized);
            var db = http.RequestServices.GetRequiredService<GnezdoDb>();
            var hash = HashOf(given);
            var key = await db.ApiKeys.FirstOrDefaultAsync(k => k.Hash == hash, http.RequestAborted);
            if (key is null) return Results.Json(new { message = "This API key is not valid (removed, or mistyped)." }, statusCode: StatusCodes.Status401Unauthorized);
            var now = http.RequestServices.GetRequiredService<TimeProvider>().GetUtcNow();
            if (key.LastUsedAt is null || now - key.LastUsedAt.Value > TimeSpan.FromMinutes(1))
            {
                key.LastUsedAt = now;
                await db.SaveChangesAsync(http.RequestAborted);
            }
            return await next(fc);
        });

        v1.MapGet("", () => Results.Ok(new
        {
            name = "GNEZDO status API",
            version = 1,
            readOnly = true,
            endpoints = new[]
            {
                "GET  /api/v1/projects/{code}         every part of the project: in jobs, nested, sent to a machine",
                "POST /api/v1/projects/{code}/check   {\"drawings\":[{\"drawing\":\"1234-56-78\",\"position\":\"P2\",\"needed\":6}]}: each drawing found or missing",
            },
        }));

        v1.MapGet("/projects/{code}", async (string code, GnezdoDb db, TimeProvider clock, CancellationToken ct) =>
        {
            var st = await ProjectStatusAsync(db, code, ct);
            if (st is null) return Results.NotFound(new { message = $"There is no project {code} in GNEZDO." });
            var (p, parts) = st.Value;
            return Results.Ok(new { project = new { p.Code, p.Name, p.Customer }, at = clock.GetUtcNow(), parts });
        });

        v1.MapPost("/projects/{code}/check", async (string code, CheckRequest r, GnezdoDb db, TimeProvider clock, CancellationToken ct) =>
        {
            var st = await ProjectStatusAsync(db, code, ct);
            var parts = st?.Parts ?? [];
            var used = new HashSet<string>();
            var items = new List<object>();
            foreach (var it in r.Drawings ?? [])
            {
                var drawing = Norm(it.Drawing);
                if (drawing.Length == 0) continue;
                var pos = Norm(it.Position);
                List<PartStatus> Match(string d) => parts.Where(x => Norm(x.Drawing) == d && (pos.Length == 0 || Norm(x.Position) == pos)).ToList();
                var found = Match(drawing);
                string? mergedWith = null;
                // a mirrored drawing (…ZR) is usually cut under its base drawing, the quantities merged
                if (found.Count == 0 && drawing.EndsWith("ZR", StringComparison.Ordinal) && drawing.Length > 2)
                {
                    found = Match(drawing[..^2].TrimEnd('-', '_'));
                    if (found.Count > 0) mergedWith = found[0].Drawing;
                }
                foreach (var f in found) used.Add(f.Id);
                int sent = found.Sum(f => f.Sent), inJobs = found.Sum(f => f.InJobs), nested = found.Sum(f => f.Nested), cut = found.Sum(f => f.Cut);
                var status = found.Count == 0 ? "missing"
                    : found.All(f => f.Status == "cut") ? "cut"
                    : found.Any(f => f.Cut > 0) ? "partlyCut"
                    : found.All(f => f.Status == "sent") ? "sent"
                    : found.Any(f => f.Sent > 0) ? "partlySent"
                    : found.Any(f => f.Nested > 0) ? "nested"
                    : found.Any(f => f.InJobs > 0) ? "inJob" : "imported";
                // pieces still to send: only where one part answers the line (one position)
                int? shortBy = it.Needed is int need && found.Count == 1 && mergedWith is null ? Math.Max(0, need - sent) : null;
                items.Add(new
                {
                    drawing = it.Drawing?.Trim(), position = it.Position?.Trim() ?? "", needed = it.Needed,
                    status, mergedWithBase = mergedWith, inJobs, nested, sent, cut, @short = shortBy, parts = found,
                });
            }
            return Results.Ok(new
            {
                project = code.Trim(), projectFound = st is not null, at = clock.GetUtcNow(), items,
                // parts GNEZDO has for the project that no line asked about
                notInList = parts.Where(x => !used.Contains(x.Id)).Select(x => x.Name).ToList(),
            });
        });
    }

    private static object View(ApiKey k) => new { id = k.Id, name = k.Name, prefix = k.Prefix, createdAt = k.CreatedAt, createdBy = k.CreatedBy, lastUsedAt = k.LastUsedAt };

    private static IResult Forbidden() => Results.Json(new { message = "Only an admin can do that." }, statusCode: StatusCodes.Status403Forbidden);

    private static string Cut(string s, int n) => s.Length <= n ? s : s[..n];
}
