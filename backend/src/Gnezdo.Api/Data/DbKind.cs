namespace Gnezdo.Api.Data;

/// <summary>Which database a server uses ("Gnezdo:Database"): sqlserver (the default), postgres or sqlite.</summary>
public static class DbKind
{
    public const string SqlServer = "sqlserver", Postgres = "postgres", Sqlite = "sqlite";

    public static string Of(IConfiguration config) => (config["Gnezdo:Database"] ?? "").Trim().ToLowerInvariant() switch
    {
        "sqlite" => Sqlite,
        "postgres" or "postgresql" or "pg" => Postgres,
        _ => SqlServer,
    };
}
