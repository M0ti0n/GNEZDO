using System.Text.Json;
using System.Text.Json.Nodes;
using Gnezdo.Api.Auth;
using Gnezdo.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Gnezdo.Api.Endpoints;

public record FolderCheckRequest(string? Path);
public record NcWriteRequest(string? Name, string? Content);

/// <summary>
/// A machine's folders (Settings -> Machines -> Machine -> Folders), written by this server: its NC
/// programs, and when "Also write a job file" is ticked a file of every job saved for it. The paths are
/// on the server's PC (or a network share it reaches); they come from the machine in the "machines"
/// setting, never from the request, so only an admin decides where GNEZDO writes.
/// </summary>
public static class MachineFolders
{
    public sealed record Folders(string Jobs, string Nc, bool JobFile, bool NcDownload);

    private static readonly Folders None = new("", "", false, false);
    private static readonly JsonSerializerOptions Indented = new() { WriteIndented = true };

    private static string Str(JsonNode? n) => n is JsonValue v && v.TryGetValue<string>(out var s) ? s : "";
    private static bool Bool(JsonNode? n) => n is JsonValue v && v.TryGetValue<bool>(out var b) && b;

    /// <summary>The machine's folders; empty id = the default machine; unknown machine = null.</summary>
    public static async Task<Folders?> FindAsync(GnezdoDb db, string? machineId, CancellationToken ct)
    {
        var s = await db.Settings.AsNoTracking().FirstOrDefaultAsync(x => x.Key == "machines", ct);
        if (string.IsNullOrWhiteSpace(s?.Value)) return null;
        JsonNode? root;
        try { root = JsonNode.Parse(s.Value); } catch (JsonException) { return null; }
        if (root?["list"] is not JsonArray list) return null;
        var id = string.IsNullOrWhiteSpace(machineId) ? Str(root["defaultId"]) : machineId.Trim();
        var m = list.OfType<JsonObject>().FirstOrDefault(x => Str(x["id"]) == id);
        if (m is null) return null;
        if (m["folders"] is not JsonObject f) return None;
        return new Folders(Str(f["jobs"]).Trim(), Str(f["nc"]).Trim(), Bool(f["jobFile"]), Bool(f["ncDownload"]));
    }

    /// <summary>A file name safe on Windows and Linux (no folders in it).</summary>
    public static string SafeName(string? name, string fallback)
    {
        var bad = "<>:\"/\\|?*".ToHashSet();
        var s = new string((name ?? "").Select(c => c < 32 || bad.Contains(c) ? '_' : c).ToArray()).Trim().TrimEnd('.', ' ');
        if (s.Length > 150) s = s[..150];
        return s.Length == 0 || s.All(c => c == '.') ? fallback : s;
    }

    /// <summary>Why the server cannot write there, or null when it can.</summary>
    public static string? Problem(string folder)
    {
        if (folder.Length == 0) return "No folder set.";
        if (!Path.IsPathFullyQualified(folder)) return @"Give the full path, e.g. D:\NC\Plasma or \\server\share\NC.";
        if (!Directory.Exists(folder)) return $"The server cannot find {folder}.";
        return null;
    }

    public static void MapMachineFolderEndpoints(this WebApplication app)
    {
        // Settings: can the server write to this folder? (admin: it tells about the server's disks)
        app.MapPost("/api/folders/check", (FolderCheckRequest r, HttpContext ctx) =>
        {
            if (!AuthEndpoints.Admin(ctx)) return Results.Json(new { message = "Only an admin can check folders." }, statusCode: StatusCodes.Status403Forbidden);
            var p = (r.Path ?? "").Trim();
            if (Problem(p) is { } why) return Results.Ok(new { ok = false, message = why });
            try
            {
                var t = Path.Combine(p, $".gnezdo-check-{Guid.NewGuid():N}.tmp");
                File.WriteAllText(t, "");
                File.Delete(t);
                return Results.Ok(new { ok = true, message = $"The server can write to {p}." });
            }
            catch (Exception e) when (e is UnauthorizedAccessException or IOException)
            {
                return Results.Ok(new { ok = false, message = $"The server cannot write to {p}: {e.Message}" });
            }
        });

        // is there an NC program of this name in the machine's NC folder already? (POST PROCESS asks before replacing it)
        app.MapGet("/api/machines/{id}/nc/exists", async (string id, string? name, GnezdoDb db, CancellationToken ct) =>
        {
            var f = await FindAsync(db, id, ct);
            if (f is null || f.Nc.Length == 0 || Problem(f.Nc) is not null) return Results.Ok(new { exists = false });
            return Results.Ok(new { exists = File.Exists(Path.Combine(f.Nc, SafeName(name, "program.nc"))) });
        });

        // an NC program into the machine's NC folder (409: no folder set, the app may download it instead)
        app.MapPost("/api/machines/{id}/nc", async (string id, NcWriteRequest r, GnezdoDb db, CancellationToken ct) =>
        {
            var f = await FindAsync(db, id, ct);
            if (f is null) return Results.Json(new { message = "There is no such machine." }, statusCode: StatusCodes.Status404NotFound);
            if (f.Nc.Length == 0) return Results.Json(new { message = "This machine has no NC folder (Settings → Machines → Machine → Folders)." }, statusCode: StatusCodes.Status409Conflict);
            if (Problem(f.Nc) is { } why) return Results.Json(new { message = $"NC folder: {why}" }, statusCode: StatusCodes.Status409Conflict);
            var path = Path.Combine(f.Nc, SafeName(r.Name, "program.nc"));
            try
            {
                await File.WriteAllTextAsync(path, r.Content ?? "", ct);
                return Results.Ok(new { path });
            }
            catch (Exception e) when (e is UnauthorizedAccessException or IOException)
            {
                return Results.Json(new { message = $"Could not write {path}: {e.Message}" }, statusCode: StatusCodes.Status500InternalServerError);
            }
        });
    }

    /// <summary>
    /// After a job is saved: its file in the machine's job folder when the machine asks for one, with the
    /// parts' drawings (a whole copy of the job). (file written, problem); both null = no file wanted.
    /// </summary>
    public static async Task<(string? File, string? Error)> WriteJobFileAsync(GnezdoDb db, Job job, CancellationToken ct)
    {
        var f = await FindAsync(db, job.Machine, ct);
        if (f is null || !f.JobFile) return (null, null);
        if (Problem(f.Jobs) is { } why) return (null, $"Job folder: {why}");
        var parts = await db.JobParts.AsNoTracking().Where(jp => jp.JobId == job.Id)
            .Include(jp => jp.Part).ThenInclude(p => p.Material).Include(jp => jp.Part).ThenInclude(p => p.Project)
            .OrderBy(jp => jp.No).ToListAsync(ct);
        JsonNode? Parse(string json)
        {
            if (string.IsNullOrWhiteSpace(json)) return null;
            try { return JsonNode.Parse(json); } catch (JsonException) { return null; }
        }
        var doc = new JsonObject
        {
            ["format"] = "gnezdo-job", ["version"] = 1,
            ["id"] = job.Id.ToString(), ["name"] = job.Name, ["machine"] = job.Machine, ["status"] = job.Status.ToString().ToLowerInvariant(),
            ["createdAt"] = job.CreatedAt, ["modifiedAt"] = job.ModifiedAt, ["modifiedBy"] = job.ModifiedBy,
            ["parts"] = new JsonArray(parts.Select(jp => (JsonNode)new JsonObject
            {
                ["no"] = jp.No, ["qty"] = jp.Qty, ["qtyMax"] = jp.QtyMax,
                ["material"] = jp.Material ?? jp.Part.Material.Name, ["thicknessMm"] = jp.ThicknessMm ?? jp.Part.ThicknessMm,
                ["part"] = new JsonObject
                {
                    ["id"] = jp.PartId.ToString(), ["name"] = jp.Part.Name, ["description"] = jp.Part.Description,
                    ["project"] = jp.Part.Project?.Code, ["material"] = jp.Part.Material.Name, ["thicknessMm"] = jp.Part.ThicknessMm,
                    ["widthMm"] = jp.Part.WidthMm, ["heightMm"] = jp.Part.HeightMm, ["areaMm2"] = jp.Part.AreaMm2,
                    ["outlinePath"] = jp.Part.OutlinePath, ["geometry"] = Parse(jp.Part.Geometry),
                    ["rotations"] = jp.Part.Rotations, ["mirror"] = jp.Part.Mirror, ["filler"] = jp.Part.Filler,
                    ["commonCut"] = jp.Part.CommonCut, ["sourceFile"] = jp.Part.SourceFile, ["revision"] = jp.Part.Revision,
                },
            }).ToArray()),
            ["stock"] = Parse(job.Stock), ["nest"] = Parse(job.Nest),
        };
        var path = Path.Combine(f.Jobs, $"{SafeName(job.Name, "job")} ({job.Id}).gnezdo-job.json");
        try
        {
            await File.WriteAllTextAsync(path, doc.ToJsonString(Indented), ct);
            return (path, null);
        }
        catch (Exception e) when (e is UnauthorizedAccessException or IOException)
        {
            return (null, $"Could not write {path}: {e.Message}");
        }
    }
}
