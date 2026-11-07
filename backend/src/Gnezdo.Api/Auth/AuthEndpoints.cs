using System.Security.Claims;
using Gnezdo.Api.Data;
using Gnezdo.Api.Diagnostics;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;

namespace Gnezdo.Api.Auth;

/// <summary>
/// Sign-in for the server build: the admin adds users (a name, a password if wanted); every API call
/// but these here needs a signed-in user. The demo (no database) and the desktop build run without.
/// A sign-in lasts 30 days in that browser, renewed while used; it ends when the user's password or
/// rights change or the user is removed (the stamp).
/// </summary>
public static class AuthEndpoints
{
    public const string StampClaim = "gnezdo:stamp";
    public const string AdminRole = "admin";

    public record SignInRequest(string? Name, string? Password);
    public record PasswordChange(string? Current, string? Password);
    public record UserCreate(string? Name, string? Password, bool IsAdmin);
    public record UserUpdate(string? Name, string? Password, bool? ClearPassword, bool? IsAdmin);

    /// <summary>Sign-in is needed: the server build (a database) unless "Gnezdo:RequireSignIn" is false.</summary>
    public static bool Required(IConfiguration config, bool demo) => !demo && config.GetValue("Gnezdo:RequireSignIn", true);

    /// <summary>Only an admin may (or anyone, where there is no sign-in).</summary>
    public static bool Admin(HttpContext ctx) =>
        !ctx.RequestServices.GetRequiredService<SignInState>().Required || ctx.User.IsInRole(AdminRole);

    public sealed record SignInState(bool Required);

    public static void AddGnezdoAuth(this WebApplicationBuilder builder, bool required, string keysDir)
    {
        builder.Services.AddSingleton(new SignInState(required));
        // the keys that sign the cookie, kept so a restart does not sign everyone out
        try { Directory.CreateDirectory(keysDir); } catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
        builder.Services.AddDataProtection().SetApplicationName("GNEZDO").PersistKeysToFileSystem(new DirectoryInfo(keysDir));
        builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme).AddCookie(o =>
        {
            o.Cookie.Name = "gnezdo.auth";
            o.Cookie.HttpOnly = true;
            o.Cookie.SameSite = SameSiteMode.Lax;
            o.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;   // plain http on the LAN
            o.ExpireTimeSpan = TimeSpan.FromDays(30);
            o.SlidingExpiration = true;
            o.Events.OnRedirectToLogin = ctx => { ctx.Response.StatusCode = StatusCodes.Status401Unauthorized; return Task.CompletedTask; };
            o.Events.OnRedirectToAccessDenied = ctx => { ctx.Response.StatusCode = StatusCodes.Status403Forbidden; return Task.CompletedTask; };
            o.Events.OnValidatePrincipal = async ctx =>
            {
                var db = ctx.HttpContext.RequestServices.GetService<GnezdoDb>();
                var stamp = ctx.Principal?.FindFirstValue(StampClaim);
                var ok = db is not null && stamp is not null && int.TryParse(ctx.Principal?.FindFirstValue(ClaimTypes.NameIdentifier), out var id)
                    && await db.Users.AsNoTracking().AnyAsync(u => u.Id == id && u.Stamp == stamp);
                if (!ok)
                {
                    ctx.RejectPrincipal();
                    await ctx.HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
                }
            };
        });
        builder.Services.AddAuthorization();
    }

    /// <summary>Every /api call needs a signed-in user, but sign-in itself and the health check
    /// (after UseAuthentication and the diagnostic log, so a refused call is logged too).</summary>
    public static void UseGnezdoAuth(this WebApplication app)
    {
        if (!app.Services.GetRequiredService<SignInState>().Required) return;
        var setup = app.Services.GetService<Gnezdo.Api.Setup.SetupState>();
        app.Use(async (ctx, next) =>
        {
            var path = ctx.Request.Path;
            if (path.StartsWithSegments("/api") && ctx.User.Identity?.IsAuthenticated != true
                && !path.StartsWithSegments("/api/auth") && !path.StartsWithSegments("/api/health")
                && !(setup?.Pending == true && path.StartsWithSegments("/api/setup")))   // no users before there is a database
            {
                ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
                await ctx.Response.WriteAsJsonAsync(new { message = "Sign in first." });
                return;
            }
            await next(ctx);
        });
    }

    private static async Task SignIn(HttpContext ctx, User u)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, u.Id.ToString(System.Globalization.CultureInfo.InvariantCulture)),
            new(ClaimTypes.Name, u.Name),
            new(StampClaim, u.Stamp),
        };
        if (u.IsAdmin) claims.Add(new Claim(ClaimTypes.Role, AdminRole));
        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme));
        await ctx.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, principal, new AuthenticationProperties { IsPersistent = true });
    }

    private static object View(User u) => new
    {
        id = u.Id, name = u.Name, isAdmin = u.IsAdmin, hasPassword = u.PasswordHash is not null,
        createdAt = u.CreatedAt, lastSignInAt = u.LastSignInAt,
    };

    private static string? CleanName(string? n) => n?.Trim() is { Length: > 0 and <= 100 } t ? t : null;

    private static IResult Invalid(string field, string message) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { [field] = [message] });

    public static void MapAuthEndpoints(this WebApplication app)
    {
        // what the app shows first: the sign-in page, the first admin to create, or the app
        app.MapGet("/api/auth/state", async (HttpContext ctx, SignInState s, CancellationToken ct) =>
        {
            if (!s.Required) return Results.Ok(new { required = false, setupNeeded = false, user = (object?)null });
            var db = ctx.RequestServices.GetRequiredService<GnezdoDb>();
            var setup = !await db.Users.AnyAsync(ct);
            object? user = null;
            if (ctx.User.Identity?.IsAuthenticated == true && int.TryParse(ctx.User.FindFirstValue(ClaimTypes.NameIdentifier), out var id)
                && await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == id, ct) is { } u) user = View(u);
            return Results.Ok(new { required = true, setupNeeded = setup, user });
        });

        // the very first start: the first user, an admin
        app.MapPost("/api/auth/setup", async (SignInRequest r, HttpContext ctx, SignInState s, TimeProvider clock, DiagLog log, CancellationToken ct) =>
        {
            if (!s.Required) return Results.NotFound();
            var db = ctx.RequestServices.GetRequiredService<GnezdoDb>();
            if (await db.Users.AnyAsync(ct)) return Results.Conflict(new { message = "There are users already: sign in." });
            if (CleanName(r.Name) is not { } name) return Invalid("name", "A name is required (up to 100 characters).");
            var u = new User
            {
                Name = name, IsAdmin = true, Stamp = Passwords.NewStamp(), CreatedAt = clock.GetUtcNow(), LastSignInAt = clock.GetUtcNow(),
                PasswordHash = string.IsNullOrEmpty(r.Password) ? null : Passwords.Hash(r.Password),
            };
            db.Users.Add(u);
            await db.SaveChangesAsync(ct);
            await SignIn(ctx, u);
            log.Write("auth", $"First admin {name} created", null, name);
            return Results.Ok(View(u));
        });

        app.MapPost("/api/auth/signin", async (SignInRequest r, HttpContext ctx, SignInState s, TimeProvider clock, DiagLog log, CancellationToken ct) =>
        {
            if (!s.Required) return Results.NotFound();
            var db = ctx.RequestServices.GetRequiredService<GnezdoDb>();
            var name = CleanName(r.Name);
            var u = name is null ? null : await db.Users.FirstOrDefaultAsync(x => x.Name == name, ct);   // case does not matter (collation)
            if (u is null || (u.PasswordHash is { } h && !Passwords.Verify(r.Password ?? "", h)))
            {
                log.Write("auth", $"Sign-in refused for \"{DiagLog.Cut(r.Name, 100)}\"", null, null, null, DiagEndpoints.Who(ctx).Client);
                await Task.Delay(500, ct);   // slows down guessing
                return Results.Json(new { message = "Name or password is wrong." }, statusCode: StatusCodes.Status401Unauthorized);
            }
            u.LastSignInAt = clock.GetUtcNow();
            await db.SaveChangesAsync(ct);
            await SignIn(ctx, u);
            log.Write("auth", $"{u.Name} signed in", null, u.Name, null, DiagEndpoints.Who(ctx).Client);
            return Results.Ok(View(u));
        });

        app.MapPost("/api/auth/signout", async (HttpContext ctx, DiagLog log) =>
        {
            if (ctx.User.Identity?.Name is { } n) log.Write("auth", $"{n} signed out", null, n);
            await ctx.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Results.NoContent();
        });

        // one's own password: set, change or remove (the current one first, when there is one)
        app.MapPost("/api/auth/password", async (PasswordChange r, HttpContext ctx, SignInState s, CancellationToken ct) =>
        {
            if (!s.Required) return Results.NotFound();
            var db = ctx.RequestServices.GetRequiredService<GnezdoDb>();
            if (!int.TryParse(ctx.User.FindFirstValue(ClaimTypes.NameIdentifier), out var id)
                || await db.Users.FirstOrDefaultAsync(u => u.Id == id, ct) is not { } u) return Results.Unauthorized();
            if (u.PasswordHash is { } h && !Passwords.Verify(r.Current ?? "", h)) return Invalid("current", "The current password is wrong.");
            u.PasswordHash = string.IsNullOrEmpty(r.Password) ? null : Passwords.Hash(r.Password);
            u.Stamp = Passwords.NewStamp();   // other browsers signed in as this user are signed out
            await db.SaveChangesAsync(ct);
            await SignIn(ctx, u);             // this one stays
            return Results.Ok(View(u));
        });

        // -- users: admin only (only where there is a database: the server build) -----------------
        if (!app.Services.GetRequiredService<SignInState>().Required) return;
        var users = app.MapGroup("/api/users");
        users.MapGet("", async (HttpContext ctx, GnezdoDb db, CancellationToken ct) =>
            !Admin(ctx) ? Results.Forbid()
            : Results.Ok((await db.Users.AsNoTracking().OrderBy(u => u.Name).ToListAsync(ct)).Select(View)));

        users.MapPost("", async (UserCreate r, HttpContext ctx, GnezdoDb db, TimeProvider clock, DiagLog log, CancellationToken ct) =>
        {
            if (!Admin(ctx)) return Results.Forbid();
            if (CleanName(r.Name) is not { } name) return Invalid("name", "A name is required (up to 100 characters).");
            if (await db.Users.AnyAsync(u => u.Name == name, ct)) return Invalid("name", $"There is a user {name} already.");
            var u = new User
            {
                Name = name, IsAdmin = r.IsAdmin, Stamp = Passwords.NewStamp(), CreatedAt = clock.GetUtcNow(),
                PasswordHash = string.IsNullOrEmpty(r.Password) ? null : Passwords.Hash(r.Password),
            };
            db.Users.Add(u);
            await db.SaveChangesAsync(ct);
            log.Write("auth", $"User {name} added{(r.IsAdmin ? " (admin)" : "")} by {ctx.User.Identity?.Name}", null, ctx.User.Identity?.Name);
            return Results.Ok(View(u));
        });

        users.MapPut("/{id:int}", async (int id, UserUpdate r, HttpContext ctx, GnezdoDb db, DiagLog log, CancellationToken ct) =>
        {
            if (!Admin(ctx)) return Results.Forbid();
            if (await db.Users.FirstOrDefaultAsync(u => u.Id == id, ct) is not { } u) return Results.NotFound();
            var changed = false;
            if (r.Name is not null)
            {
                if (CleanName(r.Name) is not { } name) return Invalid("name", "A name is required (up to 100 characters).");
                if (await db.Users.AnyAsync(x => x.Id != id && x.Name == name, ct)) return Invalid("name", $"There is a user {name} already.");
                u.Name = name;
            }
            if (r.IsAdmin is { } admin && admin != u.IsAdmin)
            {
                if (!admin && !await db.Users.AnyAsync(x => x.Id != id && x.IsAdmin, ct)) return Invalid("isAdmin", "The last admin stays an admin.");
                u.IsAdmin = admin;
                changed = true;
            }
            if (r.ClearPassword == true) { u.PasswordHash = null; changed = true; }
            else if (!string.IsNullOrEmpty(r.Password)) { u.PasswordHash = Passwords.Hash(r.Password); changed = true; }
            if (changed || r.Name is not null) u.Stamp = Passwords.NewStamp();   // signed in with the old rights: signed out
            await db.SaveChangesAsync(ct);
            if (ctx.User.FindFirstValue(ClaimTypes.NameIdentifier) == id.ToString(System.Globalization.CultureInfo.InvariantCulture)) await SignIn(ctx, u);
            log.Write("auth", $"User {u.Name} changed by {ctx.User.Identity?.Name}", new { name = r.Name, isAdmin = r.IsAdmin, password = r.ClearPassword == true ? "removed" : string.IsNullOrEmpty(r.Password) ? null : "set" }, ctx.User.Identity?.Name);
            return Results.Ok(View(u));
        });

        users.MapDelete("/{id:int}", async (int id, HttpContext ctx, GnezdoDb db, DiagLog log, CancellationToken ct) =>
        {
            if (!Admin(ctx)) return Results.Forbid();
            if (await db.Users.FirstOrDefaultAsync(u => u.Id == id, ct) is not { } u) return Results.NotFound();
            if (u.IsAdmin && !await db.Users.AnyAsync(x => x.Id != id && x.IsAdmin, ct)) return Invalid("id", "The last admin cannot be removed.");
            db.Users.Remove(u);
            await db.SaveChangesAsync(ct);
            log.Write("auth", $"User {u.Name} removed by {ctx.User.Identity?.Name}", null, ctx.User.Identity?.Name);
            return Results.NoContent();
        });
    }
}
