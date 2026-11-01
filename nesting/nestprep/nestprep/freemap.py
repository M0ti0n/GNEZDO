"""Free-space map of a nested sheet: where the free pockets are and how big a part each can take.

The improvement steps use it to decide where to try placing more parts; the placing itself is
done by PackingSolver on exact geometry, in a small window around the pocket.

The map is a grid over the sheet's usable area (cell: about the part gap, 5-20 mm, at most a tenth
of the smallest part). A cell is filled when any placed part, grown by the gap, may touch it
(outlines are drawn by cell centres and then grown by the gap plus one cell: on the safe side), so
a free cell really is usable. The holes of parts are free again (shrunk the same way); parts inside
holes are marked like any other part. Pockets are the connected free cells; for each, its area, its
box and the side of the largest square in it (the biggest part it can take, as a first filter).
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from . import geom


@dataclass
class Pocket:
    area: float                 # mm2 (free cells x cell area)
    box: tuple[float, float, float, float]   # x0, y0, x1, y1 in sheet coordinates [mm]
    fit: float                  # side of the largest free square [mm]
    cells: int


def cell_size(gap: float, smallest_part: float | None) -> float:
    c = min(20.0, max(5.0, gap))
    if smallest_part and smallest_part > 0:
        c = min(c, max(5.0, smallest_part / 10.0))
    return c


def _raster(poly: np.ndarray, x0: float, y0: float, cell: float, shape: tuple[int, int]) -> np.ndarray:
    """Cells whose centre is inside the polygon (even-odd rule); grid origin (x0, y0)."""
    H, W = shape
    out = np.zeros(shape, dtype=bool)
    p = np.asarray(poly, dtype=float)
    if len(p) < 3:
        return out
    q = np.roll(p, -1, axis=0)
    r0 = max(0, int((p[:, 1].min() - y0) / cell) - 1)
    r1 = min(H, int((p[:, 1].max() - y0) / cell) + 2)
    ylo, yhi = np.minimum(p[:, 1], q[:, 1]), np.maximum(p[:, 1], q[:, 1])
    dy = q[:, 1] - p[:, 1]
    for r in range(r0, r1):
        y = y0 + (r + 0.5) * cell
        m = (ylo <= y) & (yhi > y)
        if not m.any():
            continue
        xi = np.sort(p[m, 0] + (y - p[m, 1]) * (q[m, 0] - p[m, 0]) / dy[m])
        for k in range(0, len(xi) - 1, 2):
            c0 = max(0, int(math.ceil((xi[k] - x0) / cell - 0.5)))
            c1 = min(W - 1, int(math.floor((xi[k + 1] - x0) / cell - 0.5)))
            if c1 >= c0:
                out[r, c0:c1 + 1] = True
    return out


def _edges(poly: np.ndarray, x0: float, y0: float, cell: float, shape: tuple[int, int], out: np.ndarray):
    """Marks the cells the outline passes through (thin parts between cell centres)."""
    H, W = shape
    p = np.asarray(poly, dtype=float)
    q = np.roll(p, -1, axis=0)
    for (ax, ay), (bx, by) in zip(p, q):
        k = max(2, int(math.hypot(bx - ax, by - ay) / (cell * 0.5)) + 2)
        t = np.linspace(0.0, 1.0, k)
        cx = np.floor((ax + (bx - ax) * t - x0) / cell).astype(int)
        cy = np.floor((ay + (by - ay) * t - y0) / cell).astype(int)
        ok = (cx >= 0) & (cx < W) & (cy >= 0) & (cy < H)
        out[cy[ok], cx[ok]] = True


def _grow(a: np.ndarray, r: int) -> np.ndarray:
    """Square dilation by r cells."""
    if r <= 0:
        return a
    out = a.copy()
    for d in range(1, r + 1):
        out[d:, :] |= a[:-d, :]
        out[:-d, :] |= a[d:, :]
    b = out.copy()
    for d in range(1, r + 1):
        out[:, d:] |= b[:, :-d]
        out[:, :-d] |= b[:, d:]
    return out


def _shrink(a: np.ndarray, r: int) -> np.ndarray:
    return ~_grow(~a, r) if r > 0 else a


def _pockets(free: np.ndarray, d: np.ndarray, x0: float, y0: float, c: float) -> list[Pocket]:
    """Connected free cells (4-neighbour), from runs of free cells per row joined to the runs they
    touch in the row above (union-find over runs, not cells: a few thousand instead of 100 000+)."""
    H, W = free.shape
    runs = []          # (row, c0, c1)
    row_runs = []
    pad = np.zeros((H, W + 2), dtype=np.int8)
    pad[:, 1:-1] = free
    dif = np.diff(pad, axis=1)
    for r in range(H):
        st = np.nonzero(dif[r] == 1)[0]
        en = np.nonzero(dif[r] == -1)[0] - 1
        first = len(runs)
        runs.extend((r, int(a), int(b)) for a, b in zip(st, en))
        row_runs.append((first, len(runs)))
    parent = list(range(len(runs)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    for r in range(1, H):
        i, ie = row_runs[r - 1]
        j, je = row_runs[r]
        while i < ie and j < je:
            _, a0, a1 = runs[i]
            _, b0, b1 = runs[j]
            if a1 >= b0 and b1 >= a0:
                ra, rb = find(i), find(j)
                if ra != rb:
                    parent[max(ra, rb)] = min(ra, rb)
            if a1 < b1:
                i += 1
            else:
                j += 1
    acc: dict[int, list] = {}
    for k, (r, a, b) in enumerate(runs):
        root = find(k)
        e = acc.get(root)
        dm = int(d[r, a:b + 1].max())
        if e is None:
            acc[root] = [b - a + 1, r, r, a, b, dm]
        else:
            e[0] += b - a + 1
            e[1] = min(e[1], r); e[2] = max(e[2], r)
            e[3] = min(e[3], a); e[4] = max(e[4], b)
            e[5] = max(e[5], dm)
    out = [Pocket(area=n * c * c, box=(x0 + c0 * c, y0 + r0 * c, x0 + (c1 + 1) * c, y0 + (r1 + 1) * c),
                  fit=max(0.0, (2 * dm - 1) * c), cells=n)
           for n, r0, r1, c0, c1, dm in acc.values()]
    out.sort(key=lambda p: (-p.fit, -p.area))
    return out


def _cheb(free: np.ndarray) -> np.ndarray:
    """Per free cell: how many times the free area can be shrunk by one cell before it goes
    (Chebyshev distance to the nearest filled cell or the edge); a square of 2d-1 cells fits."""
    d = np.zeros(free.shape, dtype=np.int32)
    cur = free.copy()
    k = 0
    while cur.any():
        k += 1
        d[cur] = k
        nxt = cur.copy()
        nxt[1:, :] &= cur[:-1, :]
        nxt[:-1, :] &= cur[1:, :]
        nxt[:, 1:] &= cur[:, :-1]
        nxt[:, :-1] &= cur[:, 1:]
        nxt[0, :] = False
        nxt[-1, :] = False
        nxt[:, 0] = False
        nxt[:, -1] = False
        b = nxt.copy()
        b[1:, 1:] &= cur[:-1, :-1]
        b[1:, :-1] &= cur[:-1, 1:]
        b[:-1, 1:] &= cur[1:, :-1]
        b[:-1, :-1] &= cur[1:, 1:]
        cur = b
    return d


class FreeMap:
    def __init__(self, bin_shape: dict, placed: list[dict], gap: float, cell: float):
        """bin_shape: the sheet's usable area (instance bin type: a general shape, maybe with defects);
        placed: the shapes on it, in sheet coordinates (each {type, elements, holes?})."""
        bpoly = geom.shape_to_poly(bin_shape)
        x0, y0, x1, y1 = geom.bbox(bpoly.outer)
        self.x0, self.y0, self.cell = x0, y0, cell
        W = max(1, int(math.ceil((x1 - x0) / cell)))
        H = max(1, int(math.ceil((y1 - y0) / cell)))
        shape = (H, W)
        g = int(math.ceil(gap / cell)) + 1
        # outside the sheet's usable area: filled (a cell must lie wholly inside)
        inside = _shrink(_raster(bpoly.outer, x0, y0, cell, shape), 1)
        filled = ~inside
        for d in bin_shape.get("defects", []):
            dp = geom.shape_to_poly(d)
            m = _raster(dp.outer, x0, y0, cell, shape)
            _edges(dp.outer, x0, y0, cell, shape, m)
            filled |= _grow(m, g)
        for s in placed:
            ps = geom.shape_to_poly(s)
            m = _raster(ps.outer, x0, y0, cell, shape)
            _edges(ps.outer, x0, y0, cell, shape, m)
            m = _grow(m, g)
            for h in ps.holes:
                hm = _raster(h, x0, y0, cell, shape)
                m &= ~_shrink(hm, g)
            filled |= m
        self.free = ~filled
        self._pockets: list[Pocket] | None = None

    def pockets(self, min_fit: float = 0.0) -> list[Pocket]:
        if self._pockets is None:
            self._pockets = _pockets(self.free, _cheb(self.free), self.x0, self.y0, self.cell) if self.free.any() else []
        return [p for p in self._pockets if p.fit >= min_fit]

    def zones(self, nx: int = 6, ny: int = 3) -> list[list[int]]:
        """Free % per zone (ny rows of nx), for the run log."""
        H, W = self.free.shape
        out = []
        for r in range(ny):
            row = []
            for c in range(nx):
                z = self.free[r * H // ny:(r + 1) * H // ny, c * W // nx:(c + 1) * W // nx]
                row.append(int(round(100 * z.mean())) if z.size else 0)
            out.append(row)
        return out
