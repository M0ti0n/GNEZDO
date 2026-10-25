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

    /// <summary>Projects are saved on purpose before parts use them.</summary>
    private async Task EnsureProject(string code)
    {
        var res = await api.Client.PostAsJsonAsync("/api/projects", new ProjectCreateRequest(code, null, null));
        Assert.True(res.StatusCode is HttpStatusCode.Created or HttpStatusCode.Conflict, res.StatusCode.ToString());
    }

    private async Task<List<SavedPartDto>> Save(params SavePartRequest[] parts)
    {
        foreach (var code in parts.Select(p => p.Project).OfType<string>().Distinct()) await EnsureProject(code);
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

    private async Task<List<PartVersionDto>> History(string id) =>
        (await api.Client.GetFromJsonAsync<List<PartVersionDto>>($"/api/parts/{id}/history"))!;

    [Fact]
    public async Task Replace_keeps_the_old_version_and_restore_brings_it_back()
    {
        var id = Assert.Single(await Save(Part("SAVE_F_plate", "N26-0600", material: "S235", t: 3, description: "v1"))).Id!;
        Assert.Equal(1, Assert.Single(await Search("?name=SAVE_F_plate")).Revision);
        Assert.Single(await History(id));                                  // only the current version

        await Save(Part("SAVE_F_plate", "N26-0600", material: "S355", t: 5, description: "v2", replace: true));
        var h = await History(id);
        Assert.Equal([2, 1], h.Select(v => v.Revision));
        Assert.True(h[0].Current);
        Assert.Equal(("v1", "S235", 3m), (h[1].Description, h[1].Material, h[1].ThicknessMm));
        Assert.NotNull(h[1].ReplacedAt);

        var res = await api.Client.PostAsJsonAsync($"/api/parts/{id}/restore", new RestoreRequest(1));
        res.EnsureSuccessStatusCode();
        var restored = (await res.Content.ReadFromJsonAsync<PartDto>())!;
        Assert.Equal(("v1", "S235", 3m, 3), (restored.Description, restored.Material, restored.ThicknessMm, restored.Revision));

        // nothing is lost: v2 is in the history now too, and could be restored again
        h = await History(id);
        Assert.Equal([3, 2, 1], h.Select(v => v.Revision));
        Assert.Equal("v2", h[1].Description);
        Assert.Equal([90, 45], h[1].Rotations);
    }

    [Fact]
    public async Task Restore_of_unknown_version_is_rejected()
    {
        var id = Assert.Single(await Save(Part("SAVE_G_rib", "N26-0700"))).Id!;
        var res = await api.Client.PostAsJsonAsync($"/api/parts/{id}/restore", new RestoreRequest(7));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await api.Client.GetAsync("/api/parts/999999/history")).StatusCode);
    }

    [Fact]
    public async Task A_part_with_an_unsaved_project_is_not_saved()
    {
        var res = await api.Client.PostAsJsonAsync("/api/parts",
            new SavePartsRequest([Part("SAVE_H_plate", "N26-NOT-SAVED")], "test", "Fab"));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Contains("Save the project first", await res.Content.ReadAsStringAsync());
        var codes = (await api.Client.GetFromJsonAsync<List<ProjectOptionDto>>("/api/projects"))!.Select(p => p.Code);
        Assert.DoesNotContain("N26-NOT-SAVED", codes);
    }

    [Fact]
    public async Task A_project_is_saved_once()
    {
        var first = await api.Client.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("N26-1234", "Platform", "Kovinar"));
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        var again = await api.Client.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("n26-1234", null, null));
        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
        var p = Assert.Single((await api.Client.GetFromJsonAsync<List<ProjectOptionDto>>("/api/projects"))!, x => x.Code == "N26-1234");
        Assert.Equal(("Platform", "Kovinar"), (p.Name, p.Customer));
    }

    [Fact]
    public async Task Changing_properties_keeps_the_old_version()
    {
        await EnsureProject("N26-0800");
        await EnsureProject("N26-0801");
        var id = Assert.Single(await Save(Part("SAVE_I_flange", "N26-0800", material: "S235", t: 4, description: "old"))).Id!;

        var res = await api.Client.PutAsJsonAsync($"/api/parts/{id}",
            new PartUpdateRequest("SAVE_I_flange_B", "N26-0801", "new", "S355", 6, [90, 30], false));
        res.EnsureSuccessStatusCode();
        var d = (await res.Content.ReadFromJsonAsync<PartDetailDto>())!;
        Assert.Equal(("SAVE_I_flange_B", "N26-0801", "new", "S355", 6m, 2), (d.Part.Name, d.Part.Project, d.Part.Description, d.Part.Material, d.Part.ThicknessMm, d.Part.Revision));
        Assert.Equal([90, 30], d.Rotations);
        Assert.False(d.Mirror);

        var h = await History(id);
        Assert.Equal(("old", "S235", "N26-0800"), (h[1].Description, h[1].Material, h[1].Project));
    }

    [Fact]
    public async Task Changing_to_a_name_that_is_taken_or_an_unsaved_project_is_refused()
    {
        var a = Assert.Single(await Save(Part("SAVE_J_a", "N26-0900"))).Id!;
        await Save(Part("SAVE_J_b", "N26-0900"));
        var taken = await api.Client.PutAsJsonAsync($"/api/parts/{a}", new PartUpdateRequest("SAVE_J_b", "N26-0900", "", "S355", 6, [90], false));
        Assert.Equal(HttpStatusCode.Conflict, taken.StatusCode);
        var unsaved = await api.Client.PutAsJsonAsync($"/api/parts/{a}", new PartUpdateRequest("SAVE_J_a", "N26-UNKNOWN", "", "S355", 6, [90], false));
        Assert.Equal(HttpStatusCode.BadRequest, unsaved.StatusCode);
    }

    [Fact]
    public async Task Deleted_part_is_hidden_but_a_new_one_can_take_its_name()
    {
        var id = Assert.Single(await Save(Part("SAVE_K_cover", "N26-1000"))).Id!;
        Assert.Equal(HttpStatusCode.NoContent, (await api.Client.DeleteAsync($"/api/parts/{id}")).StatusCode);

        Assert.Empty(await Search("?name=SAVE_K_cover"));
        Assert.Empty(await Existing(new PartKey("SAVE_K_cover", "N26-1000")));
        Assert.Equal(HttpStatusCode.NotFound, (await api.Client.GetAsync($"/api/parts/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await api.Client.DeleteAsync($"/api/parts/{id}")).StatusCode);

        var again = Assert.Single(await Save(Part("SAVE_K_cover", "N26-1000")));
        Assert.Equal("created", again.Status);
        Assert.NotEqual(id, again.Id);
    }

    [Fact]
    public async Task Project_list_has_seeded_and_new_projects()
    {
        await Save(Part("SAVE_E_gusset", "N26-0999"));
        var codes = (await api.Client.GetFromJsonAsync<List<ProjectOptionDto>>("/api/projects"))!.Select(p => p.Code).ToList();
        Assert.Contains("26-0412", codes);
        Assert.Contains("N26-0999", codes);
        Assert.Equal(codes.Count, codes.Distinct().Count());
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
