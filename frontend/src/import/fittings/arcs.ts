// FITTINGS: curves as arcs and lines only (no splines: the machines cut arcs). Each arc runs through
// three points on the true curve (both ends and the middle), so the arcs of a chain meet exactly; an
// arc is kept when it stays within `tol` (0.01 mm) of the curve.

import type { Entity, Pt, Role } from "../geometry";

export type P2 = [number, number];

/** A line (no m) or an arc from a through m to b. */
export interface Seg { a: P2; b: P2; m?: P2 }

export const TOL = 0.01;
const MIN_SPAN = 1e-3;

export const seg = (a: P2, b: P2, m?: P2): Seg => (m ? { a, b, m } : { a, b });
export const rev = (s: Seg): Seg => seg(s.b, s.a, s.m);
export const mapSeg = (s: Seg, f: (p: P2) => P2): Seg => seg(f(s.a), f(s.b), s.m && f(s.m));

/** Center and radius of the circle through three points (null: in a line). */
export function circleThrough(a: P2, b: P2, c: P2): { c: P2; r: number } | null {
  const [ax, ay] = a, [bx, by] = b, [cx, cy] = c;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-12) return null;
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
  return { c: [ux, uy], r: Math.hypot(ax - ux, ay - uy) };
}

const lineDev = (a: P2, b: P2, p: P2) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
  return L === 0 ? Math.hypot(p[0] - a[0], p[1] - a[1]) : Math.abs(dx * (p[1] - a[1]) - dy * (p[0] - a[0])) / L;
};

/** The signed sweep (radians, + counterclockwise) of an arc from a through m to b. */
function sweepOf(s: Seg, c: P2): number {
  const ang = (p: P2) => Math.atan2(p[1] - c[1], p[0] - c[0]);
  const a0 = ang(s.a), am = ang(s.m!), a1 = ang(s.b);
  const TAU = 2 * Math.PI, md = (x: number) => ((x % TAU) + TAU) % TAU;
  const ccw = md(a1 - a0);
  return md(am - a0) <= ccw ? ccw : -md(a0 - a1);
}

/** Points along a segment (previews, checks). */
export function sample(s: Seg, n = 16): P2[] {
  if (!s.m) return [s.a, s.b];
  const ci = circleThrough(s.a, s.m, s.b);
  if (!ci) return [s.a, s.b];
  const a0 = Math.atan2(s.a[1] - ci.c[1], s.a[0] - ci.c[0]), sw = sweepOf(s, ci.c);
  return Array.from({ length: n + 1 }, (_, i) => [ci.c[0] + ci.r * Math.cos(a0 + (sw * i) / n), ci.c[1] + ci.r * Math.sin(a0 + (sw * i) / n)] as P2);
}

/** Arcs / lines along y = f(x) from x0 to x1, within tol. */
export function fit(f: (x: number) => number, x0: number, x1: number, tol = TOL, checks = 8): Seg[] {
  const out: Seg[] = [];
  const rec = (a: number, b: number, depth: number) => {
    const pa: P2 = [a, f(a)], pb: P2 = [b, f(b)];
    const m = 0.5 * (a + b), pm: P2 = [m, f(m)];
    const probes: P2[] = [];
    for (let k = 1; k <= checks; k++) { const x = a + ((b - a) * k) / (checks + 1); probes.push([x, f(x)]); }
    if (Math.max(...[...probes, pm].map((p) => lineDev(pa, pb, p))) <= tol) { out.push(seg(pa, pb)); return; }
    let ci = circleThrough(pa, pm, pb);
    if (ci && ci.r > 1000 * Math.hypot(pb[0] - pa[0], pb[1] - pa[1])) ci = null;
    if (ci) {
      const s = seg(pa, pb, pm);
      if (Math.max(...sample(s, checks * 2).map(([x, y]) => Math.abs(y - f(x)))) <= tol) { out.push(s); return; }
    }
    if (b - a < MIN_SPAN || depth > 40) { out.push(ci ? seg(pa, pb, pm) : seg(pa, pb)); return; }
    rec(a, m, depth + 1);
    rec(m, b, depth + 1);
  };
  rec(x0, x1, 0);
  return out;
}

/** Arcs / lines through a dense chain of points on a smooth curve, within tol. */
export function fitPoints(pts: P2[], tol = TOL): Seg[] {
  const out: Seg[] = [];
  const devLine = (i: number, j: number) => { let w = 0; for (let k = i + 1; k < j; k++) w = Math.max(w, lineDev(pts[i], pts[j], pts[k])); return w; };
  const rec = (i: number, j: number) => {
    if (j - i < 2 || devLine(i, j) <= tol) { out.push(seg(pts[i], pts[j])); return; }
    const m = (i + j) >> 1;
    const ci = circleThrough(pts[i], pts[m], pts[j]);
    if (ci && ci.r < 1000 * Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1])) {
      let w = 0;
      for (let k = i + 1; k < j; k++) w = Math.max(w, Math.abs(Math.hypot(pts[k][0] - ci.c[0], pts[k][1] - ci.c[1]) - ci.r));
      if (w <= tol) { out.push(seg(pts[i], pts[j], pts[m])); return; }
    }
    if (j - i === 2) { out.push(seg(pts[i], pts[m]), seg(pts[m], pts[j])); return; }
    rec(i, m);
    rec(m, j);
  };
  rec(0, pts.length - 1);
  return out;
}

/** Fold / scribe marks on a straight line: `length` long, `gap` in from the ends (merged when too short). */
export function marksOnLine(p0: P2, p1: P2, length = 15, gap = 2, ends: "both" | "end" = "both"): [P2, P2][] {
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1], L = Math.hypot(dx, dy);
  if (L <= 2 * gap + 0.5) return [];
  const at = (t: number): P2 => [p0[0] + (dx / L) * t, p0[1] + (dy / L) * t];
  if (ends === "end") return [[at(Math.max(gap, L - gap - length)), at(L - gap)]];
  if (2 * (gap + length) >= L) return [[at(gap), at(L - gap)]];
  return [[at(gap), at(gap + length)], [at(L - gap - length), at(L - gap)]];
}

// ------------------------------------------------------------------ into the importer's lines

/** Lines, arcs and circles of one part, by role; build() turns them into the importer's lines, moved so
 *  the part starts at 0, 0. */
export class Lines {
  private items: { s?: Seg; c?: [P2, number]; role: Role }[] = [];
  segs(list: Seg[], role: Role = "cut") { for (const s of list) this.items.push({ s, role }); return this; }
  circle(c: P2, r: number, role: Role = "cut") { this.items.push({ c: [c, r], role }); return this; }
  marks(list: [P2, P2][], role: Role = "trace") { return this.segs(list.map(([a, b]) => seg(a, b)), role); }
  /** Its size (arcs and circles included). */
  box() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const take = (x: number, y: number) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
    for (const it of this.items) {
      if (it.c) { const [[cx, cy], r] = it.c; take(cx - r, cy - r); take(cx + r, cy + r); }
      else for (const [x, y] of sample(it.s!, 12)) take(x, y);
    }
    return { x0, y0, x1, y1 };
  }
  build(prefix: string): { entities: Entity[]; w: number; h: number } {
    const b = this.box(), dx = -b.x0, dy = -b.y0;
    const P = (p: P2): Pt => ({ x: p[0] + dx, y: p[1] + dy });
    const out: Entity[] = [];
    let n = 0;
    const id = () => `${prefix}${++n}`;
    const norm = (x: number) => ((x % 360) + 360) % 360;
    for (const it of this.items) {
      const role = it.role;
      if (it.c) { out.push({ id: id(), kind: "circle", c: P(it.c[0]), r: it.c[1], role }); continue; }
      const s = it.s!;
      const a = P(s.a), b = P(s.b);
      const ci = s.m && circleThrough(s.a, s.m, s.b);
      if (!s.m || !ci) { if (Math.hypot(b.x - a.x, b.y - a.y) > 1e-9) out.push({ id: id(), kind: "line", a, b, role }); continue; }
      const deg = (p: P2) => (Math.atan2(p[1] - ci.c[1], p[0] - ci.c[0]) * 180) / Math.PI;
      // counterclockwise from start to end: a -> m -> b turning left runs from a, else from b
      const left = (s.m[0] - s.a[0]) * (s.b[1] - s.m[1]) - (s.m[1] - s.a[1]) * (s.b[0] - s.m[0]) > 0;
      out.push({ id: id(), kind: "arc", c: P(ci.c), r: ci.r, start: norm(deg(left ? s.a : s.b)), end: norm(deg(left ? s.b : s.a)), role });
    }
    return { entities: out, w: b.x1 - b.x0, h: b.y1 - b.y0 };
  }
}
