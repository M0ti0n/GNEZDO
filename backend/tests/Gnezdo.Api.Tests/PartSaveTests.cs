using System.Net;
using System.Net.Http.Json;
using Gnezdo.Api.Endpoints;

namespace Gnezdo.Api.Tests;

/// <summary>Saving changes the parts table, so these tests get a database of their own.</summary>
[CollectionDefinition("save")]
public sealed class SaveCollection : ICollectionFixture<ApiFixture> { }

[Collection("save")]
public sealed class PartSaveTests(ApiFixture api)
{
    private static SavePartRequest Part(string name, string? project, string material = "S355", decimal t = 6,
        bool replace = false, string description = "") =>
        new(name, project, description, material, t, [90, 45], Mirror: true,
            WidthMm: 120, HeightMm: 80, AreaMm2: 9000, OutlinePath: "M0 0L120 0L120 80L0 80Z", Engraved: false,
            Geometry: """[{"id":"e1","kind":"circle","c":{"x":0,"y":0},"r":5}]""", SourceFile: $"{name}.dxf", Replace: replace);

    private async Task<List<SavedPartDto>> Save(params SavePartRequest[] parts)
    {
        var res = await api.Client.PostAsJsonAsync("/api/parts", new SavePartsRequest(parts, "test", "Fab"));
        res.EnsureSuccessStatusCode();
        return (await res.Content.ReadFromJsonAsync<List<SavedPartDto>>())!;
    }

    private async Task<List<ExistingPartDto>> Existing(params PartKey[] keys)
    {
        var res = await api.Client.PostAsJsonAsync("/api/parts/existing", keys);
        res.EnsureSuccessStatusCode();
        return (await res.Content.ReadFromJsonAsync<List<ExistingPartDto>>())!;
    }

    private async Task<List<PartDto>> Search(string q) =>
        (await api.Client.GetFromJsonAsync<List<PartDto>>($"/api/parts{q}"))!;

    [Fact]
    public async Task Saved_part_is_in_the_library_with_new_project_and_material()
    {
        var saved = await Save(Part("SAVE_A_bracket", "N26-0246", material: "S690QL", t: 8));
        Assert.Equal("created", Assert.Single(saved).Status);

        var found = Assert.Single(await Search("?name=SAVE_A_bracket"));
        Assert.Equal("N26-0246", found.Project);
        Assert.Equal("S690QL", found.Material);
        Assert.Equal(8m, found.ThicknessMm);
        Assert.Equal(120, found.W);
        var facets = await api.Client.GetFromJsonAsync<PartFacetsDto>("/api/parts/facets");
        Assert.Contains("S690QL", facets!.Materials);
    }

    [Fact]
    public async Task Existing_matches_same_project_and_name_only()
    {
        await Save(Part("SAVE_B_plate", "N26-0300"), Part("SAVE_B_plate", null));

        var hits = await Existing(new PartKey("SAVE_B_plate", "n26-0300"), new PartKey("SAVE_B_plate", "N26-0301"),
            new PartKey("SAVE_B_other", "N26-0300"));
        var hit = Assert.Single(hits);
        Assert.Equal("N26-0300", hit.Project);

        var noProject = Assert.Single(await Existing(new PartKey("SAVE_B_plate", "")));
        Assert.Equal("", noProject.Project);
    }

    [Fact]
    public async Task Same_part_again_is_kept_unless_replace_is_asked()
    {
        var first = Assert.Single(await Save(Part("SAVE_C_rib", "N26-0400", description: "first")));

        var again = Assert.Single(await Save(Part("SAVE_C_rib", "N26-0400", description: "second")));
        Assert.Equal("exists", again.Status);
        Assert.Equal(first.Id, again.Id);
        Assert.Equal("first", Assert.Single(await Search("?name=SAVE_C_rib")).Description);

        var replaced = Assert.Single(await Save(Part("SAVE_C_rib", "N26-0400", description: "second", replace: true)));
        Assert.Equal("replaced", replaced.Status);
        Assert.Equal(first.Id, replaced.Id);
        Assert.Equal("second", Assert.Single(await Search("?name=SAVE_C_rib")).Description);
    }

    [Fact]
    public async Task Missing_material_or_bad_rotation_is_rejected()
    {
        var bad = Part("SAVE_D", "N26-0500", material: "") with { Rotations = [90, 15] };
        var res = await api.Client.PostAsJsonAsync("/api/parts", new SavePartsRequest([bad], "test", "Fab"));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        var body = await res.Content.ReadAsStringAsync();
        Assert.Contains("Material is required", body);
        Assert.Contains("Rotations", body);
        Assert.Empty(await Search("?name=SAVE_D"));
    }
}
