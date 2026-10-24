using Microsoft.Extensions.Options;

namespace Gnezdo.Api;

/// <summary>Converts calendar days in the shop's time zone to UTC instants for date filters.</summary>
public sealed class ShopTime(IOptions<GnezdoOptions> options)
{
    private readonly TimeZoneInfo _zone = TimeZoneInfo.FindSystemTimeZoneById(options.Value.TimeZone);

    public TimeZoneInfo Zone => _zone;

    /// <summary>00:00 local time on <paramref name="day"/>, as a UTC instant.</summary>
    public DateTimeOffset StartOfDay(DateOnly day)
    {
        var local = day.ToDateTime(TimeOnly.MinValue, DateTimeKind.Unspecified);
        return new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(local, _zone), TimeSpan.Zero);
    }

    /// <summary>The local calendar day an instant falls on.</summary>
    public DateOnly LocalDay(DateTimeOffset instant) =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(instant, _zone).DateTime);
}
