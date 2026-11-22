using System.Collections.Concurrent;

namespace Gnezdo.Api.Endpoints;

/// <summary>
/// A saved job is open in one place at a time: the browser tab that opened it (the page id it sends as
/// X-Gnezdo-Page) holds it while it is open and renews it every half minute. Opening it anywhere else,
/// by another user or by the same user on another computer or in another browser, is refused with who
/// has it; so is saving over it. Closing the job (its tab, or the page) lets it go; a browser that stops
/// without closing it (switched off, crashed) loses it after <see cref="Lapse"/>.
/// Kept in memory: a restarted server starts with no job open, and the open pages take theirs again
/// with their next renewal.
/// </summary>
public sealed class JobLocks(TimeProvider clock)
{
    /// <summary>How long a job stays held without a renewal.</summary>
    public static readonly TimeSpan Lapse = TimeSpan.FromMinutes(2);

    public sealed record Holder(string Page, string User, DateTimeOffset Since, DateTimeOffset Seen);

    private readonly ConcurrentDictionary<int, Holder> _held = new();
    private readonly object _gate = new();

    private bool Live(Holder h) => clock.GetUtcNow() - h.Seen < Lapse;

    /// <summary>Who else holds the job now (null: nobody, or this page).</summary>
    public Holder? Other(int job, string page) =>
        _held.TryGetValue(job, out var h) && h.Page != page && Live(h) ? h : null;

    /// <summary>Takes the job for this page; when another page holds it: false and who.</summary>
    public bool TryTake(int job, string page, string user, out Holder? other)
    {
        lock (_gate)
        {
            var now = clock.GetUtcNow();
            if (_held.TryGetValue(job, out var h) && h.Page != page && Live(h)) { other = h; return false; }
            _held[job] = h is not null && h.Page == page ? h with { Seen = now, User = user } : new Holder(page, user, now, now);
            other = null;
            return true;
        }
    }

    /// <summary>Renews the job for this page; false when the page does not hold it any more (it lapsed and was taken).</summary>
    public bool Keep(int job, string page, string user)
    {
        lock (_gate)
        {
            if (_held.TryGetValue(job, out var h) && h.Page != page && Live(h)) return false;
            var now = clock.GetUtcNow();
            _held[job] = h is not null && h.Page == page ? h with { Seen = now } : new Holder(page, user, now, now);
            return true;
        }
    }

    /// <summary>Lets the job go (only the page holding it can).</summary>
    public void Release(int job, string page)
    {
        lock (_gate) { if (_held.TryGetValue(job, out var h) && h.Page == page) _held.TryRemove(job, out _); }
    }

    /// <summary>The jobs open now, and where.</summary>
    public IReadOnlyList<(int Job, Holder Holder)> Open() =>
        _held.Where(kv => Live(kv.Value)).Select(kv => (kv.Key, kv.Value)).ToList();

    /// <summary>The page holding the job now (null: nobody).</summary>
    public Holder? HolderOf(int job) => _held.TryGetValue(job, out var h) && Live(h) ? h : null;

    public static string PageOf(HttpContext ctx) =>
        ctx.Request.Headers["X-Gnezdo-Page"].FirstOrDefault() is { Length: > 0 and <= 64 } p ? p
        : ctx.Request.Query["page"].FirstOrDefault() is { Length: > 0 and <= 64 } q ? q : "";

    public static string UserOf(HttpContext ctx) =>
        ctx.User.Identity?.Name is { Length: > 0 } n ? n
        : ctx.Request.Headers["X-Gnezdo-User"].FirstOrDefault() is { Length: > 0 } u ? u[..Math.Min(u.Length, 100)] : "someone";

    /// <summary>The refusal: who has the job open, since when.</summary>
    public static IResult Refused(string jobName, Holder h, string what) => Results.Json(new
    {
        message = $"{jobName} is open on another computer by {h.User} (since {h.Since:HH:mm} UTC): {what}",
        user = h.User, since = h.Since, locked = true,
    }, statusCode: StatusCodes.Status423Locked);
}
