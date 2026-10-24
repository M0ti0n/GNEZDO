using System.Net;
using System.Net.Http.Json;
using Gnezdo.Api.Endpoints;

namespace Gnezdo.Api.Tests;

[Collection("api")]
public sealed class PartSearchTests(ApiFixture api)
{
    private async Task<List<PartDto>> Search(string query) =>
        (await api.Client.GetFromJsonAsync<List<PartDto>>($"/api/parts{query}"))!;

    [Fact]
    public async Task No_filter_returns_all_parts_newest_change_first()
    {
        var parts = await Search("");
        Assert.Equal(39, parts.Count);
        Assert.Equal(parts.OrderByDescending(p => p.ModifiedAt).Select(p => p.ModifiedAt), parts.Select(p => p.ModifiedAt));
        Assert.All(parts, p => Assert.False(string.IsNullOrEmpty(p.Path)));
    }

    [Fact]
    public async Task Name_is_contains_and_case_insensitive()
    {
        var parts = await Search("?name=flange");
        Assert.Equal(9, parts.Count);
        Assert.All(parts, p => Assert.Contains("FLANGE", p.Name));
    }

    [Fact]
    public async Task Material_and_thickness()
    {
        Assert.Equal(5, (await Search("?material=S235")).Count);
        var s235x8 = await Search("?material=S235&thicknessMm=8");
        Assert.Equal(2, s235x8.Count);
        Assert.All(s235x8, p => Assert.Equal(8m, p.ThicknessMm));
    }

    [Fact]
    public async Task Project_is_contains()
    {
        var parts = await Search("?project=26-04");
        Assert.Equal(7, parts.Count);
        Assert.All(parts, p => Assert.StartsWith("26-04", p.Project));
    }

    [Fact]
    public async Task Description_is_contains()
    {
        Assert.Equal(3, (await Search("?description=window")).Count);
    }

    [Fact]
    public async Task Size_ranges_use_the_bounding_box()
    {
        var x = await Search("?xMin=300&xMax=600");
        Assert.Equal(16, x.Count);
        Assert.All(x, p => Assert.InRange(p.W, 300, 600));
        Assert.Equal(5, (await Search("?xMin=300&xMax=600&yMax=250")).Count);
    }

    [Fact]
    public async Task Engraved_only()
    {
        var parts = await Search("?engraved=true");
        Assert.Equal(8, parts.Count);
        Assert.All(parts, p => Assert.True(p.Engraved));
        Assert.Equal(39, (await Search("?engraved=false")).Count); // unticked = no filter
    }

    [Theory]
    [InlineData("created")]
    [InlineData("modified")]
    public async Task Date_filters_use_shop_calendar_days(string field)
    {
        var all = await Search("");
        DateTimeOffset Stamp(PartDto p) => field == "created" ? p.CreatedAt : p.ModifiedAt;
        var day = api.Time.LocalDay(Stamp(all[0]));
        var iso = day.ToString("yyyy-MM-dd");

        var on = await Search($"?{field}=on:{iso}");
        var upTo = await Search($"?{field}=upTo:{iso}");
        var from = await Search($"?{field}=from:{iso}");

        Assert.Equal(all.Count(p => api.Time.LocalDay(Stamp(p)) == day), on.Count);
        Assert.Equal(all.Count(p => api.Time.LocalDay(Stamp(p)) <= day), upTo.Count);
        Assert.Equal(all.Count(p => api.Time.LocalDay(Stamp(p)) >= day), from.Count);
        Assert.NotEmpty(on);
    }

    [Fact]
    public async Task Filters_combine()
    {
        var parts = await Search("?material=HARDOX&engraved=true&xMin=500");
        Assert.Equal(3, parts.Count);
    }

    [Fact]
    public async Task Bad_date_is_rejected()
    {
        var res = await api.Client.GetAsync("/api/parts?created=yesterday");
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Facets_list_materials_and_thicknesses_per_material()
    {
        var f = await api.Client.GetFromJsonAsync<PartFacetsDto>("/api/parts/facets");
        Assert.NotNull(f);
        Assert.Equal(new[] { "HARDOX", "INOX 1.4301", "S235", "S355" }, f.Materials);
        Assert.Equal(new[] { 3m, 8m }, f.Thicknesses.Where(t => t.Material == "S235").Select(t => t.ThicknessMm).Order());
    }
}
