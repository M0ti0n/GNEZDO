using System.Text.Json;

namespace Gnezdo.Api.Endpoints;

/// <summary>
/// A request whose body cannot be read as what the endpoint takes (a quantity of 1.5 or 2,147,483,648, text
/// where a number belongs, broken JSON) is answered 400 with what is wrong, the same as the other refusals
/// ({ message }), instead of an error page.
/// </summary>
public static class BadRequests
{
    public static void AddBadRequests(this IServiceCollection services) =>
        services.Configure<RouteHandlerOptions>(o => o.ThrowOnBadRequest = true);

    public static void UseBadRequests(this WebApplication app) =>
        app.Use(async (ctx, next) =>
        {
            try { await next(ctx); }
            catch (BadHttpRequestException e) when (!ctx.Response.HasStarted)
            {
                ctx.Response.Clear();
                ctx.Response.StatusCode = e.StatusCode is >= 400 and < 500 ? e.StatusCode : StatusCodes.Status400BadRequest;
                await ctx.Response.WriteAsJsonAsync(new { message = MessageOf(e) }, ctx.RequestAborted);
            }
        });

    internal static string MessageOf(BadHttpRequestException e)
    {
        for (Exception? x = e.InnerException; x is not null; x = x.InnerException)
            if (x is JsonException j)
            {
                var where = string.IsNullOrEmpty(j.Path) || j.Path == "$" ? "" : $" ({j.Path.TrimStart('$', '.')})";
                return j.Message.Contains("could not be converted", StringComparison.Ordinal)
                    ? $"The request could not be read: a value is not valid there{where}. Quantities are whole numbers."
                    : $"The request could not be read: it is not valid JSON{where}.";
            }
        return $"The request could not be read: {e.Message}";
    }
}
