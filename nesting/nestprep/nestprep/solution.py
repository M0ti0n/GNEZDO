"""Expand composite solutions to original parts, validate, and measure.

The validator rebuilds every part from the ORIGINAL instance geometry and the
expanded transforms. It does not reuse composite shapes or solver output
geometry, so it independently checks both the solver and the pre-pass.
"""
from __future__ import annotations

import math
from collections import Counter

import numpy as np

from . import geom
from .geom import Xf


def expand(solution: dict, mapping: dict | None, n_orig: int | None = None) -> list[dict]:
    """Return [{'bin_type', 'parts': [{'orig_type', 'xf', 'depth', 'group'}]}]."""
    sheets = []
    for b in solution.get("bins", []):
        for _ in range(int(b.get("copies", 1))):
            parts = []
            for gi, it in enumerate(b["items"]):
                outer = Xf(geom.norm_angle(it["angle"]), bool(it.get("mirror", False)),
                           it["x"], it["y"])
                if mapping is None:
                    parts.append({"orig_type": it["id"], "xf": outer, "depth": 0, "group": gi})
                    continue
                for m in mapping["item_types"][it["id"]]["members"]:
                    inner = Xf(m["angle"], m["mirror"], m["x"], m["y"])
                    parts.append({"orig_type": m["orig_type"], "xf": inner.then(outer),
                                  "depth": m["depth"], "group": gi})
            sheets.append({"bin_type": b["id"], "parts": parts})
    return sheets


def _xf_poly(pts: np.ndarray, xf: Xf) -> np.ndarray:
    p = pts.copy()
    if xf.mirror:
        p[:, 0] = -p[:, 0]
    a = math.radians(xf.angle)
    c, s = geom._cos_sin(xf.angle, a)
    out = np.empty_like(p)
    out[:, 0] = c * p[:, 0] - s * p[:, 1] + xf.x
    out[:, 1] = s * p[:, 0] + c * p[:, 1] + xf.y
    return out


class Geometry:
    """Caches discretised original part shapes."""

    def __init__(self, instance: dict):
        self.inst = instance
        self.shapes = []
        for it in instance["item_types"]:
            shs = it["shapes"] if "shapes" in it else [it]
            self.shapes.append([geom.shape_to_poly(s) for s in shs])
        self.bins = [geom.shape_to_poly(b) if b.get("type", "general") == "general"
                     and "elements" in b else None for b in instance["bin_types"]]

    def placed(self, orig_type: int, xf: Xf) -> list[geom.PolyShape]:
        return [geom.PolyShape(_xf_poly(s.outer, xf), [_xf_poly(h, xf) for h in s.holes])
                for s in self.shapes[orig_type]]

    def bin_rect(self, bt: int):
        b = self.inst["bin_types"][bt]
        if self.bins[bt] is not None:
            return self.bins[bt].bbox
        return (0.0, 0.0, float(b["width"]), float(b["height"]))


def validate(instance: dict, sheets: list[dict], spacing: float | None = None,
             edge: float | None = None, tol: float = 0.1) -> dict:
    g = Geometry(instance)
    params = instance.get("parameters", {})
    s = float(params.get("item_item_minimum_spacing", 0.0)) if spacing is None else spacing
    errors = []
    min_gap = math.inf
    # 1. quantities
    cnt = Counter(p["orig_type"] for sh in sheets for p in sh["parts"])
    for t, it in enumerate(instance["item_types"]):
        want = int(it.get("copies", 1))
        if cnt[t] != want:
            errors.append(f"type #{t + 1}: placed {cnt[t]}, ordered {want}")
    for si, sh in enumerate(sheets):
        bt = sh["bin_type"]
        bx0, by0, bx1, by1 = g.bin_rect(bt)
        e = edge if edge is not None else float(
            instance["bin_types"][bt].get("item_bin_minimum_spacing", 0.0))
        polys = []
        for pi, p in enumerate(sh["parts"]):
            for ps in g.placed(p["orig_type"], p["xf"]):
                polys.append((pi, p, ps, ps.bbox))
        # 2. inside sheet
        for pi, p, ps, b in polys:
            if b[0] < bx0 + e - tol or b[1] < by0 + e - tol or \
               b[2] > bx1 - e + tol or b[3] > by1 - e + tol:
                errors.append(f"sheet {si + 1}: part #{p['orig_type'] + 1} (idx {pi}) "
                              f"outside sheet/edge margin, bbox {tuple(round(v, 1) for v in b)}")
        # 3. pairwise overlap / spacing
        n = len(polys)
        bbs = np.array([q[3] for q in polys])
        for i in range(n):
            pi, p, A, ba = polys[i]
            # candidates whose bbox is within spacing
            near = np.where((bbs[i + 1:, 0] < ba[2] + s) & (bbs[i + 1:, 2] > ba[0] - s) &
                            (bbs[i + 1:, 1] < ba[3] + s) & (bbs[i + 1:, 3] > ba[1] - s))[0] + i + 1
            for j in near:
                pj, q, B, bb = polys[j]
                if pi == pj:
                    continue
                d = min(geom.contour_distance(ca, cb) for ca in A.contours() for cb in B.contours())
                inside = geom.point_in_material(*B.outer[0], A) or \
                    geom.point_in_material(*A.outer[0], B)
                if inside or d == 0.0:
                    errors.append(f"sheet {si + 1}: OVERLAP #{p['orig_type'] + 1} / "
                                  f"#{q['orig_type'] + 1}")
                    min_gap = 0.0
                    continue
                min_gap = min(min_gap, d)
                if d < s - tol:
                    errors.append(f"sheet {si + 1}: spacing {d:.2f} < {s} between "
                                  f"#{p['orig_type'] + 1} / #{q['orig_type'] + 1}")
    return {"ok": not errors, "errors": errors, "min_gap": min_gap,
            "parts": sum(cnt.values())}


def metrics(instance: dict, sheets: list[dict]) -> dict:
    g = Geometry(instance)
    area_parts = 0.0
    per = []
    for sh in sheets:
        bx0, by0, bx1, by1 = g.bin_rect(sh["bin_type"])
        W = bx1 - bx0
        xmax = 0.0
        a = 0.0
        for p in sh["parts"]:
            for ps in g.placed(p["orig_type"], p["xf"]):
                xmax = max(xmax, ps.bbox[2])
                a += ps.area
        area_parts += a
        per.append({"bin_area": (bx1 - bx0) * (by1 - by0), "xmax": xmax, "W": W,
                    "parts_area": a, "parts": len(sh["parts"])})
    n = len(per)
    equiv = (n - 1) + (per[-1]["xmax"] / per[-1]["W"] if n else 0)
    nested_in_holes = sum(1 for sh in sheets for p in sh["parts"] if p["depth"] > 0)
    return {
        "sheets": n,
        "sheet_equivalents": round(equiv, 3),
        "last_sheet_xmax": round(per[-1]["xmax"], 1) if n else 0,
        "utilisation_full_sheets": [round(x["parts_area"] / x["bin_area"], 3) for x in per],
        "parts_in_holes": nested_in_holes,
    }
