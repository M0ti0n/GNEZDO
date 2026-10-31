using System.Text.Json.Nodes;
using Gnezdo.Api.Nesting;

namespace Gnezdo.Api.Endpoints;

/// <summary>
/// Nesting runs. The job tab sends everything the run needs (parts with outlines, quantities,
/// rotations, the stock sheets), so this works with and without the database (demo).
/// </summary>
public static class NestEndpoints
{
    private static readonly string[] Modes = ["fast", "thorough", "custom"];

    public static void MapNestEndpoints(this WebApplication app)
    {
        app.MapGet("/api/nest/status", (NestRunner runner) =>
            Results.Ok(new { available = runner.Missing() is null, reason = runner.Missing() }));
        app.MapPost("/api/nest", Start);
        app.MapGet("/api/nest/{id}", (string id, NestRunner runner) =>
            runner.Get(id) is { } run ? Results.Ok(run) : Results.NotFound());
        app.MapPost("/api/nest/{id}/stop", (string id, NestRunner runner) =>
            runner.Stop(id) ? Results.Ok(runner.Get(id)) : Results.NotFound());
    }

    /// <summary>POST /api/nest: starts a run, answers with its id (then poll GET /api/nest/{id}).</summary>
    private static IResult Start(JsonObject request, NestRunner runner)
    {
        if (runner.Missing() is { } missing)
            return Results.Problem(missing, statusCode: StatusCodes.Status503ServiceUnavailable, title: "Nesting is not available");
        var errors = new Dictionary<string, string[]>();
        var mode = request["mode"]?.GetValueKind() == System.Text.Json.JsonValueKind.String ? request["mode"]!.GetValue<string>() : "";
        if (!Modes.Contains(mode)) errors["mode"] = ["Mode must be fast, thorough or custom."];
        if (request["parts"] is not JsonArray { Count: > 0 }) errors["parts"] = ["No parts to nest."];
        if (request["sheets"] is not JsonArray { Count: > 0 }) errors["sheets"] = ["No stock sheets. Add sheets in the Stock panel."];
        if (errors.Count > 0) return Results.ValidationProblem(errors);
        var id = runner.Start(request);
        return Results.Accepted($"/api/nest/{id}", runner.Get(id));
    }
}
