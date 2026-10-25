using System.Globalization;

namespace Gnezdo.Api.Endpoints;

public enum DateMode { UpTo, On, From }

/// <summary>
/// Date filter from the query string, e.g. "on:2026-10-24", "upTo:2026-10-24", "from:2026-10-24".
/// "Up to" includes the whole day; "on" is that calendar day; "from" starts at 00:00 (shop time).
/// </summary>
public readonly record struct DateFilter(DateMode Mode, DateOnly Day)
{
    public static bool TryParse(string? text, out DateFilter filter)
    {
        filter = default;
        if (string.IsNullOrWhiteSpace(text)) return false;
        var parts = text.Split(':', 2);
        if (parts.Length != 2) return false;
        DateMode mode;
        switch (parts[0].Trim().ToLowerInvariant())
        {
            case "upto": mode = DateMode.UpTo; break;
            case "on": mode = DateMode.On; break;
            case "from": mode = DateMode.From; break;
            default: return false;
        }
        if (!DateOnly.TryParseExact(parts[1].Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var day))
            return false;
        filter = new DateFilter(mode, day);
        return true;
    }

    /// <summary>Half-open UTC range [from, to); a null end means unbounded.</summary>
    public (DateTimeOffset? From, DateTimeOffset? To) ToRange(ShopTime time)
    {
        var start = time.StartOfDay(Day);
        var end = time.StartOfDay(Day.AddDays(1));
        return Mode switch
        {
            DateMode.On => (start, end),
            DateMode.UpTo => (null, end),
            _ => (start, null),
        };
    }
}
