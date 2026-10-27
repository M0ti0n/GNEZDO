#!/usr/bin/env python3
"""nestprep — hole-filling / pairing pre-pass for PackingSolver irregular.

Commands
  prepass   instance.json -> instance_pre.json + composites.json
  expand    solution.json + composites.json -> parts.json (one entry per real part)
  validate  original instance + solution (+ composites) -> overlap/spacing/count check
  render    original instance + solution (+ composites) -> sheets.png
  compare   run baseline and pre-processed solves with the same settings, report

Examples
  python nestprep_cli.py prepass job.json -o job_pre.json -m job_composites.json
  python nestprep_cli.py compare job.json --solver ./packingsolver_irregular -t 30
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from nestprep import psrun  # noqa: E402
from nestprep.holefill import Options, PrePass  # noqa: E402
from nestprep.solution import expand, metrics, validate  # noqa: E402


def load(p):
    with open(p) as f:
        return json.load(f)


def dump(obj, p):
    with open(p, "w") as f:
        json.dump(obj, f, indent=1)


def opts_from(a) -> Options:
    return Options(min_hole=a.min_hole, sub_time=a.sub_time, pairing=not a.no_pairing,
                   pair_time=a.pair_time, workers=a.workers, verbose=not a.quiet)


def cmd_prepass(a):
    inst = load(a.instance)
    t0 = time.perf_counter()
    pp = PrePass(inst, psrun.find_binary(a.solver), opts_from(a))
    out, mapping = pp.build()
    mapping["prepass_seconds"] = round(time.perf_counter() - t0, 2)
    dump(out, a.output)
    dump(mapping, a.mapping)
    print(f"{len(inst['item_types'])} item types -> {len(out['item_types'])} "
          f"({sum(1 for m in mapping['item_types'] if m['kind'] != 'original')} composites) "
          f"in {mapping['prepass_seconds']} s; {mapping['stats']}")


def _expand(a):
    inst = load(a.instance)
    sol = load(a.solution)
    mp = load(a.mapping) if a.mapping else None
    return inst, expand(sol, mp)


def cmd_expand(a):
    inst, sheets = _expand(a)
    out = []
    for i, sh in enumerate(sheets):
        parts = sorted(sh["parts"], key=lambda p: -p["depth"])  # inner parts first
        out.append({"sheet": i + 1, "bin_type": sh["bin_type"],
                    "parts": [{"orig_type": p["orig_type"], "depth": p["depth"],
                               "group": p["group"], **p["xf"].to_json()} for p in parts]})
    dump({"sheets": out}, a.output)
    print(f"wrote {a.output}: {len(out)} sheets, {sum(len(s['parts']) for s in out)} parts")


def cmd_validate(a):
    inst, sheets = _expand(a)
    v = validate(inst, sheets)
    print(json.dumps({k: v[k] for k in ("ok", "parts", "min_gap")}))
    for e in v["errors"][:50]:
        print("  ", e)
    print(json.dumps(metrics(inst, sheets)))
    sys.exit(0 if v["ok"] else 1)


def cmd_render(a):
    from nestprep.render import render_sheets
    inst, sheets = _expand(a)
    render_sheets(inst, sheets, a.output, a.title or os.path.basename(a.solution))
    print(f"wrote {a.output}")


def cmd_compare(a):
    from nestprep.render import render_sheets
    inst = load(a.instance)
    binary = psrun.find_binary(a.solver)
    os.makedirs(a.outdir, exist_ok=True)
    extra = ["-f", a.objective] if a.objective else []
    res = {}

    def run(name, instance, mapping):
        wd = os.path.join(a.outdir, name)
        r = psrun.solve(instance, binary, a.time, a.mode, workdir=wd, extra_args=extra)
        sheets = expand(r["solution"], mapping)
        v = validate(inst, sheets)
        m = metrics(inst, sheets)
        m.update(valid=v["ok"], errors=len(v["errors"]), min_gap=round(v["min_gap"], 2),
                 solve_seconds=round(r["time"], 1))
        render_sheets(inst, sheets, os.path.join(a.outdir, f"{name}.png"),
                      f"{name}: {m['sheets']} sheets, {m['sheet_equivalents']} sheet-equivalents")
        res[name] = m
        print(name, json.dumps(m))
        for e in v["errors"][:20]:
            print("   ", e)

    if not a.skip_baseline:
        run("baseline", inst, None)
    t0 = time.perf_counter()
    pp = PrePass(inst, binary, opts_from(a))
    pre, mapping = pp.build()
    pre_t = time.perf_counter() - t0
    dump(pre, os.path.join(a.outdir, "instance_pre.json"))
    dump(mapping, os.path.join(a.outdir, "composites.json"))
    print(f"pre-pass {pre_t:.1f} s, {mapping['stats']}")
    run("prepass", pre, mapping)
    res["prepass"]["prepass_seconds"] = round(pre_t, 1)
    dump(res, os.path.join(a.outdir, "compare.json"))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common_pre(p):
        p.add_argument("--solver", help="path to packingsolver_irregular binary")
        p.add_argument("--min-hole", type=float, default=60.0, help="min hole short side [mm]")
        p.add_argument("--sub-time", type=float, default=0.3, help="time limit per hole solve [s]")
        p.add_argument("--pair-time", type=float, default=0.5, help="time limit per pairing solve [s]")
        p.add_argument("--workers", type=int, default=4, help="parallel solver processes")
        p.add_argument("--no-pairing", action="store_true")
        p.add_argument("-q", "--quiet", action="store_true")

    p = sub.add_parser("prepass")
    p.add_argument("instance")
    p.add_argument("-o", "--output", default="instance_pre.json")
    p.add_argument("-m", "--mapping", default="composites.json")
    common_pre(p)
    p.set_defaults(fn=cmd_prepass)

    for name, fn in (("expand", cmd_expand), ("validate", cmd_validate), ("render", cmd_render)):
        p = sub.add_parser(name)
        p.add_argument("instance", help="ORIGINAL instance json")
        p.add_argument("solution", help="solver solution/certificate json")
        p.add_argument("-m", "--mapping", help="composites.json (omit for a plain solve)")
        if name != "validate":
            p.add_argument("-o", "--output", required=True)
        if name == "render":
            p.add_argument("--title")
        p.set_defaults(fn=fn)

    p = sub.add_parser("compare")
    p.add_argument("instance")
    p.add_argument("-t", "--time", type=float, default=30)
    p.add_argument("--mode", default="anytime")
    p.add_argument("-f", "--objective", help="override objective")
    p.add_argument("--outdir", default="compare_out")
    p.add_argument("--skip-baseline", action="store_true")
    common_pre(p)
    p.set_defaults(fn=cmd_compare)

    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
