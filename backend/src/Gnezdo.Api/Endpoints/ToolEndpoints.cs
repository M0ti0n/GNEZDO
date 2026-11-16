using System.Diagnostics;
using System.IO.Compression;
using System.Text;
using Gnezdo.Api.Desktop;

namespace Gnezdo.Api.Endpoints;

/// <summary>
/// Special tools as plug-ins, the desktop's tools folder (%LOCALAPPDATA%\GNEZDO\tools): each tool a folder
/// with tool.json (or a .gnezdo-tool.zip), read as they are now, so a tool being written is tried with
/// Settings -> Special tools -> Reload. GNEZDO only reads the files and hands them to the page: a tool's
/// script never runs here, only in the browser's sandbox. Added tools (Settings -> Add tool) are kept in
/// the "specialTools" setting instead, on the desktop and on the server.
/// </summary>
public static class ToolEndpoints
{
    /// <summary>A tool's files together at most (as the page's limit).</summary>
    public const int MaxToolBytes = 512 * 1024;
    private const int MaxTools = 100;
    private static readonly string[] TextFiles = [".json", ".js", ".svg"];

    public sealed record FolderTool(string Name, Dictionary<string, string> Files);
    public sealed record FolderProblem(string Name, string Message);

    public static string ToolsDir(DesktopHost desktop) => Path.Combine(desktop.Root, "tools");

    public static void MapToolEndpoints(this WebApplication app, DesktopHost desktop)
    {
        app.MapGet("/api/tools/folder", () =>
        {
            var dir = ToolsDir(desktop);
            var tools = new List<FolderTool>();
            var problems = new List<FolderProblem>();
            if (Directory.Exists(dir))
            {
                foreach (var sub in Directory.EnumerateDirectories(dir).Order(StringComparer.OrdinalIgnoreCase))
                {
                    if (tools.Count >= MaxTools) break;
                    var name = Path.GetFileName(sub);
                    if (name.StartsWith('.') || name.StartsWith('_')) continue;   // _off, .git: not tools
                    try
                    {
                        if (!File.Exists(Path.Combine(sub, "tool.json"))) { problems.Add(new(name, "There is no tool.json in this folder")); continue; }
                        tools.Add(new(name, ReadFolder(sub)));
                    }
                    catch (Exception e) when (e is IOException or UnauthorizedAccessException or InvalidDataException) { problems.Add(new(name, e.Message)); }
                }
                foreach (var file in Directory.EnumerateFiles(dir, "*.zip").Order(StringComparer.OrdinalIgnoreCase))
                {
                    if (tools.Count >= MaxTools) break;
                    var name = Path.GetFileName(file);
                    try { tools.Add(new(name, ReadZip(file))); }
                    catch (Exception e) when (e is IOException or UnauthorizedAccessException or InvalidDataException) { problems.Add(new(name, e.Message)); }
                }
            }
            return Results.Ok(new { folder = dir, tools, problems });
        });

        // made when missing, then shown in Explorer / the file manager
        app.MapPost("/api/tools/open-folder", () =>
        {
            var dir = ToolsDir(desktop);
            try
            {
                Directory.CreateDirectory(dir);
                if (OperatingSystem.IsWindows()) Process.Start(new ProcessStartInfo("explorer.exe", $"\"{dir}\"") { UseShellExecute = false });
                else Process.Start(new ProcessStartInfo("xdg-open", dir) { UseShellExecute = false });
                return Results.NoContent();
            }
            catch (Exception e) when (e is System.ComponentModel.Win32Exception or IOException or InvalidOperationException or UnauthorizedAccessException)
            {
                return Results.Json(new { message = $"Could not open {dir}: {e.Message}" }, statusCode: StatusCodes.Status500InternalServerError);
            }
        });
    }

    /// <summary>The tool's text files (tool.json, *.js, *.svg) in its folder and one level below.</summary>
    private static Dictionary<string, string> ReadFolder(string dir)
    {
        var files = new Dictionary<string, string>(StringComparer.Ordinal);
        long total = 0;
        foreach (var f in Directory.EnumerateFiles(dir, "*", new EnumerationOptions { RecurseSubdirectories = true, MaxRecursionDepth = 1 }))
        {
            if (!TextFiles.Contains(Path.GetExtension(f).ToLowerInvariant())) continue;
            var len = new FileInfo(f).Length;
            total += len;
            if (total > MaxToolBytes) throw new InvalidDataException($"The tool is too big (at most {MaxToolBytes / 1024} KB of .json, .js and .svg)");
            files[Path.GetRelativePath(dir, f).Replace('\\', '/')] = File.ReadAllText(f, Encoding.UTF8);
        }
        return files;
    }

    private static Dictionary<string, string> ReadZip(string file)
    {
        var files = new Dictionary<string, string>(StringComparer.Ordinal);
        long total = 0;
        using var z = ZipFile.OpenRead(file);
        foreach (var e in z.Entries)
        {
            if (e.FullName.EndsWith('/') || !TextFiles.Contains(Path.GetExtension(e.FullName).ToLowerInvariant())) continue;
            total += e.Length;
            if (total > MaxToolBytes) throw new InvalidDataException($"The tool is too big (at most {MaxToolBytes / 1024} KB of .json, .js and .svg)");
            using var s = e.Open();
            using var r = new StreamReader(s, Encoding.UTF8);
            files[e.FullName] = r.ReadToEnd();
        }
        return files;
    }
}
