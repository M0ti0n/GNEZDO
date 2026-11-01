"""Post-pass: after the main nest, move parts forward into gaps and shorten the last sheet.

Works on the solution of the (pre-processed) instance, item by item; a composite (host with parts
in its holes, or a pair) moves as one piece. PackingSolver does all the geometry: the parts already
on a sheet are given to it as obstacles ("defects", kept `spacing` away), so a gap can be a hole,
a bay, a pocket between neighbouring parts or a strip along the edge.

Steps (each optional, each with its own time limit; the time for the compaction is kept aside):

1. gap      Parts of the last sheet go into the gaps of the earlier sheets. Off by default: the
            chain's first round does the same; kept for adding parts to a finished nest.
2. chain    From the back to the front: the gaps of sheet k get parts from any later sheet
            (taken from the latest sheet first). Space freed on a sheet is used in the next
            round; rounds repeat until nothing moves.
3. pairs    Two neighbouring sheets are nested again together: as much as possible on the first,
            the rest must fit on the second. Kept only when it is better. Runs before the chain,
            from the last pair forward.
Last, the last sheet is compacted to the left, so what is left of it is one clean remnant.

Every result comes from PackingSolver; the caller validates the final layout independently.
"""
from __future__ import annotations

import copy
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from collections import Counter
from dataclasses import dataclass, field

from . import geom, psrun
from .freemap import FreeMap, Pocket, cell_size
from .push import push_sheet
from .geom import Xf


@dataclass
class PostOptions:
    gap: bool = False            # step 1; the chain's first round does the same (kept for adding parts)
    fill: bool = True            # gaps of the emptiest sheets first, from the parts of later sheets
    fill_time: float = 3.0       # per sheet
    fill_rounds: int = 3
    fill_below: float = 0.86     # sheets fuller than this (parts area / sheet area) are left alone
    empty: bool = True           # the last sheet's parts into the earlier sheets, again while sheets go
    empty_time: float = 2.0      # per sheet
    empty_first: bool = True     # also before fill (Thorough); Fast has the time for one run only
    push: bool = True            # parts pushed towards 0,0 at the start and after every step (push.py)
    tail: bool = True            # the last sheets nested again together, to need one sheet less
    tail_time: float = 6.0       # per sheet of the tail
    chain: bool = True
    pairs: bool = True
    compact: bool = True
    gap_time: float = 2.0        # per sheet
    chain_time: float = 2.0      # per sheet and round
    chain_rounds: int = 4
    pair_time: float = 8.0       # per solve (two per pair)
    compact_time: float = 5.0
    # "anytime" uses every second it is given; "not-anytime-deterministic" returns when its search
    # is done (usually well inside the limit)
    solve_mode: str = "anytime"
    # empty goes by the free pockets of a free-space map (freemap), the biggest usable first, each
    # solved in a small window around the pocket (on the same layouts: the same sheets in about 70 %
    # of the time). fill stays sheet by sheet: one whole-sheet solve fills all of a sheet's pockets
    # at once, and moved more parts in the same time (370 against 113 on a 25-sheet nest)
    pockets: bool = True
    pocket_time: float = 1.0     # per pocket
    workers: int = 1             # solver processes at the same time (fills of different sheets)
    pool_time: float = 2.0       # two-phase nest: per sheet, placing the small parts into its gaps
    pool_rounds: int = 2
    budget: float = 120.0        # whole post-pass [s]; steps stop when it runs out
    quiet: bool = False


def clip_rect(poly: np.ndarray, x0: float, y0: float, x1: float, y1: float) -> np.ndarray | None:
    """A polygon cut to a rectangle (Sutherland-Hodgman); None when nothing is left."""
    pts = [tuple(p) for p in poly]
    sides = [(lambda p: p[0] >= x0, lambda a, b: (x0, a[1] + (b[1] - a[1]) * (x0 - a[0]) / (b[0] - a[0]))),
             (lambda p: p[0] <= x1, lambda a, b: (x1, a[1] + (b[1] - a[1]) * (x1 - a[0]) / (b[0] - a[0]))),
             (lambda p: p[1] >= y0, lambda a, b: (a[0] + (b[0] - a[0]) * (y0 - a[1]) / (b[1] - a[1]), y0)),
             (lambda p: p[1] <= y1, lambda a, b: (a[0] + (b[0] - a[0]) * (y1 - a[1]) / (b[1] - a[1]), y1))]
    for inside, cut in sides:
        out = []
        for i in range(len(pts)):
            a, b = pts[i - 1], pts[i]
            ia, ib = inside(a), inside(b)
            if ib:
                if not ia:
                    out.append(cut(a, b))
                out.append(b)
            elif ia:
                out.append(cut(a, b))
        pts = out
        if len(pts) < 3:
            return None
    q = np.array(pts, dtype=float)
    return q if abs(geom.polygon_area(q)) > 1.0 else None


@dataclass
class Placed:
    id: int        # item type of the instance that was nested (composite or original)
    xf: Xf


@dataclass
class Sheet:
    bin_type: int
    items: list[Placed] = field(default_factory=list)


class PostPass:
    def __init__(self, instance: dict, solution: dict, binary: str, opt: PostOptions | None = None,
                 pool: Counter | dict | None = None):
        """`instance` is the instance that was nested (the pre-processed one when the pre-pass ran).
        `pool`: item copies not nested yet (two-phase nest: the small parts), placed by step_pool."""
        self.pool = Counter({k: v for k, v in (pool or {}).items() if v > 0})
        self._bin_area: dict[int, float] = {}
        self.inst = instance
        self.bin = binary
        self.opt = opt or PostOptions()
        self.spacing = float(instance.get("parameters", {}).get("item_item_minimum_spacing", 0.0))
        self.sheets: list[Sheet] = []
        for b in solution.get("bins", []):
            for _ in range(int(b.get("copies", 1))):
                self.sheets.append(Sheet(b["id"], [
                    Placed(it["id"], Xf(geom.norm_angle(it["angle"]), bool(it.get("mirror", False)), it["x"], it["y"]))
                    for it in b["items"]]))
        self._area = {}
        self._in_tail = False
        self._empty_runs = 0
        self.log: list[dict] = []
        self.t0 = time.perf_counter()

    # -- helpers -------------------------------------------------------------
    def say(self, msg: str):
        if not self.opt.quiet:
            print(f"  [post {time.perf_counter() - self.t0:5.1f}s] {msg}", flush=True)

    def left(self) -> float:
        """Time left for the steps before the compaction (its time is kept aside)."""
        reserve = (self.opt.compact_time if self.opt.compact else 0.0) + (self.opt.tail_time * 2 if self.opt.tail and not self._in_tail else 0.0) \
            + (self.opt.empty_time * 3 if self.opt.empty and self._empty_runs < (2 if self.opt.empty_first else 1) else 0.0)
        return self.opt.budget - reserve - (time.perf_counter() - self.t0)

    def left_total(self) -> float:
        return self.opt.budget - (time.perf_counter() - self.t0)

    def area(self, tid: int) -> float:
        if tid not in self._area:
            self._area[tid] = sum(geom.shape_to_poly(s).area for s in self.shapes(tid))
        return self._area[tid]

    def shapes(self, tid: int) -> list[dict]:
        it = self.inst["item_types"][tid]
        return it["shapes"] if "shapes" in it else [it]

    def sheet_area(self, sh: Sheet) -> float:
        return sum(self.area(p.id) for p in sh.items)

    def item_xmax(self, p: Placed) -> float:
        return max(geom.shape_to_poly(geom.transform_shape(s, p.xf)).bbox[2] for s in self.shapes(p.id))

    def xmax(self, sh: Sheet) -> float:
        return max((self.item_xmax(p) for p in sh.items), default=0.0)

    def item_json(self, tid: int, copies: int) -> dict:
        src = self.inst["item_types"][tid]
        out = {k: v for k, v in src.items() if k not in ("copies", "profit")}
        out["copies"] = copies
        out["profit"] = self.area(tid)
        return out

    @staticmethod
    def obstacle(shape: dict, p: "Placed", gap: float, clip: tuple | None = None) -> dict | None:
        """A placed part as an obstacle: outline and holes as polygons running counter-clockwise
        (a mirrored part runs the other way, and PackingSolver then misreads its holes).
        clip: (x0, y0, x1, y1) to cut it to (a window: an obstacle reaching far out of it made
        PackingSolver answer with copies on top of each other); a hole the cut crosses counts as solid."""
        ps = geom.shape_to_poly(geom.transform_shape(shape, p.xf))
        outer, holes = ps.outer, list(ps.holes)
        if clip is not None:
            outer = clip_rect(outer, *clip)
            if outer is None:
                return None
            x0, y0, x1, y1 = clip
            holes = [h for h in holes if h[:, 0].min() > x0 and h[:, 0].max() < x1 and h[:, 1].min() > y0 and h[:, 1].max() < y1]
        d = {"type": "general", "elements": geom.polygon_to_elements(geom.ccw(outer))}
        if holes:
            d["holes"] = [{"type": "general", "elements": geom.polygon_to_elements(geom.ccw(h))} for h in holes]
        d["item_defect_minimum_spacing"] = gap
        return d

    def bin_json(self, bt: int, obstacles: list[Placed]) -> dict:
        b = copy.deepcopy(self.inst["bin_types"][bt])
        b["copies"] = 1
        b.pop("copies_min", None)
        b.pop("cost", None)
        defects = list(b.get("defects", []))
        for p in obstacles:
            for s in self.shapes(p.id):
                defects.append(self.obstacle(s, p, self.spacing))
        if defects:
            b["defects"] = defects
        return b

    def solve(self, objective: str, bt: int, obstacles: list[Placed], cands: Counter, t: float,
              bin_json: dict | None = None) -> list[Placed]:
        """Places as many of `cands` as it can (knapsack) or all of them (open-dimension-x).
        bin_json: a bin of its own (a window around a pocket) instead of the sheet with `obstacles`."""
        ids = sorted(cands)
        inst = {
            "objective": objective,
            "parameters": dict(self.inst.get("parameters", {})),
            "bin_types": [bin_json if bin_json is not None else self.bin_json(bt, obstacles)],
            "item_types": [self.item_json(tid, cands[tid]) for tid in ids],
        }
        try:
            r = psrun.solve(inst, self.bin, max(0.2, t), self.opt.solve_mode)
        except RuntimeError as e:
            self.say(f"solver failed: {str(e)[:120]}")
            return []
        out = []
        for b in (r["solution"] or {}).get("bins", []):
            if b.get("id", 0) != 0:
                continue
            for it in b["items"]:
                out.append(Placed(ids[it["id"]], Xf(geom.norm_angle(it["angle"]), bool(it.get("mirror", False)), it["x"], it["y"])))
            break  # one sheet
        return out

    def take_from_latest(self, moved: list[Placed], after: int):
        """Removes the moved copies from the sheets after `after`, latest sheet first."""
        need = Counter(p.id for p in moved)
        for sh in reversed(self.sheets[after + 1:]):
            # the copies furthest right go first, so the sheet gets shorter
            order = sorted(range(len(sh.items)), key=lambda i: -self.item_xmax(sh.items[i]))
            drop = set()
            for i in order:
                if need[sh.items[i].id] > 0:
                    need[sh.items[i].id] -= 1
                    drop.add(i)
            sh.items = [p for i, p in enumerate(sh.items) if i not in drop]
        assert not +need, f"moved parts not found on later sheets: {dict(+need)}"
        self.sheets = [sh for sh in self.sheets if sh.items]

    def state(self) -> dict:
        n = len(self.sheets)
        last = self.sheets[-1] if n else None
        W = None
        if last:
            b = self.inst["bin_types"][last.bin_type]
            W = geom.shape_to_poly(b).bbox[2] if "elements" in b else float(b["width"])
        return {"sheets": n, "last_xmax": round(self.xmax(last), 1) if last else 0.0,
                "equiv": round((n - 1) + (self.xmax(last) / W if last else 0), 3)}

    def note(self, step: str, t: float, moved: int):
        s = self.state()
        self.log.append({"step": step, "seconds": round(t, 1), "moved": moved, **s})
        self.say(f"{step}: moved {moved}, {s['sheets']} sheets, last sheet {s['last_xmax']} mm "
                 f"({s['equiv']} sheet-equivalents), {t:.1f} s")

    # -- steps ---------------------------------------------------------------
    def fill(self, k: int, cands: Counter, t: float) -> int:
        if not cands or self.left() < 0.5:
            return 0
        sh = self.sheets[k]
        placed = self.solve("knapsack", sh.bin_type, sh.items, cands, min(t, self.left()))
        if not placed:
            return 0
        sh.items += placed
        self.take_from_latest(placed, k)
        return len(placed)

    def step_gap(self):
        t = time.perf_counter()
        moved = 0
        last = self.sheets[-1]
        for k in range(len(self.sheets) - 1):
            if last not in self.sheets or k >= len(self.sheets) - 1:
                break  # the last sheet has been emptied
            moved += self.fill(k, Counter(p.id for p in last.items), self.opt.gap_time)
        self.note("gap", time.perf_counter() - t, moved)

    def fullness(self, sh: Sheet) -> float:
        b = self.inst["bin_types"][sh.bin_type]
        if sh.bin_type not in self._bin_area:
            self._bin_area[sh.bin_type] = geom.shape_to_poly(b).area if "elements" in b else float(b["width"]) * float(b["height"])
        return self.sheet_area(sh) / self._bin_area[sh.bin_type]

    def free_area(self, sh: Sheet) -> float:
        return (1.0 - self.fullness(sh)) * self._bin_area[sh.bin_type]

    def index_of(self, sh: Sheet) -> int | None:
        return next((i for i, x in enumerate(self.sheets) if x is sh), None)

    def fill_batch(self, targets: list[Sheet], source: str, t: float) -> int:
        """Gaps of several sheets at once (one solver process each, `workers` at a time). Every solve
        sees the parts as they were when the batch started; applying them one by one, a sheet keeps
        only what is still to be had (a placement minus some parts is still a valid placement).
        source "pool": the parts not nested yet; "later": parts of the sheets after it (moved)."""
        jobs = []
        for sh in targets:
            k = self.index_of(sh)
            if k is None:
                continue
            if source == "pool":
                avail = self.pool
            else:
                if k >= len(self.sheets) - 1:
                    continue
                avail = Counter(p.id for x in (self.sheets[-1:] if source == "last" else self.sheets[k + 1:]) for p in x.items)
            free = self.free_area(sh)
            fit = [tid for tid, c in avail.items() if c > 0 and self.area(tid) <= free]
            # each type at most its share of the free area: with hundreds of copies on offer the solver
            # finds no first answer in its time (and offering fewer placed as many or more)
            if source == "pool":
                cands = Counter({tid: min(avail[tid], max(1, int(free / self.area(tid) / len(fit)))) for tid in fit})
            else:
                cands = Counter({tid: avail[tid] for tid in fit})
            if cands:
                jobs.append((sh, list(sh.items), cands))
        if not jobs or self.left() < 0.5:
            return 0
        tt = min(t, max(0.5, self.left()))
        run = lambda j: self.solve("knapsack", j[0].bin_type, j[1], j[2], tt)
        if self.opt.workers > 1 and len(jobs) > 1:
            with ThreadPoolExecutor(max_workers=self.opt.workers) as ex:
                results = list(ex.map(run, jobs))
        else:
            results = [run(j) for j in jobs]
        moved = 0
        for (sh, _, _), placed in zip(jobs, results):
            k = self.index_of(sh)
            if k is None or not placed:
                continue
            if source == "pool":
                avail = self.pool
            else:
                if k >= len(self.sheets) - 1:
                    continue
                avail = Counter(p.id for x in (self.sheets[-1:] if source == "last" else self.sheets[k + 1:]) for p in x.items)
            keep, took = [], Counter()
            for p in placed:
                if took[p.id] < avail[p.id]:
                    keep.append(p)
                    took[p.id] += 1
            if not keep:
                continue
            sh.items += keep
            if source == "pool":
                self.pool -= took
            else:
                self.take_from_latest(keep, k)
            moved += len(keep)
        return moved

    def batches(self, order: list[Sheet]):
        w = max(1, self.opt.workers)
        for i in range(0, len(order), w):
            yield order[i:i + w]

    def step_pool(self):
        """Two-phase nest: the small parts go into the gaps of the big parts' sheets, the emptiest
        sheet first; what does not fit goes on new sheets of its own."""
        t = time.perf_counter()
        placed = 0
        for _ in range(self.opt.pool_rounds):
            if not self.pool:
                break
            order = sorted((x for x in self.sheets if self.fullness(x) < 0.95), key=self.fullness)
            moved = 0
            for batch in self.batches(order):
                if not self.pool or self.left() < 1.0:
                    break
                moved += self.fill_batch(batch, "pool", self.opt.pool_time)
            placed += moved
            if not moved:
                break
        self.note("pool", time.perf_counter() - t, placed)
        if self.pool:
            self.pack_pool()

    def pack_pool(self):
        """The small parts left after the gaps: nested on new sheets (all of them, whatever the time)."""
        t = time.perf_counter()
        bt = self.sheets[-1].bin_type if self.sheets else 0
        n = sum(self.pool.values())
        for attempt in range(3):
            ids = sorted(self.pool)
            b = self.bin_json(bt, [])
            b["copies"] = n
            inst = {"objective": "bin-packing", "parameters": dict(self.inst.get("parameters", {})),
                    "bin_types": [b], "item_types": [self.item_json(tid, self.pool[tid]) for tid in ids]}
            try:
                r = psrun.solve(inst, self.bin, max(2.0, min(10.0, self.left())) * (attempt + 1), self.opt.solve_mode)
            except RuntimeError as e:
                self.say(f"solver failed: {str(e)[:120]}")
                continue
            new = []
            for sb in (r["solution"] or {}).get("bins", []):
                for _ in range(int(sb.get("copies", 1))):
                    new.append(Sheet(bt, [Placed(ids[it["id"]], Xf(geom.norm_angle(it["angle"]), bool(it.get("mirror", False)), it["x"], it["y"]))
                                          for it in sb["items"]]))
            got = Counter(p.id for x in new for p in x.items)
            if got == self.pool:
                self.sheets += new
                self.pool = Counter()
                break
        self.note("pool-new-sheets", time.perf_counter() - t, n - sum(self.pool.values()))

    # -- free pockets ---------------------------------------------------------
    def short_side(self, tid: int) -> float:
        if not hasattr(self, "_short"):
            self._short = {}
        if tid not in self._short:
            boxes = [geom.shape_to_poly(s).bbox for s in self.shapes(tid)]
            self._short[tid] = min(max(b[2] for b in boxes) - min(b[0] for b in boxes),
                                   max(b[3] for b in boxes) - min(b[1] for b in boxes))
        return self._short[tid]

    def cell(self) -> float:
        if not hasattr(self, "_cell"):
            self._cell = cell_size(self.spacing, min(self.short_side(t) for t in range(len(self.inst["item_types"]))))
        return self._cell

    def rect_bin(self, bt: int):
        """The bin's box when it is a plain rectangle (the windows need that), else None."""
        b = self.inst["bin_types"][bt]
        if b.get("defects") or b.get("type") not in (None, "general", "rectangle"):
            return None
        if b.get("type") == "rectangle":
            return (0.0, 0.0, float(b["width"]), float(b["height"]))
        if len(b.get("elements", [])) != 4:
            return None
        return geom.bbox(geom.shape_to_poly(b).outer)

    @staticmethod
    def fingerprint(sh: Sheet):
        return (len(sh.items), round(sum(p.xf.x * 1.000003 + p.xf.y for p in sh.items), 3))

    def freemap(self, sh: Sheet) -> FreeMap:
        if not hasattr(self, "_maps"):
            self._maps = {}
        key = (id(sh), self.fingerprint(sh))
        m = self._maps.get(id(sh))
        if m is None or m[0] != key:
            placed = [geom.transform_shape(s, p.xf) for p in sh.items for s in self.shapes(p.id)]
            m = (key, FreeMap(self.inst["bin_types"][sh.bin_type], placed, self.spacing, self.cell()))
            self._maps[id(sh)] = m
        return m[1]

    def avail_for(self, k: int, source: str) -> Counter:
        if source == "pool":
            return Counter(+self.pool)
        if k >= len(self.sheets) - 1:
            return Counter()
        return Counter(p.id for x in (self.sheets[-1:] if source == "last" else self.sheets[k + 1:]) for p in x.items)

    def window(self, sh: Sheet, pk: Pocket) -> dict:
        """The pocket's box plus a margin, inside the sheet, with the parts near it as obstacles."""
        bx0, by0, bx1, by1 = self.rect_bin(sh.bin_type)
        m = self.spacing + self.cell()
        x0, y0 = max(bx0, pk.box[0] - m), max(by0, pk.box[1] - m)
        x1, y1 = min(bx1, pk.box[2] + m), min(by1, pk.box[3] + m)
        src = self.inst["bin_types"][sh.bin_type]
        b = {"type": "general", "copies": 1,
             "elements": geom.polygon_to_elements(np.array([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], dtype=float)),
             "item_bin_minimum_spacing": float(src.get("item_bin_minimum_spacing", 0.0))}
        g = self.spacing
        defects = []
        for p in sh.items:
            for s0 in self.shapes(p.id):
                qx0, qy0, qx1, qy1 = geom.shape_to_poly(geom.transform_shape(s0, p.xf)).bbox
                if qx1 + g < x0 or qx0 - g > x1 or qy1 + g < y0 or qy0 - g > y1:
                    continue
                d = self.obstacle(s0, p, g, clip=(x0 - g - 1.0, y0 - g - 1.0, x1 + g + 1.0, y1 + g + 1.0))
                if d is not None:
                    defects.append(d)
        if defects:
            b["defects"] = defects
        return b

    def checked(self, placed: list[Placed], window: dict) -> list[Placed]:
        """The placements that really keep the gap: inside the window, clear of every obstacle and
        of each other (exact outlines). PackingSolver now and then answers a window with copies on
        top of each other, outside it, when obstacles reach far out of the window."""
        wx0, wy0, wx1, wy1 = geom.shape_to_poly(window).bbox
        obst = [geom.shape_to_poly(d) for d in window.get("defects", [])]
        g = self.spacing - 0.05
        ok, polys = [], []
        for p in placed:
            mine = [geom.shape_to_poly(geom.transform_shape(s0, p.xf)) for s0 in self.shapes(p.id)]
            if any(q.bbox[0] < wx0 - 0.1 or q.bbox[1] < wy0 - 0.1 or q.bbox[2] > wx1 + 0.1 or q.bbox[3] > wy1 + 0.1 for q in mine):
                continue
            def clear(a, b):
                if a.bbox[0] > b.bbox[2] + g or b.bbox[0] > a.bbox[2] + g or a.bbox[1] > b.bbox[3] + g or b.bbox[1] > a.bbox[3] + g:
                    return True
                if geom.point_in_material(*a.outer[0], b) or geom.point_in_material(*b.outer[0], a):
                    return False
                return min(geom.contour_distance(x, y) for x in a.contours() for y in b.contours()) >= g
            if all(clear(a, b) for a in mine for b in obst + polys):
                ok.append(p)
                polys += mine
        if len(ok) < len(placed):
            self.stats_dropped = getattr(self, "stats_dropped", 0) + len(placed) - len(ok)
        return ok

    def pockets_ok(self) -> bool:
        return self.opt.pockets and all(self.rect_bin(x.bin_type) is not None for x in self.sheets)

    def pocket_round(self, source: str, t: float, tried: set) -> int:
        """One pass over the free pockets of the sheets before the last, the biggest usable first:
        each gets the parts that could fit it (from `source`), solved in a window around it.
        Pockets solved at the same time are on different sheets; a sheet that changed is mapped
        again in the next pass. Pockets that took nothing are not tried again unless their sheet changes."""
        c = self.cell()
        found = []
        for sh in self.sheets[:-1]:
            k = self.index_of(sh)
            avail = self.avail_for(k, source)
            if not avail:
                continue
            smin = min(self.short_side(tid) for tid in avail)
            fp = self.fingerprint(sh)
            for pk in self.freemap(sh).pockets(min_fit=smin - 2 * c):
                key = (id(sh), fp, pk.box)
                if key not in tried:
                    found.append((pk, sh, key))
        found.sort(key=lambda x: (-x[0].fit, -x[0].area))
        moved = 0
        w = max(1, self.opt.workers)
        while found and self.left() > 1.0:
            batch, rest, used = [], [], set()
            for item in found:
                if id(item[1]) in used or len(batch) >= w:
                    rest.append(item)
                else:
                    batch.append(item)
                    used.add(id(item[1]))
            found = rest
            jobs = []
            for pk, sh, key in batch:
                k = self.index_of(sh)
                if k is None or k >= len(self.sheets) - 1 or self.fingerprint(sh) != key[1]:
                    continue
                avail = self.avail_for(k, source)
                cands = Counter({tid: min(n, max(1, int(1.3 * pk.area / max(self.area(tid), 1.0))))
                                 for tid, n in avail.items()
                                 if n > 0 and self.short_side(tid) <= pk.fit + 2 * c and self.area(tid) <= 1.3 * pk.area})
                if not cands:
                    tried.add(key)
                    continue
                jobs.append((sh, key, self.window(sh, pk), cands))
            if not jobs:
                continue
            tt = min(t, max(0.5, self.left()))
            run = lambda j: self.solve("knapsack", j[0].bin_type, [], j[3], tt, bin_json=j[2])
            if w > 1 and len(jobs) > 1:
                with ThreadPoolExecutor(max_workers=w) as ex:
                    results = list(ex.map(run, jobs))
            else:
                results = [run(j) for j in jobs]
            for (sh, key, win, _), placed in zip(jobs, results):
                k = self.index_of(sh)
                if k is None or k >= len(self.sheets) - 1:
                    continue
                placed = self.checked(placed, win)
                avail = self.avail_for(k, source)
                keep, took = [], Counter()
                for p in placed:
                    if took[p.id] < avail[p.id]:
                        keep.append(p)
                        took[p.id] += 1
                if not keep:
                    tried.add(key)
                    continue
                sh.items += keep
                if source == "pool":
                    self.pool -= took
                else:
                    self.take_from_latest(keep, k)
                moved += len(keep)
        return moved

    def step_fill(self):
        """The emptiest sheets first: their gaps get parts from the sheets after them (taken from the
        latest sheet first, so the tail gets shorter and a sheet may go). Rounds repeat while parts move."""
        t = time.perf_counter()
        total = 0
        for _ in range(self.opt.fill_rounds):
            moved = 0
            order = sorted((x for x in self.sheets[:-1] if self.fullness(x) < self.opt.fill_below), key=self.fullness)
            for batch in self.batches(order):
                if self.left() < 1.0:
                    break
                moved += self.fill_batch(batch, "later", self.opt.fill_time)
            total += moved
            if not moved or self.left() < 1.0:
                break
        self.note("fill", time.perf_counter() - t, total)

    def step_empty(self):
        """What a person does by hand: the last sheet's parts into the gaps of the earlier sheets,
        the sheets with the most free area first. When the last sheet goes, the new last one is
        tried too; stops when a sheet stays or the time is up. (fill offers each sheet the parts
        of every later sheet, biggest first; this empties the tail.)"""
        t = time.perf_counter()
        self._empty_runs += 1   # the second run may use the time kept for it
        moved, gone = 0, 0
        while len(self.sheets) > 1 and self.left() > 1.0 and self.pockets_ok():
            last = self.sheets[-1]
            tried: set = set()
            while self.index_of(last) is not None and self.left() > 1.0:
                m = self.pocket_round("last", self.opt.pocket_time, tried)
                moved += m
                if not m:
                    break
            if self.index_of(last) is not None:
                self.note("empty", time.perf_counter() - t, moved)
                return     # the last sheet stays (shorter, maybe): done
            gone += 1
        while len(self.sheets) > 1 and self.left() > 1.0:
            last = self.sheets[-1]
            before = len(last.items)
            order = sorted(self.sheets[:-1], key=self.free_area, reverse=True)
            for batch in self.batches(order):
                if self.index_of(last) is None or self.left() < 1.0:
                    break
                moved += self.fill_batch(batch, "last", self.opt.empty_time)
            if self.index_of(last) is not None:
                break          # the last sheet stays (shorter, maybe): done
            gone += 1
        self.note("empty", time.perf_counter() - t, moved)

    def step_tail(self):
        """The last sheets when their parts could fit on one sheet less: nested again together,
        sheet by sheet (as much as possible on each). Kept only when a sheet goes. The last two
        are tried first (most likely), then three, four; again while sheets go."""
        t = time.perf_counter()
        self._in_tail = True
        done = 0
        size = 2
        while size <= min(4, len(self.sheets)) and self.left_total() > 2.0:
            n = len(self.sheets)
            tail = self.sheets[n - size:]
            if len({x.bin_type for x in tail}) != 1 or sum(self.fullness(x) for x in tail) > (size - 1) * 0.88:
                size += 1
                continue
            bt = tail[0].bin_type
            rest = Counter(p.id for x in tail for p in x.items)
            new: list[Sheet] = []
            for j in range(size - 1):
                if not +rest or self.left_total() < 1.5:
                    break
                tt = min(self.opt.tail_time, max(1.0, self.left_total() - 1.0))
                placed = self.solve("knapsack", bt, [], rest, tt)
                if not placed:
                    break
                new.append(Sheet(bt, placed))
                rest -= Counter(p.id for p in placed)
            if not +rest and len(new) < size:
                self.sheets[n - size:] = new
                done += size - len(new)
                size = 2   # a sheet went: the new last two may merge again
            else:
                size += 1
        self._in_tail = False
        self.note("tail", time.perf_counter() - t, done)

    def step_chain(self):
        t = time.perf_counter()
        total = 0
        for _ in range(self.opt.chain_rounds):
            moved = 0
            for k in range(len(self.sheets) - 2, -1, -1):
                if k >= len(self.sheets) - 1:
                    continue
                later = Counter(p.id for sh in self.sheets[k + 1:] for p in sh.items)
                moved += self.fill(k, later, self.opt.chain_time)
            total += moved
            if not moved or self.left() <= 0:
                break
        self.note("chain", time.perf_counter() - t, total)

    def step_pairs(self):
        t = time.perf_counter()
        changed = 0
        for k in range(len(self.sheets) - 2, -1, -1):
            if self.left() <= 2 * min(self.opt.pair_time, 3.0) or k >= len(self.sheets) - 1:
                break
            a, b = self.sheets[k], self.sheets[k + 1]
            if a.bin_type != b.bin_type:
                continue
            last = k + 1 == len(self.sheets) - 1
            both = Counter(p.id for p in a.items + b.items)
            pt = min(self.opt.pair_time, self.left() / 2)
            first = self.solve("knapsack", a.bin_type, [], both, pt)
            rest = both - Counter(p.id for p in first)
            if not first:
                continue
            if not rest:
                # both sheets fit on one
                self.sheets[k] = Sheet(a.bin_type, first)
                del self.sheets[k + 1]
                changed += 1
                continue
            objective = "open-dimension-x" if last else "knapsack"
            second = self.solve(objective, a.bin_type, [], rest, max(pt, min(self.opt.pair_time, self.left())))
            if Counter(p.id for p in second) != rest:
                continue  # the rest does not fit on one sheet
            new_b = Sheet(b.bin_type, second)
            if last:
                better = self.xmax(new_b) < self.xmax(b) - 1.0
            else:
                better = sum(self.area(p.id) for p in first) > self.sheet_area(a) + 1.0
            if better:
                self.sheets[k], self.sheets[k + 1] = Sheet(a.bin_type, first), new_b
                changed += 1
        self.note("pairs", time.perf_counter() - t, changed)

    def step_compact(self):
        t = time.perf_counter()
        last = self.sheets[-1]
        ids = Counter(p.id for p in last.items)
        new = self.solve("open-dimension-x", last.bin_type, [], ids, max(1.0, min(self.opt.compact_time, self.left_total())))
        done = 0
        if Counter(p.id for p in new) == ids and self.xmax(Sheet(last.bin_type, new)) < self.xmax(last) - 1.0:
            self.sheets[-1] = Sheet(last.bin_type, new)
            done = 1
        self.note("compact", time.perf_counter() - t, done)

    def push_all(self) -> int:
        """Every sheet that changed since it was last pushed: its parts towards 0,0 (the free
        space gathers at the far side, so the next step finds bigger pockets)."""
        if not self.opt.push:
            return 0
        if not hasattr(self, "_pushed"):
            self._pushed = {}
        t = time.perf_counter()
        moves = 0
        for sh in self.sheets:
            box = self.rect_bin(sh.bin_type)
            if box is None or self._pushed.get(id(sh)) == self.fingerprint(sh):
                continue
            edge = float(self.inst["bin_types"][sh.bin_type].get("item_bin_minimum_spacing", 0.0))
            moves += push_sheet(sh.items, self.shapes, box, self.spacing, edge=edge)
            self._pushed[id(sh)] = self.fingerprint(sh)
        dt = time.perf_counter() - t
        self.opt.budget += dt      # on top of the steps' time: they keep all of theirs
        if moves:
            self.note("push", dt, moves)
        return moves

    def run(self) -> dict:
        self.note("start", 0.0, 0)
        steps = []
        if self.opt.gap and len(self.sheets) > 1:
            steps.append(self.step_gap)
        if self.pool:
            steps.append(self.step_pool)
        # the tail first (quick: only the last sheet's parts), then the gaps, then the tail again
        if self.opt.empty and self.opt.empty_first:
            steps.append(self.step_empty)
        if self.opt.fill:
            steps.append(self.step_fill)
        if self.opt.empty:
            steps.append(self.step_empty)
        if self.opt.tail:
            steps.append(self.step_tail)
        # sheet pairs and the chain from what time is left
        if self.opt.pairs:
            steps.append(self.step_pairs)
        if self.opt.chain:
            steps.append(lambda: self.left() > 1.0 and self.step_chain())
        self.push_all()
        for step in steps:
            if len(self.sheets) > 1 or step == self.step_pool:
                step()
                self.push_all()
        if self.opt.compact and self.sheets:
            self.step_compact()
            self.push_all()
        return self.solution()

    def solution(self) -> dict:
        return {"bins": [{"id": sh.bin_type, "copies": 1, "items": [
            {"id": p.id, "x": p.xf.x, "y": p.xf.y, "angle": p.xf.angle, "mirror": p.xf.mirror}
            for p in sh.items]} for sh in self.sheets]}
