"""Common cut blocks: copies of one part joined along their marked common edges, before the nest.

A part's common edges are straight lines of its outline the user marked in the importer (Common
cut tool). Two copies are joined when one copy's marked edge lies on the other's, `kerf` apart
(the shared line is cut once, down the middle). The block is then nested like any part with the
normal part gap, and split back into its copies afterwards (solution.expand).

Ways to join copies of one part:
  shift  two marked edges facing opposite ways, of the same length (a strip's two long sides):
         the next copy is the same part moved across, so a row of any length can be made;
         two shifts that are not parallel give a grid (a rectangle marked on all four sides)
  turn   one marked edge: the second copy turned 180 degrees about the edge's middle (a pair only)
A join is kept only when the copies keep the part gap everywhere except along the shared edge.

Block sizes: `share` of the largest block that fits a sheet (1: as big as fits; 0.5: half; ...);
copies left over make one smaller block, a single leftover copy is nested on its own.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from . import geom
from .geom import Xf

MIN_EDGE = 10.0      # shorter marked edges are ignored [mm]
SAME = 0.5           # edges this close in length and position are the same [mm]


@dataclass
class Join:
    kind: str                     # shift | turn
    xf: Xf                        # a copy -> its neighbour
    length: float                 # length of the shared line [mm]


def _unit(a, b):
    d = np.subtract(b, a, dtype=float)
    L = float(np.hypot(*d))
    return d / L if L > 0 else d, L


def _outward(outer: np.ndarray, a, b) -> np.ndarray | None:
    """Unit normal of segment a-b pointing out of the outline (None: not on the outside)."""
    d, L = _unit(a, b)
    if L <= 0:
        return None
    n = np.array([d[1], -d[0]])
    m = (np.asarray(a, float) + np.asarray(b, float)) / 2
    eps = 0.3
    out_a = not geom.point_in_polygon(*(m + n * eps), outer)
    out_b = not geom.point_in_polygon(*(m - n * eps), outer)
    if out_a and not out_b:
        return n
    if out_b and not out_a:
        return -n
    return None   # both sides empty or full: a window edge, a slit, or not on the outline


def _samples(contour: np.ndarray, step: float = 2.0) -> np.ndarray:
    pts = []
    n = len(contour)
    for i in range(n):
        a, b = contour[i], contour[(i + 1) % n]
        L = float(np.hypot(*(b - a)))
        k = max(1, int(math.ceil(L / step)))
        for j in range(k):
            pts.append(a + (b - a) * (j / k))
    return np.array(pts) if pts else np.zeros((0, 2))


def _pt_seg_dist(pts: np.ndarray, a, b) -> np.ndarray:
    a, b = np.asarray(a, float), np.asarray(b, float)
    d = b - a
    L2 = float(d @ d) or 1e-18
    t = np.clip(((pts - a) @ d) / L2, 0, 1)
    return np.hypot(*(pts - (a + t[:, None] * d)).T)


def _pt_contour_dist(pts: np.ndarray, contour: np.ndarray, chunk: int = 2000) -> np.ndarray:
    out = np.full(len(pts), np.inf)
    s0, s1 = contour, np.roll(contour, -1, axis=0)
    d = s1 - s0
    L2 = np.einsum("ij,ij->i", d, d)
    L2[L2 == 0] = 1e-18
    for i in range(0, len(pts), chunk):
        p = pts[i:i + chunk]
        w = p[:, None, :] - s0[None, :, :]
        t = np.clip(np.einsum("nmj,mj->nm", w, d) / L2[None, :], 0, 1)
        proj = s0[None, :, :] + t[..., None] * d[None, :, :]
        out[i:i + chunk] = np.sqrt(((p[:, None, :] - proj) ** 2).sum(-1)).min(1)
    return out


def _place(poly: geom.PolyShape, xf: Xf) -> geom.PolyShape:
    def f(c):
        return np.array([xf.apply(x, y) for x, y in c])
    return geom.PolyShape(f(poly.outer), [f(h) for h in poly.holes])


def clear_of(a: geom.PolyShape, b: geom.PolyShape, gap: float, shared=None, only_overlap: bool = False) -> bool:
    """Do two placed copies keep the part gap (and never overlap), except near the shared line?"""
    for p, q in ((a, b), (b, a)):
        pts = np.vstack([_samples(c) for c in p.contours()])
        if shared is not None:
            # the shared line and what is within the gap of it (the corners next to it)
            pts = pts[_pt_seg_dist(pts, *shared) > gap + 0.05]
        if not len(pts):
            continue
        # a copy's points inside the other (a few: an overlap shows on many)
        if any(geom.point_in_material(x, y, q) for x, y in pts[:: max(1, len(pts) // 400)]):
            return False
        if only_overlap:
            continue
        d = min(float(_pt_contour_dist(pts, c).min()) for c in q.contours())
        if d < gap - 0.05:
            return False
    return True


def joins(poly: geom.PolyShape, edges: list, kerf: float, gap: float) -> list[Join]:
    """Ways to join two copies of the part along its marked edges (part frame), best first."""
    outer = poly.outer
    marked = []
    for e in edges:
        a, b = (float(e[0]), float(e[1])), (float(e[2]), float(e[3]))
        _, L = _unit(a, b)
        n = _outward(outer, a, b) if L >= MIN_EDGE else None
        if n is not None:
            marked.append((np.array(a), np.array(b), n, L))
    out: list[Join] = []
    seen = []
    # shifts: two edges facing opposite ways, same length, lined up across the part
    for i, (a1, b1, n1, L1) in enumerate(marked):
        for j, (a2, b2, n2, L2) in enumerate(marked):
            if i == j or abs(L1 - L2) > SAME or float(n1 @ n2) > -0.999:
                continue
            m1, m2 = (a1 + b1) / 2, (a2 + b2) / 2
            t = m1 - m2 + n1 * kerf
            # the moved edge must lie on the first one (not only parallel to it)
            d1, _ = _unit(a1, b1)
            if abs(float((m2 + t - m1) @ d1)) > SAME:
                continue
            if any(np.allclose(t, s, atol=0.01) or np.allclose(t, -s, atol=0.01) for s in seen):
                continue
            xf = Xf(0.0, False, float(t[0]), float(t[1]))
            if clear_of(poly, _place(poly, xf), gap, shared=(a1, b1)) and \
               clear_of(poly, _place(poly, Xf(0.0, False, float(2 * t[0]), float(2 * t[1]))), gap):
                seen.append(t)
                out.append(Join("shift", xf, L1))
    # turns: one edge, the second copy turned 180 degrees about its middle (pairs only)
    for a, b, n, L in marked:
        m = (a + b) / 2
        xf = Xf(180.0, False, float(2 * m[0] + n[0] * kerf), float(2 * m[1] + n[1] * kerf))
        if clear_of(poly, _place(poly, xf), gap, shared=(a, b)):
            out.append(Join("turn", xf, L))
    out.sort(key=lambda j: (j.kind != "shift", -j.length))
    return out


@dataclass
class Layout:
    """How copies of one part are joined: a row (one shift), a grid (two shifts) or a turned pair."""
    kind: str                       # row | grid | pair
    steps: list                     # the joins used

    def offsets(self, a: int, b: int = 1) -> list[Xf]:
        """Transforms of the copies of an a (x b) block, in the first copy's frame."""
        if self.kind == "pair":
            return [Xf(), self.steps[0].xf]
        t1 = self.steps[0].xf
        t2 = self.steps[1].xf if self.kind == "grid" else Xf()
        return [Xf(0.0, False, i * t1.x + j * t2.x, i * t1.y + j * t2.y) for j in range(b) for i in range(a)]

    def shared_lines(self, a: int, b: int = 1) -> int:
        if self.kind == "pair":
            return 1
        return (a - 1) * b + (a * (b - 1) if self.kind == "grid" else 0)


def layout_of(poly: geom.PolyShape, edges: list, kerf: float, gap: float) -> Layout | None:
    js = joins(poly, edges, kerf, gap)
    shifts = [j for j in js if j.kind == "shift"]
    if shifts:
        s1 = shifts[0]
        for s2 in shifts[1:]:
            cross = s1.xf.x * s2.xf.y - s1.xf.y * s2.xf.x
            if abs(cross) < 1e-6:
                continue
            # the corner neighbours of a grid only touch at a point: they must not overlap
            ok = all(clear_of(poly, _place(poly, Xf(0.0, False, s1.xf.x + k * s2.xf.x, s1.xf.y + k * s2.xf.y)),
                              gap, only_overlap=True) for k in (1, -1))
            if ok:
                return Layout("grid", [s1, s2])
        return Layout("row", [s1])
    turns = [j for j in js if j.kind == "turn"]
    return Layout("pair", [turns[0]]) if turns else None
