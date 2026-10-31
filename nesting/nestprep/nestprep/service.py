"""The nesting run GNEZDO starts: `nestprep_cli.py run request.json RUNDIR`.

request.json (written by GNEZDO from the job tab):
  {"mode": "fast" | "thorough" | "custom",
   "minutes": 15 | null,            custom: nest time; null = until stopped
   "stopAfterMinutes": 5 | null,    custom: stop when nothing better for this long
   "partGapMm": 5, "edgeGapMm": 5,
   "parts":  [{"id", "name", "path", "qty", "rotations": [90], "mirror", "material", "thicknessMm"}],
   "sheets": [{"id", "material", "thicknessMm", "lengthMm", "widthMm", "qty": 3 | null, "source"}]}

`path` is the part's outline as on its thumbnail: closed loops "M x y L x y ... Z", outline and
holes, y down, origin at the top-left corner. Parts are nested on sheets of the same material and
thickness; each such group is nested on its own, groups side by side.

RUNDIR gets
  progress.json  {"state": running | done | stopped | error, "stage", "seconds", "groups": [...]}
                 rewritten as the run goes on; groups[i]: {material, thicknessMm, stage, sheets?, waste?}
  result.json    when finished: sheets with placed parts, nested count per part, skipped parts
A file named `stop` in RUNDIR ends the run: every group keeps its best layout so far.
"""
from __future__ import annotations

import json
import math
import os
import re
import threading
import time
import traceback
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

from . import geom
from .holefill import Options
from .job import NestError, run_job
from .solution import expand, metrics, validate

MODES = {"fast": "quick", "thorough": "thorough", "custom": "custom"}


# -- part outlines -------------------------------------------------------------
def path_loops(path: str) -> list[list[tuple[float, float]]]:
    """Closed loops of an SVG path made of M, L and Z (what GNEZDO stores for thumbnails)."""
    loops, cur = [], []
    for cmd, args in re.findall(r"([MLZmlz])([^MLZmlz]*)", path):
        nums = [float(v) for v in re.findall(r"-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?", args)]
        if cmd in "Mm":
            if len(cur) > 2:
                loops.append(cur)
            cur = [(nums[i], nums[i + 1]) for i in range(0, len(nums) - 1, 2)]
        elif cmd in "Ll":
            cur += [(nums[i], nums[i + 1]) for i in range(0, len(nums) - 1, 2)]
        else:
            if len(cur) > 2:
                loops.append(cur)
            cur = []
    if len(cur) > 2:
        loops.append(cur)
    # drop a repeated closing point and zero-length steps
    out = []
    for lp in loops:
        q = [p for i, p in enumerate(lp) if i == 0 or math.dist(p, lp[i - 1]) > 1e-6]
        if len(q) > 2 and math.dist(q[0], q[-1]) <= 1e-6:
            q.pop()
        if len(q) > 2:
            out.append(q)
    return out


def _area(lp) -> float:
    return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(lp, lp[1:] + lp[:1])) / 2


def _inside(pt, lp) -> bool:
    x, y = pt
    c = False
    for (x1, y1), (x2, y2) in zip(lp, lp[1:] + lp[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c


def _elements(lp) -> list[dict]:
    return [{"type": "LineSegment", "start": {"x": a[0], "y": a[1]}, "end": {"x": b[0], "y": b[1]}}
            for a, b in zip(lp, lp[1:] + lp[:1])]


def path_shape(path: str) -> dict:
    """PackingSolver shape of a part: the largest loop is the outline, loops directly inside
    it are holes (a loop inside a hole is a piece that drops out; it is not nested)."""
    loops = path_loops(path)
    if not loops:
        raise ValueError("no closed outline")
    loops.sort(key=lambda lp: -abs(_area(lp)))
    outer, rest = loops[0], loops[1:]
    holes = []
    for i, lp in enumerate(rest):
        if not _inside(lp[0], outer):
            continue
        # inside another, bigger hole: an island, not a hole of the part
        if any(_inside(lp[0], h) for h in rest[:i] if _inside(h[0], outer)):
            continue
        holes.append(lp)
    if _area(outer) < 0:
        outer = outer[::-1]
    shape = {"type": "general", "elements": _elements(outer)}
    if holes:
        shape["holes"] = [{"type": "general", "elements": _elements(h if _area(h) > 0 else h[::-1])} for h in holes]
    return shape


def rotations(steps) -> list[dict]:
    """Allowed angles from rotation steps: [90] -> 0, 90, 180, 270; [] -> 0 only."""
    angles = {0.0}
    for s in steps or []:
        s = float(s)
        if s > 0:
            angles |= {round(k * s % 360, 6) for k in range(int(math.ceil(360 / s)))}
    return [{"start": a, "end": a} for a in sorted(angles)]


def _rect(L: float, W: float) -> dict:
    return {"type": "general", "elements": _elements([(0, 0), (L, 0), (L, W), (0, W)])}


# -- groups --------------------------------------------------------------------
def _key(material, thickness) -> tuple:
    return (str(material or "").strip().lower(), round(float(thickness or 0), 3))


def build_groups(req: dict) -> tuple[list[dict], list[dict]]:
    """Instances per material and thickness; parts that cannot be nested are listed with why."""
    gap = float(req.get("partGapMm", 5))
    edge = float(req.get("edgeGapMm", 5))
    skipped, by_key = [], {}
    for p in req.get("parts", []):
        if int(p.get("qty") or 0) <= 0:
            continue
        by_key.setdefault(_key(p.get("material"), p.get("thicknessMm")), []).append(p)
    groups = []
    for key, parts in by_key.items():
        sheets = [s for s in req.get("sheets", []) if _key(s.get("material"), s.get("thicknessMm")) == key
                  and float(s.get("lengthMm") or 0) > 0 and float(s.get("widthMm") or 0) > 0
                  and (s.get("qty") is None or int(s["qty"]) > 0)]
        label = f"{parts[0].get('material', '')} {parts[0].get('thicknessMm', '')} mm"
        if not sheets:
            skipped += [{"partId": p["id"], "reason": f"No stock sheet for {label}"} for p in parts]
            continue
        items, ids = [], []
        for p in parts:
            try:
                shape = path_shape(p.get("path", ""))
            except ValueError:
                skipped.append({"partId": p["id"], "reason": "No closed outline"})
                continue
            items.append({"shapes": [shape], "copies": int(p["qty"]),
                          "allowed_rotations": rotations(p.get("rotations")),
                          "allow_mirroring": bool(p.get("mirror"))})
            ids.append(p["id"])
        if not items:
            continue
        pieces = sum(it["copies"] for it in items)
        limited = all(s.get("qty") is not None for s in sheets)
        bins = []
        for s in sheets:
            L, W = float(s["lengthMm"]), float(s["widthMm"])
            b = {**_rect(L, W), "copies": int(s["qty"]) if s.get("qty") is not None else pieces,
                 "item_bin_minimum_spacing": edge}
            if not limited:
                # remnants first: they cost less than a new sheet of the same size
                b["cost"] = L * W * (0.5 if s.get("source") == "remnant" else 1.0)
            bins.append(b)
        if limited:
            # not enough sheets for everything maybe: as many parts as fit (by area)
            for it in items:
                it["profit"] = abs(_area(path_loops_outer(it)))
        inst = {"objective": "knapsack" if limited else "variable-sized-bin-packing",
                "parameters": {"item_item_minimum_spacing": gap},
                "bin_types": bins, "item_types": items}
        groups.append({"label": label, "material": parts[0].get("material", ""),
                       "thicknessMm": parts[0].get("thicknessMm"), "instance": inst,
                       "partIds": ids, "sheets": sheets})
    return groups, skipped


def path_loops_outer(item: dict):
    return [(e["start"]["x"], e["start"]["y"]) for e in item["shapes"][0]["elements"]]


# -- the run -------------------------------------------------------------------
class Run:
    def __init__(self, req: dict, rundir: str, binary: str, workers: int | None = None):
        self.req, self.dir, self.bin = req, rundir, binary
        self.t0 = time.perf_counter()
        self.lock = threading.Lock()
        self.groups, self.skipped = build_groups(req)
        self.status = [{"material": g["material"], "thicknessMm": g["thicknessMm"], "stage": "waiting"}
                       for g in self.groups]
        cpu = os.cpu_count() or 2
        self.parallel = workers or max(1, min(len(self.groups), cpu // 4 or 1))
        self.state = "running"
        self.best: dict[int, list] = {}  # group -> its best sheets so far (best.json)
        os.makedirs(rundir, exist_ok=True)

    def stop_requested(self) -> bool:
        return os.path.exists(os.path.join(self.dir, "stop"))

    def write(self, name: str, obj: dict):
        p = os.path.join(self.dir, name)
        with open(p + ".tmp", "w") as f:
            json.dump(obj, f)
        # Windows: the replace fails while GNEZDO happens to be reading the file; try again
        for i in range(20):
            try:
                os.replace(p + ".tmp", p)
                return
            except PermissionError:
                time.sleep(0.05 * (i + 1))

    def progress(self, stage: str = ""):
        with self.lock:
            self.write("progress.json", {"state": self.state, "stage": stage,
                                         "seconds": round(time.perf_counter() - self.t0, 1),
                                         "groups": self.status})

    def sheets_of(self, i: int, placed: list[dict]) -> list[dict]:
        g = self.groups[i]
        out = []
        for sh in placed:
            s = g["sheets"][sh["bin_type"]]
            out.append({"sheetId": s.get("id"), "lengthMm": float(s["lengthMm"]), "widthMm": float(s["widthMm"]),
                        "material": g["material"], "thicknessMm": g["thicknessMm"],
                        "parts": [{"partId": g["partIds"][p["orig_type"]], "x": round(p["xf"].x, 3),
                                   "y": round(p["xf"].y, 3), "angle": p["xf"].angle, "mirror": p["xf"].mirror}
                                  for p in sh["parts"]]})
        return out

    def write_best(self, i: int, sheets: list[dict]):
        """The best layout so far of every group, for viewing while the run goes on."""
        with self.lock:
            self.best[i] = sheets
            allsheets = [sh for k in sorted(self.best) for sh in self.best[k]]
            self.write("best.json", {"sheets": allsheets})

    def group(self, i: int) -> dict:
        g = self.groups[i]
        mode = self.req.get("mode", "fast")
        level = MODES.get(mode, "quick")

        def on_progress(d):
            with self.lock:
                d = dict(d)
                layout = d.pop("layout", None)
                if "seconds" in d:
                    d["bestAt"] = d.pop("seconds")  # when the best layout so far was found
                self.status[i].update({k: v for k, v in d.items() if v is not None})
            if layout:
                self.write_best(i, self.sheets_of(i, layout))
            self.progress()
        stop_after = self.req.get("stopAfterMinutes")
        workers = max(2, (os.cpu_count() or 2) // self.parallel)
        try:
            job = run_job(g["instance"], self.bin, level, Options(workers=workers, verbose=False),
                          os.path.join(self.dir, f"group{i + 1}"), quiet=True,
                          minutes=self.req.get("minutes"), stop_after=stop_after * 60 if stop_after else None,
                          should_stop=self.stop_requested, on_progress=on_progress)
        except NestError as e:
            with self.lock:
                self.status[i].update(stage="error", error=str(e))
            self.progress()
            return {"error": str(e), "partIds": g["partIds"]}
        inst = job["instance"]
        placed = expand(job["solution"], job["mapping"])
        # a knapsack run may leave parts out: validate what was placed
        counts = Counter(p["orig_type"] for sh in placed for p in sh["parts"])
        check = json.loads(json.dumps(inst))
        for t, it in enumerate(check["item_types"]):
            it["copies"] = counts[t]
        v = validate(check, placed)
        m = metrics(check, placed) if placed else {}
        sheets = self.sheets_of(i, placed)
        self.write_best(i, sheets)
        with self.lock:
            self.status[i].update(stage="done", sheets=len(sheets), stopped=job["stopped"])
        self.progress()
        return {"sheets": sheets, "valid": v["ok"], "errors": v["errors"][:10],
                "sheetEquivalents": m.get("sheet_equivalents"), "seconds": job["seconds"],
                "tooBig": [{"partId": g["partIds"][n], "reason": f"Bigger than every stock sheet ({t})"}
                           for n, t in job["skipped"]],
                "counts": {g["partIds"][t]: c for t, c in counts.items()}}

    def run(self) -> dict:
        self.progress("start")
        with ThreadPoolExecutor(max_workers=self.parallel) as ex:
            results = list(ex.map(self.group, range(len(self.groups))))
        nested = Counter()
        sheets, skipped, errors, valid = [], list(self.skipped), [], True
        for g, r in zip(self.groups, results):
            if "error" in r:
                errors.append(f"{g['label']}: {r['error']}")
                continue
            sheets += r["sheets"]
            skipped += r["tooBig"]
            nested.update(r["counts"])
            valid &= r["valid"]
            errors += [f"{g['label']}: {e}" for e in r["errors"]]
        self.state = "stopped" if self.stop_requested() else "done"
        result = {"state": self.state, "seconds": round(time.perf_counter() - self.t0, 1),
                  "sheets": sheets, "nested": dict(nested), "skipped": skipped,
                  "valid": valid, "errors": errors,
                  "groups": [{"material": g["material"], "thicknessMm": g["thicknessMm"],
                              **{k: r.get(k) for k in ("sheetEquivalents", "seconds", "valid", "error")}}
                             for g, r in zip(self.groups, results)]}
        self.write("result.json", result)
        self.progress("finished")
        return result


def run(request_path: str, rundir: str, binary: str) -> int:
    with open(request_path) as f:
        req = json.load(f)
    try:
        r = Run(req, rundir, binary)
        if not r.groups:
            r.state = "error"
            r.write("result.json", {"state": "error", "sheets": [], "nested": {}, "skipped": r.skipped,
                                    "errors": ["Nothing to nest: " + ("; ".join(sorted({s["reason"] for s in r.skipped}))
                                                                      or "no part has a quantity")]})
            r.progress("finished")
            return 2
        r.run()
        return 0
    except Exception as e:  # anything unexpected: written down for GNEZDO to show
        os.makedirs(rundir, exist_ok=True)
        with open(os.path.join(rundir, "result.json"), "w") as f:
            json.dump({"state": "error", "sheets": [], "nested": {}, "skipped": [],
                       "errors": [f"{type(e).__name__}: {e}"], "trace": traceback.format_exc()}, f)
        with open(os.path.join(rundir, "progress.json"), "w") as f:
            json.dump({"state": "error", "stage": "finished", "groups": []}, f)
        return 1
