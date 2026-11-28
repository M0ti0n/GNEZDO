// Process -> Common pierce: several parts' outlines start from one pierce hole in the scrap between
// them. The first of them pierces it; the others start in it again with a quick pierce.
//
// To the corner (the default): each outline starts at its corner nearest the pierce point, a straight
// lead from the point into it (parts in a grid: one pierce where their corners meet, in the middle of
// them). Else each part keeps its own lead-in (its type and its place on the outline), cut down to the minimum
// lead-in: the last part of it, next to the outline. From the common pierce point an arc runs to the
// start of what is kept, tangent to it there (a straight line when the point lies in line with it).
// A part joins when the start of its kept lead-in is within the radius of the point (and on the side
// asked for: left or right of it) and the arc does not go through a part. Its lead-out stays its own; to
// the corner, the lead-out is the Technology row's Common pierce lead-out (0: none), in line with the
// outline's last edge past the corner (else square to it, to the side clear of the parts).
// With Break cut the parts first get the lead type with a gap like theirs, with the default gap (the
// Technology row's outline gap when it is negative, else −5 mm): the outline stops short, a bridge
// holds the part. The outlines of a group are cut one after another, the nearest the machine's 0,0
// first, where the last of them was (their holes are cut already then).

import type { CutContour, SheetCut } from "./cutPath";
import { pointIn, type Pt } from "./manualGeom";

export interface CommonPierceOptions {
  /** outlines whose kept lead-in starts this close to the pierce point join it [mm] */
  radius: number;
  /** the part of each part's own lead-in kept next to the outline [mm] (its whole lead-in when shorter) */
  minLead: number;
  /** only the outlines whose lead-in starts left / right of the pierce point (as drawn) join */
  side: "any" | "left" | "right";
  /** the joined outlines get a break cut (the lead type with a gap, the default gap) */
  breakCut: boolean;
  /** each outline starts at its corner nearest the pierce point instead (a straight lead from the point
   *  into it: parts in a grid meet at one pierce where their corners meet); no corner: its nearest point */
  toCorner: boolean;
}

export const DEFAULT_COMMON_PIERCE: CommonPierceOptions = { radius: 15, minLead: 2, side: "any", breakCut: false, toCorner: true };

/** Turns sharper than this (degrees) are an outline's corners. */
const CORNER = 30;

/** An outline's corners (closed loop, without its closing point). */
function cornersOf(lp: Pt[]): Pt[] {
  const n = lp.length, out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = lp[(i + n - 1) % n], b = lp[i], c = lp[(i + 1) % n];
    const u = unit(sub(b, a)), v = unit(sub(c, b));
    const ang = (Math.acos(Math.max(-1, Math.min(1, dot(u, v)))) * 180) / Math.PI;
    if (ang > CORNER) out.push(b);
  }
  return out;
}

/** The point of the loop nearest p, and on which edge. */
function nearestOnLoop(lp: Pt[], p: Pt): { at: Pt; edge: number; d: number } {
  let best = { at: lp[0], edge: 0, d: Infinity };
  for (let i = 0; i < lp.length; i++) {
    const a = lp[i], b = lp[(i + 1) % lp.length], ab = sub(b, a), L2 = dot(ab, ab);
    const t = L2 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / L2)) : 0;
    const q = add(a, mul(ab, t)), d = len(sub(p, q));
    if (d < best.d) best = { at: q, edge: i, d };
  }
  return best;
}

/** Where on the outline it starts for a pierce at p: its corner nearest p (else its nearest point). */
function startFor(c: CutContour, p: Pt): Pt {
  const lp = loopOf(c.pts);
  const cs = cornersOf(lp);
  if (!cs.length) return nearestOnLoop(lp, p).at;
  return cs.reduce((a, q) => (len(sub(q, p)) < len(sub(a, p)) ? q : a));
}

/** The outline started at q (on it): its points from q round to q again; no lead-out (it was at the old start). */
function startedAt(c: CutContour, q: Pt): CutContour {
  const lp = loopOf(c.pts);
  const { edge } = nearestOnLoop(lp, q);
  const k = (edge + 1) % lp.length;
  const atVertex = len(sub(lp[edge], q)) < 1e-6 ? edge : len(sub(lp[k], q)) < 1e-6 ? k : -1;
  const from = atVertex >= 0 ? atVertex : k;
  const ring = [...lp.slice(from), ...lp.slice(0, from)];
  const pts = atVertex >= 0 ? [...ring, ring[0]] : [q, ...ring, q];
  return { ...c, pts: pts.map(r3), leadIn: [], leadOut: [] };
}

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

/** Where each joined outline's kept lead-in starts, and the direction it runs there. */
function keptLead(c: CutContour, o: CommonPierceOptions): { pts: Pt[]; e: Pt; d: Pt } {
  const own = c.leadIn;
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

export interface CommonPierceJob {
  /** the machine's 0,0 (the group is cut from the outline nearest it) */
  from: Pt;
  /** the part's name, for the messages */
  name: (part: number) => string;
  /** the group being moved (its outlines are taken out of it first) */
  id?: string;
  /** Break cut: the outline `k` of `base` with the lead type with a gap, the default gap; a text: why not */
  breakCut?: (base: SheetCut, k: number) => CutContour | string;
  /** the parts' material from their drawings (outlines cut in pieces count too) */
  solid?: (p: Pt) => boolean;
  /** to the corner: each outline's lead-out [mm] (Technology → Common pierce → Lead-out); 0 / missing: none */
  leadOut?: number;
}

/** The lead-out of an outline started at a corner from a common pierce: `l` mm in line with its last edge
 *  (past the corner), else square to it, whichever way stays out of the parts; none when no way does. */
function cornerLeadOut(pts: Pt[], l: number, inPart: (p: Pt) => boolean): Pt[] {
  if (l <= 0 || pts.length < 2) return [];
  const end = pts[pts.length - 1];
  let k = pts.length - 2;
  while (k > 0 && len(sub(end, pts[k])) < 1e-6) k--;
  const t = unit(sub(end, pts[k]));
  for (const d of [t, [-t[1], t[0]] as Pt, [t[1], -t[0]] as Pt]) {
    if ([0.2, 0.4, 0.6, 0.8, 1].every((f) => !inPart(add(end, mul(d, l * f))))) return [r3(end), r3(add(end, mul(d, l)))];
  }
  return [];
}

/**
 * One common pierce at `p` for these outlines (contour indexes; null: every outline whose lead-in starts
 * within the radius).
 */
export function commonPierce(cut: SheetCut, live: Set<CutContour>, p: Pt, ks: number[] | null, o: CommonPierceOptions, job: CommonPierceJob): CommonPierceResult | string {
  const { id, name } = job;
  // a group being moved: back to its own leads first
  let base = cut;
  if (id) base = removePierce(cut, id);
  const liveNow = new Set(base.contours.filter((_, i) => live.has(cut.contours[i])));
  const inContours = materialTest(base, liveNow);
  const inPart = (p: Pt) => inContours(p) || !!job.solid?.(p);
  if (inPart(p)) return ks && !id ? "The middle between their lead-ins is in a part: PLACE the pierce point in the scrap by hand" : "The pierce point is in a part: it has to be in the scrap";
  const cands = (ks ?? base.contours.map((_, i) => i)).filter((k) => {
    const c = base.contours[k];
    return !!c && liveNow.has(c) && (piercable(c) || (!!c.cp && c.cp.id !== id));
  });
  const left: string[] = [];
  const members: { k: number; c: CutContour }[] = [];
  for (const k of cands) {
    // in another group: taken out of it (back to its own leads) first
    const own = restore(base.contours[k]);
    // to the corner: started at its corner nearest the pierce point, a straight lead from the point
    const corner = o.toCorner ? startFor(own, p) : null;
    let c = corner ? startedAt(own, corner) : own;
    // Break cut: the lead type with a gap, the default gap
    if (o.breakCut && job.breakCut) {
      const r = job.breakCut({ ...base, contours: base.contours.map((x, i) => (i === k ? c : x)) }, k);
      if (typeof r === "string") { left.push(`${name(own.part)}: ${r}`); continue; }
      c = r;
    }
    const kept = corner && !o.breakCut ? { pts: [r3(corner)], e: corner, d: unit(sub(corner, p)) } : keptLead(c, o);
    if (len(sub(kept.e, p)) > o.radius + 1e-6) { if (ks) left.push(`${name(c.part)}: its lead-in starts ${len(sub(kept.e, p)).toFixed(1)} mm away (radius ${o.radius} mm)`); continue; }
    if (o.side !== "any" && (o.side === "left" ? kept.e[0] > p[0] - 0.01 : kept.e[0] < p[0] + 0.01)) { if (ks) left.push(`${name(c.part)}: its lead-in is not ${o.side} of the pierce point`); continue; }
    // the way to the lead must stay in the scrap (its last 0.3 mm meets the lead): the arc, else a
    // straight line (checked along it)
    const clear = (l: Pt[]) => l.every((q, i) => i === l.length - 1 || len(sub(q, kept.e)) < 0.3 || !inPart(q));
    const line = (a0: Pt, b0: Pt): Pt[] => { const n = Math.max(2, Math.ceil(len(sub(b0, a0)) / 0.5)); return Array.from({ length: n + 1 }, (_, i) => add(a0, mul(sub(b0, a0), i / n))); };
    let arc = connector(p, kept.e, kept.d);
    if (!clear(arc.length > 2 ? arc : line(p, kept.e))) {
      if (arc.length > 2 && clear(line(p, kept.e))) arc = [p, kept.e];
      else { left.push(`${name(c.part)}: the way from the pierce point goes through a part`); continue; }
    }
    const leadIn = [...arc.slice(0, -1).map(r3), ...kept.pts.map(r3)];
    if (corner && !o.breakCut && (job.leadOut ?? 0) > 0) c = { ...c, leadOut: cornerLeadOut(c.pts, job.leadOut!, inPart) };
    const orig: NonNullable<CutContour["cp"]>["orig"] = { leadIn: own.leadIn, leadOut: own.leadOut, pts: own.pts, ...(own.lead ? { lead: own.lead } : {}), ...(own.spec ? { spec: own.spec } : {}) };
    members.push({ k, c: { ...c, leadIn, cp: { id: "", at: r3(p), orig } } });
  }
  if (members.length < 2) return members.length ? `Only ${name(members[0].c.part)} reaches this point${left.length ? ` (${left.join("; ")})` : ""}: a common pierce needs two or more outlines` : `No outline's lead-in starts within ${o.radius} mm of this point${left.length ? ` (${left.join("; ")})` : ""}`;
  const gid = id ?? newId(base);
  // cut one after another where the last of them was; the outlines left by a group they came from keep theirs
  const byK = new Map(members.map((m) => [m.k, { ...m.c, cp: { ...m.c.cp!, id: gid } }]));
  const lastK = Math.max(...members.map((m) => m.k));
  // the nearest the machine's 0,0 first
  const dist = (m: { c: CutContour }) => len(sub(m.c.leadIn[m.c.leadIn.length - 1] ?? m.c.pts[0], job.from));
  members.sort((a, b) => dist(a) - dist(b));
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
  const out = tidyPierces(cut.contours);
  return out === cut.contours ? cut : { ...cut, contours: out };
}
export function tidyPierces(contours: CutContour[]): CutContour[] {
  const n = new Map<string, number>();
  for (const c of contours) if (c.cp) n.set(c.cp.id, (n.get(c.cp.id) ?? 0) + 1);
  if (![...n.values()].some((v) => v < 2)) return contours;
  return contours.map((c) => (c.cp && (n.get(c.cp.id) ?? 0) < 2 ? restore(c) : c));
}

function restore(c: CutContour): CutContour {
  if (!c.cp) return c;
  const o = c.cp.orig;
  const out: CutContour = { ...c, leadIn: o.leadIn, leadOut: o.leadOut, pts: o.pts ?? c.pts };
  delete out.cp; delete out.lead; delete out.spec;
  if (o.lead) out.lead = o.lead;
  if (o.spec) out.spec = o.spec;
  return out;
}

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
  const cs = ks.map((k) => cut.contours[k]).filter(Boolean).map(restore);
  if (cs.length < 2) return null;
  // to the corner: the point nearest all the outlines (a grid: where their corners meet), found by
  // taking each one's corner nearest the point and centring between them, a few times over
  if (o.toCorner) {
    let c: Pt = [0, 0];
    for (const x of cs) { const lp = loopOf(x.pts); const m = lp.reduce((s, q) => add(s, q), [0, 0] as Pt); c = add(c, mul(m, 1 / lp.length / cs.length)); }
    for (let round = 0; round < 12; round++) {
      const near = cs.map((x) => startFor(x, c));
      const next = smallestCircle(near);
      if (len(sub(next, c)) < 1e-3) { c = next; break; }
      c = next;
    }
    return r3(c);
  }
  const pts = cs.map((c) => keptLead(c, o).e);
  return r3(smallestCircle(pts));
}

/** The centre of (about) the smallest circle round the points (Badoiu-Clarkson: step towards the farthest). */
function smallestCircle(pts: Pt[]): Pt {
  let c: Pt = [pts.reduce((s, q) => s + q[0], 0) / pts.length, pts.reduce((s, q) => s + q[1], 0) / pts.length];
  for (let i = 1; i <= 400; i++) {
    const far = pts.reduce((a, q) => (len(sub(q, c)) > len(sub(a, c)) ? q : a));
    c = add(c, mul(sub(far, c), 1 / (i + 1)));
  }
  return c;
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
