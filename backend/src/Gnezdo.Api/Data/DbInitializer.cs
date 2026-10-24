using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Gnezdo.Api.Data;

/// <summary>
/// Creates the database on first start and optionally fills it with sample data.
/// Waits for SQL Server to come up (Docker starts it at the same time as the API).
/// </summary>
public static class DbInitializer
{
    public static async Task InitializeAsync(IServiceProvider services, ILogger logger, CancellationToken ct = default)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<GnezdoDb>();
        var options = scope.ServiceProvider.GetRequiredService<IOptions<GnezdoOptions>>().Value;

        const int attempts = 30;
        for (var i = 1; ; i++)
        {
            try
            {
                // Schema is created from the model for now; EF migrations replace this
                // once the schema settles.
                await db.Database.EnsureCreatedAsync(ct);
                break;
            }
            catch (Exception ex) when (i < attempts && !ct.IsCancellationRequested)
            {
                logger.LogWarning("Database not reachable yet ({Attempt}/{Attempts}): {Message}", i, attempts, ex.Message);
                await Task.Delay(TimeSpan.FromSeconds(2), ct);
            }
        }

        if (options.SeedSampleData && !await db.Parts.AnyAsync(ct))
        {
            await SampleData.SeedAsync(db, DateTimeOffset.UtcNow, ct);
            logger.LogInformation("Sample data added.");
        }
    }
}

/// <summary>Loads Seed/sample-data.json (embedded) into an empty database.</summary>
public static class SampleData
{
    private sealed record SeedFile(List<SeedProject> Projects, List<SeedImport> Imports, List<SeedPart> Parts, List<SeedJob> Jobs);
    private sealed record SeedProject(string Code, string Name, string? Customer, double HoursAgo);
    private sealed record SeedImport(string Key, string Source, string Project, double HoursAgo, string By, int Warnings);
    private sealed record SeedPart(
        string Key, string Name, string Description, string Project, string Material, decimal ThicknessMm, int Qty,
        double W, double H, double AreaMm2, string Path, bool Engraved, string ImportKey,
        double CreatedHoursAgo, double ModifiedHoursAgo);
    private sealed record SeedJob(string Name, string Status, int Sheets, double CreatedHoursAgo, double HoursAgo, string By, List<JsonElement> Parts);

    public static async Task SeedAsync(GnezdoDb db, DateTimeOffset now, CancellationToken ct = default)
    {
        var seed = await LoadAsync(ct);
        DateTimeOffset Ago(double hours) => now.AddHours(-hours);

        var projects = seed.Projects.ToDictionary(
            p => p.Code,
            p => new Project { Code = p.Code, Name = p.Name, Customer = p.Customer, CreatedAt = Ago(p.HoursAgo) });
        var materials = seed.Parts.Select(p => p.Material).Distinct()
            .ToDictionary(m => m, m => new Material { Name = m });
        var imports = seed.Imports.ToDictionary(
            i => i.Key,
            i => new ImportBatch
            {
                Source = i.Source, Project = projects[i.Project], ImportedAt = Ago(i.HoursAgo),
                ImportedBy = i.By, Warnings = i.Warnings,
            });
        var parts = seed.Parts.ToDictionary(
            p => p.Key,
            p => new Part
            {
                Name = p.Name, Description = p.Description, Project = projects[p.Project],
                Material = materials[p.Material], ThicknessMm = p.ThicknessMm, Qty = p.Qty,
                WidthMm = p.W, HeightMm = p.H, AreaMm2 = p.AreaMm2, OutlinePath = p.Path,
                Engraved = p.Engraved, ImportBatch = imports[p.ImportKey],
                CreatedAt = Ago(p.CreatedHoursAgo), ModifiedAt = Ago(p.ModifiedHoursAgo),
            });
        var jobs = seed.Jobs.Select(j => new Job
        {
            Name = j.Name,
            Status = Enum.Parse<JobStatus>(j.Status, ignoreCase: true),
            SheetCount = j.Sheets,
            CreatedAt = Ago(j.CreatedHoursAgo),
            ModifiedAt = Ago(j.HoursAgo),
            ModifiedBy = j.By,
            // each entry is ["partKey", qty]
            Parts = j.Parts.Select(e => new JobPart { Part = parts[e[0].GetString()!], Qty = e[1].GetInt32() }).ToList(),
        });

        db.AddRange(projects.Values);
        db.AddRange(materials.Values);
        db.AddRange(imports.Values);
        db.AddRange(parts.Values);
        db.AddRange(jobs);
        await db.SaveChangesAsync(ct);
    }

    private static async Task<SeedFile> LoadAsync(CancellationToken ct)
    {
        await using var stream = typeof(SampleData).Assembly.GetManifestResourceStream("Gnezdo.Api.Seed.sample-data.json")
            ?? throw new InvalidOperationException("Embedded sample-data.json not found.");
        var json = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        return await JsonSerializer.DeserializeAsync<SeedFile>(stream, json, ct)
            ?? throw new InvalidOperationException("sample-data.json is empty.");
    }
}
