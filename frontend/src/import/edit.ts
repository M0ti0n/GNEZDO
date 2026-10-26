import { arcSweep, buildContours, findDoubles, lengthOf, pointsAlong, type Entity, type Pt } from "./geometry";

// Trim and Extend like AutoCAD / GstarCAD in quick mode: every other line is a cutting edge
// (Trim) or a boundary (Extend), nothing has to be picked first.
//   Trim:   the piece of the clicked object between its nearest crossings is removed;
//           an object that crosses nothing is deleted.
//   Extend: the clicked object grows from the end nearest the click to the next object it meets.
// Lines, arcs and circles (trim only) are supported; splines are not edited.

export type EditResult =
  | { ok: true; entities: Entity[]; removed: Entity[]; added: Entity[]; message: string; points?: { id: string; p: Pt; layer?: string }[] }
  | { ok: false; message: string };

type Carrier = { kind: "line"; a: Pt; b: Pt } | { kind: "circle"; c: Pt; r: number };
/** Finite pieces of an entity that can stop a trim or an extend. */
type Piece = { kind: "seg"; a: Pt; b: Pt } | { kind: "arc"; c: Pt; r: number; start: number; end: number } | { kind: "circle"; c: Pt; r: number };

const EPS_MM = 1e-4;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const norm = (d: number) => ((d % 360) + 360) % 360;
const angleAt = (c: Pt, p: Pt) => norm(deg(Math.atan2(p.y - c.y, p.x - c.x)));
const onCircle = (c: Pt, r: number, d: number): Pt => ({ x: c.x + r * Math.cos(rad(d)), y: c.y + r * Math.sin(rad(d)) });
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

let seq = 0;
const newId = (base: string) => `${base}.${++seq}`;

function piecesOf(e: Entity): Piece[] {
  switch (e.kind) {
    case "line": return [{ kind: "seg", a: e.a, b: e.b }];
    case "arc": return [{ kind: "arc", c: e.c, r: e.r, start: e.start, end: e.end }];
    case "circle": return [{ kind: "circle", c: e.c, r: e.r }];
    case "spline": {
      const p = pointsAlong(e);
      return p.slice(1).map((q, i) => ({ kind: "seg", a: p[i], b: q }));
    }
  }
}

/** Points where a line through a-b (endless) meets a circle. */
function lineCircle(a: Pt, b: Pt, c: Pt, r: number): Pt[] {
  const dx = b.x - a.x, dy = b.y - a.y;
  const fx = a.x - c.x, fy = a.y - c.y;
  const A = dx * dx + dy * dy, B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - r * r;
  const disc = B * B - 4 * A * C;
  if (A === 0 || disc < -1e-9) return [];
  const sq = Math.sqrt(Math.max(disc, 0));
  const ts = disc <= 1e-9 ? [-B / (2 * A)] : [(-B - sq) / (2 * A), (-B + sq) / (2 * A)];
  return ts.map((t) => ({ x: a.x + t * dx, y: a.y + t * dy }));
}

function circleCircle(c1: Pt, r1: number, c2: Pt, r2: number): Pt[] {
  const d = dist(c1, c2);
  if (d < 1e-9 || d > r1 + r2 + 1e-9 || d < Math.abs(r1 - r2) - 1e-9) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(r1 * r1 - a * a, 0));
  const mx = c1.x + (a * (c2.x - c1.x)) / d, my = c1.y + (a * (c2.y - c1.y)) / d;
  const ox = (h * (c2.y - c1.y)) / d, oy = (h * (c2.x - c1.x)) / d;
  return h < 1e-9 ? [{ x: mx, y: my }] : [{ x: mx + ox, y: my - oy }, { x: mx - ox, y: my + oy }];
}

const segParam = (a: Pt, b: Pt, p: Pt) => {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  return l2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
};

/** Is the point (already on the piece's carrier) within the piece? */
function within(piece: Piece, p: Pt): boolean {
  switch (piece.kind) {
    case "seg": { const len = dist(piece.a, piece.b) || 1; const s = segParam(piece.a, piece.b, p); return s >= -EPS_MM / len && s <= 1 + EPS_MM / len; }
    case "arc": return arcSweep(piece.start, angleAt(piece.c, p)) <= arcSweep(piece.start, piece.end) + deg(EPS_MM / piece.r) || dist(p, onCircle(piece.c, piece.r, piece.start)) < EPS_MM;
    case "circle": return true;
  }
}

/** Where the carrier (endless line or full circle) meets a finite piece. */
function hits(carrier: Carrier, piece: Piece): Pt[] {
  let raw: Pt[];
  if (carrier.kind === "line") {
    if (piece.kind === "seg") {
      const { a, b } = carrier, { a: q1, b: q2 } = piece;
      const d = (b.x - a.x) * (q2.y - q1.y) - (b.y - a.y) * (q2.x - q1.x);
      if (Math.abs(d) < 1e-12) return [];
      const s = ((q1.x - a.x) * (b.y - a.y) - (q1.y - a.y) * (b.x - a.x)) / d;
      raw = [{ x: q1.x + s * (q2.x - q1.x), y: q1.y + s * (q2.y - q1.y) }];
    } else raw = lineCircle(carrier.a, carrier.b, piece.c, piece.r);
  } else {
    raw = piece.kind === "seg" ? lineCircle(piece.a, piece.b, carrier.c, carrier.r) : circleCircle(carrier.c, carrier.r, piece.c, piece.r);
  }
  return raw.filter((p) => within(piece, p));
}

/** Every point where the target's carrier meets another entity. */
function crossings(target: Entity, carrier: Carrier, all: Entity[]): Pt[] {
  return all.filter((e) => e.id !== target.id).flatMap((e) => piecesOf(e).flatMap((pc) => hits(carrier, pc)));
}

const arcOf = (base: Entity, c: Pt, r: number, start: number, end: number): Entity =>
  ({ id: newId(base.id), kind: "arc", c, r, start: norm(start), end: norm(end), role: base.role, slow: base.slow, layer: base.layer, color: base.color, rgb: base.rgb });
const lineOf = (base: Entity, a: Pt, b: Pt): Entity =>
  ({ id: newId(base.id), kind: "line", a, b, role: base.role, slow: base.slow, layer: base.layer, color: base.color, rgb: base.rgb });

const replace = (all: Entity[], id: string, by: Entity[]) => all.flatMap((e) => (e.id === id ? by : [e]));

/** Trim the clicked object at its nearest crossings around the click point p. */
export function trimAt(all: Entity[], id: string, p: Pt): EditResult {
  const e = all.find((x) => x.id === id);
  if (!e) return { ok: false, message: "Nothing to trim here" };
  if (e.kind === "spline") return { ok: false, message: "Splines cannot be trimmed" };

  if (e.kind === "line") {
    const len = dist(e.a, e.b);
    const eps = EPS_MM / (len || 1);
    const ts = crossings(e, { kind: "line", a: e.a, b: e.b }, all).map((q) => segParam(e.a, e.b, q)).filter((t) => t > eps && t < 1 - eps);
    const tc = Math.min(Math.max(segParam(e.a, e.b, p), 0), 1);
    const lo = Math.max(-Infinity, ...ts.filter((t) => t < tc)), hi = Math.min(Infinity, ...ts.filter((t) => t > tc));
    const at = (t: number): Pt => ({ x: e.a.x + t * (e.b.x - e.a.x), y: e.a.y + t * (e.b.y - e.a.y) });
    const keep: Entity[] = [];
    if (Number.isFinite(lo)) keep.push(lineOf(e, e.a, at(lo)));
    if (Number.isFinite(hi)) keep.push(lineOf(e, at(hi), e.b));
    const removed = lineOf(e, Number.isFinite(lo) ? at(lo) : e.a, Number.isFinite(hi) ? at(hi) : e.b);
    return { ok: true, entities: replace(all, id, keep), removed: [removed], added: [],
      message: keep.length ? "Line trimmed" : "Line deleted (it crosses nothing)" };
  }

  if (e.kind === "arc") {
    const sweep = arcSweep(e.start, e.end);
    const eps = deg(EPS_MM / e.r);
    const us = crossings(e, { kind: "circle", c: e.c, r: e.r }, all)
      .map((q) => arcSweep(e.start, angleAt(e.c, q)) % 360).filter((u) => u > eps && u < sweep - eps);
    const uc = Math.min(arcSweep(e.start, angleAt(e.c, p)) % 360, sweep);
    const lo = Math.max(-Infinity, ...us.filter((u) => u < uc)), hi = Math.min(Infinity, ...us.filter((u) => u > uc));
    const keep: Entity[] = [];
    if (Number.isFinite(lo)) keep.push(arcOf(e, e.c, e.r, e.start, e.start + lo));
    if (Number.isFinite(hi)) keep.push(arcOf(e, e.c, e.r, e.start + hi, e.end));
    const removed = arcOf(e, e.c, e.r, e.start + (Number.isFinite(lo) ? lo : 0), e.start + (Number.isFinite(hi) ? hi : sweep));
    return { ok: true, entities: replace(all, id, keep), removed: [removed], added: [],
      message: keep.length ? "Arc trimmed" : "Arc deleted (it crosses nothing)" };
  }

  // circle: needs two crossings; the arc between them that holds the click is removed
  const angles = [...new Set(crossings(e, { kind: "circle", c: e.c, r: e.r }, all).map((q) => Math.round(angleAt(e.c, q) * 1e6) / 1e6))];
  if (angles.length === 0) return { ok: true, entities: replace(all, id, []), removed: [e], added: [], message: "Circle deleted (it crosses nothing)" };
  if (angles.length === 1) return { ok: false, message: "A circle needs two crossings to be trimmed" };
  const ac = angleAt(e.c, p);
  const after = angles.reduce((best, a) => (arcSweep(ac, a) % 360 < arcSweep(ac, best) % 360 ? a : best));
  const before = angles.reduce((best, a) => (arcSweep(a, ac) % 360 < arcSweep(best, ac) % 360 ? a : best));
  return { ok: true, entities: replace(all, id, [arcOf(e, e.c, e.r, after, before)]),
    removed: [arcOf(e, e.c, e.r, before, after)], added: [], message: "Circle trimmed" };
}

/** Extend the clicked object from the end nearest p to the next object it meets. */
export function extendAt(all: Entity[], id: string, p: Pt): EditResult {
  const e = all.find((x) => x.id === id);
  if (!e) return { ok: false, message: "Nothing to extend here" };
  if (e.kind === "circle") return { ok: false, message: "A circle cannot be extended" };
  if (e.kind === "spline") return { ok: false, message: "Splines cannot be extended" };

  if (e.kind === "line") {
    const len = dist(e.a, e.b);
    const eps = EPS_MM / (len || 1);
    const fromEnd = segParam(e.a, e.b, p) >= 0.5;               // the end nearer the click
    const ts = crossings(e, { kind: "line", a: e.a, b: e.b }, all).map((q) => segParam(e.a, e.b, q));
    const at = (t: number): Pt => ({ x: e.a.x + t * (e.b.x - e.a.x), y: e.a.y + t * (e.b.y - e.a.y) });
    const beyond = fromEnd ? ts.filter((t) => t > 1 + eps) : ts.filter((t) => t < -eps);
    if (!beyond.length) return { ok: false, message: "No line to extend to in that direction" };
    const t = fromEnd ? Math.min(...beyond) : Math.max(...beyond);
    const next = fromEnd ? { ...e, b: at(t) } : { ...e, a: at(t) };
    const grow = Math.abs(t - (fromEnd ? 1 : 0)) * len;
    return { ok: true, entities: all.map((x) => (x.id === id ? next : x)), removed: [],
      added: [lineOf(e, fromEnd ? e.b : e.a, at(t))], message: `Line extended by ${grow.toFixed(grow < 10 ? 2 : 1)} mm` };
  }

  // arc: grows along its circle, never to a full circle
  const sweep = arcSweep(e.start, e.end);
  const eps = deg(EPS_MM / e.r);
  const fromEnd = arcSweep(e.start, angleAt(e.c, p)) % 360 >= sweep / 2;
  const angles = crossings(e, { kind: "circle", c: e.c, r: e.r }, all).map((q) => angleAt(e.c, q));
  const room = 360 - sweep - eps;
  const ds = angles.map((a) => (fromEnd ? arcSweep(e.end, a) % 360 : arcSweep(a, e.start) % 360)).filter((d) => d > eps && d < room);
  if (!ds.length) return { ok: false, message: "No line to extend to in that direction" };
  const d = Math.min(...ds);
  const next = fromEnd ? { ...e, end: norm(e.end + d) } : { ...e, start: norm(e.start - d) };
  return { ok: true, entities: all.map((x) => (x.id === id ? next : x)), removed: [],
    added: [fromEnd ? arcOf(e, e.c, e.r, e.end, e.end + d) : arcOf(e, e.c, e.r, e.start - d, e.start)],
    message: `Arc extended by ${(rad(d) * e.r).toFixed(1)} mm` };
}

/* ---- Telling loose ends apart, and fixing them ------------------------------------------ */

export type EndKind = "overshoot" | "gap" | "stray" | "looseLine" | "loose";

export interface EndIssue {
  kind: EndKind;
  at: Pt;            // where to show it
  size: number;      // mm: how far the line runs past, or how wide the gap is
  label: string;     // "Line past a corner", "Gap in contour", "Stray line", "Loose end"
  /** The line the issue is about, when it is one line (stray and loose lines). */
  id?: string;
  /** A gap: its two loose ends (the marker is shown at both, joined by a dashed line). */
  ends?: [Pt, Pt];
  /** Applies the fix; missing for loose ends that need a person to look. */
  fix?: (all: Entity[]) => EditResult;
}

const endsOfEntity = (e: Entity): [Pt, Pt] | null =>
  e.kind === "line" ? [e.a, e.b]
  : e.kind === "arc" ? [onCircle(e.c, e.r, e.start), onCircle(e.c, e.r, e.end)]
  : e.kind === "spline" ? [e.fit[0], e.fit[e.fit.length - 1]] : null;

/** The cutting entity that has p as one of its ends, and which end (0 = start, 1 = end). */
function ownerOf(cut: Entity[], p: Pt): { e: Entity; end: 0 | 1 } | null {
  for (const e of cut) {
    const ends = endsOfEntity(e);
    if (!ends) continue;
    if (dist(ends[0], p) < 0.011) return { e, end: 0 };
    if (dist(ends[1], p) < 0.011) return { e, end: 1 };
  }
  return null;
}

/** How far a line or arc runs from its loose end to the first line it crosses (not at its own ends). */
function overshootOf(cut: Entity[], e: Entity, end: 0 | 1): { length: number; at: Pt; mid: Pt } | null {
  if (e.kind === "line") {
    const len = dist(e.a, e.b), eps = EPS_MM / (len || 1);
    const ts = crossings(e, { kind: "line", a: e.a, b: e.b }, cut).map((q) => segParam(e.a, e.b, q)).filter((t) => t > eps && t < 1 - eps);
    if (!ts.length) return null;
    const t = end === 0 ? Math.min(...ts) : Math.max(...ts);
    const at = (u: number): Pt => ({ x: e.a.x + u * (e.b.x - e.a.x), y: e.a.y + u * (e.b.y - e.a.y) });
    return { length: Math.abs(t - end) * len, at: at(t), mid: at((t + end) / 2) };
  }
  if (e.kind === "arc") {
    const sweep = arcSweep(e.start, e.end), eps = deg(EPS_MM / e.r);
    const us = crossings(e, { kind: "circle", c: e.c, r: e.r }, cut).map((q) => arcSweep(e.start, angleAt(e.c, q)) % 360).filter((u) => u > eps && u < sweep - eps);
    if (!us.length) return null;
    const u = end === 0 ? Math.min(...us) : Math.max(...us);
    const ue = end === 0 ? 0 : sweep;
    return { length: rad(Math.abs(u - ue)) * e.r, at: onCircle(e.c, e.r, e.start + u), mid: onCircle(e.c, e.r, e.start + (u + ue) / 2) };
  }
  return null;
}

/** Moves one end of a line or arc to p (arcs keep their circle, so only lines move freely). */
function moveEnd(e: Entity, end: 0 | 1, p: Pt): Entity | null {
  if (e.kind === "line") return end === 0 ? { ...e, a: p } : { ...e, b: p };
  return null;
}

/** Two loose ends of different pieces are offered as a gap up to this, or 15 % of the shorter piece. */
export const GAP_MAX_MM = 10;

/**
 * Sorts the loose ends of open cutting contours:
 *   overshoot - a line attached at its other end runs past a line it crosses (fix: trim the piece beyond)
 *   gap       - two ends that are each other's nearest, and either closing them closes a contour or
 *               they are close (10 mm, or 15 % of the shorter piece) (fix: meet at the corner, move an end, or add a line)
 *   stray     - a line sticking out: it touches or crosses the part, and has a free end (fix: erase it)
 *   looseLine - a line on its own, touching nothing (fix: erase it, or mark it as tracing)
 *   loose     - none of these; needs a look
 * The point where an overshooting line is touched is part of the overshoot and not listed again.
 */
export function diagnoseEnds(all: Entity[], looseEnds: Pt[]): EndIssue[] {
  const doubles = new Set(findDoubles(all));
  const cut = all.filter((e) => (e.role ?? "cut") === "cut" && !doubles.has(e.id));
  const chainIndex = new Map<string, number>();
  const chainSize: number[] = [], chainLength: number[] = [];
  const byId = new Map(cut.map((e) => [e.id, e]));
  buildContours(cut).forEach((c, i) => {
    chainSize[i] = c.entityIds.length;
    chainLength[i] = c.entityIds.reduce((sum, id) => sum + lengthOf(byId.get(id)!), 0);
    c.entityIds.forEach((id) => chainIndex.set(id, i));
  });
  const isLoose = (q: Pt) => looseEnds.some((l) => dist(l, q) < 0.011);
  /**
   * A single line or arc with both ends free and no other line ending on it: it belongs to no
   * contour (a line that another line ends on, in a T, is part of the contour and only not split).
   */
  const isFree = (e: Entity) => {
    const en = endsOfEntity(e);
    if (!en || chainSize[chainIndex.get(e.id) ?? -1] !== 1 || !isLoose(en[0]) || !isLoose(en[1])) return false;
    const self = piecesOf(e);
    return !cut.some((x) => x.id !== e.id && (endsOfEntity(x) ?? []).some((q) => self.some((pc) => nearPiece(pc, q))));
  };
  /** Longest gap offered between two different pieces: 10 mm, or 15 % of the shorter piece. */
  const gapLimit = (a: Entity, b: Entity) =>
    Math.max(GAP_MAX_MM, 0.15 * Math.min(chainLength[chainIndex.get(a.id) ?? -1] ?? 0, chainLength[chainIndex.get(b.id) ?? -1] ?? 0));
  const issues: EndIssue[] = [];
  const touched: Pt[] = [];   // where overshooting lines are crossed
  const rest: { p: Pt; owner: { e: Entity; end: 0 | 1 } | null }[] = [];

  for (const p of looseEnds) {
    const owner = ownerOf(cut, p);
    // a line past a corner is attached at its other end; a free line crossing something is a stray line
    const over = owner && !isFree(owner.e) && overshootOf(cut, owner.e, owner.end);
    // a nearer loose end means the line is short (gap), not long: the crossing is just the far corner
    const nearest = Math.min(Infinity, ...looseEnds.filter((q) => q !== p).map((q) => dist(p, q)));
    if (owner && over && over.length <= nearest + EPS_MM) {
      touched.push(over.at);
      const id = owner.e.id, mid = over.mid;
      issues.push({
        kind: "overshoot", at: p, size: over.length, label: "Line past a corner",
        fix: (now) => (now.some((x) => x.id === id) ? trimAt(now, id, mid) : { ok: false, message: "Already changed" }),
      });
    } else rest.push({ p, owner });
  }

  // ends that sit on an overshooting line are the other half of that overshoot
  const open = rest.filter((r) => !touched.some((t) => dist(t, r.p) < 0.02));
  const nearestOf = (i: number) => {
    let best = -1, bestD = Infinity;
    open.forEach((o, j) => {
      // a line's own two ends are never a gap with each other
      if (j === i || (open[i].owner && o.owner && open[i].owner!.e.id === o.owner.e.id)) return;
      const d = dist(open[i].p, o.p);
      if (d < bestD) { bestD = d; best = j; }
    });
    return { best, bestD };
  };
  const used = new Set<number>();
  open.forEach((r, i) => {
    if (used.has(i)) return;
    const { best, bestD } = nearestOf(i);
    const other = best >= 0 ? open[best] : null;
    const sameChain = !!(r.owner && other?.owner && chainIndex.get(r.owner.e.id) === chainIndex.get(other.owner.e.id));
    const isGap = !!other && !used.has(best) && !!r.owner && !!other.owner && nearestOf(best).best === i && (sameChain || bestD <= gapLimit(r.owner.e, other.owner.e));
    if (isGap) {
      used.add(i); used.add(best);
      const a = r.owner!, b = other!.owner!, pa = r.p, pb = other!.p;
      issues.push({
        kind: "gap", at: pa, ends: [pa, pb], size: bestD, label: "Gap in contour",
        fix: (now) => closeGap(now, a.e.id, a.end, pa, b.e.id, b.end, pb, bestD),
      });
      return;
    }
    used.add(i);
    const own = r.owner;
    if (!own) { issues.push({ kind: "loose", at: r.p, size: 0, label: "Loose end" }); return; }
    if (issues.some((x) => x.id === own.e.id)) return;   // its other end is listed already
    const id = own.e.id;
    const erase = (now: Entity[]) => (now.some((x) => x.id === id) ? eraseAt(now, id) : { ok: false as const, message: "Already changed" });
    const ends = endsOfEntity(own.e)!;
    const others = cut.filter((x) => x.id !== id);
    const touches = (q: Pt) => others.some((x) => piecesOf(x).some((pc) => nearPiece(pc, q)));
    const mid = midOf(own.e);
    if (isFree(own.e)) {
      // a line on its own: does it cross or touch the part, or is it just lying there?
      // piece by piece, so lines, arcs, circles and splines (many short pieces) all work
      const crosses = piecesOf(own.e).some((pc) => {
        const carrier: Carrier = pc.kind === "seg" ? { kind: "line", a: pc.a, b: pc.b } : { kind: "circle", c: pc.c, r: pc.r };
        return crossings(own.e, carrier, others).some((q) => nearPiece(pc, q));
      });
      issues.push(crosses || touches(ends[0]) || touches(ends[1])
        ? { kind: "stray", id, at: mid, size: lengthOf(own.e), label: "Stray line", fix: erase }
        : { kind: "looseLine", id, at: mid, size: lengthOf(own.e), label: "Loose line", fix: erase });
      return;
    }
    // the end of a chain: a line touching the part at one end and free at the other sticks out.
    // At its other end, one more line simply continues the chain; it touches the part when it
    // branches there (two or more others) or lands on the middle of another line.
    const meets = (q: Pt) => {
      let atEnds = 0, onMiddle = false;
      for (const x of others) {
        if (!piecesOf(x).some((pc) => nearPiece(pc, q))) continue;
        if ((endsOfEntity(x) ?? []).some((e) => dist(e, q) < 0.011)) atEnds++; else onMiddle = true;
      }
      return onMiddle || atEnds >= 2;
    };
    if (meets(ends[own.end === 0 ? 1 : 0]) || touches(r.p)) {
      issues.push({ kind: "stray", id, at: r.p, size: lengthOf(own.e), label: "Stray line", fix: erase });
      return;
    }
    issues.push({ kind: "loose", at: r.p, size: 0, label: "Loose end" });
  });
  return issues;
}

/** Point halfway along a line or arc (where its marker goes). */
function midOf(e: Entity): Pt {
  const p = pointsAlong(e);
  return p[Math.floor(p.length / 2)];
}

/** Gaps up to this size are closed by moving a line end; larger ones get a new line. */
const MOVE_END_MM = 1;

/** Is q on this piece (within the join tolerance)? */
function nearPiece(pc: Piece, q: Pt): boolean {
  const T = 0.011;
  if (pc.kind === "seg") {
    const dx = pc.b.x - pc.a.x, dy = pc.b.y - pc.a.y;
    const t = Math.max(0, Math.min(1, ((q.x - pc.a.x) * dx + (q.y - pc.a.y) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(q.x - pc.a.x - t * dx, q.y - pc.a.y - t * dy) <= T;
  }
  if (Math.abs(dist(q, pc.c) - pc.r) > T) return false;
  return pc.kind === "circle" || within(pc, q);
}

/** Closes a gap: two straight lines meet at their corner if it is close; otherwise one end moves onto the other. */
function closeGap(all: Entity[], idA: string, endA: 0 | 1, pa: Pt, idB: string, endB: 0 | 1, pb: Pt, gap: number): EditResult {
  const A = all.find((e) => e.id === idA), B = all.find((e) => e.id === idB);
  if (!A || !B) return { ok: false, message: "Already changed" };
  if (A.kind === "line" && B.kind === "line") {
    const d = (A.b.x - A.a.x) * (B.b.y - B.a.y) - (A.b.y - A.a.y) * (B.b.x - B.a.x);
    if (Math.abs(d) > 1e-9) {
      const s = ((B.a.x - A.a.x) * (B.b.y - B.a.y) - (B.a.y - A.a.y) * (B.b.x - B.a.x)) / d;
      const x = { x: A.a.x + s * (A.b.x - A.a.x), y: A.a.y + s * (A.b.y - A.a.y) };
      const reach = 3 * gap + 1;   // the corner must be about where the gap is
      if (dist(x, pa) <= reach && dist(x, pb) <= reach) {
        const na = moveEnd(A, endA, x)!, nb = moveEnd(B, endB, x)!;
        return { ok: true, entities: all.map((e) => (e.id === idA ? na : e.id === idB ? nb : e)), removed: [],
          added: [lineOf(A, pa, x), lineOf(B, pb, x)], message: `Gap closed at the corner (${gap.toFixed(2)} mm)` };
      }
    }
  }
  // a small gap: move a line end onto the other end (the line hardly turns); a larger gap, or
  // arcs and splines: bridge it with a new line, so no existing line changes direction
  const moved = gap <= MOVE_END_MM ? moveEnd(A, endA, pb) ?? moveEnd(B, endB, pa) : null;
  if (moved) return { ok: true, entities: all.map((e) => (e.id === moved.id ? moved : e)), removed: [],
    added: [lineOf(A, pa, pb)], message: `Gap closed (${gap.toFixed(2)} mm)` };
  const bridge = lineOf(A, pa, pb);
  return { ok: true, entities: [...all, bridge], removed: [], added: [bridge], message: `Gap bridged with a ${gap.toFixed(2)} mm line` };
}

/* ---- Erase and Align ----------------------------------------------------------------- */

/** Erase: removes the clicked object. */
export function eraseAt(all: Entity[], id: string): EditResult {
  const e = all.find((x) => x.id === id);
  if (!e) return { ok: false, message: "Nothing to erase here" };
  return { ok: true, entities: all.filter((x) => x.id !== id), removed: [e], added: [],
    message: `${e.kind === "line" ? "Line" : e.kind === "arc" ? "Arc" : e.kind === "circle" ? "Circle" : "Spline"} erased` };
}

const rotPt = (p: Pt, c: Pt, d: number): Pt => {
  const a = rad(d), cos = Math.cos(a), sin = Math.sin(a);
  return { x: c.x + (p.x - c.x) * cos - (p.y - c.y) * sin, y: c.y + (p.x - c.x) * sin + (p.y - c.y) * cos };
};

/** Turns an entity by d degrees counter-clockwise about c. */
export function rotateEntity(e: Entity, c: Pt, d: number): Entity {
  switch (e.kind) {
    case "line": return { ...e, a: rotPt(e.a, c, d), b: rotPt(e.b, c, d) };
    case "circle": return { ...e, c: rotPt(e.c, c, d) };
    case "arc": return { ...e, c: rotPt(e.c, c, d), start: norm(e.start + d), end: norm(e.end + d) };
    case "spline": return { ...e, fit: e.fit.map((p) => rotPt(p, c, d)) };
  }
}

/**
 * Align H / Align V: turns the whole part counter-clockwise about its centre until the
 * clicked straight line is horizontal (H) or vertical (V). Always CCW, by the smallest
 * such angle (0 to 180 degrees).
 */
export function alignAt(all: Entity[], id: string, to: "h" | "v", points?: { id: string; p: Pt; layer?: string }[]): EditResult {
  const e = all.find((x) => x.id === id);
  if (!e) return { ok: false, message: "Click a line" };
  if (e.kind !== "line") return { ok: false, message: "Click a straight line to align the part to" };
  const dir = norm(deg(Math.atan2(e.b.y - e.a.y, e.b.x - e.a.x))) % 180;   // 0..180, direction of the line
  const target = to === "h" ? 0 : 90;
  let turn = (((target - dir) % 180) + 180) % 180;                         // CCW, 0..180
  if (turn < 1e-7 || 180 - turn < 1e-7) return { ok: false, message: `This line is already ${to === "h" ? "horizontal" : "vertical"}` };
  turn = Math.round(turn * 1e9) / 1e9;
  // centre of the part's extents
  // (a loop, not Math.min(...points): large drawings have too many points for that)
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const x of all) for (const p of pointsAlong(x)) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const c = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  // every point turns with the same sin/cos, so lines that met still meet
  const rotated = all.map((x) => rotateEntity(x, c, turn));
  const shown = Math.abs(turn - Math.round(turn)) < 1e-6 ? String(Math.round(turn)) : turn.toFixed(2);
  return { ok: true, entities: rotated, removed: [], added: [e], points: points?.map((x) => ({ ...x, p: rotPt(x.p, c, turn) })),
    message: `Part turned ${shown}° counter-clockwise: the line is now ${to === "h" ? "horizontal" : "vertical"}` };
}

/** How far (degrees, CCW) Align would turn the part for this line, for the hover hint. */
export function alignTurn(e: Entity, to: "h" | "v"): number | null {
  if (e.kind !== "line") return null;
  const dir = norm(deg(Math.atan2(e.b.y - e.a.y, e.b.x - e.a.x))) % 180;
  const turn = ((((to === "h" ? 0 : 90) - dir) % 180) + 180) % 180;
  return turn < 1e-7 || 180 - turn < 1e-7 ? 0 : turn;
}
