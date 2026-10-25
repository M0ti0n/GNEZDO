import type { Entity, Pt } from "./geometry";

// Measuring tools of the import screen: Diameter, Radius, Angle and Dimension.
// They only read the drawing; what they show disappears when the tool is switched off.

/** What a click picked: an end point, a straight line, or an arc / circle (by its centre). */
export type Pick =
  | { kind: "point"; p: Pt }
  | { kind: "line"; id: string; a: Pt; b: Pt; at: Pt }
  | { kind: "round"; id: string; c: Pt; r: number; full: boolean; at: Pt };

/** A drawn measurement, in mm (drawing coordinates). */
export type Measure =
  | { kind: "distance"; from: Pt; to: Pt; value: number; note: string; ext: [Pt, Pt][] }
  | { kind: "radius"; c: Pt; to: Pt; r: number }
  | { kind: "diameter"; a: Pt; b: Pt; d: number }
  | { kind: "angle"; at: Pt; u1: Pt; u2: Pt; deg: number; ext: [Pt, Pt][] };

export type MeasureResult = { ok: true; m: Measure } | { ok: false; message: string };

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
const cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x;
const len = (a: Pt) => Math.hypot(a.x, a.y);
const dist = (a: Pt, b: Pt) => len(sub(a, b));
const unit = (a: Pt): Pt => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; };

/** Lines closer to parallel than this (degrees) count as parallel. */
const PARALLEL_DEG = 0.01;

/** Foot of the perpendicular from p to the (endless) line through a and b. */
export function foot(p: Pt, a: Pt, b: Pt): Pt {
  const d = sub(b, a);
  const t = dot(sub(p, a), d) / (dot(d, d) || 1);
  return add(a, mul(d, t));
}

/** Dashed extension from the nearer end of segment a-b to q, when q is off the segment. */
function extension(q: Pt, a: Pt, b: Pt): [Pt, Pt][] {
  const d = sub(b, a);
  const t = dot(sub(q, a), d) / (dot(d, d) || 1);
  if (t < -1e-9) return [[a, q]];
  if (t > 1 + 1e-9) return [[b, q]];
  return [];
}

/** The pick for an entity clicked at `at` (a point on or near it). Splines cannot be measured. */
export function pickEntity(e: Entity, at: Pt): Pick | null {
  if (e.kind === "line") return { kind: "line", id: e.id, a: e.a, b: e.b, at: foot(at, e.a, e.b) };
  if (e.kind === "arc") return { kind: "round", id: e.id, c: e.c, r: e.r, full: false, at };
  if (e.kind === "circle") return { kind: "round", id: e.id, c: e.c, r: e.r, full: true, at };
  return null;
}

/** Point on the circle in the direction of the click (or straight right when clicked at the centre). */
const onCircle = (c: Pt, r: number, at: Pt) => {
  const u = dist(at, c) > 1e-9 ? unit(sub(at, c)) : { x: 1, y: 0 };
  return add(c, mul(u, r));
};

export function radiusOf(p: Pick | null): MeasureResult {
  if (!p || p.kind !== "round") return { ok: false, message: "Click an arc or a circle" };
  return { ok: true, m: { kind: "radius", c: p.c, to: onCircle(p.c, p.r, p.at), r: p.r } };
}

export function diameterOf(p: Pick | null): MeasureResult {
  if (!p || p.kind !== "round") return { ok: false, message: "Click an arc or a circle" };
  const b = onCircle(p.c, p.r, p.at);
  return { ok: true, m: { kind: "diameter", a: add(p.c, sub(p.c, b)), b, d: 2 * p.r } };
}

/**
 * Angle between two straight lines, measured at their crossing, on the side where they were
 * clicked (like AutoCAD): click near the ends that form the angle you want.
 */
export function angleOf(p1: Pick, p2: Pick): MeasureResult {
  if (p1.kind !== "line" || p2.kind !== "line") return { ok: false, message: "Angle needs two straight lines" };
  const d1 = sub(p1.b, p1.a), d2 = sub(p2.b, p2.a);
  const c = cross(d1, d2);
  const sin = Math.abs(c) / (len(d1) * len(d2) || 1);
  if (Math.asin(Math.min(sin, 1)) * 180 / Math.PI < PARALLEL_DEG) return { ok: false, message: "The lines are parallel: 0°" };
  // crossing of the endless lines
  const t = cross(sub(p2.a, p1.a), d2) / c;
  const at = add(p1.a, mul(d1, t));
  // each arm points from the crossing towards where the line was clicked (or its far end)
  const arm = (pk: { a: Pt; b: Pt; at: Pt }) => {
    if (dist(pk.at, at) > 1e-6) return unit(sub(pk.at, at));
    return unit(sub(dist(pk.a, at) > dist(pk.b, at) ? pk.a : pk.b, at));
  };
  const u1 = arm(p1), u2 = arm(p2);
  const deg = Math.acos(Math.max(-1, Math.min(1, dot(u1, u2)))) * 180 / Math.PI;
  return { ok: true, m: { kind: "angle", at, u1, u2, deg, ext: [...extension(at, p1.a, p1.b), ...extension(at, p2.a, p2.b)] } };
}

/** The point a pick stands for: an end point, or the centre of an arc / circle. */
const pointOf = (p: Pick): Pt | null => (p.kind === "point" ? p.p : p.kind === "round" ? p.c : null);

/** From point q square onto line l (shortest distance to the endless line). */
function pointToLine(q: Pt, l: { a: Pt; b: Pt }, note: string): Measure {
  const f = foot(q, l.a, l.b);
  return { kind: "distance", from: q, to: f, value: dist(q, f), note, ext: extension(f, l.a, l.b) };
}

/**
 * Dimension between two picks:
 *   point / centre  ↔ point / centre: straight distance
 *   line            ↔ point or centre: square (perpendicular) to the line
 *   line            ↔ line, parallel: distance between them
 *   line            ↔ line, not parallel: shortest distance (from the end point nearest to the other line)
 */
export function dimensionOf(p1: Pick, p2: Pick): MeasureResult {
  if (p1.kind === "line" && p2.kind === "line") {
    const d1 = sub(p1.b, p1.a), d2 = sub(p2.b, p2.a);
    const sin = Math.abs(cross(d1, d2)) / (len(d1) * len(d2) || 1);
    if (Math.asin(Math.min(sin, 1)) * 180 / Math.PI < PARALLEL_DEG) {
      const m = pointToLine(p1.at, p2, "between parallel lines");
      if (m.kind === "distance" && m.value < 1e-6) return { ok: false, message: "The lines lie on each other: 0 mm" };
      return { ok: true, m };
    }
    // not parallel: the end point nearest to the other line, to its nearest point on that line
    // (square to it where it can be; to its end otherwise)
    const t1 = cross(sub(p2.a, p1.a), d2) / cross(d1, d2), t2 = cross(sub(p2.a, p1.a), d1) / cross(d1, d2);
    if (t1 >= -1e-9 && t1 <= 1 + 1e-9 && t2 >= -1e-9 && t2 <= 1 + 1e-9) return { ok: false, message: "The lines cross or touch: 0 mm" };
    const toSegment = (q: Pt, l: { a: Pt; b: Pt }): Measure => {
      const d = sub(l.b, l.a);
      const t = Math.max(0, Math.min(1, dot(sub(q, l.a), d) / (dot(d, d) || 1)));
      const f = add(l.a, mul(d, t));
      return { kind: "distance", from: q, to: f, value: dist(q, f), note: "lines not parallel: shortest distance", ext: [] };
    };
    const options = [...[p1.a, p1.b].map((q) => toSegment(q, p2)), ...[p2.a, p2.b].map((q) => toSegment(q, p1))] as (Measure & { kind: "distance" })[];
    return { ok: true, m: options.reduce((a, b) => (b.value < a.value ? b : a)) };
  }
  if (p1.kind === "line" || p2.kind === "line") {
    const l = (p1.kind === "line" ? p1 : p2) as Pick & { kind: "line" };
    const o = p1.kind === "line" ? p2 : p1;
    const q = pointOf(o)!;
    const m = pointToLine(q, l, o.kind === "round" ? "centre square to the line" : "square to the line");
    if (m.kind === "distance" && m.value < 1e-6) return { ok: false, message: "The point is on the line: 0 mm" };
    return { ok: true, m };
  }
  const a = pointOf(p1)!, b = pointOf(p2)!;
  const v = dist(a, b);
  if (v < 1e-6) return { ok: false, message: "Same point: 0 mm" };
  const note = p1.kind === "round" && p2.kind === "round" ? "between centres" : p1.kind === "round" || p2.kind === "round" ? "centre to point" : "point to point";
  return { ok: true, m: { kind: "distance", from: a, to: b, value: v, note, ext: [] } };
}
