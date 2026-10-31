"""One nesting job: pre-pass, main nest, post-pass, within a time budget.

Used by the command line (`nestprep_cli.py nest`) and by the runner GNEZDO starts
(`nestprep_cli.py run`, see service.py).
"""
from __future__ import annotations

import copy
import json
import math
import os
import time
from typing import Callable

from . import geom, psrun
from .holefill import Options, PrePass
from .postpass import PostOptions, PostPass

# Whole-job time budgets (pre-pass + nest + post-pass), on the machine it runs on.
LEVELS = {
    # pre-pass, nest, then compaction of the last sheet; the chain only from leftover time
    # grace: more nest time when there is no layout yet at the end of it (then a warning)
    "quick": dict(total=30.0, post=5.0, grace=15.0, min_nest=10.0, max_nest=30.0,
                  post_opts=dict(pairs=False, chain_time=1.5, compact_time=5.0)),
    # pre-pass, nest, then sheet pairs, chain and compaction. The nest is capped at 30 s: on the
    # test jobs a longer nest gave the same layout, the time is worth more in the post-pass.
    "thorough": dict(total=90.0, post=40.0, grace=30.0, min_nest=20.0, max_nest=30.0,
                     post_opts=dict(pairs=True, chain_time=2.0, pair_time=5.0, compact_time=8.0)),
    # the user sets the nest time (or none: until stopped); then the thorough post-pass
    "custom": dict(total=None, post=40.0, grace=60.0, min_nest=None, max_nest=None,
                   post_opts=dict(pairs=True, chain_time=2.0, pair_time=5.0, compact_time=8.0)),
}

# a nest that runs "until stopped" still needs a limit for PackingSolver: a week
FOREVER = 7 * 24 * 3600.0


def post_options(level: str, budget: float, quiet: bool = False) -> PostOptions:
    if level not in LEVELS:
        raise SystemExit(f"level must be one of {', '.join(LEVELS)}, not {level}")
    return PostOptions(budget=budget, quiet=quiet, **LEVELS[level]["post_opts"])


class NestError(Exception):
    """A job that cannot be nested as it is; the message says why, for the user."""


def _shapes(it: dict) -> list[dict]:
    return it["shapes"] if "shapes" in it else [it]


def _corners(s: dict):
    if "elements" in s:
        return geom.shape_to_poly(s).outer
    return [(0, 0), (s["width"], 0), (s["width"], s["height"]), (0, s["height"])]  # rectangle


def sheet_sizes(inst: dict) -> list[tuple[float, float]]:
    """Usable length x width of every sheet type: its bounding box less the edge distance."""
    out = []
    for b in inst["bin_types"]:
        x0, y0, x1, y1 = geom.shape_to_poly(b).bbox if "elements" in b else (0, 0, b["width"], b["height"])
        e = 2 * float(b.get("item_bin_minimum_spacing", 0.0))
        out.append((x1 - x0 - e, y1 - y0 - e))
    return out


def parts_too_big(inst: dict) -> list[tuple[int, str]]:
    """Part types that fit no sheet at any allowed rotation (bounding boxes; PackingSolver would
    otherwise just find no layout and not say why)."""
    sheets = sheet_sizes(inst)
    out = []
    for n, it in enumerate(inst["item_types"]):
        if int(it.get("copies", 1)) == 0:
            continue
        pts = [p for s in _shapes(it) for p in _corners(s)]
        angles = sorted({a for r in it.get("allowed_rotations", [{"start": 0, "end": 0}]) for a in (r["start"], r["end"])})

        def size(a):
            c, s_ = math.cos(math.radians(a)), math.sin(math.radians(a))
            xs = [x * c - y * s_ for x, y in pts]
            ys = [x * s_ + y * c for x, y in pts]
            return max(xs) - min(xs), max(ys) - min(ys)
        fits = any(w <= L + 1e-6 and h <= W + 1e-6 for a in angles for (w, h) in [size(a)] for (L, W) in sheets)
        if not fits:
            w, h = size(0)
            out.append((n, f"{w:.0f} x {h:.0f} mm"))
    return out


def dump(obj, p):
    with open(p, "w") as f:
        json.dump(obj, f, indent=1)


def run_job(inst: dict, binary: str, level: str, pre_opts: Options, outdir: str, quiet: bool = False, *,
            minutes: float | None = None, stop_after: float | None = None,
            should_stop: Callable[[], bool] | None = None,
            on_progress: Callable[[dict], None] | None = None) -> dict:
    """The whole nesting job within the level's time budget: pre-pass, nest, post-pass.

    level custom: the nest runs `minutes` (None: until stopped). stop_after: seconds with no
    better layout after which the nest ends (custom only). should_stop: polled during the
    nest; when it says so the best layout so far is kept and only the last sheet is compacted.
    on_progress gets {stage, sheets?, waste?} as the job goes on.
    """
    say = on_progress or (lambda d: None)
    os.makedirs(outdir, exist_ok=True)
    # parts that fit no sheet are left out (nested by hand); the job goes on with the rest
    big = parts_too_big(inst)
    if big:
        inst = copy.deepcopy(inst)
        for n, _ in big:
            inst["item_types"][n]["copies"] = 0
        if not quiet:
            print("skipped, bigger than every sheet: " + ", ".join(f"#{n + 1} {t}" for n, t in big), flush=True)
    if not any(int(it.get("copies", 1)) for it in inst["item_types"]):
        raise NestError("Every part is bigger than every stock sheet")
    L = LEVELS[level]
    t0 = time.perf_counter()
    say({"stage": "prepare"})
    pre, mapping = PrePass(inst, binary, pre_opts).build()
    pre_t = time.perf_counter() - t0
    if level == "custom":
        nest_t = FOREVER if minutes is None else max(10.0, minutes * 60.0 - pre_t - L["post"])
    else:
        nest_t = min(L["max_nest"], max(L["min_nest"], L["total"] - pre_t - L["post"]))
        stop_after = None
    say({"stage": "nest"})

    def progress(best):
        say({"stage": "nest", **best})
    # no layout yet when the time is up (a hard job): a little more time, stopping at the first one
    r = psrun.solve_grace(pre, binary, nest_t, L["grace"], workdir=os.path.join(outdir, "nest"),
                          stop_after=stop_after, should_stop=should_stop, on_progress=progress)
    if not r["solution"]:
        if r.get("stopped"):
            raise NestError("Stopped before a layout was found")
        raise NestError(f"No layout found in {time.perf_counter() - t0:.0f} s. "
                        "Try Thorough nest, or nest fewer parts at a time.")
    nest_done = time.perf_counter() - t0
    say({"stage": "improve"})
    if r.get("stopped"):
        # stopped by hand: only the last sheet is compacted, quickly
        opts = PostOptions(pairs=False, chain=False, compact_time=5.0, budget=6.0, quiet=quiet)
    elif level == "custom":
        opts = post_options(level, L["post"], quiet)
    else:
        opts = post_options(level, max(L["post"] * 0.5, L["total"] - nest_done), quiet)
    pp = PostPass(pre, r["solution"], binary, opts)
    sol = pp.run()
    total = time.perf_counter() - t0
    dump(pre, os.path.join(outdir, "instance_pre.json"))
    dump(mapping, os.path.join(outdir, "composites.json"))
    dump(sol, os.path.join(outdir, "solution.json"))
    return {"solution": sol, "mapping": mapping, "steps": pp.log, "instance": inst,
            "skipped": big, "stopped": bool(r.get("stopped")),
            "seconds": {"prepass": round(pre_t, 1), "nest": round(r["time"], 1),
                        "post": round(total - nest_done, 1), "total": round(total, 1)}}
