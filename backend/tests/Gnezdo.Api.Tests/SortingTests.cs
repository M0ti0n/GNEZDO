using System.Net;
using System.Net.Http.Json;
using Gnezdo.Api.Endpoints;

namespace Gnezdo.Api.Tests;

[Collection("api")]
public sealed class SortingTests(ApiFixture api)
{
    private async Task<List<PartDto>> Parts(string query) =>
        (await api.Client.GetFromJsonAsync<List<PartDto>>($"/api/parts{query}"))!;

    private async Task<List<JobSummaryDto>> Jobs(string query) =>
        (await api.Client.GetFromJsonAsync<List<JobSummaryDto>>($"/api/jobs{query}"))!;

    private static void Sorted<T, TKey>(IReadOnlyList<T> rows, Func<T, TKey> key, bool desc)
    {
        var keys = rows.Select(key).ToList();
        var expected = desc ? keys.OrderByDescending(k => k, Comparer<TKey>.Default).ToList()
                            : keys.OrderBy(k => k, Comparer<TKey>.Default).ToList();
        Assert.Equal(expected, keys);
    }

    // SQL Server's default collation compares text case-insensitively; compare the same way here.
    private static string Fold(string s) => s.ToUpperInvariant();

    [Theory]
    [InlineData("asc")]
    [InlineData("desc")]
    public async Task Parts_by_name(string dir)
    {
        var rows = await Parts($"?sort=name&dir={dir}");
        Assert.Equal(39, rows.Count);
        Sorted(rows, p => Fold(p.Name), dir == "desc");
    }

    [Fact]
    public async Task Parts_by_dates()
    {
        Sorted(await Parts("?sort=created"), p => p.CreatedAt, desc: true);   // dates default to newest first
        Sorted(await Parts("?sort=created&dir=asc"), p => p.CreatedAt, desc: false);
        Sorted(await Parts("?sort=modified&dir=asc"), p => p.ModifiedAt, desc: false);
    }

    [Fact]
    public async Task Parts_by_material_then_thickness()
    {
        var rows = await Parts("?sort=material");
        Sorted(rows, p => (Fold(p.Material), p.ThicknessMm), desc: false);
        Assert.Equal("HARDOX", rows[0].Material);
        Assert.Equal("S355", rows[^1].Material);
    }

    [Fact]
    public async Task Parts_by_thickness()
    {
        var rows = await Parts("?sort=thickness&dir=desc");
        Sorted(rows, p => p.ThicknessMm, desc: true);
        Assert.Equal(15m, rows[0].ThicknessMm);
    }

    [Fact]
    public async Task Parts_by_project_with_filters()
    {
        var rows = await Parts("?sort=project&material=S235");
        Assert.Equal(5, rows.Count);
        Sorted(rows, p => Fold(p.Project), desc: false);
        Assert.Equal("26-0398", rows[0].Project);
    }

    [Fact]
    public async Task Jobs_by_name_and_dates()
    {
        Sorted(await Jobs("?sort=name"), j => Fold(j.Name), desc: false);
        Sorted(await Jobs("?sort=name&dir=desc"), j => Fold(j.Name), desc: true);
        Sorted(await Jobs("?sort=created"), j => j.CreatedAt, desc: true);
        Sorted(await Jobs("?sort=modified&dir=asc"), j => j.ModifiedAt, desc: false);
    }

    [Fact]
    public async Task Jobs_by_material_thickness_project()
    {
        // every sample job is one material, so the displayed material is the sort key
        var byMat = await Jobs("?sort=material");
        Sorted(byMat, j => Fold(j.Material), desc: false);
        Assert.Equal("Miha2787", byMat[0].Name);

        var byThk = await Jobs("?sort=thickness&dir=desc");
        Sorted(byThk, j => j.ThicknessMm, desc: true);
        Assert.Equal("26-0409 Prirobnice", byThk[0].Name);

        var byProject = await Jobs("?sort=project");
        Sorted(byProject, j => Fold(j.Projects.Min()!), desc: false);
    }

    [Fact]
    public async Task Bad_sort_is_rejected()
    {
        Assert.Equal(HttpStatusCode.BadRequest, (await api.Client.GetAsync("/api/parts?sort=colour")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await api.Client.GetAsync("/api/jobs?sort=name&dir=up")).StatusCode);
    }
}
