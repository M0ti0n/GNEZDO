"""Push the parts of a sheet towards the machine's 0,0 (the engine's 0,0: the origin flips are done
before nesting), so the free space gathers at the far side: bigger pockets for the later steps, a
cleaner remnant.

Parts are taken from the one nearest 0,0 outwards; each slides along -Y, then -X, as far as the gap
to the parts around it and the sheet edge allow; rounds repeat until nothing moves. How far a part
can slide comes from points along the outlines (every `step` mm): for a point b of the moving part
and a point a of another part closer to 0,0 along the slide, with |b_x - a_x| < gap, it may slide
b_y - a_y - sqrt(gap^2 - (b_x - a_x)^2) before those two come too close (and the same with x and y
swapped). The shortest of these, less a small margin for the spacing of the points, is then checked
on the exact outlines before the part moves.
"""
from __future__ import annotations

import math

import numpy as np

from . import geom
from .geom import Xf


def _samples(polys: list, step: float) -> np.ndarray:
    pts = []
    for ps in polys:
        for c in ps.contours():
            q = np.roll(c, -1, axis=0)
            for (ax, ay), (bx, by) in zip(c, q):
                n = max(1, int(math.ceil(math.hypot(bx - ax, by - ay) / step)))
                t = np.arange(n) / n
                pts.append(np.column_stack([ax + (bx - ax) * t, ay + (by - ay) * t]))
    return np.vstack(pts) if pts else np.zeros((0, 2))


def _bbox(polys):
    bs = [p.bbox for p in polys]
    return (min(b[0] for b in bs), min(b[1] for b in bs), max(b[2] for b in bs), max(b[3] for b in bs))


def _slide(B: np.ndarray, A: np.ndarray, gap: float, axis: int, limit: float = math.inf) -> float:
    """How far points B may move towards -axis before coming within `gap` of points A (at most
    `limit`: points of A further away than that cannot make it shorter, and are left out)."""
    o = 1 - axis
    best = limit
    if len(A) == 0 or len(B) == 0:
        return best
    # A: only points in B's lane, in front of B, and within reach
    m = (A[:, o] > B[:, o].min() - gap) & (A[:, o] < B[:, o].max() + gap) & (A[:, axis] < B[:, axis].max())
    if math.isfinite(limit):
        m &= A[:, axis] > B[:, axis].min() - limit - gap
    A = A[m]
    if len(A) == 0:
        return best
    # B: only points in A's lane
    B = B[(B[:, o] > A[:, o].min() - gap) & (B[:, o] < A[:, o].max() + gap)]
    for i in range(0, len(B), 512):
        b = B[i:i + 512]
        d = b[:, None, o] - A[None, :, o]
        m = (np.abs(d) < gap) & (A[None, :, axis] < b[:, None, axis] + 1e-9)
        if not m.any():
            continue
        t = b[:, None, axis] - A[None, :, axis] - np.sqrt(np.maximum(gap * gap - d * d, 0.0))
        best = min(best, float(t[m].min()))
    return best


def _near_distance(p: np.ndarray, q: np.ndarray, gap: float) -> float:
    """Exact distance between two outlines when it is under `gap` (else inf): only the edges that
    lie within `gap` of the other outline's box can be that close, the rest is left out."""
    def edges_near(c, box):
        a, b = c, np.roll(c, -1, axis=0)
        lo = np.minimum(a, b)
        hi = np.maximum(a, b)
        m = (hi[:, 0] > box[0] - gap) & (lo[:, 0] < box[2] + gap) & (hi[:, 1] > box[1] - gap) & (lo[:, 1] < box[3] + gap)
        return a[m], b[m]
    qb = (q[:, 0].min(), q[:, 1].min(), q[:, 0].max(), q[:, 1].max())
    a0, a1 = edges_near(p, qb)
    if not len(a0):
        return math.inf
    pts = np.vstack([a0, a1])
    pb = (pts[:, 0].min(), pts[:, 1].min(), pts[:, 0].max(), pts[:, 1].max())
    b0, b1 = edges_near(q, pb)
    if not len(b0):
        return math.inf
    best = math.inf
    for i in range(0, len(a0), 400):
        for j in range(0, len(b0), 400):
            best = min(best, geom._seg_seg_min_dist(a0[i:i + 400], a1[i:i + 400], b0[j:j + 400], b1[j:j + 400]))
            if best == 0.0:
                return 0.0
    return best


def _top(polys: list) -> list:
    """The outer outlines of the shapes not inside another shape of the same item (a host with the
    parts in its holes: just the host's outline)."""
    out = []
    for i, p in enumerate(polys):
        b = p.bbox
        if not any(j != i and q.bbox[0] <= b[0] and q.bbox[1] <= b[1] and q.bbox[2] >= b[2] and q.bbox[3] >= b[3]
                   and (q.bbox != b or j < i) for j, q in enumerate(polys)):
            out.append(geom.PolyShape(p.outer, []))
    return out


def _inside_box(a, b) -> bool:
    return b[0] <= a[0] and b[1] <= a[1] and b[2] >= a[2] and b[3] >= a[3]


def _clear(mine: list, others: list, gap: float) -> bool:
    for a in mine:
        for b in others:
            if a.bbox[0] > b.bbox[2] + gap or b.bbox[0] > a.bbox[2] + gap or \
               a.bbox[1] > b.bbox[3] + gap or b.bbox[1] > a.bbox[3] + gap:
                continue
            if geom.point_in_material(*a.outer[0], b) or geom.point_in_material(*b.outer[0], a):
                return False
            if min(_near_distance(x, y, gap) for x in a.contours() for y in b.contours()) < gap - 0.01:
                return False
    return True


def push_sheet(items: list, shapes_of, bin_box: tuple[float, float, float, float], gap: float,
               edge: float = 0.0, step: float = 3.0, rounds: int = 4, min_move: float = 0.5) -> int:
    """Pushes the placed items (objects with .id and .xf, changed in place) towards 0,0 inside
    bin_box (x0, y0, x1, y1; the usable area, `edge` kept from it). Returns how many moves."""
    n = len(items)
    if n == 0:
        return 0
    polys = [[geom.shape_to_poly(geom.transform_shape(s, it.xf)) for s in shapes_of(it.id)] for it in items]
    tops = [_top(p) for p in polys]
    pts = [_samples(p, step) for p in polys]          # every outline (one item inside another)
    tpts = [_samples(p, step) for p in tops]          # outer outlines only (side by side: most pairs)
    boxes = [_bbox(p) for p in polys]
    nested = lambda i, j: _inside_box(boxes[i], boxes[j]) or _inside_box(boxes[j], boxes[i])
    margin = step * 0.5 + 0.2          # the points are up to step/2 apart along an edge
    moves = 0
    for _ in range(rounds):
        moved_round = 0
        order = sorted(range(n), key=lambda i: boxes[i][0] + boxes[i][1])
        for i in order:
            for axis in (1, 0):        # -Y first, then -X
                bx0, by0, bx1, by1 = boxes[i]
                lo = (bx0, by0)[axis] - ((bin_box[0], bin_box[1])[axis] + edge)
                if lo < min_move:
                    continue
                # parts that the slide may run into: overlapping across the slide, nearer 0,0
                o0, o1 = (bx0, bx1) if axis == 1 else (by0, by1)
                near = [j for j in range(n) if j != i
                        and (boxes[j][0 if axis == 1 else 1] < o1 + gap) and (boxes[j][2 if axis == 1 else 3] > o0 - gap)
                        and boxes[j][axis] < (by1 if axis == 1 else bx1)]
                t = lo
                # the nearest first: the slide gets short early and the rest is quick to rule out
                near.sort(key=lambda j: (by0 if axis == 1 else bx0) - boxes[j][2 + axis])
                for j in near:
                    if t < min_move:
                        break
                    if (by0 if axis == 1 else bx0) - boxes[j][2 + axis] >= t + gap:
                        continue       # its far side is further than the slide: cannot stop it
                    if nested(i, j):
                        t = min(t, _slide(pts[i], pts[j], gap, axis, t))
                    else:
                        t = min(t, _slide(tpts[i], tpts[j], gap, axis, t))
                t -= margin if t < lo else 0.0
                if t < min_move:
                    continue
                # exactly, before moving (back off once if the points were too sparse)
                for tt in (t, t - 2.0):
                    if tt < min_move:
                        break
                    dx, dy = (0.0, -tt) if axis == 1 else (-tt, 0.0)
                    mine = [geom.shape_to_poly(geom.transform_shape(s, Xf(items[i].xf.angle, items[i].xf.mirror,
                                                                       items[i].xf.x + dx, items[i].xf.y + dy)))
                            for s in shapes_of(items[i].id)]
                    mbox = _bbox(mine)
                    mtop = _top(mine)
                    ok = True
                    for j in near:
                        if _inside_box(mbox, boxes[j]) or _inside_box(boxes[j], mbox):
                            ok = _clear(mine, polys[j], gap)
                        else:
                            ok = _clear(mtop, tops[j], gap)
                        if not ok:
                            break
                    if ok:
                        it = items[i]
                        it.xf = Xf(it.xf.angle, it.xf.mirror, it.xf.x + dx, it.xf.y + dy)
                        polys[i] = mine
                        tops[i] = mtop
                        pts[i] = pts[i] + [dx, dy]
                        tpts[i] = tpts[i] + [dx, dy]
                        boxes[i] = mbox
                        moved_round += 1
                        break
        moves += moved_round
        if not moved_round:
            break
    return moves
