using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Gnezdo.Api.Data;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;

namespace Gnezdo.Api.Tests;

/// <summary>Sign-in on the server build: the first admin, users, passwords, admin-only settings.</summary>
public sealed class AuthTests : IAsyncLifetime
{
    private readonly WebApplicationFactory<Program> _factory;
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "gnezdo-auth-test-" + Guid.NewGuid().ToString("N")[..8]);

    public AuthTests()
    {
        var cs = TestDb.NewConnectionString("gnezdo_auth");
        _factory = new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
        {
            b.UseEnvironment("Testing");
            TestDb.Use(b, cs);
            b.UseSetting("Gnezdo:SeedSampleData", "false");
            b.UseSetting("Gnezdo:DataDir", Path.Combine(_dir, "data"));
            b.UseSetting("Diagnostics:Dir", Path.Combine(_dir, "logs"));
        });
    }

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        using (var scope = _factory.Services.CreateScope())
            await TestDb.DropAsync(scope.ServiceProvider.GetRequiredService<GnezdoDb>());
        await _factory.DisposeAsync();
        try { Directory.Delete(_dir, true); } catch (IOException) { }
    }

    /// <summary>A browser of its own (its own sign-in cookie).</summary>
    private HttpClient Browser() => _factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });

    private static async Task<JsonObject> State(HttpClient c) => (await c.GetFromJsonAsync<JsonObject>("/api/auth/state"))!;

    private async Task<HttpClient> Admin()
    {
        var c = Browser();
        var res = await c.PostAsJsonAsync("/api/auth/setup", new { name = "Fab", password = "secret" });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        return c;
    }

    [Fact]
    public async Task Nothing_without_signing_in_and_the_first_admin_is_set_up_once()
    {
        var c = Browser();
        var s = await State(c);
        Assert.True(s["required"]!.GetValue<bool>());
        Assert.True(s["setupNeeded"]!.GetValue<bool>());
        Assert.Equal(HttpStatusCode.Unauthorized, (await c.GetAsync("/api/jobs")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await c.GetAsync("/api/health")).StatusCode);

        var admin = await Admin();
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync("/api/jobs")).StatusCode);
        var me = await State(admin);
        Assert.Equal("Fab", me["user"]!["name"]!.GetValue<string>());
        Assert.True(me["user"]!["isAdmin"]!.GetValue<bool>());
        // a second setup is refused: there is an admin
        Assert.Equal(HttpStatusCode.Conflict, (await Browser().PostAsJsonAsync("/api/auth/setup", new { name = "Eve" })).StatusCode);
    }

    [Fact]
    public async Task A_user_without_a_password_signs_in_by_name_and_is_not_an_admin()
    {
        var admin = await Admin();
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync("/api/users", new { name = "Miha", isAdmin = false })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/users", new { name = "miha" })).StatusCode);   // the same name

        var miha = Browser();
        Assert.Equal(HttpStatusCode.OK, (await miha.PostAsJsonAsync("/api/auth/signin", new { name = "MIHA" })).StatusCode);   // case does not matter
        Assert.Equal(HttpStatusCode.OK, (await miha.GetAsync("/api/jobs")).StatusCode);
        // admin only: users, the machine settings, the log switch
        Assert.Equal(HttpStatusCode.Forbidden, (await miha.GetAsync("/api/users")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await miha.PutAsJsonAsync("/api/settings/machines", new { value = new JsonObject() })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await miha.PutAsJsonAsync("/api/logs/settings", new { enabled = false })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync("/api/settings/machines", new { value = new JsonObject() })).StatusCode);
    }

    [Fact]
    public async Task A_wrong_password_is_refused_and_a_new_one_signs_the_old_sessions_out()
    {
        var admin = await Admin();
        Assert.Equal(HttpStatusCode.Unauthorized, (await Browser().PostAsJsonAsync("/api/auth/signin", new { name = "Fab", password = "nope" })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Browser().PostAsJsonAsync("/api/auth/signin", new { name = "Nobody" })).StatusCode);

        var u = (await (await admin.PostAsJsonAsync("/api/users", new { name = "Rok", password = "a1" })).Content.ReadFromJsonAsync<JsonObject>())!;
        var rok = Browser();
        Assert.Equal(HttpStatusCode.Unauthorized, (await rok.PostAsJsonAsync("/api/auth/signin", new { name = "Rok" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await rok.PostAsJsonAsync("/api/auth/signin", new { name = "Rok", password = "a1" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await rok.GetAsync("/api/jobs")).StatusCode);

        // the admin gives Rok a new password: Rok's browser is signed out
        var id = u["id"]!.GetValue<int>();
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/users/{id}", new { password = "b2" })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await rok.GetAsync("/api/jobs")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await rok.PostAsJsonAsync("/api/auth/signin", new { name = "Rok", password = "b2" })).StatusCode);

        // Rok changes his own password; removed, he is signed out for good
        Assert.Equal(HttpStatusCode.OK, (await rok.PostAsJsonAsync("/api/auth/password", new { current = "b2", password = "c3" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await rok.GetAsync("/api/jobs")).StatusCode);   // this browser stays signed in
        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"/api/users/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await rok.GetAsync("/api/jobs")).StatusCode);
    }

    [Fact]
    public async Task The_last_admin_stays()
    {
        var admin = await Admin();
        var me = (await State(admin))["user"]!["id"]!.GetValue<int>();
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync($"/api/users/{me}", new { isAdmin = false })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.DeleteAsync($"/api/users/{me}")).StatusCode);
    }

    [Fact]
    public async Task A_job_saved_signed_in_is_modified_by_that_user()
    {
        var admin = await Admin();
        var res = await admin.PostAsJsonAsync("/api/jobs", new { name = "Auth job", parts = Array.Empty<object>(), modifiedBy = "Someone else" });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        var id = (await res.Content.ReadFromJsonAsync<JsonObject>())!["id"]!.GetValue<string>();
        var job = (await admin.GetFromJsonAsync<JsonObject>($"/api/jobs/{id}"))!;
        Assert.Equal("Fab", job["modifiedBy"]!.GetValue<string>());
    }
}
