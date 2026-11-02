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

Algorithm (blocks)
------------------
After pairing and hole filling, every big part whose outline fills little of its bounding box (an
L, a comb, a slanted plate) gets other parts into the pockets of that box: the box is the bin, the
big part an obstacle in it, the other parts the items (knapsack, profit growing faster than area
so the biggest that fit go first). The box may grow by `block_margin` on one side when that makes
the block fuller. A block is kept when it fills its box clearly better than the big part alone.
All blocks are worked out at once: the parts that fill them are shared out first (by pocket area;
whole copies of scarce parts to the tightest pocket that holds them), then every block is one solver
job, all in parallel (block_parallel; the older way, big parts taking turns, is run_blocks_turns).

Algorithm (pairing)
-------------------
For part types with a low bounding-box fill ratio and >= 2 copies left, two
copies are packed into the smallest bounding box (open-dimension-xy objective).
The pair is kept as a composite when its bounding-box fill beats the single
part by `pair_min_gain` and reaches `pair_min_fill`.
"""
from __future__ import annotations

import copy
import time
import math
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

import numpy as np

from . import freemap, geom
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
    # every round fills as many host copies as the scarcest filler allows; a part with ten copies
    # and mixed fillers can need more than six (the tenth copy was left empty)
    max_rounds_per_host: int = 50
    min_fill_area: float = 0.0          # ignore fills smaller than this [mm2]
    pairing: bool = True
    pair_max_fill: float = 0.80         # only try pairing below this bbox fill
    pair_min_fill: float = 0.80         # keep pair if its bbox fill >= this
    pair_min_gain: float = 0.10         # ... and improves fill by this much
    pair_time: float = 0.5
    # blocks: a big part with pockets (its outline fills little of its box) gets other parts into
    # its box, the biggest that fit first, so it nests as a near-rectangle (see run_blocks)
    blocks: bool = True
    block_margin: float = 0.10          # the box may grow this share of its width or height
    block_min_share: float = 0.04       # a big part: its box is at least this share of a sheet
    block_max_outline_fill: float = 0.85   # ... and its outline fills at most this share of the box
    block_min_fill: float = 0.70        # keep a block when it fills at least this share of its box
    block_gain: float = 0.08            # ... and this much more than the big part alone
    block_time: float = 1.0             # time per block sub-solve [s]
    block_budget: float = 30.0          # time for the whole step [s]
    block_parallel: bool = True         # all blocks worked out at once (parts shared up front)
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
            e = 2 * float(b.get("item_bin_minimum_spacing", 0.0))  # edge distance on both sides
            if "elements" in b:
                x0, y0, x1, y1 = geom.shape_to_poly(b).bbox
                self.sheets.append((x1 - x0 - e, y1 - y0 - e))
            else:
                self.sheets.append((float(b["width"]) - e, float(b["height"]) - e))
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

    def hole_job(self, hole: np.ndarray, cands: list[Part], avail: dict[int, int]):
        harea = abs(geom.polygon_area(hole))
        caps = {p.pid: min(avail[p.pid], max(1, int(harea // max(p.area, 1.0))))
                for p in cands}
        # one answer per hole shape: reused as long as the parts it uses are still there
        return self.hole_key(hole), caps

    def prefetch(self, hosts: list[Part]):
        """Every distinct hole of every host solved up front, at the same time (`workers` solver
        processes), with the parts as they are now. The pass over the hosts then finds most of them
        ready; a hole whose candidates changed meanwhile is solved again there."""
        if self.opt.workers <= 1:
            return
        jobs = {}
        for host in hosts:
            avail = {p.pid: p.remaining for p in self.parts}
            avail[host.pid] -= 1
            for h in self.usable_holes(host):
                cands = self.candidates(h, avail, host)
                if not cands:
                    continue
                key, caps = self.hole_job(h, cands, avail)
                if key not in self.cache and key not in jobs:
                    jobs[key] = (h, cands, caps)
        if not jobs:
            return
        keys = list(jobs)
        with ThreadPoolExecutor(max_workers=self.opt.workers) as ex:
            results = list(ex.map(lambda k: self.sub_solve(*jobs[k]), keys))
        for k, res in zip(keys, results):
            self.cache[k] = res
        self.stats["prefetched"] += len(keys)

    def sub_solve(self, hole: np.ndarray, cands: list[Part], caps: dict[int, int]):
        """The knapsack of one hole, in the hole's own frame (its box corner at 0,0)."""
        x0, y0, _, _ = geom.bbox(hole)
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
        return res

    def solve_hole(self, hole: np.ndarray, cands: list[Part], avail: dict[int, int]):
        """Knapsack of `cands` into one hole. Returns [(pid, Xf in hole coords)]."""
        x0, y0, _, _ = geom.bbox(hole)
        key, caps = self.hole_job(hole, cands, avail)
        cand_ids = {p.pid for p in cands}
        cached = self.cache.get(key)
        if cached is not None and all(pid in cand_ids for pid, _ in cached) and \
                all(avail.get(pid, 0) >= n for pid, n in Counter(pid for pid, _ in cached).items()):
            self.stats["cache_hits"] += 1
            res = cached
        else:
            res = self.sub_solve(hole, cands, caps)
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
        self.prefetch([h for _, h in hosts])
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
                         f"(+{farea / 1e2:.0f} cm2 each)")

    # -- pairing -------------------------------------------------------------
    def bbox_fill(self, p: Part) -> float:
        w, h = p.dims()
        return p.area / (w * h)

    def outline_fill(self, p: Part) -> float:
        """How much of its bounding box the part's outer outline fills (holes ignored)."""
        w, h = p.dims()
        outer = sum(abs(geom.polygon_area(q.outer)) for q in p.polys)
        return outer / (w * h) if w > 0 and h > 0 else 1.0

    def run_pairing(self):
        # 1. build every strip sub-problem (2 copies, a few candidate heights)
        jobs = []
        for p in list(self.parts[: self.n_orig]):
            # judged by the outline: holes do not matter for how two copies lie side by side (a
            # rectangle with holes never pairs better; a triangle or an L can)
            if p.remaining < 2 or self.outline_fill(p) >= self.opt.pair_max_fill:
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

    # -- blocks --------------------------------------------------------------------
    def outers(self, p: Part) -> list[np.ndarray]:
        """Outer outlines of the part's shapes that are not inside another of its shapes."""
        polys = p.polys
        out = []
        for i, a in enumerate(polys):
            ab = a.bbox
            inside = any(j != i and b.bbox[0] <= ab[0] and b.bbox[1] <= ab[1] and b.bbox[2] >= ab[2] and b.bbox[3] >= ab[3]
                         and (b.bbox != ab or j < i) and geom.point_in_polygon(*a.outer[0], b.outer)
                         for j, b in enumerate(polys))
            if not inside:
                out.append(a.outer)
        return out

    def box_fits_sheet(self, w: float, h: float) -> bool:
        return not self.sheets or any((w <= sw + 1e-6 and h <= sh + 1e-6) or (h <= sw + 1e-6 and w <= sh + 1e-6)
                                      for sw, sh in self.sheets)

    def block_variants(self, host: Part) -> list[tuple[float, float, float, float]]:
        """How the box may grow: (left, bottom, right, top); none, or the margin on one side."""
        W, H = host.dims()
        m = self.opt.block_margin
        out = [(0.0, 0.0, 0.0, 0.0)]
        if m > 0:
            out += [(0.0, 0.0, m * W, 0.0), (m * W, 0.0, 0.0, 0.0), (0.0, 0.0, 0.0, m * H), (0.0, m * H, 0.0, 0.0)]
        return [v for v in out if self.box_fits_sheet(W + v[0] + v[2], H + v[1] + v[3])]

    def block_solve(self, host: Part, v, cands: list[Part], caps: dict[int, int]):
        """The knapsack of one block: the (grown) box as the bin, the big part an obstacle in it."""
        x0, y0, x1, y1 = host.bbox
        bx0, by0 = x0 - v[0], y0 - v[1]
        BW, BH = x1 + v[2] - bx0, y1 + v[3] - by0
        rect = np.array([[0.0, 0.0], [BW, 0.0], [BW, BH], [0.0, BH]])
        defects = [{"type": "general", "elements": geom.polygon_to_elements(geom.ccw(o - [bx0, by0])),
                    "item_defect_minimum_spacing": self.s} for o in self.outers(host)]
        sub = {
            "objective": "knapsack",
            "parameters": {"item_item_minimum_spacing": self.s},
            "bin_types": [{"type": "general", "elements": geom.polygon_to_elements(rect), "copies": 1,
                           "item_bin_minimum_spacing": 0.0, "defects": defects}],
            "item_types": [{"shapes": p.shapes, "copies": caps[p.pid],
                            # more than the area: the biggest parts that fit go in first
                            "profit": p.area ** 1.2,
                            "allowed_rotations": p.rotations_json()} for p in cands],
        }
        try:
            r = solve(sub, self.bin, self.opt.block_time, self.opt.sub_mode)
        except RuntimeError:
            return []
        self.stats["sub_solves"] += 1
        self.stats["sub_time"] += r["time"]
        res = []
        for b in (r["solution"] or {}).get("bins", []):
            for it in b["items"]:
                res.append((cands[it["id"]].pid, Xf(geom.norm_angle(it["angle"]), bool(it.get("mirror", False)),
                                                     it["x"] + bx0, it["y"] + by0)))
        return res

    def block_for(self, host: Part, avail: dict[int, int], parallel: bool = True):
        """The best block of one copy of `host` with the parts in `avail`: (fills, composite, fill) or None."""
        W, H = host.dims()
        variants = self.block_variants(host)
        if not variants:
            return None
        env = sum(abs(geom.polygon_area(o)) for o in self.outers(host))
        pocket = max(w * h for w, h in ((W + v[0] + v[2], H + v[1] + v[3]) for v in variants)) - env
        bw = max(W + v[0] + v[2] for v in variants)
        bh = max(H + v[1] + v[3] for v in variants)
        cands = [p for p in self.parts if avail.get(p.pid, 0) > 0 and p.area <= pocket and p.area < host.area
                 and p.fits_box(bw, bh)]
        if not cands:
            return None
        caps = {p.pid: min(avail[p.pid], max(1, int(pocket // max(p.area, 1.0)))) for p in cands}
        if parallel:
            with ThreadPoolExecutor(max_workers=max(1, self.opt.workers)) as ex:
                results = list(ex.map(lambda v: self.block_solve(host, v, cands, caps), variants))
        else:
            results = [self.block_solve(host, variants[0], cands, caps)]
        f0 = self.bbox_fill(host)
        best = None
        for fills in results:
            if not fills:
                continue
            comp = self.compose(host, fills, kind="block")
            if comp is None or not self.fits_sheet(comp):
                continue
            comp.pid = -1                       # not among the parts yet
            f = self.bbox_fill(comp)
            if best is None or f > best[2]:
                best = (fills, comp, f)
        if best is None or best[2] < max(self.opt.block_min_fill, f0 + self.opt.block_gain):
            return None
        return best

    def block_hosts(self) -> list[Part]:
        """The big parts with pockets, the biggest box first."""
        sheet = min((w * h for w, h in self.sheets), default=None)
        hosts = []
        for p in self.parts:
            if p.remaining <= 0:
                continue
            W, H = p.dims()
            if sheet and W * H < self.opt.block_min_share * sheet:
                continue
            env = sum(abs(geom.polygon_area(o)) for o in self.outers(p))
            if env / (W * H) > self.opt.block_max_outline_fill:
                continue
            hosts.append(p)
        hosts.sort(key=lambda p: -(p.dims()[0] * p.dims()[1]))
        return hosts

    def pockets_of(self, host: Part, cell: float):
        """The free pockets in the part's box (the part grown by the gap taken out), and per side of
        the box (left, bottom, right, top) the pocket area open to it."""
        x0, y0, x1, y1 = host.bbox
        W, H = x1 - x0, y1 - y0
        rect = np.array([[0.0, 0.0], [W, 0.0], [W, H], [0.0, H]])
        placed = [{"type": "general", "elements": geom.polygon_to_elements(geom.ccw(o - [x0, y0]))} for o in self.outers(host)]
        fm = freemap.FreeMap({"type": "general", "elements": geom.polygon_to_elements(rect)}, placed, self.s, cell)
        pockets = [pk for pk in fm.pockets() if pk.area > 0]
        near = 2.5 * cell
        open_ = [0.0, 0.0, 0.0, 0.0]
        for pk in pockets:
            bx0, by0, bx1, by1 = pk.box
            if bx0 <= near: open_[0] += pk.area
            if by0 <= near: open_[1] += pk.area
            if bx1 >= W - near: open_[2] += pk.area
            if by1 >= H - near: open_[3] += pk.area
        return pockets, open_

    @staticmethod
    def fits_pocket(p: Part, pk) -> bool:
        """A quick check: the part's box fits the pocket's box, its narrow side the pocket's width."""
        bx0, by0, bx1, by1 = pk.box
        pw, ph = p.dims()
        return p.area <= pk.area and min(pw, ph) <= pk.fit + 1e-6 and p.fits_box(bx1 - bx0, by1 - by0)

    def run_blocks(self):
        if self.opt.block_parallel:
            return self.run_blocks_parallel()
        return self.run_blocks_turns()

    def run_blocks_parallel(self):
        """All blocks worked out at once. The parts that fill them are shared out first: a kind with
        enough copies in proportion to each big part's pocket area (pocket area x copies); what does
        not split evenly, whole copies, biggest first, each to the big part whose pocket it fits most
        tightly. Then every block (big part kind x the parts it got x the box variants) is one
        solver job, all of them in parallel; a part a block could not place gets one more try in the
        next-best big part, else it goes to the main nest."""
        t0 = time.perf_counter()
        hosts = self.block_hosts()
        if not hosts:
            return
        self.say(f"  {len(hosts)} big parts with pockets: " + ", ".join(self.label(h.pid) for h in hosts))
        hid = {h.pid for h in hosts}
        fillers = [p for p in self.parts if p.remaining > 0 and p.pid not in hid]
        if not fillers:
            return
        smallest = min(min(p.dims()) for p in fillers)
        cell = max(3.0, min(freemap.cell_size(self.s, smallest), 10.0))
        info = {}
        for h in hosts:
            pockets, open_ = self.pockets_of(h, cell)
            if not pockets:
                continue
            fits = {f.pid: [pk for pk in pockets if self.fits_pocket(f, pk)] for f in fillers if f.area < h.area}
            fits = {k: v for k, v in fits.items() if v}
            if fits:
                info[h.pid] = dict(pockets=pockets, open=open_, fits=fits, area=sum(pk.area for pk in pockets))
        hosts = [h for h in hosts if h.pid in info]
        if not hosts:
            return

        # -- the parts shared out ------------------------------------------------------------------
        cap: dict[int, dict[int, int]] = {h.pid: {} for h in hosts}   # per copy of a big part
        extra: dict[int, list[Counter]] = {h.pid: [Counter() for _ in range(h.remaining)] for h in hosts}
        room: dict[int, list[float]] = {h.pid: [info[h.pid]["area"]] * h.remaining for h in hosts}
        scarce: list[int] = []
        for f in sorted(fillers, key=lambda p: -p.area):
            hs = [h for h in hosts if f.pid in info[h.pid]["fits"]]
            if not hs:
                continue
            weight = {h.pid: info[h.pid]["area"] * h.remaining for h in hs}
            total = sum(weight.values())
            used = 0
            for h in hs:
                per = int(f.remaining * weight[h.pid] / total) // h.remaining
                per = min(per, int(info[h.pid]["area"] // max(f.area, 1.0)))
                if per > 0:
                    cap[h.pid][f.pid] = per
                    used += per * h.remaining
            scarce += [f.pid] * (f.remaining - used)
        # whole copies: the biggest first, each to the tightest pocket that holds it
        for fpid in scarce:
            f = self.parts[fpid]
            best = None
            for h in hosts:
                pks = info[h.pid]["fits"].get(fpid)
                if not pks:
                    continue
                slack = min(pk.area for pk in pks) - f.area
                k = next((i for i, r in enumerate(room[h.pid]) if r >= f.area), None)
                if k is not None and (best is None or slack < best[0]):
                    best = (slack, h.pid, k)
            if best:
                _, hp, k = best
                extra[hp][k][fpid] += 1
                room[hp][k] -= f.area

        # -- the blocks to work out: a big part kind x what one copy got; the box variants ----------
        kinds = []          # (host, caps per copy, copies)
        for h in hosts:
            groups: dict[tuple, int] = {}
            for e in extra[h.pid]:
                key = tuple(sorted(e.items()))
                groups[key] = groups.get(key, 0) + 1
            for key, n in groups.items():
                caps = dict(cap[h.pid])
                for fpid, c in key:
                    caps[fpid] = caps.get(fpid, 0) + c
                if caps:
                    kinds.append((h, caps, n))
        jobs = []
        for ki, (h, caps, n) in enumerate(kinds):
            W, H = h.dims()
            m = self.opt.block_margin
            sides = [i for i in sorted(range(4), key=lambda i: -info[h.pid]["open"][i]) if info[h.pid]["open"][i] > 0][:2]
            vs = [(0.0, 0.0, 0.0, 0.0)]
            for i in sides if m > 0 else []:
                v = [0.0, 0.0, 0.0, 0.0]
                v[i] = m * (W if i in (0, 2) else H)
                vs.append(tuple(v))
            for v in vs:
                if self.box_fits_sheet(W + v[0] + v[2], H + v[1] + v[3]):
                    jobs.append((ki, v))
        # within the time: the margin variants of the smallest blocks go first when there are too many
        w = max(1, self.opt.workers)
        while jobs and len(jobs) * self.opt.block_time / w > self.opt.block_budget:
            k = max((j for j in jobs if any(x for x in j[1])), key=lambda j: -kinds[j[0]][0].dims()[0] * kinds[j[0]][0].dims()[1], default=None)
            if k is None:
                break
            jobs.remove(k)

        def job(j):
            ki, v = j
            h, caps, _ = kinds[ki]
            cands = [self.parts[pid] for pid in caps]
            return self.block_solve(h, v, cands, caps)
        with ThreadPoolExecutor(max_workers=w) as ex:
            results = list(ex.map(job, jobs))

        # -- the best variant of every kind; kept when it fills its box well enough -------------
        best: dict[int, tuple] = {}
        for (ki, v), fills in zip(jobs, results):
            if not fills:
                continue
            h = kinds[ki][0]
            comp = self.compose(h, fills, kind="block")
            if comp is None or not self.fits_sheet(comp):
                continue
            f = self.bbox_fill(comp)
            if ki not in best or f > best[ki][2]:
                best[ki] = (fills, comp, f)
        made = 0
        for ki, (h, caps, n) in enumerate(kinds):
            b = best.get(ki)
            if b is None or b[2] < max(self.opt.block_min_fill, self.bbox_fill(h) + self.opt.block_gain):
                continue
            need = Counter(pid for pid, _ in b[0])
            k = min([n, h.remaining] + [self.parts[pid].remaining // c for pid, c in need.items()])
            if k <= 0:
                continue
            comp = b[1]
            comp.pid = len(self.parts)
            comp.remaining = k
            self.parts.append(comp)
            h.remaining -= k
            for pid, c in need.items():
                self.parts[pid].remaining -= c * k
            made += k
            desc = ", ".join(f"{c}x{self.label(pid)}" for pid, c in need.items())
            self.say(f"  block {self.label(h.pid)} x{k}: {desc}, box fill {self.bbox_fill(h):.2f} -> {b[2]:.2f}")
        self.stats["blocks"] += made
        self.stats["block_jobs"] += len(jobs)
        # a short second round: copies of big parts left plain, with the parts still free (in parallel)
        left = [h for h in hosts if h.remaining > 0]
        if left and time.perf_counter() - t0 < self.opt.block_budget:
            avail = {p.pid: p.remaining for p in self.parts}
            plans = {}
            with ThreadPoolExecutor(max_workers=w) as ex:
                futs = {h.pid: ex.submit(self.block_for, h, {**avail, h.pid: avail[h.pid] - 1}, False) for h in left}
                for hp, fu in futs.items():
                    plans[hp] = fu.result()
            for h in left:
                b = plans.get(h.pid)
                if not b:
                    continue
                need = Counter(pid for pid, _ in b[0])
                k = min([h.remaining] + [self.parts[pid].remaining // c for pid, c in need.items()])
                if k <= 0:
                    continue
                comp = b[1]
                comp.pid = len(self.parts)
                comp.remaining = k
                self.parts.append(comp)
                h.remaining -= k
                for pid, c in need.items():
                    self.parts[pid].remaining -= c * k
                self.stats["blocks"] += k
                desc = ", ".join(f"{c}x{self.label(pid)}" for pid, c in need.items())
                self.say(f"  block {self.label(h.pid)} x{k} (2nd round): {desc}, box fill {self.bbox_fill(h):.2f} -> {b[2]:.2f}")

    def run_blocks_turns(self):
        end = time.perf_counter() + self.opt.block_budget
        sheet = min((w * h for w, h in self.sheets), default=None)
        hosts = []
        for p in self.parts:
            if p.remaining <= 0:
                continue
            W, H = p.dims()
            if sheet and W * H < self.opt.block_min_share * sheet:
                continue
            env = sum(abs(geom.polygon_area(o)) for o in self.outers(p))
            if env / (W * H) > self.opt.block_max_outline_fill:
                continue
            hosts.append(p)
        hosts.sort(key=lambda p: -(p.dims()[0] * p.dims()[1]))
        if not hosts:
            return
        self.say(f"  {len(hosts)} big parts with pockets: " + ", ".join(self.label(h.pid) for h in hosts))
        plan: dict[int, tuple | None] = {}       # host pid -> its block as last worked out
        done: set[int] = set()
        # turns: one copy of every big part per turn, so they share the parts that fit them; when
        # the time is up no new blocks are worked out, but those found are still used
        while True:
            moved = False
            for host in hosts:
                if host.pid in done or host.remaining <= 0:
                    continue
                avail = {p.pid: p.remaining for p in self.parts}
                avail[host.pid] -= 1
                b = plan.get(host.pid)
                need = Counter(pid for pid, _ in b[0]) if b else None
                if b is None or any(avail.get(pid, 0) < n for pid, n in need.items()):
                    if time.perf_counter() >= end:
                        done.add(host.pid)
                        continue
                    b = self.block_for(host, avail)
                    plan[host.pid] = b
                    if b is None:
                        done.add(host.pid)
                        continue
                    need = Counter(pid for pid, _ in b[0])
                    desc = ", ".join(f"{n}x{self.label(pid)}" for pid, n in need.items())
                    self.say(f"  block {self.label(host.pid)}: {desc}, box fill {self.bbox_fill(host):.2f} -> {b[2]:.2f}")
                comp = b[1]
                if comp.pid < 0:                # its first copy: the composite joins the parts
                    comp.pid = len(self.parts)
                    comp.remaining = 0
                    self.parts.append(comp)
                comp.remaining += 1
                host.remaining -= 1
                for pid, n in need.items():
                    self.parts[pid].remaining -= n
                self.stats["blocks"] += 1
                moved = True
            if not moved:
                break

    # -- output ----------------------------------------------------------------
    def label(self, pid: int) -> str:
        p = self.parts[pid]
        if p.kind == "original":
            return f"#{pid + 1}"
        inner = Counter(m.orig_type + 1 for m in p.members[1:])
        return f"C{pid}[#{p.members[0].orig_type + 1}+" + \
            "+".join(f"{n}x#{t}" for t, n in sorted(inner.items())) + "]"

    def build(self) -> tuple[dict, dict]:
        t = time.perf_counter()
        if self.opt.pairing:
            self.say("Pairing:")
            self.run_pairing()
        self.stats["pairing_s"] = round(time.perf_counter() - t, 1)
        t = time.perf_counter()
        self.say("Hole filling:")
        self.run_holefill()
        self.stats["holefill_s"] = round(time.perf_counter() - t, 1)
        if self.opt.blocks:
            t = time.perf_counter()
            self.say("Blocks:")
            self.run_blocks()
            self.stats["blocks_s"] = round(time.perf_counter() - t, 1)
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
