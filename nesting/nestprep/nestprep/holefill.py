"""Hole-filling and shape-pairing pre-pass for PackingSolver irregular instances.

Input : a PackingSolver irregular instance (dict).
Output: a new instance where some item types are replaced by *composite*
        item types (a host part with smaller parts already placed inside its
        holes, or two copies of a part paired into a compact block), plus a
        mapping that expands any solution back to individual original parts.

Algorithm (hole filling)
------------------------
1.  Every original item type becomes a `Part` in a pool with its copy count.
2.  Host types (types with at least one usable hole) are processed from the
    smallest usable hole to the largest. Small hosts are filled first, so the
    resulting composites (e.g. washer + micro flange) are themselves candidates
    for bigger holes later: nesting depth grows naturally (30 in 29 in 24 ...).
3.  For one host copy, each usable hole is solved as a knapsack: the hole
    contour is the bin, all pool parts that can fit are the items, profit is
    material area. Identical holes reuse the cached result.
4.  The fill is replicated on k host copies, k limited by the pool. A new
    composite type with k copies is created and the pool decremented. If host
    copies remain (pool ran short) the host is re-solved with what is left.
5.  Composite allowed rotations = host rotations for which every inner part
    still ends up at an angle/mirror it is allowed to have.

Algorithm (pairing)
-------------------
For part types with a low bounding-box fill ratio and >= 2 copies left, two
copies are packed into the smallest bounding box (open-dimension-xy objective).
The pair is kept as a composite when its bounding-box fill beats the single
part by `pair_min_gain` and reaches `pair_min_fill`.
"""
from __future__ import annotations

import copy
import math
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

import numpy as np

from . import geom
from .geom import Xf
from .psrun import solve

QUARTER = (0.0, 90.0, 180.0, 270.0)


# --------------------------------------------------------------------------
# Data structures
# --------------------------------------------------------------------------

@dataclass
class Member:
    """One original part inside a (possibly composite) item type."""
    orig_type: int
    xf: Xf            # transform from original part coords to item-local coords
    depth: int        # 0 = outermost; deeper parts must be cut first

    def to_json(self):
        return {"orig_type": self.orig_type, "depth": self.depth, **self.xf.to_json()}


@dataclass
class Part:
    pid: int
    shapes: list[dict]                       # instance-format shapes (local coords)
    placements: list[tuple[float, bool]]     # allowed (angle, mirror), discrete
    members: list[Member]
    remaining: int
    kind: str = "original"                   # original | holefill | pair
    rot_json: list | None = None             # original allowed_rotations (kept verbatim)
    source_json: dict | None = None          # original item JSON (originals only)
    _poly: list = field(default=None, repr=False)

    @property
    def polys(self) -> list[geom.PolyShape]:
        if self._poly is None:
            self._poly = [geom.shape_to_poly(s) for s in self.shapes]
        return self._poly

    @property
    def area(self) -> float:
        return sum(p.area for p in self.polys)

    @property
    def bbox(self):
        bs = [p.bbox for p in self.polys]
        return (min(b[0] for b in bs), min(b[1] for b in bs),
                max(b[2] for b in bs), max(b[3] for b in bs))

    def dims(self) -> tuple[float, float]:
        b = self.bbox
        return b[2] - b[0], b[3] - b[1]

    def fits_box(self, w: float, h: float) -> bool:
        """Necessary condition: some allowed 90-degree placement fits in w x h."""
        pw, ph = self.dims()
        for ang, _ in self.placements:
            a = ang % 180
            if abs(a) < 1e-6 and pw <= w + 1e-6 and ph <= h + 1e-6:
                return True
            if abs(a - 90) < 1e-6 and ph <= w + 1e-6 and pw <= h + 1e-6:
                return True
            if a % 90:  # free angle: use the diagonal-free bound
                if min(pw, ph) <= min(w, h) and max(pw, ph) <= max(w, h):
                    return True
        return False

    def rotations_json(self) -> list[dict]:
        if self.kind == "original" and self.rot_json is not None:
            return self.rot_json
        return [{"start": a, "end": a, "mirror": m} for a, m in self.placements]

    def to_item_json(self) -> dict:
        if self.kind == "original" and self.source_json is not None:
            j = copy.deepcopy(self.source_json)
            j["copies"] = self.remaining
            return j
        return {"shapes": self.shapes, "copies": self.remaining,
                "allowed_rotations": self.rotations_json()}


def parse_placements(item: dict) -> tuple[list[tuple[float, bool]], list | None]:
    """Discrete (angle, mirror) placements; continuous ranges sampled at 90 deg."""
    rots = item.get("allowed_rotations") or [{"start": 0, "end": 0}]
    out = []
    for r in rots:
        s, e, m = float(r["start"]), float(r["end"]), bool(r.get("mirror", False))
        if abs(s - e) < 1e-9:
            out.append((geom.norm_angle(s), m))
        else:
            out += [(a, m) for a in QUARTER if s - 1e-9 <= a <= e + 1e-9]
    if item.get("allow_mirroring"):
        out += [(a, True) for a, m in list(out) if not m]
    # unique, stable
    seen, uniq = set(), []
    for p in out:
        if p not in seen:
            seen.add(p)
            uniq.append(p)
    rot_json = item.get("allowed_rotations")
    if item.get("allow_mirroring") and rot_json is not None:
        rot_json = None  # will be rebuilt from placements
    return uniq, rot_json


# --------------------------------------------------------------------------
# Pre-pass
# --------------------------------------------------------------------------

@dataclass
class Options:
    spacing: float | None = None        # item-item spacing; default from instance
    min_hole: float = 60.0              # min short side of a usable hole [mm]
    sub_time: float = 1.0               # time limit per hole sub-solve [s]
    sub_mode: str = "not-anytime-deterministic"
    max_rounds_per_host: int = 6
    min_fill_area: float = 0.0          # ignore fills smaller than this [mm2]
    pairing: bool = True
    pair_max_fill: float = 0.80         # only try pairing below this bbox fill
    pair_min_fill: float = 0.80         # keep pair if its bbox fill >= this
    pair_min_gain: float = 0.10         # ... and improves fill by this much
    pair_time: float = 0.5
    workers: int = 4                    # parallel solver processes
    verbose: bool = True


class PrePass:
    def __init__(self, instance: dict, binary: str, opt: Options | None = None):
        self.inst = instance
        self.bin = binary
        self.opt = opt or Options()
        params = instance.get("parameters", {})
        self.s = self.opt.spacing if self.opt.spacing is not None else \
            float(params.get("item_item_minimum_spacing", 0.0))
        self.parts: list[Part] = []
        for t, it in enumerate(instance["item_types"]):
            if len(it.get("shapes", [it])) != 1 and "shapes" in it:
                pass  # multi-shape originals are supported, treated as one part
            shapes = it["shapes"] if "shapes" in it else [
                {k: v for k, v in it.items() if k in ("type", "elements", "holes")}]
            pl, rj = parse_placements(it)
            self.parts.append(Part(t, shapes, pl, [Member(t, Xf(), 0)],
                                   int(it.get("copies", 1)), "original", rj, it))
        self.n_orig = len(self.parts)
        # sheet sizes (bounding boxes): a composite must still fit one of them
        self.sheets = []
        for b in instance.get("bin_types", []):
            if "elements" in b:
                x0, y0, x1, y1 = geom.shape_to_poly(b).bbox
                self.sheets.append((x1 - x0, y1 - y0))
            else:
                self.sheets.append((float(b["width"]), float(b["height"])))
        self.cache: dict = {}
        self.stats = Counter()
        self.log: list[str] = []

    # -- logging -----------------------------------------------------------
    def say(self, msg: str):
        self.log.append(msg)
        if self.opt.verbose:
            print(msg, flush=True)

    # -- holes -------------------------------------------------------------
    def usable_holes(self, part: Part) -> list[np.ndarray]:
        holes = []
        for p in part.polys:
            for h in p.holes:
                x0, y0, x1, y1 = geom.bbox(h)
                if min(x1 - x0, y1 - y0) >= self.opt.min_hole:
                    holes.append(geom.ccw(h))
        return holes

    @staticmethod
    def hole_key(h: np.ndarray):
        x0, y0, _, _ = geom.bbox(h)
        q = np.round(h - [x0, y0], 2)
        # rotate start vertex to the lexicographically smallest for a stable key
        i = min(range(len(q)), key=lambda k: (q[k, 0], q[k, 1]))
        return tuple(map(tuple, np.roll(q, -i, axis=0)))

    def candidates(self, hole: np.ndarray, avail: dict[int, int], host: Part) -> list[Part]:
        x0, y0, x1, y1 = geom.bbox(hole)
        w, h = x1 - x0 - 2 * self.s, y1 - y0 - 2 * self.s
        harea = abs(geom.polygon_area(hole))
        out = []
        for p in self.parts:
            if avail.get(p.pid, 0) <= 0 or p.pid == host.pid:
                continue
            if any(m.orig_type == host.members[0].orig_type for m in p.members):
                continue  # never nest a part inside a copy of itself
            if p.area > harea or not p.fits_box(w, h):
                continue
            out.append(p)
        return out

    def solve_hole(self, hole: np.ndarray, cands: list[Part], avail: dict[int, int]):
        """Knapsack of `cands` into one hole. Returns [(pid, Xf in hole coords)]."""
        x0, y0, _, _ = geom.bbox(hole)
        harea = abs(geom.polygon_area(hole))
        caps = {p.pid: min(avail[p.pid], max(1, int(harea // max(p.area, 1.0))))
                for p in cands}
        key = (self.hole_key(hole), tuple(sorted(caps.items())))
        if key in self.cache:
            self.stats["cache_hits"] += 1
            res = self.cache[key]
        else:
            loc = hole - [x0, y0]
            sub = {
                "objective": "knapsack",
                "parameters": {"item_item_minimum_spacing": self.s},
                "bin_types": [{"type": "general",
                               "elements": geom.polygon_to_elements(loc),
                               "copies": 1,
                               "item_bin_minimum_spacing": self.s}],
                "item_types": [{"shapes": p.shapes, "copies": caps[p.pid],
                                "profit": p.area,
                                "allowed_rotations": p.rotations_json()}
                               for p in cands],
            }
            r = solve(sub, self.bin, self.opt.sub_time, self.opt.sub_mode)
            self.stats["sub_solves"] += 1
            self.stats["sub_time"] += r["time"]
            res = []
            for b in (r["solution"] or {}).get("bins", []):
                for it in b["items"]:
                    cand = cands[it["id"]]
                    xf = Xf(geom.norm_angle(it["angle"]), bool(it.get("mirror", False)),
                            it["x"], it["y"])
                    self.check_against_solver(cand, xf, it)
                    res.append((cand.pid, xf))
            self.cache[key] = res
        # shift back to host coords
        return [(pid, Xf(xf.angle, xf.mirror, xf.x + x0, xf.y + y0)) for pid, xf in res]

    def check_against_solver(self, cand: Part, xf: Xf, sol_item: dict):
        """Self-check: our transform of each shape must equal the solver's."""
        shapes = sol_item.get("item_shapes") or []
        for k, sh in enumerate(shapes):
            if k >= len(cand.shapes):
                break
            solver = geom.elements_to_polygon(geom.elements_from_solution(sh["shape"]))
            mine = geom.shape_to_poly(geom.transform_shape(cand.shapes[k], xf)).outer
            a = sorted(map(tuple, np.round(solver, 1).tolist()))
            b = sorted(map(tuple, np.round(mine, 1).tolist()))
            if a != b:
                self.stats["transform_mismatch"] += 1
                self.say(f"  !! transform mismatch for {self.label(cand.pid)} shape {k} "
                         f"at {xf}")
                return

    def fill_host_once(self, host: Part, avail: dict[int, int]):
        holes = sorted(self.usable_holes(host), key=lambda h: -abs(geom.polygon_area(h)))
        avail = dict(avail)
        fills = []
        for h in holes:
            cands = self.candidates(h, avail, host)
            if not cands:
                continue
            res = self.solve_hole(h, cands, avail)
            # pool may have shrunk since the cached result was computed
            need = Counter(pid for pid, _ in res)
            if any(avail[pid] < n for pid, n in need.items()):
                continue
            for pid, n in need.items():
                avail[pid] -= n
            fills += res
        return fills

    def fits_sheet(self, p: Part) -> bool:
        return not self.sheets or any(p.fits_box(w, h) for w, h in self.sheets)

    def compose(self, host: Part, fills, kind="holefill") -> Part | None:
        shapes = [copy.deepcopy(s) for s in host.shapes]
        members = list(host.members)
        for pid, xf in fills:
            p = self.parts[pid]
            shapes += [geom.transform_shape(s, xf) for s in p.shapes]
            members += [Member(m.orig_type, m.xf.then(xf), m.depth + 1) for m in p.members]
        placements = self.compatible_placements(host.placements, members)
        if not placements:
            return None
        comp = Part(len(self.parts), shapes, placements, members, 0, kind)
        if self.fits_sheet(host) and not self.fits_sheet(comp):
            return None  # a filler took away the rotation the host needs to fit a sheet
        return comp

    def compatible_placements(self, base, members):
        out = []
        for ang, mir in base:
            outer = Xf(ang, mir)
            ok = True
            for m in members:
                f = m.xf.then(outer)
                if (geom.norm_angle(f.angle), f.mirror) not in self.parts[m.orig_type].placements:
                    ok = False
                    break
            if ok:
                out.append((ang, mir))
        return out

    def run_holefill(self):
        hosts = []
        for p in self.parts[: self.n_orig]:
            hs = self.usable_holes(p)
            if hs:
                hosts.append((max(abs(geom.polygon_area(h)) for h in hs), p))
        hosts.sort(key=lambda t: t[0])
        for _, host in hosts:
            rounds = 0
            strict = False
            while host.remaining > 0 and rounds < self.opt.max_rounds_per_host:
                rounds += 1
                avail = {p.pid: p.remaining for p in self.parts}
                avail[host.pid] -= 1  # the host copy itself
                if strict:
                    # only fillers that turn with the host, so the host keeps all its rotations
                    angles = {geom.norm_angle(a) for a, _ in host.placements}
                    for p in self.parts:
                        if not angles <= {geom.norm_angle(a) for a, _ in p.placements}:
                            avail[p.pid] = 0
                fills = self.fill_host_once(host, avail)
                if not fills:
                    break
                farea = sum(self.parts[pid].area for pid, _ in fills)
                if farea <= self.opt.min_fill_area:
                    break
                need = Counter(pid for pid, _ in fills)
                k = host.remaining
                for pid, n in need.items():
                    k = min(k, self.parts[pid].remaining // n)
                if k <= 0:
                    break
                comp = self.compose(host, fills)
                if comp is None:
                    if not strict:
                        strict = True
                        self.say(f"  host {host.pid + 1}: fill rejected (rotation), again with fillers that turn with it")
                        continue
                    self.say(f"  host {host.pid + 1}: fill rejected (no common rotation)")
                    break
                comp.remaining = k
                host.remaining -= k
                for pid, n in need.items():
                    self.parts[pid].remaining -= k * n
                self.parts.append(comp)
                desc = ", ".join(f"{n}x{self.label(pid)}" for pid, n in need.items())
                self.say(f"  host {self.label(host.pid)} x{k}: holes get {desc} "
                         f"(+{farea / 1e3:.0f} cm2 each)")

    # -- pairing -------------------------------------------------------------
    def bbox_fill(self, p: Part) -> float:
        w, h = p.dims()
        return p.area / (w * h)

    def run_pairing(self):
        # 1. build every strip sub-problem (2 copies, a few candidate heights)
        jobs = []
        for p in list(self.parts[: self.n_orig]):
            if p.remaining < 2 or self.bbox_fill(p) >= self.opt.pair_max_fill:
                continue
            w, h = p.dims()
            for H in sorted({round(v, 3) for v in (w, h, w + 2 * self.s, h + 2 * self.s)}):
                jobs.append((p, {
                    "objective": "open-dimension-x",
                    "parameters": {"item_item_minimum_spacing": self.s},
                    "bin_types": [{"type": "rectangle", "width": 4 * (w + h),
                                   "height": H, "copies": 1}],
                    "item_types": [{"shapes": p.shapes, "copies": 2,
                                    "allowed_rotations": p.rotations_json()}],
                }))

        # 2. solve them in parallel (independent sub-processes)
        def run(job):
            try:
                return solve(job[1], self.bin, self.opt.pair_time, "not-anytime-deterministic")
            except RuntimeError:
                return None
        with ThreadPoolExecutor(max_workers=self.opt.workers) as ex:
            results = list(ex.map(run, jobs))

        # 3. keep the tightest pair per part type
        best_by_pid: dict[int, tuple] = {}
        for (p, _), r in zip(jobs, results):
            if r is None:
                continue
            self.stats["sub_solves"] += 1
            self.stats["sub_time"] += r["time"]
            items = [it for b in (r["solution"] or {}).get("bins", []) for it in b["items"]]
            if len(items) != 2:
                continue
            xfs = [Xf(geom.norm_angle(it["angle"]), bool(it.get("mirror", False)),
                      it["x"], it["y"]) for it in items]
            tmp = Part(-1, [geom.transform_shape(sh, xf) for xf in xfs for sh in p.shapes],
                       [], [], 0, "pair")
            f = self.bbox_fill(tmp)
            if p.pid not in best_by_pid or f > best_by_pid[p.pid][0]:
                best_by_pid[p.pid] = (f, xfs)

        for pid in sorted(best_by_pid):
            p = self.parts[pid]
            f1 = self.bbox_fill(p)
            best = best_by_pid[pid]
            xfs = best[1]
            # express the pair relative to the first copy's frame
            members = [Member(p.pid, xf, 0) for xf in xfs]
            shapes = [geom.transform_shape(s, xf) for xf in xfs for s in p.shapes]
            pair = Part(len(self.parts), shapes, [], members, 0, "pair")
            # normalise to origin
            x0, y0, _, _ = pair.bbox
            shift = Xf(0, False, -x0, -y0)
            pair.shapes = [geom.transform_shape(s, shift) for s in shapes]
            pair.members = [Member(m.orig_type, m.xf.then(shift), 0) for m in members]
            pair._poly = None
            pair.placements = self.compatible_placements(QUARTER_PLACEMENTS(p), pair.members)
            if not pair.placements or not self.fits_sheet(pair):
                continue
            f2 = self.bbox_fill(pair)
            if f2 >= self.opt.pair_min_fill and f2 >= f1 + self.opt.pair_min_gain:
                k = p.remaining // 2
                pair.remaining = k
                p.remaining -= 2 * k
                self.parts.append(pair)
                self.say(f"  pair {self.label(p.pid)} x{k}: bbox fill {f1:.2f} -> {f2:.2f}")
            else:
                self.say(f"  pair {self.label(p.pid)}: skipped (fill {f1:.2f} -> {f2:.2f})")

    # -- output ----------------------------------------------------------------
    def label(self, pid: int) -> str:
        p = self.parts[pid]
        if p.kind == "original":
            return f"#{pid + 1}"
        inner = Counter(m.orig_type + 1 for m in p.members[1:])
        return f"C{pid}[#{p.members[0].orig_type + 1}+" + \
            "+".join(f"{n}x#{t}" for t, n in sorted(inner.items())) + "]"

    def build(self) -> tuple[dict, dict]:
        if self.opt.pairing:
            self.say("Pairing:")
            self.run_pairing()
        self.say("Hole filling:")
        self.run_holefill()
        out = {k: v for k, v in self.inst.items() if k != "item_types"}
        out["item_types"] = []
        mapping = {"format": "nestprep-composites", "version": 1,
                   "spacing": self.s, "item_types": []}
        for p in self.parts:
            if p.remaining <= 0:
                continue
            out["item_types"].append(p.to_item_json())
            mapping["item_types"].append({
                "kind": p.kind, "label": self.label(p.pid), "copies": p.remaining,
                "members": [m.to_json() for m in p.members]})
        # sanity: every original copy accounted for exactly once
        cnt = Counter()
        for e in mapping["item_types"]:
            for m in e["members"]:
                cnt[m["orig_type"]] += e["copies"]
        for t, it in enumerate(self.inst["item_types"]):
            assert cnt[t] == int(it.get("copies", 1)), (t, cnt[t], it.get("copies"))
        mapping["stats"] = dict(self.stats)
        return out, mapping


def QUARTER_PLACEMENTS(p: Part):
    """Placements to offer a pair: those of the part itself."""
    return p.placements
