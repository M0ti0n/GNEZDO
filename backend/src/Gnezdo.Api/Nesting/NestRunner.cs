using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;

namespace Gnezdo.Api.Nesting;

/// <summary>Where the nesting engine is ("Nesting" section of the settings). Empty = found next to the program.</summary>
public class NestingOptions
{
    /// <summary>Python that runs nestprep (Windows build: nesting\python\python.exe; elsewhere python3).</summary>
    public string Python { get; set; } = "";
    /// <summary>nestprep_cli.py.</summary>
    public string Script { get; set; } = "";
    /// <summary>PackingSolver (packingsolver_irregular[.exe]).</summary>
    public string Solver { get; set; } = "";
    /// <summary>Folder for the runs' files; empty = the system's temporary folder.</summary>
    public string RunsDir { get; set; } = "";
    /// <summary>Runs at the same time; more wait in a queue.</summary>
    public int MaxRuns { get; set; } = 2;
}

public enum NestState { Queued, Running, Done, Stopped, Error }

/// <summary>
/// Runs nestings: each run is nestprep_cli.py run request.json RUNDIR in its own process, which
/// writes progress.json while it works and result.json at the end. A file "stop" in RUNDIR ends it,
/// keeping the best layout so far. Runs live in memory; their folders are removed after a day.
/// </summary>
public sealed class NestRunner : IDisposable
{
    private sealed class Run
    {
        public required string Id { get; init; }
        public required string Dir { get; init; }
        public DateTimeOffset Created { get; init; }
        public DateTimeOffset? Started { get; set; }
        public DateTimeOffset? Finished { get; set; }
        public NestState State { get; set; } = NestState.Queued;
        public bool StopAsked { get; set; }
        public string? Error { get; set; }
        public Process? Process { get; set; }
        public readonly System.Text.StringBuilder Stderr = new();
    }

    private readonly ConcurrentDictionary<string, Run> _runs = new();
    private readonly SemaphoreSlim _slots;
    private readonly ILogger<NestRunner> _log;
    private readonly TimeProvider _clock;
    private readonly string _runsDir;
    public string Python { get; }
    public string Script { get; }
    public string Solver { get; }

    public NestRunner(IOptions<NestingOptions> options, ILogger<NestRunner> log, TimeProvider clock)
    {
        var o = options.Value;
        _log = log;
        _clock = clock;
        _slots = new SemaphoreSlim(Math.Max(1, o.MaxRuns));
        var exe = OperatingSystem.IsWindows() ? ".exe" : "";
        // Windows build: GNEZDO\program\GNEZDO.exe and GNEZDO\nesting\...; Docker: /app and /app/nesting
        var nesting = new[] { Path.Combine(AppContext.BaseDirectory, "..", "nesting"), Path.Combine(AppContext.BaseDirectory, "nesting") }
            .Select(Path.GetFullPath).FirstOrDefault(Directory.Exists) ?? Path.Combine(AppContext.BaseDirectory, "nesting");
        Python = o.Python is { Length: > 0 } p ? p
            : File.Exists(Path.Combine(nesting, "python", "python" + exe)) ? Path.Combine(nesting, "python", "python" + exe)
            : OperatingSystem.IsWindows() ? "python" : "python3";
        Script = o.Script is { Length: > 0 } s ? s : Path.Combine(nesting, "nestprep", "nestprep_cli.py");
        Solver = o.Solver is { Length: > 0 } v ? v : Path.Combine(nesting, "packingsolver_irregular" + exe);
        _runsDir = o.RunsDir is { Length: > 0 } d ? d : Path.Combine(Path.GetTempPath(), "gnezdo-nest");
        Directory.CreateDirectory(_runsDir);
        CleanOld();
    }

    /// <summary>Why nesting cannot run here, or null when it can.</summary>
    public string? Missing()
    {
        if (!File.Exists(Script)) return $"The nesting engine is not installed (missing {Script}).";
        if (!File.Exists(Solver)) return $"PackingSolver is not installed (missing {Solver}).";
        return null;
    }

    public string Start(JsonObject request)
    {
        var id = Guid.NewGuid().ToString("N")[..12];
        var dir = Path.Combine(_runsDir, id);
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "request.json"), request.ToJsonString());
        var run = new Run { Id = id, Dir = dir, Created = _clock.GetUtcNow() };
        _runs[id] = run;
        _ = Task.Run(() => ExecuteAsync(run));
        return id;
    }

    private async Task ExecuteAsync(Run run)
    {
        await _slots.WaitAsync();
        try
        {
            if (run.StopAsked) { run.State = NestState.Stopped; return; }  // stopped while waiting
            var psi = new ProcessStartInfo(Python)
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                WorkingDirectory = run.Dir,
            };
            foreach (var a in new[] { "-u", Script, "run", Path.Combine(run.Dir, "request.json"), run.Dir, "--solver", Solver })
                psi.ArgumentList.Add(a);
            psi.Environment["PYTHONIOENCODING"] = "utf-8";
            var proc = new Process { StartInfo = psi };
            proc.ErrorDataReceived += (_, e) => { if (e.Data is not null) lock (run.Stderr) { if (run.Stderr.Length < 20_000) run.Stderr.AppendLine(e.Data); } };
            proc.OutputDataReceived += (_, _) => { };
            run.Started = _clock.GetUtcNow();
            run.State = NestState.Running;
            proc.Start();
            run.Process = proc;
            proc.BeginErrorReadLine();
            proc.BeginOutputReadLine();
            await proc.WaitForExitAsync();
            var result = ReadJson(Path.Combine(run.Dir, "result.json"));
            var state = result?["state"]?.GetValue<string>();
            run.State = state switch
            {
                "done" => NestState.Done,
                "stopped" => NestState.Stopped,
                _ => NestState.Error,
            };
            if (run.State == NestState.Error)
            {
                var errs = result?["errors"]?.AsArray().Select(e => e?.GetValue<string>()).Where(e => e is not null);
                lock (run.Stderr) run.Error = errs?.Any() == true ? string.Join("; ", errs)
                    : $"The nesting engine stopped (exit code {proc.ExitCode}). {Tail(run.Stderr.ToString())}";
                _log.LogWarning("Nest run {Id} failed: {Error}", run.Id, run.Error);
            }
        }
        catch (Exception ex)
        {
            run.State = NestState.Error;
            run.Error = $"The nesting engine could not start ({Python}): {ex.Message}";
            _log.LogWarning(ex, "Nest run {Id} could not start", run.Id);
        }
        finally
        {
            run.Finished = _clock.GetUtcNow();
            _slots.Release();
        }
    }

    private static string Tail(string s) => s.Length > 600 ? "..." + s[^600..] : s;

    /// <summary>Stop and keep the best layout so far. False when there is no such run.</summary>
    public bool Stop(string id)
    {
        if (!_runs.TryGetValue(id, out var run)) return false;
        run.StopAsked = true;
        try { File.WriteAllText(Path.Combine(run.Dir, "stop"), ""); } catch (IOException) { }
        return true;
    }

    /// <summary>State, progress and (when finished) the result of a run; null when unknown.</summary>
    public JsonObject? Get(string id)
    {
        if (!_runs.TryGetValue(id, out var run)) return null;
        var now = _clock.GetUtcNow();
        var o = new JsonObject
        {
            ["id"] = run.Id,
            ["state"] = run.State.ToString().ToLowerInvariant(),
            ["stopAsked"] = run.StopAsked,
            ["seconds"] = run.Started is { } s ? Math.Round(((run.Finished ?? now) - s).TotalSeconds, 1) : 0,
        };
        if (ReadJson(Path.Combine(run.Dir, "progress.json")) is { } progress)
            o["groups"] = progress["groups"]?.DeepClone();
        if (run.State is NestState.Done or NestState.Stopped && ReadJson(Path.Combine(run.Dir, "result.json")) is { } result)
            o["result"] = result;
        if (run.Error is not null) o["error"] = run.Error;
        return o;
    }

    private static JsonNode? ReadJson(string path)
    {
        // written by the engine as tmp + rename; a read may still meet a half-written file now and then
        for (var i = 0; i < 3; i++)
        {
            try
            {
                if (!File.Exists(path)) return null;
                // shared for writing and deleting: the engine replaces the file while it works
                using var f = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                return JsonNode.Parse(f);
            }
            catch (Exception e) when (e is IOException or JsonException or UnauthorizedAccessException) { Thread.Sleep(30); }
        }
        return null;
    }

    private void CleanOld()
    {
        try
        {
            foreach (var d in Directory.GetDirectories(_runsDir))
                if (Directory.GetLastWriteTimeUtc(d) < DateTime.UtcNow.AddDays(-1)) Directory.Delete(d, true);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
    }

    public void Dispose()
    {
        foreach (var r in _runs.Values)
        {
            try { if (r.Process is { HasExited: false } p) p.Kill(true); } catch (InvalidOperationException) { }
        }
    }
}
