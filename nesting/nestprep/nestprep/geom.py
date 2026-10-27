"""Geometry helpers for PackingSolver irregular JSON shapes.

Only numpy is required. Shapes are kept in PackingSolver's element format
(LineSegment / CircularArc) for output, and discretised into polygons for
measurement and validation.

Transform convention (matches PackingSolver irregular, see
Instance::item_shape_orig and Solution::shape_scaled):
    1. mirror  -> x := -x            (axial symmetry about the Y axis)
    2. rotate  -> counter-clockwise by `angle` degrees about the origin
    3. shift   -> + (x, y)           (called "bl_corner" in the solver)
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

ARC_TOL = 0.05  # max chord sagitta when discretising arcs [mm]


# --------------------------------------------------------------------------
# Transform
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class Xf:
    """Placement transform: mirror, then rotate by angle (deg), then shift."""
    angle: float = 0.0
    mirror: bool = False
    x: float = 0.0
    y: float = 0.0

    def apply(self, px: float, py: float) -> tuple[float, float]:
        if self.mirror:
            px = -px
        a = math.radians(self.angle)
        c, s = _cos_sin(self.angle, a)
        return (c * px - s * py + self.x, s * px + c * py + self.y)

    def then(self, outer: "Xf") -> "Xf":
        """Compose: first self, then outer. Returns a single equivalent Xf."""
        tx, ty = self.x, self.y
        if outer.mirror:
            tx = -tx
        a = math.radians(outer.angle)
        c, s = _cos_sin(outer.angle, a)
        nx = c * tx - s * ty + outer.x
        ny = s * tx + c * ty + outer.y
        ang = outer.angle + (-self.angle if outer.mirror else self.angle)
        return Xf(norm_angle(ang), self.mirror != outer.mirror, nx, ny)

    def to_json(self) -> dict:
        return {"angle": self.angle, "mirror": self.mirror, "x": self.x, "y": self.y}


def _cos_sin(deg: float, rad: float) -> tuple[float, float]:
    d = deg % 360
    exact = {0: (1.0, 0.0), 90: (0.0, 1.0), 180: (-1.0, 0.0), 270: (0.0, -1.0)}
    if d in exact:
        return exact[d]
    return math.cos(rad), math.sin(rad)


def norm_angle(a: float) -> float:
    a = a % 360.0
    if abs(a - 360.0) < 1e-9:
        a = 0.0
    return round(a, 9)


# --------------------------------------------------------------------------
# Elements (PackingSolver JSON) <-> transforms
# --------------------------------------------------------------------------

def _pt(p):
    return (float(p["x"]), float(p["y"]))


def elements_from_solution(sol_elems: list[dict]) -> list[dict]:
    """Convert solution-file element format (xs, ys, xe, ...) to instance format."""
    out = []
    for e in sol_elems:
        ne = {"type": e["type"],
              "start": {"x": e["xs"], "y": e["ys"]},
              "end": {"x": e["xe"], "y": e["ye"]}}
        if e["type"] == "CircularArc":
            ne["center"] = {"x": e["xc"], "y": e["yc"]}
            ne["orientation"] = e["orientation"]
        out.append(ne)
    return out


def transform_elements(elems: list[dict], xf: Xf) -> list[dict]:
    """Transform a closed element list the same way the solver does.

    Mirroring reverses the contour direction, so (like the solver's shape
    library) element order is reversed and start/end are swapped; the arc
    orientation flag is unchanged.
    """
    src = list(reversed(elems)) if xf.mirror else elems
    out = []
    for e in src:
        s, en = _pt(e["start"]), _pt(e["end"])
        if xf.mirror:
            s, en = en, s
        ns = xf.apply(*s)
        ne_ = xf.apply(*en)
        ne = {"type": e["type"],
              "start": {"x": _r(ns[0]), "y": _r(ns[1])},
              "end": {"x": _r(ne_[0]), "y": _r(ne_[1])}}
        if e["type"] == "CircularArc":
            c = xf.apply(*_pt(e["center"]))
            ne["center"] = {"x": _r(c[0]), "y": _r(c[1])}
            ne["orientation"] = e["orientation"]
        out.append(ne)
    return out


def transform_shape(shape: dict, xf: Xf) -> dict:
    """Transform a {type, elements, holes} shape dict."""
    out = {"type": "general", "elements": transform_elements(shape["elements"], xf)}
    if shape.get("holes"):
        out["holes"] = [{"type": "general",
                         "elements": transform_elements(h["elements"], xf)}
                        for h in shape["holes"]]
    return out


def _r(v: float) -> float:
    return round(v, 6)


# --------------------------------------------------------------------------
# Discretisation
# --------------------------------------------------------------------------

def _arc_points(s, e, c, orientation, tol=ARC_TOL):
    r = math.hypot(s[0] - c[0], s[1] - c[1])
    a0 = math.atan2(s[1] - c[1], s[0] - c[0])
    a1 = math.atan2(e[1] - c[1], e[0] - c[0])
    if orientation == "Full":
        sweep = 2 * math.pi
    elif orientation in ("CounterClockwise", "Anticlockwise"):
        sweep = (a1 - a0) % (2 * math.pi)
        if sweep < 1e-12:
            sweep = 2 * math.pi
    else:  # Clockwise
        sweep = -((a0 - a1) % (2 * math.pi))
        if abs(sweep) < 1e-12:
            sweep = -2 * math.pi
    if r < 1e-9:
        return [s]
    # segments so that sagitta <= tol
    step = 2 * math.acos(max(-1.0, min(1.0, 1 - tol / r))) if tol < r else math.pi / 4
    n = max(4 if orientation == "Full" else 1, int(math.ceil(abs(sweep) / max(step, 1e-6))))
    return [(c[0] + r * math.cos(a0 + sweep * i / n),
             c[1] + r * math.sin(a0 + sweep * i / n)) for i in range(n)]


def elements_to_polygon(elems: list[dict], tol=ARC_TOL) -> np.ndarray:
    """Closed element list -> (N, 2) polygon (last vertex not repeated)."""
    pts = []
    for e in elems:
        s = _pt(e["start"])
        if e["type"] == "LineSegment":
            pts.append(s)
        elif e["type"] == "CircularArc":
            pts.extend(_arc_points(s, _pt(e["end"]), _pt(e["center"]),
                                   e.get("orientation", "CounterClockwise"), tol))
        else:
            raise ValueError(f"unsupported element type {e['type']}")
    poly = np.asarray(pts, dtype=float)
    # drop consecutive duplicates
    if len(poly) > 1:
        keep = np.ones(len(poly), bool)
        d = np.linalg.norm(np.diff(poly, axis=0, append=poly[:1]), axis=1)
        keep[1:] = d[:-1] > 1e-9
        poly = poly[keep]
    return poly


def polygon_area(p: np.ndarray) -> float:
    x, y = p[:, 0], p[:, 1]
    return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(np.roll(x, -1), y))


def ccw(p: np.ndarray) -> np.ndarray:
    return p if polygon_area(p) >= 0 else p[::-1].copy()


def bbox(p: np.ndarray) -> tuple[float, float, float, float]:
    return (float(p[:, 0].min()), float(p[:, 1].min()),
            float(p[:, 0].max()), float(p[:, 1].max()))


@dataclass
class PolyShape:
    """Discretised shape with holes."""
    outer: np.ndarray
    holes: list[np.ndarray]

    @property
    def area(self) -> float:
        return abs(polygon_area(self.outer)) - sum(abs(polygon_area(h)) for h in self.holes)

    @property
    def bbox(self):
        return bbox(self.outer)

    def contours(self) -> list[np.ndarray]:
        return [self.outer] + self.holes


def shape_to_poly(shape: dict, tol=ARC_TOL) -> PolyShape:
    return PolyShape(elements_to_polygon(shape["elements"], tol),
                     [elements_to_polygon(h["elements"], tol) for h in shape.get("holes", [])])


def polygon_to_elements(p: np.ndarray) -> list[dict]:
    n = len(p)
    return [{"type": "LineSegment",
             "start": {"x": _r(p[i, 0]), "y": _r(p[i, 1])},
             "end": {"x": _r(p[(i + 1) % n, 0]), "y": _r(p[(i + 1) % n, 1])}}
            for i in range(n)]


# --------------------------------------------------------------------------
# Predicates used by the validator
# --------------------------------------------------------------------------

def point_in_polygon(px: float, py: float, poly: np.ndarray) -> bool:
    x, y = poly[:, 0], poly[:, 1]
    x2, y2 = np.roll(x, -1), np.roll(y, -1)
    cond = (y > py) != (y2 > py)
    with np.errstate(divide="ignore", invalid="ignore"):
        xint = x + (py - y) * (x2 - x) / (y2 - y)
    return bool(np.count_nonzero(cond & (px < xint)) % 2)


def point_in_material(px: float, py: float, s: PolyShape) -> bool:
    if not point_in_polygon(px, py, s.outer):
        return False
    return not any(point_in_polygon(px, py, h) for h in s.holes)


def _segments(p: np.ndarray):
    return p, np.roll(p, -1, axis=0)


def _seg_seg_min_dist(a0, a1, b0, b1) -> float:
    """Min distance between every segment of set A and set B (vectorised).

    a0, a1: (n, 2); b0, b1: (m, 2). Returns the global minimum (0 when any
    pair of segments crosses).
    """
    # point-to-segment distances in both directions
    def p2s(p, s0, s1):
        d = s1 - s0  # (m,2)
        L2 = np.einsum("ij,ij->i", d, d)
        L2[L2 == 0] = 1e-18
        # p (n,2) vs segments (m,2)
        w = p[:, None, :] - s0[None, :, :]
        t = np.clip(np.einsum("nmj,mj->nm", w, d) / L2[None, :], 0, 1)
        proj = s0[None, :, :] + t[..., None] * d[None, :, :]
        return np.sqrt(((p[:, None, :] - proj) ** 2).sum(-1)).min()

    dmin = min(p2s(a0, b0, b1), p2s(b0, a0, a1))
    if dmin < 1e-9:
        return 0.0
    # proper crossings
    def orient(p, q, r):
        return (q[..., 0] - p[..., 0]) * (r[..., 1] - p[..., 1]) - \
               (q[..., 1] - p[..., 1]) * (r[..., 0] - p[..., 0])
    A0, A1 = a0[:, None, :], a1[:, None, :]
    B0, B1 = b0[None, :, :], b1[None, :, :]
    o1, o2 = orient(A0, A1, B0), orient(A0, A1, B1)
    o3, o4 = orient(B0, B1, A0), orient(B0, B1, A1)
    if np.any((o1 * o2 < 0) & (o3 * o4 < 0)):
        return 0.0
    return float(dmin)


def contour_distance(p: np.ndarray, q: np.ndarray, chunk=400) -> float:
    a0, a1 = _segments(p)
    b0, b1 = _segments(q)
    best = math.inf
    for i in range(0, len(a0), chunk):
        for j in range(0, len(b0), chunk):
            best = min(best, _seg_seg_min_dist(a0[i:i + chunk], a1[i:i + chunk],
                                               b0[j:j + chunk], b1[j:j + chunk]))
            if best == 0.0:
                return 0.0
    return best


def bbox_gap(b1, b2) -> float:
    dx = max(b2[0] - b1[2], b1[0] - b2[2], 0.0)
    dy = max(b2[1] - b1[3], b1[1] - b2[3], 0.0)
    return math.hypot(dx, dy)
