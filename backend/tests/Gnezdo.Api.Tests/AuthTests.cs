using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Gnezdo.Api.Data;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;

namespace Gnezdo.Api.Tests;

/// <summary>Sign-in on the server build: the default Admin, users, passwords, admin-only settings.</summary>
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

    /// <summary>Signed in as the default Admin, renamed Fab with a password (as the person installing it would).</summary>
    private async Task<HttpClient> Admin()
    {
        var c = Browser();
        var me = (await (await c.PostAsJsonAsync("/api/auth/signin", new { name = "Admin" })).Content.ReadFromJsonAsync<JsonObject>())!;
        var res = await c.PutAsJsonAsync($"/api/users/{me["id"]!.GetValue<int>()}", new { name = "Fab", password = "secret" });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        return c;
    }

    [Fact]
    public async Task Nothing_without_signing_in_and_a_new_database_starts_with_Admin_without_a_password()
    {
        var c = Browser();
        var s = await State(c);
        Assert.True(s["required"]!.GetValue<bool>());
        Assert.True(s["defaultAdmin"]!.GetValue<bool>());
        Assert.Null(s["user"]);
        Assert.Equal(HttpStatusCode.Unauthorized, (await c.GetAsync("/api/jobs")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await c.GetAsync("/api/health")).StatusCode);

        // Admin, no password: an admin
        Assert.Equal(HttpStatusCode.OK, (await c.PostAsJsonAsync("/api/auth/signin", new { name = "admin" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await c.GetAsync("/api/jobs")).StatusCode);
        var me = await State(c);
        Assert.Equal("Admin", me["user"]!["name"]!.GetValue<string>());
        Assert.True(me["user"]!["isAdmin"]!.GetValue<bool>());
        Assert.False(me["user"]!["hasPassword"]!.GetValue<bool>());
        Assert.Single((await c.GetFromJsonAsync<JsonArray>("/api/users"))!);

        // given a password, the sign-in page no longer says to sign in as Admin, and the password is needed
        Assert.Equal(HttpStatusCode.OK, (await c.PostAsJsonAsync("/api/auth/password", new { password = "s3cret" })).StatusCode);
        Assert.False((await State(Browser()))["defaultAdmin"]!.GetValue<bool>());
        Assert.Equal(HttpStatusCode.Unauthorized, (await Browser().PostAsJsonAsync("/api/auth/signin", new { name = "Admin" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Browser().PostAsJsonAsync("/api/auth/signin", new { name = "Admin", password = "s3cret" })).StatusCode);
    }

    [Fact]
    public async Task A_restart_does_not_add_Admin_again()
    {
        var admin = await Admin();   // Admin is Fab now
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GnezdoDb>();
            await Gnezdo.Api.Auth.AuthEndpoints.EnsureAdminAsync(scope.ServiceProvider, db, Microsoft.Extensions.Logging.Abstractions.NullLogger.Instance);
        }
        var users = (await admin.GetFromJsonAsync<JsonArray>("/api/users"))!;
        Assert.Equal("Fab", Assert.Single(users)!["name"]!.GetValue<string>());
    }

    [Fact]
    public async Task A_user_without_a_password_signs_in_by_name_and_is_not_an_admin()
    {
        var admin = await Admin();
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync("/api/users", new { name = "Alex", isAdmin = false })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/users", new { name = "alex" })).StatusCode);   // the same name

        var alex = Browser();
        Assert.Equal(HttpStatusCode.OK, (await alex.PostAsJsonAsync("/api/auth/signin", new { name = "ALEX" })).StatusCode);   // case does not matter
        Assert.Equal(HttpStatusCode.OK, (await alex.GetAsync("/api/jobs")).StatusCode);
        // admin only: users, the machine settings, the log switch
        Assert.Equal(HttpStatusCode.Forbidden, (await alex.GetAsync("/api/users")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await alex.PutAsJsonAsync("/api/settings/machines", new { value = new JsonObject() })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await alex.PutAsJsonAsync("/api/logs/settings", new { enabled = false })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync("/api/settings/machines", new { value = new JsonObject() })).StatusCode);
        // stock, import and nesting rules are shared the same way: everyone reads them, only an admin changes them
        foreach (var key in new[] { "stock", "importRules", "nestingRules" })
        {
            Assert.Equal(HttpStatusCode.Forbidden, (await alex.PutAsJsonAsync($"/api/settings/{key}", new { value = new JsonObject { ["x"] = 1 } })).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/settings/{key}", new { value = new JsonObject { ["x"] = 2 } })).StatusCode);
            Assert.Equal(2, (await alex.GetFromJsonAsync<JsonObject>($"/api/settings/{key}"))!["x"]!.GetValue<int>());
        }
        // two admins change the same settings from the version both loaded: the second is refused, told who
        var got = await admin.GetAsync("/api/settings/stock");
        var v = got.Headers.ETag!.Tag;
        var versions = (await admin.GetFromJsonAsync<JsonObject>("/api/settings/versions"))!;
        Assert.Equal(v.Trim('"'), versions["stock"]!.GetValue<string>());
        var first = await admin.PutAsJsonAsync("/api/settings/stock", new { value = new JsonObject { ["x"] = 3 }, @base = v });
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.NotEqual(v, first.Headers.ETag!.Tag);
        var second = await admin.PutAsJsonAsync("/api/settings/stock", new { value = new JsonObject { ["x"] = 4 }, @base = v });
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
        Assert.Contains("changed these settings since you loaded them", await second.Content.ReadAsStringAsync());
        Assert.Equal(3, (await admin.GetFromJsonAsync<JsonObject>("/api/settings/stock"))!["x"]!.GetValue<int>());
        // from the version now there: saved
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync("/api/settings/stock", new { value = new JsonObject { ["x"] = 4 }, @base = first.Headers.ETag!.Tag })).StatusCode);
        Assert.NotEqual("none", (await admin.GetFromJsonAsync<JsonObject>("/api/settings/versions"))!["stock"]!.GetValue<string>());
        // and only an admin deletes a project
        var refused = await alex.DeleteAsync("/api/projects?code=NO-SUCH-PROJECT");
        Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
        Assert.Contains("Only an admin can delete projects", await refused.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task A_wrong_password_is_refused_and_a_new_one_signs_the_old_sessions_out()
    {
        var admin = await Admin();
        Assert.Equal(HttpStatusCode.Unauthorized, (await Browser().PostAsJsonAsync("/api/auth/signin", new { name = "Fab", password = "nope" })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Browser().PostAsJsonAsync("/api/auth/signin", new { name = "Nobody" })).StatusCode);

        var u = (await (await admin.PostAsJsonAsync("/api/users", new { name = "Sam", password = "a1" })).Content.ReadFromJsonAsync<JsonObject>())!;
        var sam = Browser();
        Assert.Equal(HttpStatusCode.Unauthorized, (await sam.PostAsJsonAsync("/api/auth/signin", new { name = "Sam" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await sam.PostAsJsonAsync("/api/auth/signin", new { name = "Sam", password = "a1" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await sam.GetAsync("/api/jobs")).StatusCode);

        // the admin gives Sam a new password: Sam's browser is signed out
        var id = u["id"]!.GetValue<int>();
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/users/{id}", new { password = "b2" })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await sam.GetAsync("/api/jobs")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await sam.PostAsJsonAsync("/api/auth/signin", new { name = "Sam", password = "b2" })).StatusCode);

        // Sam changes his own password; removed, he is signed out for good
        Assert.Equal(HttpStatusCode.OK, (await sam.PostAsJsonAsync("/api/auth/password", new { current = "b2", password = "c3" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await sam.GetAsync("/api/jobs")).StatusCode);   // this browser stays signed in
        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"/api/users/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await sam.GetAsync("/api/jobs")).StatusCode);
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

    [Fact]
    public async Task Each_user_sees_only_their_own_drafts()
    {
        var admin = await Admin();
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync("/api/users", new { name = "Alex", isAdmin = false })).StatusCode);
        var alex = Browser();
        Assert.Equal(HttpStatusCode.OK, (await alex.PostAsJsonAsync("/api/auth/signin", new { name = "Alex" })).StatusCode);

        var id = Guid.NewGuid().ToString();
        var draft = new { name = "Fab's job", parts = 1, solutions = 0, content = new JsonObject { ["x"] = 1 } };
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/drafts/{id}", draft)).StatusCode);
        Assert.Single((await admin.GetFromJsonAsync<JsonArray>("/api/drafts"))!);
        Assert.Empty((await alex.GetFromJsonAsync<JsonArray>("/api/drafts"))!);
        Assert.Equal(HttpStatusCode.NotFound, (await alex.GetAsync($"/api/drafts/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await alex.PutAsJsonAsync($"/api/drafts/{id}", draft)).StatusCode);
        await alex.DeleteAsync($"/api/drafts/{id}");   // not hers: nothing happens
        Assert.Single((await admin.GetFromJsonAsync<JsonArray>("/api/drafts"))!);
    }
}
