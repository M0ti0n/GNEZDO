// The cut path of a sheet (Process -> Auto cut -> PROCESS): for every part its contours in cutting
// order, each with a lead-in and lead-out, and the parts in an order that never cuts a part loose
// before what lies in it. Sheet frame (mm, y down, as the sheet is drawn); the head travels from the
// machine's 0,0 corner from one lead-in to the next.
//
// Always: tracing first, then open cuts, holes, the outline last; a part lying in another part's hole
// before that part. Then the machine's Big parts last (within the big part's bounding box), then the
// order picked under AUTO CUT. Outlines are cut clockwise, holes counter-clockwise, as the machine
// sees them (its X / Y from its 0,0 corner): the scrap is on the left, where the kerf goes (G41). With a
// 0,0 corner that mirrors the sheet as drawn (top-left, bottom-right) that is the other way round on screen.
//
// Common cut (machine can, parts with the Common cut rule nested a kerf apart along their marked
// lines): the parts make a block, cut as one: their holes, each shared line once (job/commonPath.ts),
// then the block's outline.

import { api } from "../api/api";
import { checkGeometry, pointsAlong, roleOf } from "../import/geometry";
import { DEFAULT_ANGLE, LEAD_TYPES, leadRulesOf, type LeadRules, type LeadType } from "./leads";
import { commonEdges, partCommonLines, placedEdges, type CommonEdge } from "./commonCut";
import { commonBlocks, sharedLineCut, type CommonBlock } from "./commonPath";
import { cutOrderOf, gapsFor, machineCan, type Machine, type Origin } from "./machine";
import { partLoops, pointIn, transform, type Box, type Pt } from "./manualGeom";
import type { NestedSheet, PlacedPart } from "./nest";
import { TRACE_SHORTEST_FROM_MM, techRowFor, traceShortestOf, type TechRow } from "./technology";

/** The order picked under AUTO CUT. */
export type CutRule = "leftRight" | "rightLeft" | "bottomTop" | "topBottom" | "shortest" | "smallBig";

export const CUT_RULES: { id: CutRule; label: string; hint: string }[] = [
  { id: "leftRight", label: "Left to right", hint: "Columns from the left edge to the right, up and down in turn" },
  { id: "bottomTop", label: "Bottom to top", hint: "Rows from the bottom edge up, left and right in turn" },
  { id: "rightLeft", label: "Right to left", hint: "Columns from the right edge to the left (for counter-clockwise cutting)" },
  { id: "topBottom", label: "Top to bottom", hint: "Rows from the top edge down (for counter-clockwise cutting)" },
  { id: "shortest", label: "Shortest distance", hint: "Always the nearest part next" },
  { id: "smallBig", label: "Smallest to biggest", hint: "Parts by their area, the smallest first" },
];

export type CutKind = "outer" | "inner" | "open" | "trace";

/** One contour as it is cut: the pierce at leadIn[0] (or pts[0] without a lead), the cut along pts, out along leadOut. */
export interface CutContour {
  /** the part's index in the sheet's parts */
  part: number;
  kind: CutKind;
  pts: Pt[];
  leadIn: Pt[];
  leadOut: Pt[];
  /** cut at the small-hole speed */
  small?: boolean;
  lead?: LeadType;
  /** the lead values set by hand (Process → Lead in / out); missing: the Technology row's */
  spec?: LeadSpec;
  /** a common cut block's outline: every part of the block (the cut path is good while they all stay put) */
  parts?: number[];
  /** a shared common cut line (cut once for two parts, along the middle of the kerf gap) */
  common?: boolean;
  /** Process → Movement: the rapid to this contour goes through these points; only while the contour
   *  before it is still `after` (contourKey; "origin": it is the first), else they are dropped */
  via?: { pts: Pt[]; after: string };
  /** Process → Break cut: the outline is cut in pieces, one per start of the plan (this is piece `piece`) */
  bc?: { plan: BreakPlan; piece: number };
  /** this piece starts again right after a micro joint (no lead-in; the Technology row's MJ restart) */
  restart?: boolean;
  /** Process → Inline cut: a stretch of a contour, cut in a pass along `axis` with the stretches in line
   *  with it; `rev`: against the contour's direction (kerf compensation the other side); w × h: the
   *  whole contour's size (its size class) */
  inline?: { axis: "x" | "y"; rev: boolean; pierce: "pierce" | "quick" | "none"; w: number; h: number };
  /** Process → Common pierce: this outline starts from the group's pierce point `at` (its lead-in from
   *  there); `orig`: its own leads, to go back to */
  cp?: { id: string; at: Pt; orig: { leadIn: Pt[]; leadOut: Pt[]; pts?: Pt[]; lead?: LeadType; spec?: LeadSpec } };
}

/** Where an outline starts (one piece each), in cut order along it: the original lead, or a break cut
 *  (BC: dropped there, the gap behind it; manual: from balloon 1 (`p1`, where the cut stops) to `at`). */
export interface BreakStart { at: Pt; type: LeadType; spec: LeadSpec; tag: "orig" | "bc" | "manual" | "mj"; p1?: Pt }
/** `orig`: the contour's own lead after a break or joint took its place (kept to bring it back) */
export interface BreakPlan { id: string; starts: BreakStart[]; orig?: BreakStart }

/** A contour's name that stays when its leads change: the part, the kind and the box of its line. */
export function contourKey(c: CutContour): string {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of c.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const r = (v: number) => (Math.round(v * 10) / 10).toFixed(1);
  return `${c.parts ? `b${c.parts.join(".")}` : c.part}:${c.kind}${c.common ? "c" : ""}${c.inline ? `i${c.inline.axis}` : ""}:${r(x0)},${r(y0)},${r(x1)},${r(y1)}`;
}

/** The points the rapid to `c` goes through (none when the contour before it is no longer the one they were made for). */
export const viaOf = (c: CutContour, prev: CutContour | undefined): Pt[] =>
  c.via && c.via.pts.length && c.via.after === (prev ? contourKey(prev) : "origin") ? c.via.pts : [];

export interface SheetCut {
  at: string;
  rule: CutRule | "manual";
  contours: CutContour[];
  /** per part index: where the part was when it was processed (moved since: not processed any more) */
  keys: Record<number, string>;
  /** made for a 0,0 corner that mirrors the sheet as drawn (outlines counter-clockwise on screen); missing = not */
  mirrored?: boolean;
}

/** What PROCESS does with the parts it gets. */
export type CutWhat = "all" | "trace" | "internal";

export const partKey = (p: PlacedPart) => `${p.partId}|${p.x.toFixed(3)}|${p.y.toFixed(3)}|${p.angle}|${p.mirror ? 1 : 0}`;

/** The parts of the sheet whose cut path is still good. */
export function processedParts(sheet: NestedSheet): Set<number> {
  const c = sheet.cut;
  const out = new Set<number>();
  if (!c) return out;
  const good = (i: number) => { const p = sheet.parts[i]; return !!p && c.keys[i] === partKey(p); };
  // a common cut block counts only while every part of it is where it was
  const bad = new Set<number>();
  for (const ct of c.contours) if (ct.parts && !ct.parts.every(good)) ct.parts.forEach((i) => bad.add(i));
  for (const ct of c.contours) for (const i of ct.parts ?? [ct.part]) if (good(i) && !bad.has(i)) out.add(i);
  return out;
}

/** The contours still good, in cutting order. */
export const liveContours = (sheet: NestedSheet): CutContour[] => {
  const ok = processedParts(sheet);
  return (sheet.cut?.contours ?? []).filter((c) => (c.parts ?? [c.part]).every((i) => ok.has(i)));
};

/** The machine's 0,0 on the sheet (sheet frame). */
export const originPoint = (sheet: Pick<NestedSheet, "lengthMm" | "widthMm">, origin: Origin): Pt =>
  [origin.endsWith("right") ? sheet.lengthMm : 0, origin.startsWith("bottom") ? sheet.widthMm : 0];

/** The sheet as drawn has y down, the machine Y up: a 0,0 corner flipping one axis keeps the turning
 *  sense, none (top-left) or both (bottom-right) mirror it. */
export const originMirrors = (origin: Origin) => origin.startsWith("top") === origin.endsWith("left");

// ------------------------------------------------------------------ tracing and open cut lines of a part

export type Marks = { trace: Pt[][]; open: Pt[][] };
const markCache = new Map<string, { at: number; marks: Promise<Marks> }>();

/** Parts were saved (their drawings may have changed): their marks are read again. */
export const forgetPartMarks = () => markCache.clear();

/** A part's trace and open cut lines in its outline's frame (as the thumbnail path: y down), joined into runs. */
export function partMarks(partId: string): Promise<Marks> {
  let r = markCache.get(partId);
  if (!r || Date.now() - r.at > 60_000) {
    r = { at: Date.now(), marks: loadMarks(partId) };
    markCache.set(partId, r);
  }
  return r.marks;
}

async function loadMarks(partId: string): Promise<Marks> {
  const g = await api.partGeometry(partId).catch(() => null);
  const ents = g?.entities ?? [];
  const marks = ents.filter((e) => roleOf(e) === "trace" || roleOf(e) === "openCut");
  if (!marks.length) return { trace: [], open: [] };
  const report = checkGeometry(ents);
  const box = report.contours.find((c) => c.closed && c.outer)?.box ?? report.box;
  const f = (q: { x: number; y: number }): Pt => [q.x - box.minX, box.maxY - q.y];
  const runs = (role: string) => chain(marks.filter((e) => roleOf(e) === role).map((e) => pointsAlong(e).map(f)));
  return { trace: runs("trace"), open: runs("openCut") };
}

const near = (a: Pt, b: Pt, tol = 0.05) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;

/** Lines that meet end to end joined into one run (one pierce). */
function chain(lines: Pt[][]): Pt[][] {
  const left = lines.filter((l) => l.length > 1);
  const out: Pt[][] = [];
  while (left.length) {
    let run = left.shift()!;
    for (let grew = true; grew;) {
      grew = false;
      for (let k = 0; k < left.length; k++) {
        const l = left[k];
        const a = run[0], b = run[run.length - 1];
        if (near(b, l[0])) run = [...run, ...l.slice(1)];
        else if (near(b, l[l.length - 1])) run = [...run, ...l.slice(0, -1).reverse()];
        else if (near(a, l[l.length - 1])) run = [...l.slice(0, -1), ...run];
        else if (near(a, l[0])) run = [...l.slice(1).reverse(), ...run];
        else continue;
        left.splice(k, 1);
        grew = true;
        break;
      }
    }
    out.push(run);
  }
  return out;
}

// ------------------------------------------------------------------ geometry helpers

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const mul = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k];
const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1];
const len = (a: Pt) => Math.hypot(a[0], a[1]);
const unit = (a: Pt): Pt => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
const rot = (v: Pt, deg: number): Pt => { const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r); return [v[0] * c - v[1] * s, v[0] * s + v[1] * c]; };
/** The scrap side of a cut going along d: left of it as the machine sees it (side -1: mirrored on screen). */
const scrapN = (d: Pt, side: 1 | -1): Pt => [side * d[1], -side * d[0]];
const r2 = (p: Pt): Pt => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100];
/** Shoelace in the sheet frame: > 0 clockwise as seen on the sheet (y down). */
const signedArea = (lp: Pt[]) => lp.reduce((s, p, i) => { const q = lp[(i + 1) % lp.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
const boxOf = (pts: Pt[]): Box => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1 };
};
const touches = (a: Box, b: Box) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;

/** Without a repeated closing point; clockwise (as seen) when cw, else counter-clockwise. */
export function oriented(lp: Pt[], cw: boolean): Pt[] {
  let l = lp.length > 1 && near(lp[0], lp[lp.length - 1], 1e-6) ? lp.slice(0, -1) : lp.slice();
  l = l.filter((p, i) => i === 0 || !near(p, l[i - 1], 1e-6));
  return (signedArea(l) > 0) === cw ? l : l.reverse();
}

/** Distance from p along d to the loop (Infinity: it does not meet it). */
function rayHit(lp: Pt[], p: Pt, d: Pt): number {
  let best = Infinity;
  for (let i = 0; i < lp.length; i++) {
    const a = lp[i], b = lp[(i + 1) % lp.length];
    const e = sub(b, a);
    const den = d[0] * e[1] - d[1] * e[0];
    if (Math.abs(den) < 1e-12) continue;
    const w = sub(a, p);
    const t = (w[0] * e[1] - w[1] * e[0]) / den;
    const u = (w[0] * d[1] - w[1] * d[0]) / den;
    if (t > 1e-4 && u >= -1e-9 && u <= 1 + 1e-9) best = Math.min(best, t);
  }
  return best;
}

/** Walks along the polyline from its start for `dist` mm (the points passed and the point reached). */
function walk(pts: Pt[], dist: number): Pt[] {
  const out: Pt[] = [pts[0]];
  let left = dist;
  for (let i = 1; i < pts.length && left > 1e-9; i++) {
    const seg = len(sub(pts[i], pts[i - 1]));
    if (seg >= left) { out.push(add(pts[i - 1], mul(unit(sub(pts[i], pts[i - 1])), left))); return out; }
    out.push(pts[i]);
    left -= seg;
  }
  return out;
}

/** Quarter arc from `from` round to `to`: the points between them (both included). */
function arcPts(c: Pt, from: Pt, to: Pt, n = 8): Pt[] {
  const a0 = Math.atan2(from[1] - c[1], from[0] - c[0]);
  let a1 = Math.atan2(to[1] - c[1], to[0] - c[0]);
  while (a1 - a0 > Math.PI) a1 -= 2 * Math.PI;
  while (a0 - a1 > Math.PI) a1 += 2 * Math.PI;
  const r = len(sub(from, c));
  return Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)] as Pt; });
}

// ------------------------------------------------------------------ leads

/** A lead pair's values: lengths, gap (+ overlap, − stops short), angles [°], arc radius [mm]. */
export interface LeadSpec { lin: number; lout: number; gap: number; aIn: number; aOut: number; radius: number }
type LeadValues = LeadSpec;

/** What the Technology row gives a lead type (the automatic cut's values). */
export function leadValues(kind: "outer" | "inner", row: TechRow | null, type: LeadType): LeadValues {
  const outer = kind === "outer";
  const lin = row ? (outer ? row.outLeadInMm : row.holeLeadInMm) || 0 : outer ? 5 : 3;
  const lout = row ? (outer ? row.outLeadOutMm : row.holeLeadOutMm) || 0 : outer ? 2 : 1;
  const usesGap = type === "perpGap" || type === "angled" || type === "arc" || type === "cornerGap";
  const gap = usesGap && row ? (outer ? row.outGapMm : row.holeGapMm) ?? 0 : 0;
  const def = DEFAULT_ANGLE[type] ?? 90;
  return {
    lin, lout, gap,
    aIn: (row?.leadInAngle || 0) > 0 && (type === "cornerAngle" || type === "angled") ? row!.leadInAngle! : def,
    aOut: (row?.leadOutAngle || 0) > 0 && (type === "cornerAngle" || type === "angled") ? row!.leadOutAngle! : def,
    radius: (row ? (outer ? row.outLeadRadiusMm : row.holeLeadRadiusMm) : 0) || Math.max(1, lin),
  };
}

export const cornerOnly = (t: LeadType) => !!LEAD_TYPES.find((x) => x.id === t)?.cornerOnly;

/** The point of the part's box the leads are put nearest to. */
const targetOf = (b: Box, rules: LeadRules): Pt => [rules.place.endsWith("right") ? b.x1 : b.x0, rules.place.startsWith("bottom") ? b.y1 : b.y0];

/**
 * A closed contour with its leads: started at a sharp corner nearest the target with the corner type,
 * else at the point of a straight stretch nearest it with the other type.
 */
function closedContour(lp: Pt[], kind: "outer" | "inner", rules: LeadRules, row: TechRow | null, target: Pt, side: 1 | -1): Omit<CutContour, "part" | "kind"> {
  const n = lp.length;
  const prev = (i: number) => lp[(i - 1 + n) % n], next = (i: number) => lp[(i + 1) % n];
  const cType = kind === "outer" ? rules.outCorner : rules.holeCorner;
  let oType = kind === "outer" ? rules.outOther : rules.holeOther;
  if (cornerOnly(oType)) oType = "perp";
  const angleAt = (i: number) => cornerAngle(lp, i, side);

  let start: { at: Pt; edge: number; vertex: boolean; t: Pt } | null = null;
  let type: LeadType = oType;
  // a window (not a round hole): the middle of a radius, else well away from its corners
  if (kind === "inner" && !isRound(lp)) start = windowStart(lp, target, leadValues(kind, row, oType).lin);
  if (!start && cornerOnly(cType)) {
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      if (len(sub(lp[i], prev(i))) < 0.5 || len(sub(next(i), lp[i])) < 0.5) continue;
      if (angleAt(i) > rules.sharpMaxDeg) continue;
      const d = len(sub(lp[i], target));
      if (d < best) { best = d; start = { at: lp[i], edge: i, vertex: true, t: unit(sub(next(i), lp[i])) }; }
    }
    if (start) type = cType;
  }
  if (!start) {
    const v0 = leadValues(kind, row, oType);
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      const a = lp[i], b = next(i), e = sub(b, a), L = len(e);
      if (L < 1e-6) continue;
      const t = unit(e);
      if (L >= 2) {
        // a point of the edge, kept off its corners
        const m = Math.min(L / 2, Math.max(1, v0.lin * 0.5));
        const s = Math.max(m, Math.min(L - m, dot(sub(target, a), t)));
        const p = add(a, mul(t, s));
        const d = len(sub(p, target));
        if (d < best) { best = d; start = { at: p, edge: i, vertex: false, t }; }
      } else if (Math.abs(angleAt(i) - 180) < 25) {
        // a point of a curve drawn in short pieces
        const d = len(sub(a, target));
        const tt = unit(add(unit(sub(a, prev(i))), t));
        if (d < best) { best = d; start = { at: a, edge: i, vertex: true, t: tt }; }
      }
    }
  }
  if (!start) start = { at: lp[0], edge: 0, vertex: true, t: unit(sub(next(0), lp[0])) };
  return leadsAt(lp, kind, rules, row, start, type, leadValues(kind, row, type), side);
}

export interface LeadStart { at: Pt; edge: number; vertex: boolean; t: Pt }

/** The material angle at corner i of a loop [°] (the material on the right of the cut). */
export function cornerAngle(lp: Pt[], i: number, side: 1 | -1): number {
  const n = lp.length;
  const e1 = unit(sub(lp[i], lp[(i - 1 + n) % n])), e2 = unit(sub(lp[(i + 1) % n], lp[i]));
  const u = mul(e1, -1);
  const phi = (Math.acos(Math.max(-1, Math.min(1, dot(u, e2)))) * 180) / Math.PI;
  const b = add(u, e2);
  if (len(b) < 1e-9) return 180;
  const matN: Pt = [-side * e2[1], side * e2[0]];
  return dot(b, matN) > 0 ? phi : 360 - phi;
}

/** A closed contour started at `start` with this lead pair (by hand: Process → Lead in / out). */
export function leadsAt(lp: Pt[], kind: "outer" | "inner", rules: LeadRules, row: TechRow | null, start: LeadStart, type: LeadType, v: LeadSpec, side: 1 | -1): Omit<CutContour, "part" | "kind"> {
  const n = lp.length;
  const prev = (i: number) => lp[(i - 1 + n) % n];

  // the contour from the start round to it again
  const ring: Pt[] = [start.at];
  for (let k = 1; k <= n; k++) ring.push(lp[(start.edge + k) % n]);
  if (start.vertex) ring[ring.length - 1] = start.at; else ring.push(start.at);
  let pts = ring;
  if (v.gap > 0) pts = [...ring, ...walk(ring, v.gap).slice(1)];
  else if (v.gap < 0) pts = walk(ring, Math.max(0, totalLen(ring) + v.gap));

  // a hole's leads stay in the hole: at most to its middle along the lead
  const limit = (p: Pt, d: Pt, want: number) => {
    if (kind !== "inner" || !rules.holeShorten) return want;
    const hit = rayHit(lp, p, d);
    return Number.isFinite(hit) ? Math.min(want, hit / 2) : want;
  };

  const P = start.at, end = pts[pts.length - 1];
  const tEnd = unit(sub(end, pts[pts.length - 2] ?? P));
  let leadIn: Pt[] = [], leadOut: Pt[] = [];
  if (type === "corner" || type === "cornerAngle") {
    const e1 = unit(sub(P, prev(start.edge))), e2 = start.t;
    let dIn: Pt, dOut: Pt;
    if (type === "corner") { dIn = mul(e2, -1); dOut = e1; }
    else {
      // turned from the incoming edge's line by the angle, towards the outgoing edge's back side (and the other way out)
      const towards = (from: Pt, to: Pt, deg: number) => { const s = from[0] * to[1] - from[1] * to[0] >= 0 ? 1 : -1; return rot(from, s * deg); };
      dIn = towards(e1, mul(e2, -1), v.aIn);
      dOut = towards(mul(e2, -1), e1, v.aOut);
    }
    const li = limit(P, dIn, v.lin), lo = limit(P, dOut, v.lout);
    if (li > 0) leadIn = [add(P, mul(dIn, li)), P];
    if (lo > 0) leadOut = [end, add(end, mul(dOut, lo))];
  } else if (type === "cornerGap") {
    // in line at the corner (as Corner, in line); out after the gap, at the angle from the edge, to the scrap side
    const dIn = mul(start.t, -1);
    const rad = (d: number) => (d * Math.PI) / 180;
    const dOut = unit(add(mul(tEnd, Math.cos(rad(v.aOut))), mul(scrapN(tEnd, side), Math.sin(rad(v.aOut)))));
    const li = limit(P, dIn, v.lin), lo = limit(end, dOut, v.lout);
    if (li > 0) leadIn = [add(P, mul(dIn, li)), P];
    if (lo > 0) leadOut = [end, add(end, mul(dOut, lo))];
  } else if (type === "arc") {
    const nP = scrapN(start.t, side), nE = scrapN(tEnd, side);
    const R = Math.min(v.radius, limit(P, nP, v.radius * 2) / 2 || v.radius);
    const c = add(P, mul(nP, R));
    const s1 = add(c, rot(mul(nP, -R), 90)), s2 = add(c, rot(mul(nP, -R), -90));
    const S = dot(sub(s1, P), start.t) < 0 ? s1 : s2;
    leadIn = arcPts(c, S, P);
    const c2 = add(end, mul(nE, R));
    const e1 = add(c2, rot(mul(nE, -R), 90)), e2 = add(c2, rot(mul(nE, -R), -90));
    leadOut = arcPts(c2, end, dot(sub(e1, end), tEnd) > 0 ? e1 : e2);
  } else {
    // perpendicular (90°) or at an angle to the edge, from the scrap side
    const aIn = type === "angled" ? v.aIn : 90, aOut = type === "angled" ? v.aOut : 90;
    const rad = (d: number) => (d * Math.PI) / 180;
    const dIn = unit(add(mul(start.t, -Math.cos(rad(aIn))), mul(scrapN(start.t, side), Math.sin(rad(aIn)))));
    const dOut = unit(add(mul(tEnd, Math.cos(rad(aOut))), mul(scrapN(tEnd, side), Math.sin(rad(aOut)))));
    const li = limit(P, dIn, v.lin), lo = limit(end, dOut, v.lout);
    if (li > 0) leadIn = [add(P, mul(dIn, li)), P];
    if (lo > 0) leadOut = [end, add(end, mul(dOut, lo))];
  }
  const b = boxOf(lp);
  const small = kind === "inner" && !!row && row.smallHoleMm > 0 && (b.x1 - b.x0 + b.y1 - b.y0) / 2 <= row.smallHoleMm;
  return { pts: pts.map(r2), leadIn: leadIn.map(r2), leadOut: leadOut.map(r2), lead: type, ...(small ? { small } : {}) };
}

/** Signed turn at each vertex [°] (+ / − by the loop's sense). */
function turns(lp: Pt[]): number[] {
  const n = lp.length;
  return lp.map((p, i) => {
    const a = unit(sub(p, lp[(i - 1 + n) % n])), b = unit(sub(lp[(i + 1) % n], p));
    return (Math.atan2(a[0] * b[1] - a[1] * b[0], dot(a, b)) * 180) / Math.PI;
  });
}

/** A round hole: every vertex turns a little the same way, all at about the same distance from the middle. */
function isRound(lp: Pt[]): boolean {
  if (lp.length < 8) return false;
  const t = turns(lp);
  if (!t.every((x) => Math.abs(x) < 25 && Math.sign(x) === Math.sign(t[0]))) return false;
  const c: Pt = [lp.reduce((s, p) => s + p[0], 0) / lp.length, lp.reduce((s, p) => s + p[1], 0) / lp.length];
  const r = lp.map((p) => len(sub(p, c)));
  const mean = r.reduce((s, x) => s + x, 0) / r.length;
  return r.every((x) => Math.abs(x - mean) <= 0.03 * mean + 0.05);
}

/**
 * Where the leads go on a window (an inner contour that is not a round hole): the middle of its arc
 * (a radius) nearest the target if it has one, else on a straight side at least 2 × the lead-in from
 * its corners (the middle of a side too short for that), nearest the target.
 */
function windowStart(lp: Pt[], target: Pt, lin: number): { at: Pt; edge: number; vertex: boolean; t: Pt } | null {
  const n = lp.length;
  const t = turns(lp);
  const curved = (i: number) => Math.abs(t[i]) >= 0.5 && Math.abs(t[i]) < 25;
  // points along the loop from vertex i, `d` mm on
  const along = (i: number, d: number): { at: Pt; edge: number; vertex: boolean; t: Pt } => {
    let k = i, left = d;
    for (let guard = 0; guard < n; guard++) {
      const a = lp[k], b = lp[(k + 1) % n], L = len(sub(b, a));
      if (left < L - 1e-6) {
        if (left < 1e-6) return { at: a, edge: k, vertex: true, t: unit(add(unit(sub(a, lp[(k - 1 + n) % n])), unit(sub(b, a)))) };
        return { at: add(a, mul(unit(sub(b, a)), left)), edge: k, vertex: false, t: unit(sub(b, a)) };
      }
      left -= L; k = (k + 1) % n;
    }
    return { at: lp[i], edge: i, vertex: true, t: unit(sub(lp[(i + 1) % n], lp[i])) };
  };
  const segLen = (k: number) => len(sub(lp[(k + 1) % n], lp[k]));
  const lens = lp.map((_, k) => segLen(k));
  const med = lens.slice().sort((x, y) => x - y)[Math.floor(n / 2)];
  const short = (k: number) => lens[(k + n) % n] <= 4 * med;
  // vertex v joins two pieces of one arc: both segments short, a small turn
  const links = (v: number) => curved(v) && short(v - 1) && short(v) && (Math.sign(t[v]) === Math.sign(t[(v - 1 + n) % n]) || !curved((v - 1 + n) % n));
  const cands: { at: Pt; edge: number; vertex: boolean; t: Pt }[] = [];
  const first = lp.findIndex((_, v) => !links(v));
  if (first < 0) return null;
  // arcs: runs of short segments joined by small turns of one sense
  for (let s0 = 0; s0 < n; s0++) {
    const k0 = (first + s0) % n;
    if (links(k0) || !short(k0)) continue;
    let k = k0, L = lens[k0], turn = curved(k0) ? t[k0] / 2 : 0;
    while (links((k + 1) % n) && (k + 1) % n !== k0) { k = (k + 1) % n; L += lens[k]; turn += t[k]; }
    const end = (k + 1) % n;
    if (curved(end)) turn += t[end] / 2;
    if (k !== k0 && Math.abs(turn) >= 20) cands.push(along(k0, L / 2));
  }
  if (!cands.length) {
    // straight sides between corners (collinear pieces count as one side)
    const corner = (v: number) => Math.abs(t[v]) >= 0.5;
    const c0 = lp.findIndex((_, v) => corner(v));
    if (c0 < 0) return null;
    for (let s0 = 0; s0 < n; s0++) {
      const i0 = (c0 + s0) % n;
      if (!corner(i0)) continue;
      let j = (i0 + 1) % n, L = lens[i0];
      while (!corner(j) && j !== i0) { L += lens[j]; j = (j + 1) % n; }
      const off = 2 * lin;
      const a0 = lp[i0], e = unit(sub(lp[(i0 + 1) % n], a0));
      const want = Math.max(0, Math.min(L, dot(sub(target, a0), e)));
      const d = off > L / 2 ? L / 2 : Math.max(off, Math.min(L - off, want));
      cands.push(along(i0, d));
    }
  }
  if (!cands.length) return null;
  return cands.reduce((b, c) => (len(sub(c.at, target)) < len(sub(b.at, target)) ? c : b));
}

const totalLen = (pts: Pt[]) => pts.reduce((s, p, i) => (i ? s + len(sub(p, pts[i - 1])) : 0), 0);

// ------------------------------------------------------------------ parts and their order

interface PartGeo { i: number; outer: Pt[]; holes: Pt[][]; trace: Pt[][]; open: Pt[][]; box: Box; area: number }

async function partGeos(sheet: NestedSheet, paths: Map<string, string>, idx: number[], wantMarks: boolean, mirrored: boolean): Promise<PartGeo[]> {
  return Promise.all(idx.map(async (i) => {
    const p = sheet.parts[i];
    const path = paths.get(p.partId) ?? "";
    const f = transform(p);
    const loops = partLoops(path).map((lp) => lp.map(f));
    const marks = wantMarks ? await partMarks(p.partId) : { trace: [], open: [] };
    const outer = loops[0] ? oriented(loops[0], !mirrored) : [];
    return {
      i, outer, holes: loops.slice(1).map((lp) => oriented(lp, mirrored)),
      trace: marks.trace.map((l) => l.map(f)), open: marks.open.map((l) => l.map(f)),
      box: boxOf(outer), area: Math.abs(signedArea(outer)),
    };
  }));
}

interface El { parts: number[]; box: Box; area: number }

const center = (b: Box): Pt => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
const median = (v: number[]) => { const s = v.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

/** Elements in the order of the rule (columns / rows go back and forth). */
function sortEls(els: El[], rule: CutRule, from: Pt): El[] {
  if (els.length < 2) return els.slice();
  if (rule === "smallBig") return els.slice().sort((a, b) => a.area - b.area);
  if (rule === "shortest") {
    const left = els.slice(), out: El[] = [];
    let at = from;
    while (left.length) {
      let k = 0, best = Infinity;
      left.forEach((e, j) => { const d = len(sub(center(e.box), at)); if (d < best) { best = d; k = j; } });
      const e = left.splice(k, 1)[0];
      out.push(e);
      at = center(e.box);
    }
    return out;
  }
  const cols = rule === "leftRight" || rule === "rightLeft";
  const size = median(els.map((e) => (cols ? e.box.x1 - e.box.x0 : e.box.y1 - e.box.y0)));
  const band = Math.max(30, Math.min(600, size || 100));
  // distance of an element's leading edge from where the sweep starts
  const lead = (e: El) => rule === "leftRight" ? e.box.x0 : rule === "rightLeft" ? -e.box.x1 : rule === "bottomTop" ? -e.box.y1 : e.box.y0;
  const across = (e: El) => (cols ? -center(e.box)[1] : center(e.box)[0]);   // columns: bottom up first; rows: left first
  const base = Math.min(...els.map(lead));
  return els.map((e) => ({ e, b: Math.floor((lead(e) - base) / band), a: across(e) }))
    .sort((p, q) => p.b - q.b || (p.b % 2 ? q.a - p.a : p.a - q.a))
    .map((x) => x.e);
}

/** The parts in cutting order (see the top of this file). */
function orderParts(geos: PartGeo[], rule: CutRule, machine: Machine, sheet: NestedSheet, from: Pt): number[] {
  const by = new Map(geos.map((g) => [g.i, g]));
  // a part in another part's hole: that part (the smallest one holding it) is its container
  const container = new Map<number, number>();
  for (const g of geos) {
    const p = g.outer[0];
    if (!p) continue;
    let best: PartGeo | null = null;
    for (const h of geos) {
      if (h === g || h.area <= g.area || !touches(h.box, g.box)) continue;
      if (h.holes.some((lp) => pointIn(lp, p[0], p[1])) && (!best || h.area < best.area)) best = h;
    }
    if (best) container.set(g.i, best.i);
  }
  const kids = new Map<number, number[]>();
  for (const [c, h] of container) kids.set(h, [...(kids.get(h) ?? []), c]);
  const unitOf = (i: number): El => {
    const g = by.get(i)!;
    const inner = sortEls((kids.get(i) ?? []).map(unitOf), rule, from).flatMap((e) => e.parts);
    return { parts: [...inner, i], box: g.box, area: g.area };
  };
  const top = geos.filter((g) => !container.has(g.i)).map((g) => unitOf(g.i));

  const co = cutOrderOf(machine);
  const sheetArea = sheet.lengthMm * sheet.widthMm;
  const med = median(top.map((e) => e.area));
  const isBig = (e: El) => co.bigLast && top.length > 1 && (e.area > co.bigTimesMedian * med || e.area > (co.bigSheetPct / 100) * sheetArea);
  const bigs = top.filter(isBig);
  // big parts whose boxes overlap make one box
  const groups: { bigs: El[]; box: Box }[] = [];
  for (const b of bigs.sort((x, y) => x.area - y.area)) {
    const hit = groups.filter((g) => touches(g.box, b.box));
    const merged = { bigs: [...hit.flatMap((g) => g.bigs), b], box: hit.reduce((u, g) => ({ x0: Math.min(u.x0, g.box.x0), y0: Math.min(u.y0, g.box.y0), x1: Math.max(u.x1, g.box.x1), y1: Math.max(u.y1, g.box.y1) }), b.box) };
    for (const g of hit) groups.splice(groups.indexOf(g), 1);
    groups.push(merged);
  }
  const taken = new Set<El>();
  const els: El[] = [];
  for (const g of groups) {
    const members = top.filter((e) => !isBig(e) && !taken.has(e) && touches(e.box, g.box));
    members.forEach((e) => taken.add(e));
    const parts = [...sortEls(members, rule, from).flatMap((e) => e.parts), ...g.bigs.sort((x, y) => x.area - y.area).flatMap((e) => e.parts)];
    els.push({ parts, box: g.box, area: Math.max(...g.bigs.map((e) => e.area)) });
  }
  for (const e of top) if (!isBig(e) && !taken.has(e)) els.push(e);
  return sortEls(els, rule, from).flatMap((e) => e.parts);
}

// ------------------------------------------------------------------ PROCESS

export interface CutRequest {
  sheet: NestedSheet;
  /** the parts' outline paths by part id */
  paths: Map<string, string>;
  machine: Machine;
  origin: Origin;
  rule: CutRule;
  /** the part indexes to process (null: every part); `ordered`: in this order (Selected parts) */
  parts: number[] | null;
  ordered?: boolean;
  what: CutWhat;
  /** tracing of this part is cut (Skip trace lines / the trace box of a selected part) */
  traceOf: (i: number) => boolean;
}

/** The sheet's cut path after PROCESS (every part: a new one; chosen parts: theirs replaced, put after the others). */
export async function processSheet(q: CutRequest): Promise<SheetCut> {
  const { sheet, machine } = q;
  let idx = q.parts ?? sheet.parts.map((_, i) => i);
  // a chosen part of a common cut block brings the block's other parts along (it is cut as one)
  if (q.parts && q.what === "all") {
    const more = new Set(idx);
    for (const c of sheet.cut?.contours ?? []) if (c.parts?.some((k) => more.has(k))) c.parts.forEach((k) => more.add(k));
    idx = [...idx, ...[...more].filter((k) => !idx.includes(k))];
  }
  const row = techRowFor(machine.technologies, sheet.material, sheet.thicknessMm)?.row ?? null;
  const rules = leadRulesOf(machine);
  const canTrace = machineCan(machine, "trace"), canOpen = machineCan(machine, "openCut");
  const mirrored = originMirrors(q.origin);
  const side = mirrored ? -1 : 1;
  const geos = await partGeos(sheet, q.paths, idx, q.what !== "internal" && (canTrace || canOpen), mirrored);
  const from = originPoint(sheet, q.origin);
  const order = q.ordered ? idx : orderParts(geos, q.rule, machine, sheet, from);
  const by = new Map(geos.map((g) => [g.i, g]));

  // common cut: parts a kerf apart along their marked lines make blocks, cut as one (job/commonPath.ts)
  const blockOf = new Map<number, CommonBlock>();
  const lastOf = new Map<CommonBlock, number>();
  const gaps = gapsFor(machine, sheet.material, sheet.thicknessMm);
  const kerf = sheet.kerfMm ?? gaps.kerfMm ?? 0;
  if (q.what === "all" && machineCan(machine, "commonCut") && geos.length > 1) {
    const withEdges = await Promise.all(geos.map(async (g) => {
      const p = sheet.parts[g.i];
      const lines = await partCommonLines(p.partId);
      const edges: CommonEdge[] = lines.length ? placedEdges(p, commonEdges(q.paths.get(p.partId) ?? "", lines)) : [];
      return { i: g.i, outer: g.outer, box: g.box, edges };
    }));
    if (withEdges.some((w) => w.edges.length)) {
      for (const b of commonBlocks(withEdges, kerf)) for (const i of b.members) blockOf.set(i, b);
      // a block is cut where its last part comes in the order (what lies in its parts' holes is done by then)
      for (const i of order) { const b = blockOf.get(i); if (b) lastOf.set(b, i); }
    }
  }

  const fresh: CutContour[] = [];
  let at = from;
  const startOf = (c: Omit<CutContour, "part" | "kind">) => c.leadIn[0] ?? c.pts[0];
  const endOf = (c: Omit<CutContour, "part" | "kind">) => c.leadOut[c.leadOut.length - 1] ?? c.pts[c.pts.length - 1];
  /** open runs from the end nearer the head */
  const openRuns = (runs: Pt[][], part: number, kind: "open" | "trace") => {
    const left = runs.filter((r) => r.length > 1).slice();
    while (left.length) {
      let k = 0, best = Infinity, rev = false;
      left.forEach((r, j) => {
        const a = len(sub(r[0], at)), b = len(sub(r[r.length - 1], at));
        if (a < best) { best = a; k = j; rev = false; }
        if (b < best) { best = b; k = j; rev = true; }
      });
      const r = left.splice(k, 1)[0];
      const pts = (rev ? r.slice().reverse() : r).map(r2);
      fresh.push({ part, kind, pts, leadIn: [], leadOut: [] });
      at = pts[pts.length - 1];
    }
  };
  for (const i of order) {
    const g = by.get(i);
    if (!g || !g.outer.length) continue;
    const target = targetOf(g.box, rules);
    if (q.what !== "internal") {
      if (canTrace && q.traceOf(i)) openRuns(g.trace, i, "trace");
      if (q.what === "trace") continue;
      if (canOpen) openRuns(g.open, i, "open");
    }
    // the holes, the nearest next
    const holes = g.holes.map((lp) => closedContour(lp, "inner", rules, row, targetOf(boxOf(lp), rules), side));
    while (holes.length) {
      let k = 0, best = Infinity;
      holes.forEach((h, j) => { const d = len(sub(startOf(h), at)); if (d < best) { best = d; k = j; } });
      const h = holes.splice(k, 1)[0];
      fresh.push({ part: i, kind: "inner", ...h });
      at = endOf(h);
    }
    if (q.what === "internal") continue;
    const blk = blockOf.get(i);
    if (blk) {
      if (lastOf.get(blk) !== i) continue;   // its outline: with the block's
      const members = blk.members;
      // scrap the block closes in, then the shared lines, then the block's outline
      for (const lp of blk.inner) {
        const h = closedContour(lp, "inner", rules, row, targetOf(boxOf(lp), rules), side);
        fresh.push({ part: i, kind: "inner", parts: members, ...h });
        at = endOf(h);
      }
      const inside = (p: Pt) => members.some((m) => { const mg = by.get(m); return !!mg && pointIn(mg.outer, p[0], p[1]); });
      const room = Math.max(0, (sheet.partGapMm ?? gaps.partGapMm) - kerf - 0.5);
      const ext = Math.min(row?.outLeadInMm || 3, room), extOut = Math.min(row?.outLeadOutMm || 1, room);
      const left = blk.lines.slice();
      while (left.length) {
        let k = 0, best = Infinity;
        left.forEach((l, j) => { const d = Math.min(len(sub(l[0], at)), len(sub(l[1], at))); if (d < best) { best = d; k = j; } });
        const c = sharedLineCut(left.splice(k, 1)[0], inside, at, ext, extOut, kerf, rules.common, row?.leadInAngle || 45, row?.leadOutAngle || 45);
        const cc = { pts: c.pts.map(r2), leadIn: c.leadIn.map(r2), leadOut: c.leadOut.map(r2) };
        fresh.push({ part: i, kind: "open", common: true, parts: members, ...cc });
        at = endOf(cc);
      }
      for (const lp of blk.outer) {
        const o = closedContour(lp, "outer", rules, row, targetOf(boxOf(lp), rules), side);
        fresh.push({ part: i, kind: "outer", parts: members, ...o });
        at = endOf(o);
      }
      continue;
    }
    const o = closedContour(g.outer, "outer", rules, row, target, side);
    fresh.push({ part: i, kind: "outer", ...o });
    at = endOf(o);
  }

  const keys: Record<number, string> = {};
  // chosen parts: their old contours of this kind go, the rest of the sheet's path stays before them
  let kept: CutContour[] = [];
  // the rest of the sheet's path stays only if it was made for the same 0,0 corner sense
  if (q.parts && !!sheet.cut?.mirrored === mirrored) {
    const good = processedParts(sheet);
    const chosen = new Set(idx);
    const drop = (c: CutContour) => chosen.has(c.part) && (q.what === "all" || (q.what === "trace" ? c.kind === "trace" : c.kind === "inner"));
    // a block one of whose parts is chosen goes whole
    const dropBlock = (c: CutContour) => q.what === "all" && !!c.parts?.some((k) => chosen.has(k));
    kept = (sheet.cut?.contours ?? []).filter((c) => (c.parts ?? [c.part]).every((k) => good.has(k)) && !drop(c) && !dropBlock(c));
    for (const c of kept) for (const k of c.parts ?? [c.part]) keys[k] = partKey(sheet.parts[k]);
  }
  for (const c of fresh) for (const k of c.parts ?? [c.part]) keys[k] = partKey(sheet.parts[k]);
  let contours = [...kept, ...fresh];
  // the sheet's tracing first, shortest rapids (not after a contour order picked by hand): on a laser the
  // Technology row says (not set: from 4 mm up), on other machines Settings -> Machines -> Cut order
  const traceShortest = machine.technology === "laser"
    ? (row ? traceShortestOf(row) : sheet.thicknessMm >= TRACE_SHORTEST_FROM_MM - 1e-6)
    : cutOrderOf(machine).traceShortest;
  if (traceShortest && !q.ordered) contours = tracesShortest(contours, from);
  return { at: new Date().toISOString(), rule: q.parts && q.ordered ? "manual" : q.rule, contours, keys, ...(mirrored ? { mirrored } : {}) };
}

/**
 * Every trace line of the sheet first, in the order of the shortest rapids from `from` (the 0,0): the
 * next one is the line whose nearer end is nearest to where the head is, cut from that end; then the
 * rest of the contours in their order. A few passes then turn a line round, or swap a stretch of the
 * order end for end, where that makes the rapids shorter (2-opt).
 */
export function tracesShortest(contours: CutContour[], from: Pt): CutContour[] {
  const traces = contours.filter((c) => c.kind === "trace" && c.pts.length > 1);
  const runs = traces.map((c) => ({ c, a: c.pts[0], b: c.pts[c.pts.length - 1] }));
  const d = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  // nearest neighbor: each step the nearer end of the nearest line
  const order: { c: CutContour; a: Pt; b: Pt }[] = [];
  const left = runs.slice();
  let at = from;
  while (left.length) {
    let k = 0, rev = false, best = Infinity;
    left.forEach((r, j) => {
      const da = d(at, r.a), db = d(at, r.b);
      if (da < best) { best = da; k = j; rev = false; }
      if (db < best) { best = db; k = j; rev = true; }
    });
    const r = left.splice(k, 1)[0];
    order.push(rev ? { c: r.c, a: r.b, b: r.a } : r);
    at = order[order.length - 1].b;
  }
  // 2-opt on the rapids (a closed trace starts and ends at the same point: turning it round changes nothing)
  const n = order.length;
  const startOf = (i: number) => (i < 0 ? from : order[i].b);
  for (let pass = 0; pass < 8 && n > 2 && n <= 400; pass++) {
    let better = false;
    for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) {
      // reversing order[i..j] (and each line in it): the rapids into i and out of j change
      const before = d(startOf(i - 1), order[i].a) + (j + 1 < n ? d(order[j].b, order[j + 1].a) : 0);
      const after = d(startOf(i - 1), order[j].b) + (j + 1 < n ? d(order[i].a, order[j + 1].a) : 0);
      if (after < before - 1e-6) {
        const seg = order.slice(i, j + 1).reverse().map((r) => ({ c: r.c, a: r.b, b: r.a }));
        order.splice(i, j - i + 1, ...seg);
        better = true;
      }
    }
    if (!better) break;
  }
  const done = order.map(({ c, a }) => {
    const turned = !(c.pts[0][0] === a[0] && c.pts[0][1] === a[1]);
    const t: CutContour = turned ? { ...c, pts: c.pts.slice().reverse(), leadIn: c.leadOut.slice().reverse(), leadOut: c.leadIn.slice().reverse() } : { ...c };
    delete t.via;   // its rapid comes from somewhere else now
    return t;
  });
  return [...done, ...contours.filter((c) => !traces.includes(c))];
}

/** The rapid to each contour (index in `contours`): from where the head is, through its points, to the pierce. */
export function rapidPaths(contours: CutContour[], from: Pt): { k: number; pts: Pt[] }[] {
  const out: { k: number; pts: Pt[] }[] = [];
  let at = from;
  contours.forEach((c, k) => {
    const s = c.leadIn[0] ?? c.pts[0];
    if (!s) return;
    const via = viaOf(c, contours[k - 1]);
    if (via.length || len(sub(s, at)) > 0.01) out.push({ k, pts: [at, ...via, s] });
    at = c.leadOut[c.leadOut.length - 1] ?? c.pts[c.pts.length - 1] ?? at;
  });
  return out;
}

/** Rapid moves of the path: from 0,0 to every pierce, through Movement's points (sheet frame). */
export function rapidsOf(contours: CutContour[], from: Pt): [Pt, Pt][] {
  const out: [Pt, Pt][] = [];
  for (const r of rapidPaths(contours, from)) for (let i = 1; i < r.pts.length; i++) out.push([r.pts[i - 1], r.pts[i]]);
  return out;
}

/**
 * The sheet's parts and cut path moved by dx, dy (its size changed and the 0,0 corner is right or
 * bottom: the parts stay where they are from 0,0). Processed parts stay processed.
 */
export function shiftSheet(sheet: NestedSheet, dx: number, dy: number): NestedSheet {
  if (!dx && !dy) return sheet;
  const mv = (p: Pt): Pt => [p[0] + dx, p[1] + dy];
  const mvStart = (s: BreakStart): BreakStart => ({ ...s, at: mv(s.at), ...(s.p1 ? { p1: mv(s.p1) } : {}) });
  const parts = sheet.parts.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }));
  let cut = sheet.cut;
  if (cut) {
    const c0 = cut;
    const contours = c0.contours.map((c) => ({
      ...c, pts: c.pts.map(mv), leadIn: c.leadIn.map(mv), leadOut: c.leadOut.map(mv),
      ...(c.bc ? { bc: { ...c.bc, plan: { ...c.bc.plan, starts: c.bc.plan.starts.map(mvStart), ...(c.bc.plan.orig ? { orig: mvStart(c.bc.plan.orig) } : {}) } } } : {}),
    }));
    // a rapid's points belong to the contour before it, named by its line: named again
    const renamed = new Map(c0.contours.map((c, i) => [contourKey(c), contourKey(contours[i])]));
    contours.forEach((c, i) => {
      const v = c0.contours[i].via;
      if (v) contours[i] = { ...c, via: { pts: v.pts.map(mv), after: renamed.get(v.after) ?? v.after } };
    });
    const keys: Record<number, string> = {};
    for (const [k, key] of Object.entries(c0.keys)) {
      const i = Number(k), was = sheet.parts[i];
      keys[i] = was && key === partKey(was) ? partKey(parts[i]) : key;
    }
    cut = { ...c0, contours, keys };
  }
  return { ...sheet, parts, cut };
}
