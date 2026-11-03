# nestprep — hole-filling and pairing pre-pass for PackingSolver

A Python prototype of step 1 of the nesting plan. It takes a PackingSolver
irregular instance, builds *composite* item types (host part + parts nested in
its holes, and pairs of awkward parts), and writes a new instance plus a
mapping. Any solution of the new instance can then be expanded back to
individual parts.

It needs only Python 3.10+, numpy and matplotlib (for PNGs), plus the
`packingsolver_irregular` binary.

## Results on test job Miha2787 (first version, PackingSolver 2026-10-23)

Newer results, with the upgraded PackingSolver: [../README.md](../README.md#results-test-job-miha2787-531-parts-30-types-hardox-1-mm-sheet-3000--1500-5-mm-spacing).

### Original numbers (531 parts, 30 types, HARDOX 1 mm, 3000×1500, 5 mm spacing)

Sheet-equivalents = full sheets + used length of the last sheet / 3000.
All runs were on a 2-core cloud box with the same objective as the online test
(variable-sized bin packing). All layouts passed the independent validator
(531 parts, min gap 5.0 mm).

| Run                                   | Sheets | Sheet-equivalents | Parts in holes |
|---------------------------------------|--------|-------------------|----------------|
| Libellula CUT (report)                | 8      | ≈ 7.49 (last sheet 1475 mm) | yes  |
| PackingSolver, anytime 30 s           | 8      | 7.96              | 0              |
| **Pre-pass + PackingSolver, anytime 30 s** | 8 | **7.34** (last sheet 1012 mm) | 251 |
| PackingSolver, deterministic 30 s     | 8      | 8.00              | 0              |
| **Pre-pass + PackingSolver, deterministic** | 8 | **7.53**         | 251            |

Anytime 60 s gave the same numbers as 30 s for both runs. The pre-pass itself
takes about 16 s here (83 small solves); with 8 server threads expect a few seconds.

## Usage

```bash
export PACKINGSOLVER_IRREGULAR=/path/to/packingsolver_irregular   # built from ../packingsolver (patched)

# 1. pre-pass
python nestprep_cli.py prepass job.json -o job_pre.json -m job_composites.json

# 2. nest the pre-processed instance (any objective / mode)
packingsolver_irregular -i job_pre.json -c job_solution.json -t 30

# 3. expand to individual parts (inner parts listed first = cut first),
#    validate against the ORIGINAL instance, render sheets
python nestprep_cli.py expand   job.json job_solution.json -m job_composites.json -o parts.json
python nestprep_cli.py validate job.json job_solution.json -m job_composites.json
python nestprep_cli.py render   job.json job_solution.json -m job_composites.json -o sheets.png

# or all of it, baseline vs pre-pass, in one go
python nestprep_cli.py compare job.json -t 30 --outdir out/
```

Options: `--min-hole` (60 mm), `--sub-time` (0.3 s per hole), `--pair-time`,
`--workers` (4 parallel solver processes), `--no-pairing`, `--no-blocks`,
`--block-margin` (10 %).

## How it works

`nestprep/holefill.py`

1. **Pairing.** Parts with a bounding-box fill below 0.80 and at least 2 copies:
   pack 2 copies into strips of a few heights (open-dimension-x), keep the
   tightest. The pair is kept if its fill is ≥ 0.80 and at least 0.10 better than a
   single part. On this job only #17 qualifies (triangles 0.49 → 0.96).
2. **Hole filling, smallest hosts first.** For each host type, every hole with a
   short side ≥ 60 mm becomes a knapsack bin (edge spacing = part spacing). Items
   are all pool parts that pass a bounding-box/area pre-check, and profit is the
   material area. Small hosts are filled first, so their composites become
   candidates for bigger holes. That gives multi-level nesting
   (#30 in #19 in #24 in #6), as Libellula does.
3. The fill is replicated on as many host copies as the pool allows. The
   leftover host copies are re-solved with what remains.
4. Composite rotations = the host rotations for which every inner part still
   lands on an allowed angle/mirror (e.g. #11 and #25 restrict to 0/180°).
5. **Blocks** (Custom only, when chosen: experimental. On real jobs they never beat the
   standard nest, so Thorough and Fast run without them). Every big part (box ≥ 4 % of a
   sheet) whose outline fills at most 85 % of its box (an L, a comb, a slanted
   plate, a host already filled) gets other parts into its box: the box is a
   knapsack bin, the big part an obstacle in it, profit area^1.2 so the biggest
   parts that fit go first. The box may grow by the block margin (10 %) on one
   side (only the 1-2 sides where pockets open); the fullest variant wins. A
   block is kept when it fills ≥ 70 % of its box and 0.08 more than the part alone.
   All blocks are worked out at once: first the parts are shared out (a free-space
   map of every big part's box gives its pockets; a kind with enough copies is
   split by pocket area x copies, whole copies of scarce kinds go, biggest first,
   to the tightest pocket that holds them), then every block is one solver job,
   all in parallel; copies left plain get one more parallel round with the parts
   still free. Test job (1236 pieces, 2 CPU threads, Thorough, 10 % margin):
   23 sheets / 22.33 sheet equivalents without blocks; 22 / 21.65 with blocks
   taking turns (block step 33 s); 22 / 21.28-21.38 with the parallel blocks
   (block step 14-16 s).
6. Self-checks: every sub-solve result is compared against the solver's own
   transformed shapes, and the copy count of every original type is asserted.

`nestprep/solution.py`: expansion (composite transform ∘ member transform),
**independent validator** (rebuilds every part from the original geometry:
counts, inside sheet, overlap, spacing), and metrics.

## PackingSolver bug found and patched

[`../patches/0001-periodic-packing-union-of-all-pieces.patch`](../patches/0001-periodic-packing-union-of-all-pieces.patch), file `src/irregular/periodic_packing.cpp`,
function `compute_combined_shape`: for a multi-shape item it unions the
sub-shapes and returns only the **first connected component**. Composite
items are always disconnected (spacing between parts), so the periodic packer
(TSPP) tiled them by the first shape only and produced **overlapping
layouts**. The validator caught it (4 triangle pairs in the window of #2,
pitch 305 mm instead of 311.6 mm). The fix returns the convex hull of all
components when the union is disconnected. That is conservative and never
infeasible. The bug affects any multi-shape item, including the main nest. It
should be reported upstream (fontanf/packingsolver). Until it's fixed there, use the patched copy in
[`../packingsolver/`](../packingsolver/) (the patch is already applied to it).

## Porting notes for the C# worker

- Geometry: replace `geom.py` with Clipper2 / NetTopologySuite; transforms and
  `Xf.then` composition carry over 1:1 (mirror x→−x, rotate CCW, shift).
- Sub-solves are independent processes → `Parallel.ForEach` with the worker
  thread cap; cache hole results by (normalised hole contour, candidate caps).
- Keep the validator as a separate component that runs after every solve.

## Post-pass (`nestprep/postpass.py`)

Gap filling, chain, sheet pairs and last-sheet compaction after the nest: see
[../README.md](../README.md#post-pass-and-time-levels).

```bash
python nestprep_cli.py nest job.json --level quick                # quick: ~35 s (thorough: about 3 min, see LEVELS)
python nestprep_cli.py post job.json solution.json -n job_pre.json -m job_composites.json --budget 30
```

## Not done yet
- Cut order is exported as `depth` (inner first); lead-ins are not considered.
