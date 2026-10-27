# Nesting: PackingSolver + nestprep

The nesting engine GNEZDO will use, kept here so it is at hand. Nothing in the app calls it yet.

| Folder / file | What |
|---|---|
| [`packingsolver/`](packingsolver/) | A copy of [PackingSolver](https://github.com/fontanf/packingsolver) (C++, MIT license, by Florian Fontan) with our fixes applied. Version in [`PACKINGSOLVER_VERSION`](PACKINGSOLVER_VERSION). |
| [`patches/`](patches/) | Our fixes to PackingSolver, one file each, so they can be applied again to a newer version. |
| [`nestprep/`](nestprep/) | Our pre-pass (Python): puts small parts into the holes of bigger ones and pairs awkward parts before PackingSolver nests the sheet; and the post-pass that fills gaps after the nest (below). Details in its [README](nestprep/README.md). |
| [`update-packingsolver.sh`](update-packingsolver.sh) | Replaces `packingsolver/` with a newer upstream version and applies `patches/`. |

Left out of the copy: PackingSolver's `data/` (260 MB of benchmark instances), `doc/`, `img/`.
Nothing else in it was changed apart from `patches/`.

## Our fixes

| Patch | Problem | Fix |
|---|---|---|
| `0001-periodic-packing-union-of-all-pieces.patch` | `compute_combined_shape` (periodic packing) kept only the first piece of an item made of several pieces, so a part with smaller parts in its holes could be tiled over them: **overlapping layouts**. | Uses the convex hull of all pieces when they don't form one piece (safe, never overlapping). Still needed in upstream as of 2026-10-26; should be reported upstream. |

## Build (Linux)

```bash
cd nesting/packingsolver
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release \
  -DPACKINGSOLVER_BUILD_TEST=OFF -DPACKINGSOLVER_USE_CLP=OFF -DPACKINGSOLVER_USE_HIGHS=ON
cmake --build build --target packingsolver_irregular
# -> build/src/irregular/packingsolver_irregular
```

The build downloads its libraries (Boost, HiGHS, nlohmann/json and Fontan's helper libraries) at
fixed versions, so it needs internet. CLP is off because it needs extra system packages; HiGHS
(open source, MIT) is the linear-programming solver instead. Then PackingSolver must be told so:
`--linear-programming-solver highs` (nestprep does this; `PACKINGSOLVER_LP_SOLVER` changes it).

The GitHub workflow **Nesting** builds it and runs nestprep on a small demo job whenever
something here changes, and keeps the built program as a download (artifact `packingsolver-linux`).

## Results (test job Miha2787: 531 parts, 30 types, HARDOX 1 mm, sheet 3000 × 1500, 5 mm spacing)

Sheet-equivalents = full sheets + used length of the last sheet / 3000. 30 s per solve, 2-core
machine, every layout checked by nestprep's own validator (all parts placed, inside the sheet,
no overlaps, gap ≥ 5 mm).

| Run | Sheets | Sheet-equivalents | Parts in holes |
|---|---|---|---|
| Libellula CUT (report) | 8 | ≈ 7.49 | yes |
| PackingSolver 2026-10-23 alone | 8 | 7.96 | 0 |
| PackingSolver 2026-10-23 + pre-pass | 8 | 7.34 | 251 |
| PackingSolver 2026-10-26 alone | 8 | 8.00 | 0 |
| **PackingSolver 2026-10-26 + pre-pass** | **7** | **7.00** | 247 |

With the newer PackingSolver the pre-pass job fits on **7 sheets, one fewer than Libellula**. The
older version on the same machine still gives 7.34, so the gain comes from the upgrade. The
"anytime" and "deterministic" modes gave the same layouts here.

## Post-pass: gap filling after the nest

After the nest, `nestprep` can move parts forward into gaps (`compare --post quick|thorough`,
or the `post` command on a finished nest). PackingSolver gets the parts already on a sheet as
obstacles, so a gap can be a hole, a bay, a pocket between two parts or a strip along the edge.

1. **Gap filling**: parts of the last sheet go into the gaps of the earlier sheets.
2. **Chain**: from the back to the front, the gaps of each sheet get parts from any later sheet
   (latest sheet first, its right-most parts first); repeated until nothing moves.
3. **Sheet pairs** (thorough only): two neighbouring sheets nested again together, as much as
   possible on the first; kept only when better.
4. **Compaction**: the last sheet nested again as short as possible, leaving one clean remnant.

`quick` = 1 + 2 + 4 (up to 60 s), `thorough` = all four (up to 240 s). Every final layout is
checked by the validator against the original parts.

Results on three test jobs (531–532 parts, same settings as above, 2-core machine):

| Job | After pre-pass | + quick | + thorough |
|---|---|---|---|
| test 1 (Miha2787) | 7 sheets, 7.00 | 7.00 (42 s) | 7.00 (182 s) |
| test 2 | 8 sheets, 7.93 (last 2784 mm) | 7.73, last 2175 mm (60 s) | **7.63**, last 1895 mm (243 s) |
| test 3 | 8 sheets, 7.67 (last 2012 mm) | 7.57, last 1710 mm (60 s) | **7.51**, last 1542 mm (240 s) |

What it does: it shortens the last sheet by 0.1–0.3 sheet (300–900 mm of a 3000 mm sheet) when
that sheet is not already full. It did not save a whole sheet on these jobs: the earlier sheets
are 80–85 % full and their gaps are smaller than the parts left over. Gap filling from the last
sheet alone moved almost nothing; the chain, the sheet pairs and the compaction did the work.
Thorough hit its 240 s limit on tests 2 and 3, so more time could gain a little more.

## Updating PackingSolver

```bash
nesting/update-packingsolver.sh            # newest upstream (or give a commit)
# build, then compare on a test job:
cd nesting/nestprep
python nestprep_cli.py compare job.json --solver ../packingsolver/build/src/irregular/packingsolver_irregular -t 30 --outdir out
```

If a patch no longer applies, the script stops: fix the patch (or drop it if upstream fixed the
problem) and run it again. `update-packingsolver.sh --check` tells whether `packingsolver/` is
exactly the recorded version plus our patches (the workflow checks this too).
