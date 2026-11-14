# GNEZDO status API

A read-only API for other apps (a BOM app, a workflow overview) that want to know where the laser parts
of an order stand: in GNEZDO or not, in a job, nested, sent to a machine, cut. Nothing can be changed through
it: the other app compares with its own data and flags what it finds (a drawing never imported, or one with
no laser parts at all, is for that app to mark).

Server build only (the desktop build has no keys menu).

## Keys

An admin makes a key per app: user menu → **Status API keys** → *Make key*. The key is shown once; GNEZDO
keeps only its hash. Removing a key stops that app at once.

Every call sends the key in a header:

```
X-Api-Key: gz_…
```

(`Authorization: Bearer gz_…` works too.) Without a valid key the answer is `401`.

## What GNEZDO knows

| Status       | Meaning                                                                  |
|--------------|--------------------------------------------------------------------------|
| `missing`    | (check only) no part of that drawing in the project: never imported      |
| `imported`   | saved in GNEZDO, in no saved job                                          |
| `inJob`      | in a saved job, not nested                                                |
| `nested`     | on the job's saved nest (the solution shown)                              |
| `partlySent` | some pieces sent to a machine                                             |
| `sent`       | at least the part's quantity sent to a machine                            |
| `partlyCut`  | some pieces in jobs the operator marked as cut                            |
| `cut`        | at least the part's quantity in jobs marked as cut                        |

"Sent" is recorded by **Process → POST PROCESS**: every NC program written (or downloaded) for a sheet of a
saved job, with the pieces of each part on it (times the sheet's cut number). Post processing the same sheet
again replaces its record; post processing every sheet replaces the job's records.

"Cut" is the operator's, by sheet: Job search → pick a sheet → **Mark sheet N as cut** (only a sheet sent to a
machine), or **Mark all as cut** for the whole job. A sheet's pieces count as cut; a job marked as cut as a
whole counts all its nested pieces. The job is cut (`isCut`) when all its sheets are. Post processing sheets
again keeps the cut mark of a sheet whose parts did not change. Each sheet shows `isCut`, `cutAt`, `cutBy`;
each job line `isCut`, `cutAt`, `cutBy` and `cut`; a part and a check line add up `cut`. A part in two jobs
counts from whichever job's sheets are cut.

Parts belong to a project (the order): the same drawing in two orders is two parts, so the numbers of one
order never mix with another's. A part taken from an older project into a new job still counts for its own
project.

## Part names

Laser parts are named `{drawing}_{BOM position}_{pieces}kos`, e.g. `1234-56-78_P2_3kos` (`-` works between
them too; `kom` / `pcs` instead of `kos`, or no pieces). The API splits that into `drawing`, `position` and
`piecesPerDrawing`. A name without a position (`P1`, `P3A` …) is the drawing as a whole.

## GET /api/v1/projects/{code}

Every part of the project.

```json
{
  "project": { "code": "26-0412", "name": "Conveyor brackets", "customer": "…" },
  "at": "2026-11-14T13:05:00+00:00",
  "parts": [
    {
      "id": "512", "name": "1234-56-78_P2_3kos", "drawing": "1234-56-78", "position": "P2", "piecesPerDrawing": 3,
      "qty": 6, "material": "S235", "thicknessMm": 5, "importedAt": "…",
      "inJobs": 6, "nested": 6, "sent": 3, "lastSentAt": "…", "cut": 0, "status": "partlySent",
      "jobs": [
        { "id": "88", "name": "S235_5_1411", "machine": "laser", "qty": 6, "nested": 6, "sent": 3,
          "isCut": false, "cutAt": null, "cutBy": "", "cut": 0, "modifiedAt": "…",
          "sheets": [ { "sheet": 1, "file": "S235_5_1411_1.nc", "machine": "laser", "pieces": 3, "sentAt": "…", "sentBy": "…",
                        "isCut": false, "cutAt": null, "cutBy": "" } ] }
      ]
    }
  ]
}
```

`404` when there is no such project.

## POST /api/v1/projects/{code}/check

The order's laser drawings (from the BOM), each answered: found or missing, and how far it got.

```json
{ "drawings": [
  { "drawing": "1234-56-78", "position": "P2", "needed": 6 },
  { "drawing": "1234-56-79", "needed": 2 },
  { "drawing": "1234-56-78ZR", "position": "P2", "needed": 6 }
] }
```

- `position` is optional: without it every position of the drawing answers.
- `needed` is optional (pieces): with it, and one part answering the line, `short` is how many are still to send.
- A mirrored drawing (`…ZR`) not found by itself is looked for under its base drawing (`mergedWithBase`),
  as mirrored parts are usually cut under the base number with both quantities together.

```json
{
  "project": "26-0412", "projectFound": true, "at": "…",
  "items": [
    { "drawing": "1234-56-78", "position": "P2", "needed": 6, "status": "partlySent", "mergedWithBase": null,
      "inJobs": 6, "nested": 6, "sent": 3, "cut": 0, "short": 3, "parts": [ … as above … ] },
    { "drawing": "1234-56-79", "position": "", "needed": 2, "status": "missing", "inJobs": 0, "nested": 0, "sent": 0, "short": null, "parts": [] }
  ],
  "notInList": ["1234-56-80_P1_1kos"]
}
```

`notInList`: parts GNEZDO has for the project that no line asked about. With an unknown project every line
is `missing` and `projectFound` is `false`.

## GET /api/v1

A short list of the endpoints (also checks the key).
