using System.Net;
using System.Net.Http.Json;
using Gnezdo.Api.Endpoints;

namespace Gnezdo.Api.Tests;

/// <summary>GET /api/jobs: the Job search panel.</summary>
[Collection("api")]
public sealed class JobSearchTests(ApiFixture api)
{
    private async Task<List<JobSummaryDto>> Search(string query) =>
        (await api.Client.GetFromJsonAsync<List<JobSummaryDto>>($"/api/jobs{query}"))!;

    private static string[] Names(IEnumerable<JobSummaryDto> jobs) => jobs.Select(j => j.Name).Order().ToArray();

    [Fact]
    public async Task No_filter_returns_all_jobs_newest_change_first()
    {
        var jobs = await Search("");
        Assert.Equal(6, jobs.Count);
        Assert.Equal("Miha2787", jobs[0].Name);
    }

    [Fact]
    public async Task Job_name_is_contains()
    {
        Assert.Equal(new[] { "26-0412 Konzole" }, Names(await Search("?name=konzole")));
    }

    [Fact]
    public async Task Material_and_thickness_match_parts_in_the_job()
    {
        Assert.Equal(new[] { "26-0409 Prirobnice" }, Names(await Search("?material=S355")));
        Assert.Equal(new[] { "26-0412 Konzole", "Ostanki teden 43" }, Names(await Search("?material=S235&thicknessMm=3")));
        Assert.Equal(new[] { "26-0409 Prirobnice" }, Names(await Search("?thicknessMm=15")));
        Assert.Equal(new[] { "26-0398 Nosilci", "Ostanki teden 43" }, Names(await Search("?material=S235&thicknessMm=8")));
        Assert.Empty(await Search("?material=HARDOX&thicknessMm=8"));
    }

    [Fact]
    public async Task Project_finds_jobs_containing_parts_of_that_project()
    {
        var jobs = await Search("?project=26-0398");
        Assert.Equal(new[] { "26-0398 Nosilci", "Ostanki teden 43" }, Names(jobs));
        Assert.All(jobs, j => Assert.Contains("26-0398", j.Projects));
    }

    [Fact]
    public async Task Part_name_finds_every_job_it_is_used_in()
    {
        Assert.Equal(new[] { "26-0398 Nosilci", "Ostanki teden 43" }, Names(await Search("?part=VEZNA_PLOCEVINA")));
        Assert.Equal(new[] { "Miha2787" }, Names(await Search("?part=triangle")));
    }

    [Theory]
    [InlineData("created")]
    [InlineData("modified")]
    public async Task Date_filters_use_shop_calendar_days(string field)
    {
        var all = await Search("");
        DateTimeOffset Stamp(JobSummaryDto j) => field == "created" ? j.CreatedAt : j.ModifiedAt;
        var day = api.Time.LocalDay(Stamp(all[0]));
        var iso = day.ToString("yyyy-MM-dd");

        Assert.Equal(all.Count(j => api.Time.LocalDay(Stamp(j)) == day), (await Search($"?{field}=on:{iso}")).Count);
        Assert.Equal(all.Count(j => api.Time.LocalDay(Stamp(j)) <= day), (await Search($"?{field}=upTo:{iso}")).Count);
        Assert.Equal(all.Count(j => api.Time.LocalDay(Stamp(j)) >= day), (await Search($"?{field}=from:{iso}")).Count);
    }

    [Fact]
    public async Task Filters_combine()
    {
        Assert.Equal(new[] { "26-0398 Nosilci" }, Names(await Search("?project=26-0398&part=NOSILEC")));
        Assert.Empty(await Search("?project=26-0398&material=HARDOX"));
    }

    [Fact]
    public async Task Results_carry_projects_and_created_date()
    {
        var miha = (await Search("?name=Miha2787")).Single();
        Assert.Equal(new[] { "Miha2787" }, miha.Projects);
        Assert.True(miha.CreatedAt <= miha.ModifiedAt);
    }

    [Fact]
    public async Task Bad_input_is_rejected()
    {
        Assert.Equal(HttpStatusCode.BadRequest, (await api.Client.GetAsync("/api/jobs?created=today")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await api.Client.GetAsync("/api/jobs?status=lost")).StatusCode);
    }
}
