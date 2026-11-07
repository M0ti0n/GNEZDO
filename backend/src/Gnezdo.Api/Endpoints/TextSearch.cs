using Gnezdo.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Gnezdo.Api.Endpoints;

/// <summary>
/// "Contains the text", case not mattering, on both databases: a LIKE pattern with the wildcards
/// in the typed text escaped. (string.Contains would be case-sensitive on SQLite.)
/// </summary>
public static class TextSearch
{
    public const string Escape = "\\";

    public static string Pattern(GnezdoDb db, string text)
    {
        var e = text.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");
        if (!db.Database.IsSqlite()) e = e.Replace("[", "\\[");   // a character class on SQL Server only
        return $"%{e}%";
    }
}
