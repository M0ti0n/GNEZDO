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
from collections import Counter
from dataclasses import dataclass, field

from . import geom, psrun
from .geom import Xf


@dataclass
class PostOptions:
    gap: bool = False            # step 1; the chain's first round does the same (kept for adding parts)
    chain: bool = True
    pairs: bool = True
    compact: bool = True
    gap_time: float = 2.0        # per sheet
    chain_time: float = 2.0      # per sheet and round
    chain_rounds: int = 4
    pair_time: float = 8.0       # per solve (two per pair)
    compact_time: float = 5.0
    budget: float = 120.0        # whole post-pass [s]; steps stop when it runs out
    quiet: bool = False


@dataclass
class Placed:
    id: int        # item type of the instance that was nested (composite or original)
    xf: Xf


@dataclass
class Sheet:
    bin_type: int
    items: list[Placed] = field(default_factory=list)


class PostPass:
    def __init__(self, instance: dict, solution: dict, binary: str, opt: PostOptions | None = None):
        """`instance` is the instance that was nested (the pre-processed one when the pre-pass ran)."""
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
        self.log: list[dict] = []
        self.t0 = time.perf_counter()

    # -- helpers -------------------------------------------------------------
    def say(self, msg: str):
        if not self.opt.quiet:
            print(f"  [post {time.perf_counter() - self.t0:5.1f}s] {msg}", flush=True)

    def left(self) -> float:
        """Time left for the steps before the compaction (its time is kept aside)."""
        reserve = self.opt.compact_time if self.opt.compact else 0.0
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

    def bin_json(self, bt: int, obstacles: list[Placed]) -> dict:
        b = copy.deepcopy(self.inst["bin_types"][bt])
        b["copies"] = 1
        b.pop("copies_min", None)
        b.pop("cost", None)
        defects = list(b.get("defects", []))
        for p in obstacles:
            for s in self.shapes(p.id):
                d = geom.transform_shape(s, p.xf)
                d["item_defect_minimum_spacing"] = self.spacing
                defects.append(d)
        if defects:
            b["defects"] = defects
        return b

    def solve(self, objective: str, bt: int, obstacles: list[Placed], cands: Counter, t: float) -> list[Placed]:
        """Places as many of `cands` as it can (knapsack) or all of them (open-dimension-x)."""
        ids = sorted(cands)
        inst = {
            "objective": objective,
            "parameters": dict(self.inst.get("parameters", {})),
            "bin_types": [self.bin_json(bt, obstacles)],
            "item_types": [self.item_json(tid, cands[tid]) for tid in ids],
        }
        try:
            r = psrun.solve(inst, self.bin, max(0.2, t), "anytime")
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

    def run(self) -> dict:
        self.note("start", 0.0, 0)
        if self.opt.gap and len(self.sheets) > 1:
            self.step_gap()
        # sheet pairs first: on the test jobs they gave most of the gain, the chain after them
        # uses the gaps they open; the chain alone rarely shortened the last sheet
        if self.opt.pairs and len(self.sheets) > 1:
            self.step_pairs()
        if self.opt.chain and len(self.sheets) > 1 and self.left() > 1.0:
            self.step_chain()
        if self.opt.compact and self.sheets:
            self.step_compact()
        return self.solution()

    def solution(self) -> dict:
        return {"bins": [{"id": sh.bin_type, "copies": 1, "items": [
            {"id": p.id, "x": p.xf.x, "y": p.xf.y, "angle": p.xf.angle, "mirror": p.xf.mirror}
            for p in sh.items]} for sh in self.sheets]}
