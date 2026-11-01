// Geometry for manual nesting: parts placed on a sheet (sheet frame: mm, y down, 0,0 top-left of the
// sheet as drawn), how far a group of parts can slide before it meets another part or the edge (with
// the gaps), and which parts overlap or come too close.
import { loopsOf, type NestedSheet, type PlacedPart } from "./nest";
import type { Origin } from "./machine";

export type Pt = [number, number];
export interface Box { x0: number; y0: number; x1: number; y1: number }

export const transform = (p: Pick<PlacedPart, "x" | "y" | "angle" | "mirror">) => {
  const a = (p.angle * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return ([x0, y]: Pt): Pt => { const x = p.mirror ? -x0 : x0; return [x * c - y * s + p.x, x * s + y * c + p.y]; };
};

const area = (lp: Pt[]) => lp.reduce((s, p, i) => { const q = lp[(i + 1) % lp.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;

/** A part's outline loops (part frame), the biggest first (the outline), the rest holes. */
const loopCache = new Map<string, Pt[][]>();
export function partLoops(path: string): Pt[][] {
  let l = loopCache.get(path);
  if (!l) {
    l = (loopsOf(path) as Pt[][]).slice().sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)));
    loopCache.set(path, l);
  }
  return l;
}

/** Points along every loop, `step` mm apart (part frame). */
const sampleCache = new Map<string, Pt[]>();
function partSamples(path: string, step = 2): Pt[] {
  const k = `${step}|${path}`;
  let out = sampleCache.get(k);
  if (!out) {
    out = [];
    for (const lp of partLoops(path)) {
      for (let i = 0; i < lp.length; i++) {
        const a = lp[i], b = lp[(i + 1) % lp.length];
        const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
        for (let j = 0; j < n; j++) out.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]);
      }
    }
    sampleCache.set(k, out);
  }
  return out;
}

export interface Placed { loops: Pt[][]; samples: Pt[]; box: Box }

/** A placed part in sheet coordinates. */
export function placed(path: string, p: PlacedPart): Placed {
  const f = transform(p);
  const loops = partLoops(path).map((lp) => lp.map(f));
  const samples = partSamples(path).map(f);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of loops[0] ?? []) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { loops, samples, box: { x0, y0, x1, y1 } };
}

export const unionBox = (bs: Box[]): Box => bs.reduce((u, b) => ({ x0: Math.min(u.x0, b.x0), y0: Math.min(u.y0, b.y0), x1: Math.max(u.x1, b.x1), y1: Math.max(u.y1, b.y1) }),
  { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });

export function pointIn(lp: Pt[], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = lp.length - 1; i < lp.length; j = i++) {
    const [xi, yi] = lp[i], [xj, yj] = lp[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
/** In the part's material: inside its outline, not in a hole. */
export const inMaterial = (q: Placed, x: number, y: number) =>
  !!q.loops[0] && pointIn(q.loops[0], x, y) && !q.loops.slice(1).some((h) => pointIn(h, x, y));

/** The area parts may use: inside the trims (by the machine's axes: X-, Y- at the origin corner). */
export function usableBox(sheet: NestedSheet, origin: Origin): Box {
  const t = sheet.trims ?? { xMinus: 0, xPlus: 0, yMinus: 0, yPlus: 0 };
  const right = origin.endsWith("right"), bottom = origin.startsWith("bottom");
  const l = right ? t.xPlus : t.xMinus, r = right ? t.xMinus : t.xPlus;
  const tp = bottom ? t.yPlus : t.yMinus, b = bottom ? t.yMinus : t.yPlus;
  return { x0: l, y0: tp, x1: sheet.lengthMm - r, y1: sheet.widthMm - b };
}

export type Dir = "up" | "down" | "left" | "right";
const DIRS: Record<Dir, { axis: 0 | 1; sign: 1 | -1 }> = {
  up: { axis: 1, sign: -1 }, down: { axis: 1, sign: 1 }, left: { axis: 0, sign: -1 }, right: { axis: 0, sign: 1 },
};

/**
 * How far points `mov` can go in direction `dir` before one comes within `gap` of a point of `obs`
 * (points `step` apart: the answer is short by up to that much at worst, never too long).
 */
function slidePts(mov: Pt[], obs: Pt[], gap: number, dir: Dir, limit: number): number {
  const { axis, sign } = DIRS[dir], o = 1 - axis;
  let best = limit;
  // only obstacle points in the lane of the moving ones, ahead, within reach
  let lo = Infinity, hi = -Infinity, back = Infinity, front = -Infinity;
  for (const p of mov) { lo = Math.min(lo, p[o]); hi = Math.max(hi, p[o]); const a = p[axis] * sign; back = Math.min(back, a); front = Math.max(front, a); }
  const near = obs.filter((q) => q[o] > lo - gap && q[o] < hi + gap && q[axis] * sign > back - 1e-6 && q[axis] * sign < front + best + gap);
  if (!near.length) return best;
  for (const b of mov) {
    const ab = b[axis] * sign;
    for (const a of near) {
      const d = a[o] - b[o];
      if (d >= gap || d <= -gap) continue;
      const aa = a[axis] * sign;
      if (aa < ab - 1e-6) continue;
      const t = aa - ab - Math.sqrt(gap * gap - d * d);
      // already too close where it is (beside it, not in the way): the slide does not make that worse
      if (t < 0) continue;
      if (t < best) best = t;
    }
  }
  return best;
}

/**
 * Ctrl + direction: how far the group can slide before it meets another part (keeping `gap`) or the
 * edge of the usable area (or of a shaped sheet's outline, keeping `edgeGap`). 0 when it cannot move.
 */
export function slideDistance(group: Placed[], others: Placed[], usable: Box, gap: number, dir: Dir,
  outline?: Pt[][], edgeGap = 0): number {
  const g = unionBox(group.map((q) => q.box));
  let t = dir === "up" ? g.y0 - usable.y0 : dir === "down" ? usable.y1 - g.y1 : dir === "left" ? g.x0 - usable.x0 : usable.x1 - g.x1;
  t = Math.max(0, t);
  const mov = group.flatMap((q) => q.samples);
  const { axis, sign } = DIRS[dir];
  for (const q of others) {
    // can it be in the way at all?
    const o = 1 - axis;
    const glo = o === 0 ? g.x0 : g.y0, ghi = o === 0 ? g.x1 : g.y1;
    const qlo = o === 0 ? q.box.x0 : q.box.y0, qhi = o === 0 ? q.box.x1 : q.box.y1;
    if (qhi < glo - gap || qlo > ghi + gap) continue;
    const gFront = sign > 0 ? (axis === 0 ? g.x1 : g.y1) : -(axis === 0 ? g.x0 : g.y0);
    const qBack = sign > 0 ? (axis === 0 ? q.box.x0 : q.box.y0) : -(axis === 0 ? q.box.x1 : q.box.y1);
    const qFront = sign > 0 ? (axis === 0 ? q.box.x1 : q.box.y1) : -(axis === 0 ? q.box.x0 : q.box.y0);
    if (qFront < gFront - (axis === 0 ? g.x1 - g.x0 : g.y1 - g.y0) - gap) continue;   // wholly behind
    if (qBack > gFront + t + gap) continue;                                            // beyond the reach
    t = Math.min(t, slidePts(mov, q.samples, gap, dir, t));
    if (t <= 0) return 0;
  }
  if (outline?.length) {
    const pts: Pt[] = [];
    for (const lp of outline) for (let i = 0; i < lp.length; i++) {
      const a = lp[i], b = lp[(i + 1) % lp.length];
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2));
      for (let j = 0; j < n; j++) pts.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]);
    }
    t = Math.min(t, slidePts(mov, pts, edgeGap, dir, t));
  }
  return Math.max(0, t - 0.05);
}

/** Sampled distance between two placed parts, looked at only where they are near each other. */
function closeness(a: Placed, b: Placed, gap: number): number {
  const bx = { x0: b.box.x0 - gap, y0: b.box.y0 - gap, x1: b.box.x1 + gap, y1: b.box.y1 + gap };
  const ax = { x0: a.box.x0 - gap, y0: a.box.y0 - gap, x1: a.box.x1 + gap, y1: a.box.y1 + gap };
  const pa = a.samples.filter(([x, y]) => x >= bx.x0 && x <= bx.x1 && y >= bx.y0 && y <= bx.y1);
  if (!pa.length) return Infinity;
  const pb = b.samples.filter(([x, y]) => x >= ax.x0 && x <= ax.x1 && y >= ax.y0 && y <= ax.y1);
  let best = Infinity;
  for (const p of pa) for (const q of pb) {
    const dx = p[0] - q[0], dy = p[1] - q[1];
    const d = dx * dx + dy * dy;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/**
 * Parts that overlap another, come closer than the gap (less a little for the sampling), or reach
 * past the usable area. Indexes into `parts`.
 */
export function problems(parts: Placed[], usable: Box, gap: number, outline?: Pt[][]): Set<number> {
  const bad = new Set<number>();
  const tol = 1.2;   // the samples are 2 mm apart: up to ~1 mm short of the truth
  parts.forEach((q, i) => {
    if (q.box.x0 < usable.x0 - 0.05 || q.box.y0 < usable.y0 - 0.05 || q.box.x1 > usable.x1 + 0.05 || q.box.y1 > usable.y1 + 0.05) bad.add(i);
    if (outline?.length && q.samples.some(([x, y]) => !pointIn(outline[0], x, y) || outline.slice(1).some((h) => pointIn(h, x, y)))) bad.add(i);
  });
  for (let i = 0; i < parts.length; i++) {
    const a = parts[i];
    for (let j = i + 1; j < parts.length; j++) {
      const b = parts[j];
      if (a.box.x0 > b.box.x1 + gap || b.box.x0 > a.box.x1 + gap || a.box.y0 > b.box.y1 + gap || b.box.y0 > a.box.y1 + gap) continue;
      const inside = (a.loops[0] && inMaterial(b, ...a.loops[0][0])) || (b.loops[0] && inMaterial(a, ...b.loops[0][0]));
      if (inside || closeness(a, b, gap) < gap - tol) { bad.add(i); bad.add(j); }
    }
  }
  return bad;
}

/** The group turned by `deg` (positive: clockwise as drawn) about the centre of its box. */
export function rotateGroup(parts: PlacedPart[], boxes: Box[], deg: number): PlacedPart[] {
  const u = unionBox(boxes);
  const cx = (u.x0 + u.x1) / 2, cy = (u.y0 + u.y1) / 2;
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return parts.map((p) => {
    const dx = p.x - cx, dy = p.y - cy;
    return { ...p, x: cx + dx * c - dy * s, y: cy + dx * s + dy * c, angle: (((p.angle + deg) % 360) + 360) % 360 };
  });
}
