// Drawing on the importer canvas: snapping (ends, middles, centers, quadrants, crossings, perpendicular,
// tangent), aid lines (endless construction lines), and the shapes and edits of the drawing tools
// (slot, offset, radius / chamfer at a corner, joining two lines at their crossing).
// Aid lines and dimensions are kept with the part but only shown and used here: never cut, never nested.

import type { Measure } from "./measure";
import type { Entity, Pt } from "./geometry";

/** Something that helps drawing: an endless aid line, a center line (a slot's), or a dimension. */
export type Aid =
  | { id: string; kind: "xline"; p: Pt; d: Pt }
  /** a straight piece: a slot's center line (dash-dot), or a line turned into an aid line (dash: dashed) */
  | { id: string; kind: "cline"; a: Pt; b: Pt; dash?: boolean }
  /** an arc or a circle (start 0, end 360) turned into an aid line, degrees counterclockwise */
  | { id: string; kind: "carc"; c: Pt; r: number; start: number; end: number }
  | { id: string; kind: "dim"; m: Measure };

export type SnapKind = "end" | "mid" | "center" | "quadrant" | "intersection" | "perpendicular" | "tangent" | "ortho";
export const SNAP_KINDS: { id: SnapKind; label: string; tip: string }[] = [
  { id: "end", label: "End points", tip: "Ends of lines and arcs" },
  { id: "mid", label: "Midpoints", tip: "The middle of lines, arcs and slot center lines" },
  { id: "center", label: "Centers", tip: "Centers of circles and arcs" },
  { id: "quadrant", label: "Quadrants", tip: "The 0°, 90°, 180° and 270° points of circles and arcs" },
  { id: "intersection", label: "Intersections", tip: "Where lines, arcs, circles and aid lines cross" },
  { id: "perpendicular", label: "Perpendicular", tip: "From the last point square onto a line (or straight onto a circle)" },
  { id: "tangent", label: "Tangent", tip: "From the last point, touching a circle or an arc" },
  { id: "ortho", label: "Horizontal / vertical", tip: "Line, Aid line and Slot: within 3° of horizontal or vertical, made exactly horizontal or vertical" },
];
export const ALL_SNAPS: SnapKind[] = SNAP_KINDS.map((s) => s.id);

export interface Snap { p: Pt; kind: SnapKind }

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
const cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x;
const len = (a: Pt) => Math.hypot(a.x, a.y);
const dist = (a: Pt, b: Pt) => len(sub(a, b));
const unit = (a: Pt): Pt => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; };
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const norm360 = (d: number) => ((d % 360) + 360) % 360;
const on = (c: Pt, r: number, d: number): Pt => ({ x: c.x + r * Math.cos(rad(d)), y: c.y + r * Math.sin(rad(d)) });
/** Is the angle (degrees) on the arc from start counter-clockwise to end? */
export const onArc = (a: number, start: number, end: number) => norm360(a - start) <= norm360(end - start) + 1e-9;

/** Anything a point can snap to, as plain geometry. */
type Curve =
  | { t: "seg"; a: Pt; b: Pt }
  | { t: "inf"; p: Pt; d: Pt }
  | { t: "arc"; c: Pt; r: number; start: number; end: number }
  | { t: "circle"; c: Pt; r: number };

function curvesOf(ents: Entity[], aids: Aid[]): Curve[] {
  const out: Curve[] = [];
  for (const e of ents) {
    if (e.kind === "line") out.push({ t: "seg", a: e.a, b: e.b });
    else if (e.kind === "arc") out.push({ t: "arc", c: e.c, r: e.r, start: e.start, end: e.end });
    else if (e.kind === "circle") out.push({ t: "circle", c: e.c, r: e.r });
    else for (let i = 1; i < e.fit.length; i++) out.push({ t: "seg", a: e.fit[i - 1], b: e.fit[i] });
  }
  for (const a of aids) {
    if (a.kind === "xline") out.push({ t: "inf", p: a.p, d: a.d });
    else if (a.kind === "cline") out.push({ t: "seg", a: a.a, b: a.b });
    else if (a.kind === "carc") out.push(a.end - a.start >= 360 ? { t: "circle", c: a.c, r: a.r } : { t: "arc", c: a.c, r: a.r, start: a.start, end: a.end });
  }
  return out;
}

/** The nearest point of a curve to p. */
function nearest(c: Curve, p: Pt): Pt {
  if (c.t === "seg") {
    const d = sub(c.b, c.a), L = dot(d, d) || 1;
    const t = Math.max(0, Math.min(1, dot(sub(p, c.a), d) / L));
    return add(c.a, mul(d, t));
  }
  if (c.t === "inf") return add(c.p, mul(c.d, dot(sub(p, c.p), c.d)));
  const u = dist(p, c.c) > 1e-12 ? unit(sub(p, c.c)) : { x: 1, y: 0 };
  if (c.t === "circle") return add(c.c, mul(u, c.r));
  const a = deg(Math.atan2(u.y, u.x));
  if (onArc(a, c.start, c.end)) return add(c.c, mul(u, c.r));
  const s = on(c.c, c.r, c.start), e = on(c.c, c.r, c.end);
  return dist(s, p) < dist(e, p) ? s : e;
}
const curveDist = (c: Curve, p: Pt) => dist(nearest(c, p), p);

/** Where two curves cross (circles and arcs as their circles, then kept when on the arc / segment). */
function meet(a: Curve, b: Curve): Pt[] {
  const asLine = (c: Curve): { p: Pt; d: Pt } | null => (c.t === "seg" ? { p: c.a, d: unit(sub(c.b, c.a)) } : c.t === "inf" ? c : null);
  const asCircle = (c: Curve): { c: Pt; r: number } | null => (c.t === "arc" || c.t === "circle" ? c : null);
  let pts: Pt[] = [];
  const la = asLine(a), lb = asLine(b), ca = asCircle(a), cb = asCircle(b);
  if (la && lb) { const x = lineX(la.p, la.d, lb.p, lb.d); if (x) pts = [x]; }
  else if (la && cb) pts = lineCircle(la.p, la.d, cb.c, cb.r);
  else if (ca && lb) pts = lineCircle(lb.p, lb.d, ca.c, ca.r);
  else if (ca && cb) pts = circleCircle(ca.c, ca.r, cb.c, cb.r);
  const ok = (c: Curve, q: Pt) => {
    if (c.t === "seg") { const d = sub(c.b, c.a); const t = dot(sub(q, c.a), d) / (dot(d, d) || 1); return t >= -1e-9 && t <= 1 + 1e-9; }
    if (c.t === "arc") return onArc(deg(Math.atan2(q.y - c.c.y, q.x - c.c.x)), c.start, c.end);
    return true;
  };
  return pts.filter((q) => ok(a, q) && ok(b, q));
}

/** Crossing of two endless lines (point + unit direction), or null when parallel. */
export function lineX(p: Pt, d: Pt, q: Pt, e: Pt): Pt | null {
  const den = cross(d, e);
  if (Math.abs(den) < 1e-12) return null;
  const t = cross(sub(q, p), e) / den;
  return add(p, mul(d, t));
}
function lineCircle(p: Pt, d: Pt, c: Pt, r: number): Pt[] {
  const f = sub(p, c);
  const b = dot(f, d), cc = dot(f, f) - r * r;
  const disc = b * b - cc;
  if (disc < -1e-9) return [];
  const s = Math.sqrt(Math.max(0, disc));
  return disc < 1e-12 ? [add(p, mul(d, -b))] : [add(p, mul(d, -b - s)), add(p, mul(d, -b + s))];
}
function circleCircle(c1: Pt, r1: number, c2: Pt, r2: number): Pt[] {
  const d = dist(c1, c2);
  if (d < 1e-12 || d > r1 + r2 + 1e-9 || d < Math.abs(r1 - r2) - 1e-9) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const u = unit(sub(c2, c1)), m = add(c1, mul(u, a)), n = { x: -u.y, y: u.x };
  return h < 1e-9 ? [m] : [add(m, mul(n, h)), add(m, mul(n, -h))];
}

/** Lower is preferred when two snaps are about as near. */
const RANK: Record<SnapKind, number> = { end: 0, intersection: 1, center: 2, mid: 2, quadrant: 2, perpendicular: 3, tangent: 3, ortho: 4 };

/**
 * The snap nearest the pointer (within tol mm), of the kinds allowed. `from` is the last point placed
 * (for perpendicular and tangent).
 */
export function findSnap(p: Pt, tol: number, ents: Entity[], aids: Aid[], allowed: ReadonlySet<SnapKind>, from?: Pt | null): Snap | null {
  let best: (Snap & { d: number }) | null = null;
  const take = (q: Pt, kind: SnapKind) => {
    if (!allowed.has(kind)) return;
    const d = dist(q, p);
    if (d > tol) return;
    // a preferred kind wins over a slightly nearer one (a third of the tolerance)
    const score = d + RANK[kind] * tol * 0.12;
    if (!best || score < best.d) best = { p: { ...q }, kind, d: score };
  };
  for (const e of ents) {
    if (e.kind === "line") { take(e.a, "end"); take(e.b, "end"); take(mul(add(e.a, e.b), 0.5), "mid"); }
    else if (e.kind === "arc") {
      take(on(e.c, e.r, e.start), "end"); take(on(e.c, e.r, e.end), "end");
      take(on(e.c, e.r, e.start + norm360(e.end - e.start) / 2), "mid");
      take(e.c, "center");
      for (const q of [0, 90, 180, 270]) if (onArc(q, e.start, e.end)) take(on(e.c, e.r, q), "quadrant");
    } else if (e.kind === "circle") {
      take(e.c, "center");
      for (const q of [0, 90, 180, 270]) take(on(e.c, e.r, q), "quadrant");
    } else { take(e.fit[0], "end"); take(e.fit[e.fit.length - 1], "end"); }
  }
  for (const a of aids) {
    if (a.kind === "cline") { take(a.a, "end"); take(a.b, "end"); take(mul(add(a.a, a.b), 0.5), "mid"); }
    else if (a.kind === "carc") {
      const full = a.end - a.start >= 360;
      take(a.c, "center");
      if (!full) { take(on(a.c, a.r, a.start), "end"); take(on(a.c, a.r, a.end), "end"); take(on(a.c, a.r, a.start + norm360(a.end - a.start) / 2), "mid"); }
      for (const q of [0, 90, 180, 270]) if (full || onArc(q, a.start, a.end)) take(on(a.c, a.r, q), "quadrant");
    }
  }
  // crossings among what passes near the pointer
  const curves = curvesOf(ents, aids);
  const near = curves.filter((c) => curveDist(c, p) <= tol);
  if (allowed.has("intersection")) for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) for (const q of meet(near[i], near[j])) take(q, "intersection");
  if (from) {
    for (const c of near) {
      if (c.t === "seg" || c.t === "inf") {
        // square onto the line (on the segment)
        const d = c.t === "seg" ? unit(sub(c.b, c.a)) : c.d, o = c.t === "seg" ? c.a : c.p;
        const f = add(o, mul(d, dot(sub(from, o), d)));
        if (c.t === "inf" || dist(nearest(c, f), f) < 1e-6) take(f, "perpendicular");
      } else {
        const r = dist(from, c.c);
        if (r > 1e-9) {
          // straight onto the circle (both sides), on the arc when it is one
          const u = unit(sub(from, c.c));
          for (const q of [add(c.c, mul(u, c.r)), add(c.c, mul(u, -c.r))]) if (c.t === "circle" || onArc(deg(Math.atan2(q.y - c.c.y, q.x - c.c.x)), c.start, c.end)) take(q, "perpendicular");
        }
        if (r > c.r + 1e-9) {
          // the two points where a line from `from` touches the circle
          const a0 = Math.atan2(from.y - c.c.y, from.x - c.c.x), b = Math.acos(c.r / r);
          for (const a of [a0 + b, a0 - b]) {
            const q = { x: c.c.x + c.r * Math.cos(a), y: c.c.y + c.r * Math.sin(a) };
            if (c.t === "circle" || onArc(deg(a), c.start, c.end)) take(q, "tangent");
          }
        }
      }
    }
  }
  const b = best as (Snap & { d: number }) | null;
  return b ? { p: b.p, kind: b.kind } : null;
}

// ------------------------------------------------------------------ aid lines

let aidSeq = 0;
export const aidId = () => `aid${Date.now().toString(36)}${++aidSeq}`;

/** An endless aid line through two points (null when they are the same). */
export function xlineThrough(a: Pt, b: Pt): Aid | null {
  if (dist(a, b) < 1e-9) return null;
  return { id: aidId(), kind: "xline", p: a, d: unit(sub(b, a)) };
}
/** An endless aid line through a point at an angle (degrees, counter-clockwise from X). */
export const xlineAt = (p: Pt, angleDeg: number): Aid => ({ id: aidId(), kind: "xline", p, d: { x: Math.cos(rad(angleDeg)), y: Math.sin(rad(angleDeg)) } });

/** Ctrl + Aid line: parallel to a line, half way between it and a point (or a parallel line). */
export function xlineMiddle(lineA: Pt, lineB: Pt, to: Pt): Aid | null {
  if (dist(lineA, lineB) < 1e-9) return null;
  const d = unit(sub(lineB, lineA));
  const f = add(lineA, mul(d, dot(sub(to, lineA), d)));
  return { id: aidId(), kind: "xline", p: mul(add(f, to), 0.5), d };
}

/** The part of an endless line inside a box (screen or mm), for drawing it; null when it misses the box. */
export function clipLine(p: Pt, d: Pt, box: { minX: number; minY: number; maxX: number; maxY: number }): [Pt, Pt] | null {
  let t0 = -Infinity, t1 = Infinity;
  const slab = (o: number, v: number, lo: number, hi: number) => {
    if (Math.abs(v) < 1e-12) return o >= lo && o <= hi;
    let a = (lo - o) / v, b = (hi - o) / v;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    return t0 <= t1;
  };
  if (!slab(p.x, d.x, box.minX, box.maxX) || !slab(p.y, d.y, box.minY, box.maxY)) return null;
  if (!isFinite(t0) || !isFinite(t1)) return null;
  return [add(p, mul(d, t0)), add(p, mul(d, t1))];
}

// ------------------------------------------------------------------ typed values

/** A number as typed (comma or point as the decimal mark; empty: null). */
export function typed(s: string): number | null {
  const t = s.trim().replace(",", ".");
  if (!t) return null;
  const v = Number(t);
  return isFinite(v) ? v : null;
}

/** The angle (degrees) of a direction; typed angles: positive counter-clockwise, negative clockwise. */
export const angleOf = (d: Pt) => deg(Math.atan2(d.y, d.x));
export const dirAt = (angleDeg: number): Pt => ({ x: Math.cos(rad(angleDeg)), y: Math.sin(rad(angleDeg)) });

// ------------------------------------------------------------------ slot

/**
 * A slot (center to center): two half circles at a and b, radius r, and the two straight sides.
 * The cutting lines, and its center line (an aid: its middle snaps).
 */
export function slotOf(a: Pt, b: Pt, r: number, newId: () => string): { ents: Entity[]; center: Aid } | null {
  const L = dist(a, b);
  if (L < 1e-9 || r <= 1e-9) return null;
  const u = unit(sub(b, a)), n = { x: -u.y, y: u.x };
  const ang = angleOf(u);
  const ents: Entity[] = [
    { id: newId(), kind: "line", a: add(a, mul(n, r)), b: add(b, mul(n, r)), role: "cut" },
    { id: newId(), kind: "arc", c: b, r, start: norm360(ang - 90), end: norm360(ang + 90), role: "cut" },
    { id: newId(), kind: "line", a: add(b, mul(n, -r)), b: add(a, mul(n, -r)), role: "cut" },
    { id: newId(), kind: "arc", c: a, r, start: norm360(ang + 90), end: norm360(ang + 270), role: "cut" },
  ];
  return { ents, center: { id: aidId(), kind: "cline", a, b } };
}

/** The radius a third click gives a slot: its distance from the line through the centers. */
export function slotRadius(a: Pt, b: Pt, p: Pt): number {
  const u = unit(sub(b, a));
  return Math.abs(cross(u, sub(p, a)));
}

// ------------------------------------------------------------------ offset

/** The distance from a line, arc or circle to p, and on which side (+1 left of a line / outside a circle). */
export function offsetSide(e: Entity, p: Pt): { d: number; side: 1 | -1 } | null {
  if (e.kind === "line") {
    const u = unit(sub(e.b, e.a));
    const s = cross(u, sub(p, e.a));
    return { d: Math.abs(s), side: s >= 0 ? 1 : -1 };
  }
  if (e.kind === "arc" || e.kind === "circle") {
    const r = dist(p, e.c);
    return { d: Math.abs(r - e.r), side: r >= e.r ? 1 : -1 };
  }
  return null;
}

/** A copy of a line, arc or circle offset by d to a side; null when a circle or arc would vanish. */
export function offsetOf(e: Entity, d: number, side: 1 | -1, id: string): Entity | null {
  const base = { id, role: e.role, layer: e.layer, color: e.color, rgb: e.rgb };
  if (e.kind === "line") {
    const u = unit(sub(e.b, e.a)), n = mul({ x: -u.y, y: u.x }, side * d);
    return { ...base, kind: "line", a: add(e.a, n), b: add(e.b, n) };
  }
  if (e.kind === "arc" || e.kind === "circle") {
    const r = e.r + side * d;
    if (r <= 1e-6) return null;
    return e.kind === "arc" ? { ...base, kind: "arc", c: e.c, r, start: e.start, end: e.end } : { ...base, kind: "circle", c: e.c, r };
  }
  return null;
}

// ------------------------------------------------------------------ corners: radius, chamfer, join

const TOL = 1e-4;

/** A corner: a point where exactly two straight lines end. */
export interface Corner { at: Pt; ids: [string, string] }

/** The corner nearest p (within tol), if exactly two lines end there and nothing else. */
export function cornerAt(ents: Entity[], p: Pt, tol: number): Corner | null {
  const ends: { q: Pt; e: Entity }[] = [];
  for (const e of ents) {
    if (e.kind === "line") { ends.push({ q: e.a, e }, { q: e.b, e }); }
    else if (e.kind === "arc") { ends.push({ q: on(e.c, e.r, e.start), e }, { q: on(e.c, e.r, e.end), e }); }
    else if (e.kind === "spline") { ends.push({ q: e.fit[0], e }, { q: e.fit[e.fit.length - 1], e }); }
  }
  let best: Pt | null = null, bd = tol;
  for (const { q } of ends) { const d = dist(q, p); if (d <= bd) { bd = d; best = q; } }
  if (!best) return null;
  const here = ends.filter(({ q }) => dist(q, best!) < TOL);
  if (here.length !== 2 || here.some(({ e }) => e.kind !== "line") || here[0].e.id === here[1].e.id) return null;
  return { at: best, ids: [here[0].e.id, here[1].e.id] };
}

type Line = Extract<Entity, { kind: "line" }>;
/** The line's far end from the corner, the direction away from it, and its length. */
const arm = (l: Line, at: Pt) => {
  const far = dist(l.a, at) < dist(l.b, at) ? l.b : l.a;
  return { far, u: unit(sub(far, at)), L: dist(far, at) };
};
/** The line shortened to end at q instead of the corner. */
const cutBack = (l: Line, at: Pt, q: Pt): Line => (dist(l.a, at) < dist(l.b, at) ? { ...l, a: q } : { ...l, b: q });

export type CornerResult = { ok: true; entities: Entity[]; message: string } | { ok: false; message: string };

/**
 * A radius at a corner: an arc tangent to both lines, the lines cut back to it. The lines must be long
 * enough for the arc to touch them (its setback no longer than the shorter line).
 */
export function filletAt(ents: Entity[], c: Corner, r: number, newId: string): CornerResult {
  const l1 = ents.find((e) => e.id === c.ids[0]) as Line, l2 = ents.find((e) => e.id === c.ids[1]) as Line;
  const a1 = arm(l1, c.at), a2 = arm(l2, c.at);
  const th = Math.acos(Math.max(-1, Math.min(1, dot(a1.u, a2.u))));
  if (th < 1e-6 || th > Math.PI - 1e-6) return { ok: false, message: "The lines are in one line: no corner to round" };
  if (r <= 0) return { ok: false, message: "Type a radius bigger than 0" };
  const t = r / Math.tan(th / 2);
  const short = Math.min(a1.L, a2.L);
  if (t > short + 1e-9) {
    const rMax = short * Math.tan(th / 2);
    return { ok: false, message: `Too big: at this corner the radius can be at most ${rMax.toFixed(rMax < 10 ? 2 : 1)} mm (the shorter line is ${short.toFixed(short < 10 ? 2 : 1)} mm)` };
  }
  const t1 = add(c.at, mul(a1.u, t)), t2 = add(c.at, mul(a2.u, t));
  const bis = unit(add(a1.u, a2.u));
  const center = add(c.at, mul(bis, r / Math.sin(th / 2)));
  const s = angleOf(sub(t1, center)), e = angleOf(sub(t2, center));
  // the short way round from t1 to t2
  const ccw = norm360(e - s) <= 180;
  const arc: Entity = { id: newId, kind: "arc", c: center, r, start: norm360(ccw ? s : e), end: norm360(ccw ? e : s), role: l1.role, layer: l1.layer, color: l1.color, rgb: l1.rgb };
  const out: Entity[] = [];
  for (const x of ents) {
    if (x.id === l1.id) { if (a1.L - t > TOL) out.push(cutBack(l1, c.at, t1)); }
    else if (x.id === l2.id) { if (a2.L - t > TOL) out.push(cutBack(l2, c.at, t2)); }
    else out.push(x);
  }
  out.push(arc);
  return { ok: true, entities: out, message: `Radius ${r} mm at the corner` };
}

/** A chamfer at a corner: d1 along the first line, d2 along the second, joined by a straight line. */
export function chamferAt(ents: Entity[], c: Corner, first: string, d1: number, d2: number, newId: string): CornerResult {
  const ids = first === c.ids[1] ? [c.ids[1], c.ids[0]] : c.ids;
  const l1 = ents.find((e) => e.id === ids[0]) as Line, l2 = ents.find((e) => e.id === ids[1]) as Line;
  const a1 = arm(l1, c.at), a2 = arm(l2, c.at);
  if (d1 <= 0 || d2 <= 0) return { ok: false, message: "Type both distances bigger than 0" };
  if (d1 > a1.L + 1e-9 || d2 > a2.L + 1e-9) return { ok: false, message: `Too big: the lines are ${a1.L.toFixed(1)} and ${a2.L.toFixed(1)} mm long` };
  if (Math.abs(cross(a1.u, a2.u)) < 1e-9) return { ok: false, message: "The lines are in one line: no corner to chamfer" };
  const p1 = add(c.at, mul(a1.u, d1)), p2 = add(c.at, mul(a2.u, d2));
  const out: Entity[] = [];
  for (const x of ents) {
    if (x.id === l1.id) { if (a1.L - d1 > TOL) out.push(cutBack(l1, c.at, p1)); }
    else if (x.id === l2.id) { if (a2.L - d2 > TOL) out.push(cutBack(l2, c.at, p2)); }
    else out.push(x);
  }
  out.push({ id: newId, kind: "line", a: p1, b: p2, role: l1.role, layer: l1.layer, color: l1.color, rgb: l1.rgb });
  return { ok: true, entities: out, message: `Chamfer ${d1} × ${d2} mm at the corner` };
}

/**
 * Ctrl + Extend: two lines joined where they (would) cross: each is lengthened or cut back to that point,
 * keeping the part on the side it was clicked.
 */
export function joinLines(ents: Entity[], id1: string, p1: Pt, id2: string, p2: Pt): CornerResult {
  const l1 = ents.find((e) => e.id === id1), l2 = ents.find((e) => e.id === id2);
  if (!l1 || !l2 || l1.kind !== "line" || l2.kind !== "line") return { ok: false, message: "Click two straight lines" };
  if (id1 === id2) return { ok: false, message: "Click a second, different line" };
  const d1 = unit(sub(l1.b, l1.a)), d2 = unit(sub(l2.b, l2.a));
  const x = lineX(l1.a, d1, l2.a, d2);
  if (!x) return { ok: false, message: "The lines are parallel: they never meet" };
  const fix = (l: Line, click: Pt): Line => {
    const L = dist(l.a, l.b) || 1, d = unit(sub(l.b, l.a));
    const tx = dot(sub(x, l.a), d) / L, tc = dot(sub(click, l.a), d) / L;
    // keep from the end on the clicked side to the crossing
    return tc < tx ? { ...l, b: x } : { ...l, a: x };
  };
  const n1 = fix(l1, p1), n2 = fix(l2, p2);
  if (dist(n1.a, n1.b) < TOL || dist(n2.a, n2.b) < TOL) return { ok: false, message: "A line would vanish: click on the parts to keep" };
  return { ok: true, entities: ents.map((e) => (e.id === id1 ? n1 : e.id === id2 ? n2 : e)), message: "Lines joined at their crossing" };
}

/** Within maxDeg of horizontal or vertical seen from `from`: the point put exactly level ("h") or plumb ("v"). */
export function orthoSnap(from: Pt, p: Pt, maxDeg = 3): { p: Pt; dir: "h" | "v" } | null {
  const dx = p.x - from.x, dy = p.y - from.y;
  if (Math.hypot(dx, dy) < 1e-9) return null;
  const a = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI);   // 0 … 180
  if (Math.min(a, 180 - a) <= maxDeg) return { p: { x: p.x, y: from.y }, dir: "h" };
  if (Math.abs(90 - a) <= maxDeg) return { p: { x: from.x, y: p.y }, dir: "v" };
  return null;
}

/** A point turned around c by deg (counterclockwise; negative: clockwise). */
export function rotPt(p: Pt, c: Pt, deg: number): Pt {
  const r = (deg * Math.PI) / 180, co = Math.cos(r), si = Math.sin(r);
  const x = p.x - c.x, y = p.y - c.y;
  return { x: c.x + x * co - y * si, y: c.y + x * si + y * co };
}

/** A line, arc, circle or spline turned around c by deg (counterclockwise; negative: clockwise). */
export function rotateEnt(e: Entity, c: Pt, deg: number): Entity {
  switch (e.kind) {
    case "line": return { ...e, a: rotPt(e.a, c, deg), b: rotPt(e.b, c, deg) };
    case "circle": return { ...e, c: rotPt(e.c, c, deg) };
    case "spline": return { ...e, fit: e.fit.map((q) => rotPt(q, c, deg)) };
    case "arc": {
      const start = norm360(e.start + deg);
      return { ...e, c: rotPt(e.c, c, deg), start, end: e.end - e.start >= 360 ? start + 360 : norm360(e.end + deg) };
    }
  }
}

/** The angle typed or shown by hand: from c to p, degrees counterclockwise from the right (0°); by hand it
 *  goes in whole degrees and is caught within 3° of every 45°. */
export function handAngle(c: Pt, p: Pt, exact: boolean): number | null {
  const dx = p.x - c.x, dy = p.y - c.y;
  if (Math.hypot(dx, dy) < 1e-9) return null;
  const a = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (exact) return Math.round(a * 1000) / 1000;
  const k = Math.round(a / 45) * 45;
  return Math.abs(a - k) <= 3 ? k : Math.round(a);
}

// ------------------------------------------------------------------ lines turned into aid lines

/** A line, an arc or a circle as an aid line (dashed, kept with the part, never cut); a spline: null. */
export function toAid(e: Entity): Aid | null {
  if (e.kind === "line") return { id: aidId(), kind: "cline", a: e.a, b: e.b, dash: true };
  if (e.kind === "circle") return { id: aidId(), kind: "carc", c: e.c, r: e.r, start: 0, end: 360 };
  if (e.kind === "arc") return { id: aidId(), kind: "carc", c: e.c, r: e.r, start: e.start, end: e.end };
  return null;
}

/** An aid arc / circle as an entity (to draw it). */
export const carcEnt = (a: Extract<Aid, { kind: "carc" }>): Entity =>
  a.end - a.start >= 360 ? { id: a.id, kind: "circle", c: a.c, r: a.r } : { id: a.id, kind: "arc", c: a.c, r: a.r, start: a.start, end: a.end };

// ------------------------------------------------------------------ grips (lines drawn in the importer)

/** a, b: a line's ends; mid: its middle (moves it); c: a center (moves it); r: on the circle / arc (its
 *  radius); s, e: an arc's ends (along its circle). */
export type GripKind = "a" | "b" | "mid" | "c" | "r" | "s" | "e";

/** The grips of a line, circle or arc (a spline has none). */
export function gripsOf(e: Entity): { g: GripKind; p: Pt }[] {
  if (e.kind === "line") return [{ g: "a", p: e.a }, { g: "b", p: e.b }, { g: "mid", p: mul(add(e.a, e.b), 0.5) }];
  if (e.kind === "circle") return [{ g: "c", p: e.c }, ...[0, 90, 180, 270].map((q) => ({ g: "r" as const, p: on(e.c, e.r, q) }))];
  if (e.kind === "arc") return [
    { g: "c", p: e.c }, { g: "s", p: on(e.c, e.r, e.start) }, { g: "e", p: on(e.c, e.r, e.end) },
    { g: "r", p: on(e.c, e.r, e.start + norm360(e.end - e.start) / 2) },
  ];
  return [];
}

/** The grip of a drawn entity nearest p (within tol). */
export function gripAt(ents: Entity[], p: Pt, tol: number): { id: string; g: GripKind; p: Pt } | null {
  let best: { id: string; g: GripKind; p: Pt; d: number } | null = null;
  for (const e of ents) for (const q of gripsOf(e)) {
    const d = dist(q.p, p);
    if (d <= tol && (!best || d < best.d)) best = { id: e.id, g: q.g, p: q.p, d };
  }
  return best && { id: best.id, g: best.g, p: best.p };
}

/** The entity with grip g (first at `from`) dragged to `to`; null when it would vanish. */
export function dragGrip(e: Entity, g: GripKind, from: Pt, to: Pt): Entity | null {
  const d = sub(to, from);
  if (e.kind === "line") {
    const n = g === "a" ? { ...e, a: to } : g === "b" ? { ...e, b: to } : { ...e, a: add(e.a, d), b: add(e.b, d) };
    return dist(n.a, n.b) > 1e-6 ? n : null;
  }
  if (e.kind === "circle" || e.kind === "arc") {
    if (g === "c") return { ...e, c: add(e.c, d) };
    if (g === "r") { const r = dist(to, e.c); return r > 1e-6 ? { ...e, r } : null; }
    if (e.kind === "arc" && (g === "s" || g === "e")) {
      if (dist(to, e.c) < 1e-9) return null;
      const a = norm360(deg(Math.atan2(to.y - e.c.y, to.x - e.c.x)));
      const n = g === "s" ? { ...e, start: a, end: norm360(e.end) } : { ...e, start: norm360(e.start), end: a };
      return norm360(n.end - n.start) > 0.01 ? n : null;
    }
  }
  return null;
}
