// Process -> Common pierce: several parts' outlines start from one pierce hole in the scrap between
// them. The first of them pierces it; the others start in it again with a quick pierce.
//
// Each part keeps its own lead-in (its type and its place on the outline), cut down to the minimum
// lead-in: the last part of it, next to the outline. From the common pierce point an arc runs to the
// start of what is kept, tangent to it there (a straight line when the point lies in line with it).
// A part joins when the start of its kept lead-in is within the radius of the point and the arc does
// not go through a part. Its lead-out is set here: length and angle to the outline, to the scrap side.
// The outlines of a group are cut one after another, where the last of them was (their holes are cut
// already then).

import type { CutContour, SheetCut } from "./cutPath";
import { pointIn, type Pt } from "./manualGeom";

export interface CommonPierceOptions {
  /** outlines whose kept lead-in starts this close to the pierce point join it [mm] */
  radius: number;
  /** the part of each part's own lead-in kept next to the outline [mm] (its whole lead-in when shorter) */
  minLead: number;
  /** lead-out: length [mm] and angle to the outline [°] (90: square to it, 0: on along it) */
  outLen: number;
  outAngle: number;
}

export const DEFAULT_COMMON_PIERCE: CommonPierceOptions = { radius: 15, minLead: 2, outLen: 2, outAngle: 45 };

/** An outline that may share a pierce: a part's own outline, whole (not broken, not inline). */
export const piercable = (c: CutContour) =>
  c.kind === "outer" && !c.parts && !c.common && !c.bc && !c.inline && !c.restart;

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const mul = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k];
const len = (a: Pt) => Math.hypot(a[0], a[1]);
const unit = (a: Pt): Pt => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1];
const r3 = (p: Pt): Pt => [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000];

/** The last `d` mm of a polyline (all of it when shorter). */
function lastPart(l: Pt[], d: number): Pt[] {
  let left = d;
  for (let i = l.length - 1; i > 0; i--) {
    const seg = len(sub(l[i], l[i - 1]));
    if (seg >= left) return [add(l[i], mul(unit(sub(l[i - 1], l[i])), left)), ...l.slice(i)];
    left -= seg;
  }
  return l.slice();
}

/** From `p` to `e`, arriving along `d` (unit): a tangent arc as points, or a straight line. */
function connector(p: Pt, e: Pt, d: Pt): Pt[] {
  const v = sub(p, e);
  if (len(v) < 0.01) return [e];
  let n: Pt = [-d[1], d[0]];
  let nv = dot(n, v);
  if (nv < 0) { n = mul(n, -1); nv = -nv; }
  // in line with the lead (behind it): straight
  if (nv < 1e-3 * len(v)) return [p, e];
  const r = dot(v, v) / (2 * nv);
  const c = add(e, mul(n, r));
  const a0 = Math.atan2(p[1] - c[1], p[0] - c[0]), a1 = Math.atan2(e[1] - c[1], e[0] - c[0]);
  // the turning sense that arrives at e along d
  const er = sub(e, c);
  const ccw = dot([-er[1], er[0]], d) > 0;
  let sweep = a1 - a0;
  if (ccw) { while (sweep <= 0) sweep += 2 * Math.PI; } else { while (sweep >= 0) sweep -= 2 * Math.PI; }
  // more than half round: the point is ahead of the lead; a straight line is shorter and clearer
  if (Math.abs(sweep) > Math.PI) return [p, e];
  const n0 = Math.max(4, Math.ceil(Math.abs(sweep) * r / 1.5));
  const out: Pt[] = [];
  for (let i = 0; i <= n0; i++) { const a = a0 + (sweep * i) / n0; out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); }
  out[0] = p; out[out.length - 1] = e;
  return out;
}

const loopOf = (pts: Pt[]) => (pts.length > 2 && len(sub(pts[0], pts[pts.length - 1])) < 1e-3 ? pts.slice(0, -1) : pts);

/** Is the point in a part (inside an outline, not in one of its holes)? */
function materialTest(cut: SheetCut, live: Set<CutContour>) {
  const solids = new Map<number, { outer: Pt[][]; holes: Pt[][] }>();
  for (const c of cut.contours) {
    if (!live.has(c) || (c.kind !== "outer" && c.kind !== "inner") || c.common || c.bc || c.inline) continue;
    const key = c.parts ? -1 - Math.min(...c.parts) : c.part;
    const s = solids.get(key) ?? { outer: [], holes: [] };
    (c.kind === "outer" ? s.outer : s.holes).push(loopOf(c.pts));
    solids.set(key, s);
  }
  return (p: Pt) => [...solids.values()].some((s) => s.outer.some((lp) => lp.length > 2 && pointIn(lp, p[0], p[1])) && !s.holes.some((lp) => lp.length > 2 && pointIn(lp, p[0], p[1])));
}

/** The lead-out: `o.outLen` at `o.outAngle` to the outline's end, to the side that is not the part. */
function leadOutOf(c: CutContour, o: CommonPierceOptions, inPart: (p: Pt) => boolean): Pt[] {
  if (!(o.outLen > 0) || c.pts.length < 2) return [];
  const e = c.pts[c.pts.length - 1];
  let k = c.pts.length - 2;
  while (k > 0 && len(sub(e, c.pts[k])) < 1e-3) k--;
  const t = unit(sub(e, c.pts[k]));
  const a = (Math.min(180, Math.max(0, o.outAngle)) * Math.PI) / 180;
  const side = (s: number): Pt => unit(add(mul(t, Math.cos(a)), mul([-t[1] * s, t[0] * s], Math.sin(a))));
  const probe = (d: Pt) => add(e, mul(d, Math.min(1, o.outLen)));
  const d = !inPart(probe(side(1))) ? side(1) : side(-1);
  return [e, r3(add(e, mul(d, o.outLen)))];
}

/** Where each joined outline's kept lead-in starts, and the direction it runs there. */
function keptLead(c: CutContour, o: CommonPierceOptions): { pts: Pt[]; e: Pt; d: Pt } {
  const own = c.cp?.orig.leadIn ?? c.leadIn;
  if (own.length > 1) {
    const pts = lastPart(own, Math.max(0, o.minLead));
    const d = unit(sub(pts[Math.min(1, pts.length - 1)], pts[0]));
    return { pts, e: pts[0], d };
  }
  // no lead-in: straight into the outline's start
  const s = c.pts[0];
  return { pts: [s], e: s, d: unit(sub(c.pts[1] ?? s, s)) };
}

export interface CommonPierceResult { cut: SheetCut; joined: number; left: string[] }

/** A free id for a new group. */
const newId = (cut: SheetCut) => {
  const used = new Set(cut.contours.map((c) => c.cp?.id).filter(Boolean));
  let n = 1;
  while (used.has(`cp${n}`)) n++;
  return `cp${n}`;
};

/**
 * One common pierce at `p` for these outlines (contour indexes; null: every outline whose lead-in starts
 * within the radius). `id`: the group being moved (its members are taken out of it first). `name(k)`:
 * the part's name for the messages.
 */
export function commonPierce(cut: SheetCut, live: Set<CutContour>, p: Pt, ks: number[] | null, o: CommonPierceOptions, name: (part: number) => string, id?: string): CommonPierceResult | string {
  // a group being moved: back to its own leads first
  let base = cut;
  if (id) base = removePierce(cut, id);
  const liveNow = new Set(base.contours.filter((_, i) => live.has(cut.contours[i])));
  const inPart = materialTest(base, liveNow);
  if (inPart(p)) return "The pierce point is in a part: it has to be in the scrap";
  const cands = (ks ?? base.contours.map((_, i) => i)).filter((k) => {
    const c = base.contours[k];
    return !!c && liveNow.has(c) && (piercable(c) || (!!c.cp && c.cp.id !== id));
  });
  const left: string[] = [];
  const members: { k: number; c: CutContour }[] = [];
  for (const k of cands) {
    const c0 = base.contours[k];
    // in another group: taken out of it (back to its own leads) first
    const c = c0.cp ? { ...c0, leadIn: c0.cp.orig.leadIn, leadOut: c0.cp.orig.leadOut, cp: undefined } : c0;
    const kept = keptLead(c, o);
    if (len(sub(kept.e, p)) > o.radius + 1e-6) { if (ks) left.push(`${name(c.part)}: its lead-in starts ${len(sub(kept.e, p)).toFixed(1)} mm away (radius ${o.radius} mm)`); continue; }
    const arc = connector(p, kept.e, kept.d);
    // the way to the lead must stay in the scrap (its last 0.3 mm meets the lead)
    const clear = arc.every((q, i) => i === arc.length - 1 || len(sub(q, kept.e)) < 0.3 || !inPart(q));
    if (!clear) { left.push(`${name(c.part)}: the way from the pierce point goes through a part`); continue; }
    const leadIn = [...arc.slice(0, -1).map(r3), ...kept.pts.map(r3)];
    members.push({ k, c: { ...c, leadIn, leadOut: leadOutOf(c, o, inPart), cp: { id: "", at: r3(p), orig: { leadIn: c.leadIn, leadOut: c.leadOut } } } });
  }
  if (members.length < 2) return members.length ? `Only ${name(members[0].c.part)} reaches this point${left.length ? ` (${left.join("; ")})` : ""}: a common pierce needs two or more outlines` : `No outline's lead-in starts within ${o.radius} mm of this point${left.length ? ` (${left.join("; ")})` : ""}`;
  const gid = id ?? newId(base);
  // cut one after another where the last of them was; the outlines left by a group they came from keep theirs
  const byK = new Map(members.map((m) => [m.k, { ...m.c, cp: { ...m.c.cp!, id: gid } }]));
  const lastK = Math.max(...members.map((m) => m.k));
  const out: CutContour[] = [];
  base.contours.forEach((c, k) => {
    if (byK.has(k)) { if (k === lastK) out.push(...members.map((m) => byK.get(m.k)!)); return; }
    out.push(c);
  });
  // a group that kept only one outline is no group any more
  return { cut: tidy({ ...base, contours: out }), joined: members.length, left };
}

/** A group with one outline left: back to its own leads. */
function tidy(cut: SheetCut): SheetCut {
  const n = new Map<string, number>();
  for (const c of cut.contours) if (c.cp) n.set(c.cp.id, (n.get(c.cp.id) ?? 0) + 1);
  if (![...n.values()].some((v) => v < 2)) return cut;
  return { ...cut, contours: cut.contours.map((c) => (c.cp && (n.get(c.cp.id) ?? 0) < 2 ? restore(c) : c)) };
}

const restore = (c: CutContour): CutContour => {
  if (!c.cp) return c;
  const { cp, ...rest } = c;
  return { ...rest, leadIn: cp.orig.leadIn, leadOut: cp.orig.leadOut };
};

/** A group's outlines back to their own leads. */
export function removePierce(cut: SheetCut, id: string): SheetCut {
  return { ...cut, contours: cut.contours.map((c) => (c.cp?.id === id ? restore(c) : c)) };
}

/** The common pierce points of the sheet: their groups, where, and the contours in them. */
export function piercesOf(cut: SheetCut | undefined, live: Set<CutContour>): { id: string; at: Pt; ks: number[] }[] {
  const by = new Map<string, { id: string; at: Pt; ks: number[] }>();
  (cut?.contours ?? []).forEach((c, k) => {
    if (!c.cp || !live.has(c)) return;
    const g = by.get(c.cp.id) ?? { id: c.cp.id, at: c.cp.at, ks: [] };
    g.ks.push(k);
    by.set(c.cp.id, g);
  });
  return [...by.values()];
}

/**
 * The point in the scrap equally far from these outlines' lead-in starts (the middle where they meet):
 * the centre of the smallest circle round the starts. null: fewer than two.
 */
export function autoPoint(cut: SheetCut, ks: number[], o: CommonPierceOptions): Pt | null {
  const pts = ks.map((k) => cut.contours[k]).filter(Boolean).map((c) => keptLead(c, o).e);
  if (pts.length < 2) return null;
  // Badoiu-Clarkson: step towards the farthest point
  let c: Pt = [pts.reduce((s, q) => s + q[0], 0) / pts.length, pts.reduce((s, q) => s + q[1], 0) / pts.length];
  for (let i = 1; i <= 400; i++) {
    const far = pts.reduce((a, q) => (len(sub(q, c)) > len(sub(a, c)) ? q : a));
    c = add(c, mul(sub(far, c), 1 / (i + 1)));
  }
  return r3(c);
}

/** Does this outline start in a common pierce another outline has pierced before it (cut order)? */
export function reusesPierce(contours: CutContour[], k: number): boolean {
  const c = contours[k];
  if (!c?.cp || !c.leadIn.length) return false;
  const s = c.leadIn[0];
  for (let i = 0; i < k; i++) {
    const b = contours[i];
    if (b.cp?.id === c.cp.id && b.leadIn.length && len(sub(b.leadIn[0], s)) < 0.01) return true;
  }
  return false;
}
