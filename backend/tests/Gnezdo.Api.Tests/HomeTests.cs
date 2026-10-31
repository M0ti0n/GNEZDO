using System.Net;
using System.Net.Http.Json;
using Gnezdo.Api.Endpoints;

namespace Gnezdo.Api.Tests;

[Collection("api")]
public sealed class HomeTests(ApiFixture api)
{
    [Fact]
    public async Task Health()
    {
        var res = await api.Client.GetAsync("/api/health");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
    }

    [Fact]
    public async Task Recent_imports_newest_first_with_materials()
    {
        var list = await api.Client.GetFromJsonAsync<List<ImportSummaryDto>>("/api/imports/recent");
        Assert.NotNull(list);
        Assert.Equal(5, list.Count);
        Assert.Equal("TEST_30_industrial", list[0].Source);
        Assert.Equal(30, list[0].PartCount);
        Assert.Equal(new[] { "HARDOX 1 mm" }, list[0].Materials);
        Assert.Equal(new[] { "S355 10 mm", "S355 15 mm" }, list.Single(i => i.Project == "26-0409").Materials);
    }

    [Fact]
    public async Task Recent_jobs_with_part_count_and_main_material()
    {
        var list = await api.Client.GetFromJsonAsync<List<JobSummaryDto>>("/api/jobs/recent");
        Assert.NotNull(list);
        Assert.Equal(6, list.Count);
        var miha = list[0];
        Assert.Equal("Miha2787", miha.Name);
        Assert.Equal(531, miha.PartCount);
        Assert.Equal("HARDOX", miha.Material);
        Assert.Equal(1m, miha.ThicknessMm);
        Assert.Equal("nested", miha.Status);
    }

    [Fact]
    public async Task Job_search_by_status_and_text()
    {
        var cut = await api.Client.GetFromJsonAsync<List<JobSummaryDto>>("/api/jobs?status=cut");
        Assert.Equal(3, cut!.Count);
        var brackets = await api.Client.GetFromJsonAsync<List<JobSummaryDto>>("/api/jobs?name=brackets");
        Assert.Single(brackets!);
    }

    [Fact]
    public async Task Job_parts_of_the_test_job()
    {
        var jobs = await api.Client.GetFromJsonAsync<List<JobSummaryDto>>("/api/jobs?name=Miha2787");
        var parts = await api.Client.GetFromJsonAsync<List<JobPartDto>>($"/api/jobs/{jobs![0].Id}/parts");
        Assert.Equal(30, parts!.Count);
        Assert.Equal(531, parts.Sum(p => p.Qty));
        Assert.Equal(HttpStatusCode.NotFound, (await api.Client.GetAsync("/api/jobs/999999/parts")).StatusCode);
    }

    [Fact]
    public async Task Recent_projects_with_counts()
    {
        var list = await api.Client.GetFromJsonAsync<List<ProjectSummaryDto>>("/api/projects/recent");
        Assert.NotNull(list);
        Assert.Equal(5, list.Count);
        Assert.Equal("Miha2787", list[0].Code);
        var p0398 = list.Single(p => p.Code == "26-0398");
        Assert.Equal(2, p0398.PartCount);
        Assert.Equal(2, p0398.JobCount);
    }
}
