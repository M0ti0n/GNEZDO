using System.Diagnostics;
using System.Text;

namespace Gnezdo.Api.Endpoints;

/// <summary>
/// DWG drawings: the app reads DXF, so a DWG is converted to DXF here, by a converter on the server's
/// PC: the ODA File Converter (free, installed by the user) or LibreDWG's dwg2dxf. Either is found by
/// itself (its usual install folder, next to GNEZDO in "tools", or on the PATH), or set with
/// "Gnezdo:DwgConverter" in the config (or the GNEZDO_DWG_CONVERTER environment variable).
/// </summary>
public static class DwgEndpoints
{
    public sealed record Converter(string Kind, string Path);

    private const long MaxBytes = 100L * 1024 * 1024;

    private static Converter? Of(string? path)
    {
        if (string.IsNullOrWhiteSpace(path) || !File.Exists(path)) return null;
        var name = System.IO.Path.GetFileNameWithoutExtension(path);
        return new Converter(name.Contains("ODAFileConverter", StringComparison.OrdinalIgnoreCase) ? "oda" : "libredwg", path);
    }

    /// <summary>The converter to use, or null when there is none.</summary>
    public static Converter? Find(IConfiguration config)
    {
        if (Of(config["Gnezdo:DwgConverter"]) is { } c) return c;
        if (Of(Environment.GetEnvironmentVariable("GNEZDO_DWG_CONVERTER")) is { } e) return e;
        var exe = OperatingSystem.IsWindows() ? ".exe" : "";
        // ODA File Converter in its install folders (the newest version first)
        var roots = OperatingSystem.IsWindows()
            ? new[] { Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86) }
                .Where(r => r.Length > 0).Select(r => System.IO.Path.Combine(r, "ODA"))
            : new[] { "/opt", "/usr/bin" };
        foreach (var root in roots.Where(Directory.Exists))
        {
            var direct = System.IO.Path.Combine(root, "ODAFileConverter" + exe);
            if (Of(direct) is { } d) return d;
            foreach (var dir in Directory.GetDirectories(root, "ODAFileConverter*").OrderByDescending(x => x, StringComparer.OrdinalIgnoreCase))
                if (Of(System.IO.Path.Combine(dir, "ODAFileConverter" + exe)) is { } o) return o;
        }
        // LibreDWG's dwg2dxf next to GNEZDO or on the PATH
        var here = AppContext.BaseDirectory;
        foreach (var p in new[] { System.IO.Path.Combine(here, "tools", "dwg2dxf" + exe), System.IO.Path.Combine(here, "..", "tools", "dwg2dxf" + exe), System.IO.Path.Combine(here, "dwg2dxf" + exe) })
            if (Of(System.IO.Path.GetFullPath(p)) is { } l) return l;
        foreach (var dir in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(System.IO.Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
            if (Of(System.IO.Path.Combine(dir, "dwg2dxf" + exe)) is { } l) return l;
        return null;
    }

    /// <summary>The DXF text of a DWG, or why not.</summary>
    public static async Task<(string? Dxf, string? Error)> ConvertAsync(Converter conv, Stream dwg, CancellationToken ct)
    {
        var work = Directory.CreateTempSubdirectory("gnezdo-dwg-").FullName;
        try
        {
            var inDir = Directory.CreateDirectory(System.IO.Path.Combine(work, "in")).FullName;
            var outDir = Directory.CreateDirectory(System.IO.Path.Combine(work, "out")).FullName;
            var src = System.IO.Path.Combine(inDir, "drawing.dwg");
            await using (var f = File.Create(src)) await dwg.CopyToAsync(f, ct);
            var dst = System.IO.Path.Combine(outDir, "drawing.dxf");
            var psi = new ProcessStartInfo(conv.Path) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
            if (conv.Kind == "oda")
                foreach (var a in new[] { inDir, outDir, "ACAD2018", "DXF", "0", "1", "*.DWG" }) psi.ArgumentList.Add(a);
            else
                foreach (var a in new[] { "-y", "-o", dst, src }) psi.ArgumentList.Add(a);
            using var p = Process.Start(psi);
            if (p is null) return (null, "The DWG converter did not start.");
            var err = p.StandardError.ReadToEndAsync(ct);
            var stdout = p.StandardOutput.ReadToEndAsync(ct);
            using var limit = CancellationTokenSource.CreateLinkedTokenSource(ct);
            limit.CancelAfter(TimeSpan.FromMinutes(2));
            try { await p.WaitForExitAsync(limit.Token); }
            catch (OperationCanceledException)
            {
                try { p.Kill(true); } catch (InvalidOperationException) { }
                return (null, "The DWG converter took too long.");
            }
            if (!File.Exists(dst))
            {
                var why = ((await err) + " " + (await stdout)).Trim();
                return (null, $"The DWG converter could not read it{(why.Length > 0 ? $": {why[..Math.Min(300, why.Length)]}" : ".")}");
            }
            return (await File.ReadAllTextAsync(dst, Encoding.UTF8, ct), null);
        }
        finally
        {
            try { Directory.Delete(work, true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
        }
    }

    public static void MapDwgEndpoints(this WebApplication app)
    {
        // can this server read DWG?
        app.MapGet("/api/import/dwg", (IConfiguration config) =>
        {
            var c = Find(config);
            return Results.Ok(new { available = c is not null, converter = c is null ? null : c.Kind == "oda" ? "ODA File Converter" : "LibreDWG dwg2dxf" });
        });
        // a DWG (the request body) as DXF text
        app.MapPost("/api/import/dwg", async (HttpRequest req, IConfiguration config, CancellationToken ct) =>
        {
            var c = Find(config);
            if (c is null) return Results.Json(new { message = "This server cannot read DWG: install the ODA File Converter (free) on it, or put LibreDWG's dwg2dxf in GNEZDO's tools folder (INSTALL.txt). Or save the drawing as DXF." }, statusCode: StatusCodes.Status409Conflict);
            if (req.ContentLength is > MaxBytes) return Results.Json(new { message = "The DWG is too big (100 MB at most)." }, statusCode: StatusCodes.Status413PayloadTooLarge);
            var (dxf, error) = await ConvertAsync(c, req.Body, ct);
            return dxf is null
                ? Results.Json(new { message = error }, statusCode: StatusCodes.Status422UnprocessableEntity)
                : Results.Text(dxf, "text/plain", Encoding.UTF8);
        });
    }
}
