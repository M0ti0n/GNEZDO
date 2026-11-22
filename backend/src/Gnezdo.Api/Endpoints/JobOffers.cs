using Gnezdo.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Gnezdo.Api.Endpoints;

/// <summary>
/// Parts sent to someone else's open job (server build): the sender picks saved parts in the Parts list and a
/// job open on another computer; the page that has the job open is asked ("Mia is sending you 3 parts to nest
/// in 26-0412"), accepts (the parts go into the job's work parts) or refuses, and the sender is told which.
/// An offer whose job was closed (or opened somewhere else) before an answer is told to the sender as not
/// delivered. Kept in memory, like the job locks: a restarted server forgets offers not answered yet.
/// </summary>
public sealed class JobOffers(TimeProvider clock)
{
    /// <summary>An answer waits this long for its sender's page; an offer this long for an answer.</summary>
    public static readonly TimeSpan Keep = TimeSpan.FromHours(12);

    public enum State { Pending, Accepted, Refused, Gone }

    public sealed record Item(int PartId, int Qty);

    public sealed class Offer
    {
        public required string Id { get; init; }
        public required int JobId { get; init; }
        public required string JobName { get; init; }
        public required string FromUser { get; init; }
        public required string FromPage { get; init; }
        public required string ToUser { get; init; }
        public required string ToPage { get; init; }
        public required IReadOnlyList<Item> Items { get; init; }
        public string Note { get; init; } = "";
        public DateTimeOffset At { get; init; }
        public State State { get; set; }
        public DateTimeOffset? AnsweredAt { get; set; }
    }

    private readonly List<Offer> _offers = [];
    private readonly object _gate = new();

    public Offer Add(int jobId, string jobName, string fromUser, string fromPage, JobLocks.Holder to, IReadOnlyList<Item> items, string note)
    {
        var o = new Offer
        {
            Id = Guid.NewGuid().ToString("N")[..12], JobId = jobId, JobName = jobName, FromUser = fromUser, FromPage = fromPage,
            ToUser = to.User, ToPage = to.Page, Items = items, Note = note, At = clock.GetUtcNow(),
        };
        lock (_gate) { _offers.Add(o); }
        return o;
    }

    /// <summary>For a page: the offers waiting for its answer, and the answers to its own offers (each told once).</summary>
    public (List<Offer> Incoming, List<Offer> Answers) For(string page, JobLocks locks)
    {
        var now = clock.GetUtcNow();
        lock (_gate)
        {
            // an offer to a job closed (or opened elsewhere) before an answer, or never answered: not delivered
            foreach (var o in _offers.Where(o => o.State == State.Pending))
                if (locks.HolderOf(o.JobId)?.Page != o.ToPage || now - o.At > Keep) { o.State = State.Gone; o.AnsweredAt = now; }
            _offers.RemoveAll(o => o.State != State.Pending && now - (o.AnsweredAt ?? o.At) > Keep);   // a sender who never came back
            var incoming = _offers.Where(o => o.State == State.Pending && o.ToPage == page).OrderBy(o => o.At).ToList();
            var answers = _offers.Where(o => o.State != State.Pending && o.FromPage == page).OrderBy(o => o.AnsweredAt).ToList();
            _offers.RemoveAll(answers.Contains);
            return (incoming, answers);
        }
    }

    /// <summary>The answer of the page the offer went to; false: no such offer waiting for this page.</summary>
    public bool Answer(string id, string page, bool accept)
    {
        lock (_gate)
        {
            var o = _offers.FirstOrDefault(x => x.Id == id && x.ToPage == page && x.State == State.Pending);
            if (o is null) return false;
            o.State = accept ? State.Accepted : State.Refused;
            o.AnsweredAt = clock.GetUtcNow();
            return true;
        }
    }

    // ---- endpoints

    public record OfferItem(string PartId, int Qty);
    public record OfferRequest(int JobId, OfferItem[] Parts, string? Note);
    public record OpenJobDto(string Id, string Name, string User, DateTimeOffset Since, MaterialDto[] Materials);
    public record MaterialDto(string Material, decimal ThicknessMm);
    public record IncomingItem(PartDto Part, int Qty);
    public record IncomingDto(string Id, string JobId, string JobName, string FromUser, DateTimeOffset At, string Note, IncomingItem[] Parts);
    public record AnswerDto(string Id, string JobName, string ToUser, string State, int PartCount, int Pieces);

    public static void Map(WebApplication app)
    {
        // the jobs open on other computers, with who has them and the materials and thicknesses in them
        app.MapGet("/api/jobs/open", async (HttpContext ctx, GnezdoDb db, JobLocks locks, CancellationToken ct) =>
        {
            var page = JobLocks.PageOf(ctx);
            var open = locks.Open().Where(o => o.Holder.Page != page).ToList();
            var ids = open.Select(o => o.Job).ToList();
            var names = await db.Jobs.AsNoTracking().Where(j => ids.Contains(j.Id)).ToDictionaryAsync(j => j.Id, j => j.Name, ct);
            var mats = (await db.JobParts.AsNoTracking().Where(jp => ids.Contains(jp.JobId))
                    .Select(jp => new { jp.JobId, Material = jp.Material ?? jp.Part.Material.Name, Thickness = jp.ThicknessMm ?? jp.Part.ThicknessMm })
                    .Distinct().ToListAsync(ct))
                .GroupBy(x => x.JobId).ToDictionary(g => g.Key, g => g.OrderBy(x => x.Material).ThenBy(x => x.Thickness).Select(x => new MaterialDto(x.Material, x.Thickness)).ToArray());
            return Results.Ok(open.Where(o => names.ContainsKey(o.Job)).OrderBy(o => names[o.Job], StringComparer.OrdinalIgnoreCase)
                .Select(o => new OpenJobDto(o.Job.ToString(), names[o.Job], o.Holder.User, o.Holder.Since, mats.GetValueOrDefault(o.Job) ?? [])));
        });

        app.MapPost("/api/offers", async (OfferRequest r, HttpContext ctx, GnezdoDb db, JobLocks locks, JobOffers offers, CancellationToken ct) =>
        {
            var page = JobLocks.PageOf(ctx);
            if (page.Length == 0) return Results.BadRequest(new { message = "No page id (X-Gnezdo-Page)." });
            var job = await db.Jobs.AsNoTracking().Where(j => j.Id == r.JobId).Select(j => j.Name).FirstOrDefaultAsync(ct);
            if (job is null) return Results.NotFound(new { message = "There is no such job." });
            var to = locks.HolderOf(r.JobId);
            if (to is null) return Results.Conflict(new { message = $"{job} is not open anywhere now: the parts were not sent." });
            if (to.Page == page) return Results.BadRequest(new { message = $"{job} is open here: add the parts yourself." });
            var items = new List<Item>();
            foreach (var p in r.Parts ?? [])
            {
                if (!int.TryParse(p.PartId, out var id) || p.Qty < 0) return Results.BadRequest(new { message = "A part or quantity is not valid." });
                if (!items.Any(i => i.PartId == id)) items.Add(new Item(id, p.Qty));
            }
            if (items.Count == 0) return Results.BadRequest(new { message = "No parts to send." });
            if (items.Count > 500) return Results.BadRequest(new { message = "At most 500 parts at a time." });
            var ids = items.Select(i => i.PartId).ToList();
            if (await db.Parts.AsNoTracking().Live().CountAsync(p => ids.Contains(p.Id), ct) != items.Count)
                return Results.BadRequest(new { message = "A part was deleted meanwhile: search again." });
            var note = (r.Note ?? "").Trim();
            var o = offers.Add(r.JobId, job, JobLocks.UserOf(ctx), page, to, items, note.Length > 300 ? note[..300] : note);
            return Results.Ok(new { id = o.Id, to = to.User, job });
        });

        // polled by every page (every few seconds): offers to answer, and answers to its own
        app.MapGet("/api/offers", async (HttpContext ctx, GnezdoDb db, JobLocks locks, JobOffers offers, CancellationToken ct) =>
        {
            var page = JobLocks.PageOf(ctx);
            if (page.Length == 0) return Results.Ok(new { incoming = Array.Empty<IncomingDto>(), answers = Array.Empty<AnswerDto>() });
            var (incoming, answers) = offers.For(page, locks);
            var ids = incoming.SelectMany(o => o.Items.Select(i => i.PartId)).Distinct().ToList();
            var parts = ids.Count == 0 ? new Dictionary<string, PartDto>()
                : await db.Parts.AsNoTracking().Where(p => ids.Contains(p.Id)).Select(PartEndpoints.ToDto).ToDictionaryAsync(p => p.Id, ct);
            return Results.Ok(new
            {
                incoming = incoming.Select(o => new IncomingDto(o.Id, o.JobId.ToString(), o.JobName, o.FromUser, o.At, o.Note,
                    o.Items.Where(i => parts.ContainsKey(i.PartId.ToString())).Select(i => new IncomingItem(parts[i.PartId.ToString()], i.Qty)).ToArray())),
                answers = answers.Select(o => new AnswerDto(o.Id, o.JobName, o.ToUser, o.State.ToString().ToLowerInvariant(), o.Items.Count, o.Items.Sum(i => i.Qty))),
            });
        });

        app.MapPost("/api/offers/{id}/answer", (string id, AnswerRequest r, HttpContext ctx, JobOffers offers) =>
            offers.Answer(id, JobLocks.PageOf(ctx), r.Accept) ? Results.NoContent()
                : Results.NotFound(new { message = "This offer is not waiting for an answer here any more." }));
    }

    public record AnswerRequest(bool Accept);
}
