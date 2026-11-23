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
import { tidyPierces } from "./commonPierce";
import { commonEdges, partCommonLines, placedEdges, type CommonEdge } from "./commonCut";
import { commonBlocks, sharedLineCut, type CommonBlock } from "./commonPath";
import { cutOrderOf, gapsFor, holeCompOf, machineCan, type Machine, type Origin } from "./machine";
import { partLoops, pointIn, transform, type Box, type Pt } from "./manualGeom";
import type { NestedSheet, PlacedPart } from "./nest";
import { TRACE_SHORTEST_FROM_MM, techRowFor, traceShortestOf, type TechRow } from "./technology";

/** The order picked under AUTO CUT. */
export type CutRule = "leftRight" | "rightLeft" | "bottomTop" | "topBottom" | "shortest" | "smallBig";

export const CUT_RULES: { id: CutRule; label: string; hint: string }[] = [
  { id: "leftRight", label: "Left to right", hint: "Columns from the left edge to the right, each from the bottom up" },
  { id: "bottomTop", label: "Bottom to top", hint: "Rows from the bottom edge up, each from left to right" },
  { id: "rightLeft", label: "Right to left", hint: "Columns from the right edge to the left, each from the bottom up (for counter-clockwise cutting)" },
  { id: "topBottom", label: "Top to bottom", hint: "Rows from the top edge down, each from left to right (for counter-clockwise cutting)" },
  { id: "shortest", label: "Shortest distance", hint: "Always the nearest part next" },
  { id: "smallBig", label: "Smallest to biggest", hint: "Parts by their area, the smallest first" },
];

export type CutKind = "outer" | "inner" | "open" | "trace";

/** One contour as it is cut: the pierce at leadIn[0] (or pts[0] without a lead), the cut along pts, out along leadOut. */
export interface CutContour {
  /** the part's index in the sheet's parts */
  part: number;
  kind: CutKind;
  /** a hole marked with the Hole tool, cut this much bigger or smaller (the machine's hole compensation):
   *  the lead and joint tools rebuild it from the drawing at that size */
  holeK?: number;
  /** an island: a loop in one of the part's holes (an even number of loops deep), so the outline of a piece
   *  of its own. Listed with the part's holes (kind "inner": the part's outline stays its only "outer"), cut
   *  like an outline: clockwise, its lead from the scrap around it, before the hole it lies in; the NC
   *  program gets it as an outline. Was cut as a hole: the kerf into the piece, the pierce in it (QA GB-01) */
  island?: boolean;
  pts: Pt[];
  leadIn: Pt[];
  leadOut: Pt[];
  /** cut at the small-hole speed */
  small?: boolean;
  /** processed with Selected parts / Trace / Cut internal (an order picked by hand): processing the whole
   *  sheet again keeps the parts whose outline came so, first and in that order, and does the rest after them */
  picked?: boolean;
  lead?: LeadType;
  /** the lead values set by hand (Process → Lead in / out); missing: the Technology row's */
  spec?: LeadSpec;
  /** its lead moved, set or deleted by hand (Process → Lead in / out; Reset takes it off) */
  edited?: boolean;
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
  /** the order picked under AUTO CUT the last time the sheet was processed (kept when the order is changed by
   *  hand): Manual cut's Path cut order sorts what is left after the parts picked by it */
  autoRule?: CutRule;
  contours: CutContour[];
  /** per part index: where the part was when it was processed (moved since: not processed any more) */
  keys: Record<number, string>;
  /** per part index (as keys): its drawing when it was processed (pathSig of its outline path). A part
   *  whose drawing changed since (replaced, another revision restored) is not processed any more.
   *  Missing: an older cut (its drawings are taken as they are) */
  sigs?: Record<number, string>;
  /** per part index: its tracing and open cut lines when it was processed (marksSig). The outline's
   *  fingerprint does not see them: a part whose marking or open cut changed (replaced, edited in another
   *  browser) was posted with the old lines (QA R2-03). Post process reads them again and compares. */
  msigs?: Record<number, string>;
  /** the settings the sheet was processed with (cutSettingsSig): the Technology row and the machine's cutting
   *  settings. Changed since (an admin, another computer), Post process refuses: the program took the new E
   *  codes and tech program with the old leads (QA GB-11). Missing: an older cut */
  techSig?: string;
  /** made for a 0,0 corner that mirrors the sheet as drawn (outlines counter-clockwise on screen); missing = not */
  mirrored?: boolean;
  /** from PROCESS only (not kept with the sheet): the leads moved or shortened to fit, and those that still do not */
  leadFit?: LeadFitCount;
  /** from PROCESS only: the whole sheet processed, parts kept first as picked by hand before (their count) */
  keptFirst?: number;
}

/** What PROCESS does with the parts it gets. */
export type CutWhat = "all" | "trace" | "internal";

export const partKey = (p: PlacedPart) => `${p.partId}|${p.x.toFixed(3)}|${p.y.toFixed(3)}|${p.angle}|${p.mirror ? 1 : 0}`;

/** A short fingerprint of a part's drawing (its outline path): FNV-1a, 32 bits, and the length. */
export function pathSig(path: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < path.length; i++) { h ^= path.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return `${(h >>> 0).toString(36)}.${path.length.toString(36)}`;
}

/** The part's drawing now (its outline path by part id), to tell a drawing changed since processing. */
export type PathOf = (partId: string) => string | undefined;

/** The parts (indexes) whose drawing changed since they were processed (an older cut has no record: none). */
export function changedDrawings(sheet: NestedSheet, pathOf: PathOf): Set<number> {
  const out = new Set<number>();
  const sigs = sheet.cut?.sigs;
  if (!sigs) return out;
  for (const [k, sig] of Object.entries(sigs)) {
    const p = sheet.parts[Number(k)];
    const path = p ? pathOf(p.partId) : undefined;
    if (path !== undefined && pathSig(path) !== sig) out.add(Number(k));
  }
  return out;
}

/** The parts of the sheet whose cut path is still good (with `pathOf`: also not if their drawing changed). */
export function processedParts(sheet: NestedSheet, pathOf?: PathOf): Set<number> {
  const c = sheet.cut;
  const out = new Set<number>();
  if (!c) return out;
  const changed = pathOf ? changedDrawings(sheet, pathOf) : new Set<number>();
  const good = (i: number) => { const p = sheet.parts[i]; return !!p && c.keys[i] === partKey(p) && !changed.has(i); };
  // a common cut block counts only while every part of it is where it was
  const bad = new Set<number>();
  for (const ct of c.contours) if (ct.parts && !ct.parts.every(good)) ct.parts.forEach((i) => bad.add(i));
  for (const ct of c.contours) for (const i of ct.parts ?? [ct.part]) if (good(i) && !bad.has(i)) out.add(i);
  return out;
}

/**
 * The cut path after the sheet's list of parts changed by hand (a part deleted, pasted, the list in
 * another order): a contour names its part by its place in the list, so each processed part is found
 * again by where it lies and its contours follow it; those of parts that are gone go. Parts only moved
 * (the list as it was) keep theirs as they are: put back, they are processed again.
 */
export function remapCut(cut: SheetCut | undefined, before: PlacedPart[], after: PlacedPart[]): SheetCut | undefined {
  if (!cut) return cut;
  if (before.length === after.length && before.every((p, i) => p.partId === after[i].partId)) return cut;
  const free = new Map<string, number[]>();
  after.forEach((p, j) => { const k = partKey(p); free.set(k, [...(free.get(k) ?? []), j]); });
  const to = new Map<number, number>();
  // a part still in its place keeps it; the others take the first free part lying where they lay
  const good = Object.keys(cut.keys).map(Number).filter((i) => before[i] && cut.keys[i] === partKey(before[i]));
  const take = (i: number, j: number) => { to.set(i, j); const l = free.get(cut.keys[i])!; l.splice(l.indexOf(j), 1); };
  for (const i of good) if (after[i] && partKey(after[i]) === cut.keys[i]) take(i, i);
  for (const i of good) if (!to.has(i)) { const j = free.get(cut.keys[i])?.[0]; if (j !== undefined) take(i, j); }
  const rename = new Map<string, string>();
  const contours = cut.contours.filter((c) => (c.parts ?? [c.part]).every((i) => to.has(i))).map((c) => {
    const n: CutContour = { ...c, part: to.get(c.part)!, ...(c.parts ? { parts: c.parts.map((i) => to.get(i)!) } : {}) };
    rename.set(contourKey(c), contourKey(n));
    return n;
  });
  const keys: Record<number, string> = {};
  for (const [i, j] of to) keys[j] = cut.keys[i];
  const sigs: Record<number, string> = {};
  for (const [i, j] of to) if (cut.sigs?.[i]) sigs[j] = cut.sigs[i];
  const msigs: Record<number, string> = {};
  for (const [i, j] of to) if (cut.msigs?.[i]) msigs[j] = cut.msigs[i];
  return {
    ...cut, keys, ...(cut.sigs ? { sigs } : {}), ...(cut.msigs ? { msigs } : {}),
    contours: contours.map((c) => (c.via && c.via.after !== "origin" ? { ...c, via: { ...c.via, after: rename.get(c.via.after) ?? c.via.after } } : c)),
  };
}

/** The contours still good, in cutting order. */
/** Changed by hand after Auto cut: a lead moved or set, micro joints, breaks, an inline cut, a common pierce. */
export const handEdited = (c: CutContour) => !!(c.edited || c.spec || c.bc || c.inline || c.cp);

/**
 * A whole sheet processed again with the parts changed by hand kept as they were: the new cut, with each such
 * part's old contours where the new ones of that part are (its tracing where its new tracing is, the rest where
 * its new holes and outline are), so the order rule still holds. Only parts that stayed where they were, with
 * the same drawing. A new Auto cut threw joints, breaks and hand-set leads away without asking (QA R2-10).
 */
export function keepHandEdits(sheet: NestedSheet, fresh: SheetCut, pathOf?: PathOf): SheetCut {
  const old = sheet.cut;
  if (!old) return fresh;
  const live = liveContours(sheet, pathOf);
  const hand = new Set<number>();
  for (const c of live) if (!c.parts && handEdited(c)) hand.add(c.part);
  for (const p of [...hand]) if (old.keys[p] !== fresh.keys[p] || (old.sigs?.[p] ?? fresh.sigs?.[p]) !== fresh.sigs?.[p]) hand.delete(p);
  if (!hand.size) return fresh;
  const trace = (c: CutContour) => c.kind === "trace";
  const oldOf = (p: number, t: boolean) => live.filter((c) => !c.parts && c.part === p && trace(c) === t).map(({ via: _via, ...c }) => c);
  const out: CutContour[] = [];
  const placed = new Set<string>();
  for (const c of fresh.contours) {
    if (c.parts || !hand.has(c.part)) { out.push(c); continue; }
    const key = `${c.part}|${trace(c)}`;
    if (!placed.has(key)) { placed.add(key); out.push(...oldOf(c.part, trace(c))); }
  }
  // a part that had tracing, or cuts, the new cut has none of (a setting changed): at the end
  for (const p of hand) for (const t of [true, false]) if (!placed.has(`${p}|${t}`)) out.push(...oldOf(p, t));
  return { ...fresh, contours: out };
}

export const liveContours = (sheet: NestedSheet, pathOf?: PathOf): CutContour[] => {
  const ok = processedParts(sheet, pathOf);
  return (sheet.cut?.contours ?? []).filter((c) => (c.parts ?? [c.part]).every((i) => ok.has(i)));
};

/** The machine's 0,0 on the sheet (sheet frame). */
export const originPoint = (sheet: Pick<NestedSheet, "lengthMm" | "widthMm">, origin: Origin): Pt =>
  [origin.endsWith("right") ? sheet.lengthMm : 0, origin.startsWith("bottom") ? sheet.widthMm : 0];

/** The sheet as drawn has y down, the machine Y up: a 0,0 corner flipping one axis keeps the turning
 *  sense, none (top-left) or both (bottom-right) mirror it. */
export const originMirrors = (origin: Origin) => origin.startsWith("top") === origin.endsWith("left");

// ------------------------------------------------------------------ tracing and open cut lines of a part

/** Tracing and open cut lines; grain: lines along the grain, only shown (never cut or traced). */
export type Marks = { trace: Pt[][]; open: Pt[][]; grain?: Pt[][]; foil?: boolean; holes?: Box[] };
const markCache = new Map<string, { at: number; marks: Promise<Marks> }>();

/** Parts were saved (their drawings may have changed): their marks are read again (these parts, or all). */
export const forgetPartMarks = (ids?: Iterable<string>) => { if (!ids) markCache.clear(); else for (const id of ids) markCache.delete(id); };

/** A fingerprint of a part's tracing and open cut lines (in its own frame, to 0.001 mm). */
export function marksSig(m: Pick<Marks, "trace" | "open">): string {
  const runs = (r: Pt[][]) => r.map((l) => l.map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`).join(" ")).join("|");
  return pathSig(`T${runs(m.trace)}O${runs(m.open)}`);
}

/** The parts (indexes) whose tracing or open cut lines are not the ones they were processed with: read
 *  again from the database (not this browser's copy, which may be older), compared with msigs. */
export async function changedMarks(sheet: NestedSheet): Promise<Set<number>> {
  const out = new Set<number>();
  const msigs = sheet.cut?.msigs;
  if (!msigs) return out;
  const ks = Object.keys(msigs).map(Number).filter((k) => sheet.parts[k]);
  forgetPartMarks(new Set(ks.map((k) => sheet.parts[k].partId)));
  await Promise.all(ks.map(async (k) => {
    const m = await partMarks(sheet.parts[k].partId).catch(() => null);
    if (m && marksSig(m) !== msigs[k]) out.add(k);
  }));
  return out;
}

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
  const surf = g?.marks;
  const slow = ents.some((e) => e.slow && roleOf(e) === "cut");
  if (!marks.length && !surf?.grain && !surf?.foil && !slow) return { trace: [], open: [] };
  const report = checkGeometry(ents);
  const box = report.contours.find((c) => c.closed && c.outer)?.box ?? report.box;
  const f = (q: { x: number; y: number }): Pt => [q.x - box.minX, box.maxY - q.y];
  const runs = (role: string) => chain(marks.filter((e) => roleOf(e) === role).map((e) => pointsAlong(e).map(f)));
  // the holes marked with the Hole tool (their boxes, in the same frame): the machine's hole compensation
  const byId = new Map(ents.map((e) => [e.id, e]));
  const holes: Box[] = slow ? report.contours.filter((c) => c.closed && !c.outer && c.entityIds.some((id) => byId.get(id)?.slow))
    .map((c) => ({ x0: c.box.minX - box.minX, y0: box.maxY - c.box.maxY, x1: c.box.maxX - box.minX, y1: box.maxY - c.box.minY })) : [];
  return { trace: runs("trace"), open: runs("openCut"), ...(surf?.grain ? { grain: grainLines(box.maxX - box.minX, box.maxY - box.minY, surf.grain) } : {}), ...(surf?.foil ? { foil: true } : {}), ...(holes.length ? { holes } : {}) };
}

/** Three lines along the grain in the middle of the part (its frame: y down, box corner at 0,0). */
export function grainLines(w: number, h: number, dir: "x" | "y"): Pt[][] {
  const along = dir === "x" ? w : h, across = dir === "x" ? h : w;
  const len = Math.min(along * 0.45, 90), gap = Math.min(across * 0.12, 9);
  const cx = w / 2, cy = h / 2;
  return [-1, 0, 1].map((k) => (dir === "x"
    ? [[cx - len / 2, cy + k * gap], [cx + len / 2, cy + k * gap]]
    : [[cx + k * gap, cy - len / 2], [cx + k * gap, cy + len / 2]]) as Pt[]);
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
// Cut path points to 0.001 mm (the NC program's own precision). Was 0.01 mm: on a part nested at 15°,
// 30° or 45°, that second rounding (after the drawing's own) put points on a circle up to 0.014 mm off it,
// past what the arc fit allows, and stretches of circles and slots were cut as 7.5° chords (QA R2-02).
const r2 = (p: Pt): Pt => [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000];
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

/** The shortest distance from p to the loop. */
function loopDist(lp: Pt[], p: Pt): number {
  let best = Infinity;
  for (let i = 0; i < lp.length; i++) {
    const a = lp[i], e = sub(lp[(i + 1) % lp.length], a), L2 = dot(e, e);
    const u = L2 > 1e-12 ? Math.max(0, Math.min(1, dot(sub(p, a), e) / L2)) : 0;
    best = Math.min(best, len(sub(p, add(a, mul(e, u)))));
  }
  return best;
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

/**
 * A point on edge `edge` of the loop, put on the arc that edge is a chord of (when it is one: the loop goes
 * round the same circle before and after it, in short chords). A micro joint, a break or a lead moved by
 * hand starting partway along a chord of a circle was on the straight chord, up to 0.2 mm inside an R100
 * (more on bigger ones): the NC program could not fit an arc through it, the piece's ends were cut as lines
 * off the circle (QA R2-09). Otherwise the point as it is.
 */
export function onArc(lp: Pt[], edge: number, p: Pt): Pt {
  const n = lp.length;
  if (n < 6) return p;
  const at = (i: number) => lp[((i % n) + n) % n];
  const a = at(edge), b = at(edge + 1);
  // the circle through the widest run of vertices round the edge that lies on one (least squares: the
  // vertices are rounded to 0.01 mm, three of them alone put the middle a tenth of a millimetre off)
  for (let w = 3; w >= 1; w--) {
    if (2 * w + 2 > n) continue;
    const run = Array.from({ length: 2 * w + 2 }, (_, k) => at(edge - w + k));
    const c = fitCircle(run);
    if (!c || c.r > 20000) continue;
    if (run.some((q) => Math.abs(len(sub(q, c.c)) - c.r) > 0.02)) continue;
    // a short chord of it (at most 10° of the circle): not a long straight edge between two arcs
    if (len(sub(b, a)) > 2 * c.r * Math.sin((5 * Math.PI) / 180)) return p;
    // every corner of the run turning the same way
    const turn = (i: number) => { const u = sub(run[i], run[i - 1]), v = sub(run[i + 1], run[i]); return u[0] * v[1] - u[1] * v[0]; };
    const t0 = Math.sign(turn(1));
    if (!t0 || run.slice(1, -1).some((_, i) => Math.sign(turn(i + 1)) !== t0)) continue;
    const d = sub(p, c.c);
    return len(d) > 1e-9 ? add(c.c, mul(unit(d), c.r)) : p;
  }
  return p;
}

/** The circle nearest the points (least squares, Kasa); null: they are in a line. */
function fitCircle(pts: Pt[]): { c: Pt; r: number } | null {
  // centred on their mean, for the numbers' sake
  const mx = pts.reduce((s, q) => s + q[0], 0) / pts.length, my = pts.reduce((s, q) => s + q[1], 0) / pts.length;
  let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const [x, y] of pts) {
    const u = x - mx, v = y - my;
    suu += u * u; svv += v * v; suv += u * v;
    suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-12) return null;
  const r1 = (suuu + suvv) / 2, r2v = (svvv + svuu) / 2;
  const uc = (r1 * svv - r2v * suv) / det, vc = (r2v * suu - r1 * suv) / det;
  const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / pts.length);
  return { c: [uc + mx, vc + my], r };
}

/** The loop's edge a point lies on (-1: none). */
function edgeAt(lp: Pt[], p: Pt): number {
  for (let i = 0; i < lp.length; i++) {
    const a = lp[i], b = lp[(i + 1) % lp.length], e = sub(b, a), L2 = dot(e, e);
    const t = L2 ? Math.max(0, Math.min(1, dot(sub(p, a), e) / L2)) : 0;
    if (len(sub(p, add(a, mul(e, t)))) < 1e-6 && t > 1e-9 && t < 1 - 1e-9) return i;
  }
  return -1;
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

/** How far a lead reaches along the contour from where it starts: an arc lead its radius, the others their lead-in. */
const leadReach = (v: LeadSpec, type: LeadType) => Math.max(v.lin, type === "arc" ? v.radius : 0);

export const cornerOnly = (t: LeadType) => !!LEAD_TYPES.find((x) => x.id === t)?.cornerOnly;

/** The point of the part's box the leads are put nearest to. */
const targetOf = (b: Box, rules: LeadRules): Pt => [rules.place.endsWith("right") ? b.x1 : b.x0, rules.place.startsWith("bottom") ? b.y1 : b.y0];

/** Do these leads fit where they are (clear of the other parts, inside the sheet, not in the part itself)? */
type LeadFit = (c: { leadIn: Pt[]; leadOut: Pt[] }) => boolean;
/** How the leads of a PROCESS run were fitted: moved / shortened to fit, and those that still do not. */
export interface LeadFitCount { fitted: number; tight: number }

/** The leads tried shorter, in this order, where the full ones do not fit. */
const FIT_FACTORS = [1, 0.75, 0.5];
/** An outline coming this near the lead place has material there (a sharp corner, a radius): the lead goes there. */
const PLACE_NEAR_MM = 25;

/**
 * A closed contour with its leads. An outline: at the place (the target) when the outline comes within
 * PLACE_NEAR_MM of it: a sharp corner with the corner type, else the edge or radius point nearest it with
 * the other type, then the other sharp corners (along the place's side counting half); when not, at the
 * nearest sharp corners, an edge point only after them. Each start is tried at full length, 75 % and 50 % before the next. A hole: at a
 * window's own place, a sharp corner nearest the target, else an edge point (a curve: at one of its points,
 * so the start lies on the curve itself, not on a chord of it); the nearest that fits at full length, else
 * at 75 %, 50 %. When none fits: the first start with its leads at 50 % (counted as tight).
 */
function closedContour(lp: Pt[], kind: "outer" | "inner", rules: LeadRules, row: TechRow | null, target: Pt, side: 1 | -1, fit?: LeadFit, count?: LeadFitCount): Omit<CutContour, "part" | "kind"> {
  const n = lp.length;
  const prev = (i: number) => lp[(i - 1 + n) % n], next = (i: number) => lp[(i + 1) % n];
  const cType = kind === "outer" ? rules.outCorner : rules.holeCorner;
  let oType = kind === "outer" ? rules.outOther : rules.holeOther;
  if (cornerOnly(oType)) oType = "perp";
  const angleAt = (i: number) => cornerAngle(lp, i, side);
  const far = (p: Pt) => len(sub(p, target));
  type Cand = { s: LeadStart; type: LeadType; d: number };
  const byDist = (a: Cand, b: Cand) => a.d - b.d;

  // a window (not a round hole): the middle of a radius, else well away from its corners
  const windows: Cand[] = kind === "inner" && !isRound(lp)
    ? windowStarts(lp, target, leadReach(leadValues(kind, row, oType), oType)).map((s) => ({ s, type: oType, d: far(s.at) })) : [];
  const corners: Cand[] = [];
  if (cornerOnly(cType)) for (let i = 0; i < n; i++) {
    if (len(sub(lp[i], prev(i))) < 0.5 || len(sub(next(i), lp[i])) < 0.5) continue;
    if (angleAt(i) > rules.sharpMaxDeg) continue;
    corners.push({ s: { at: lp[i], edge: i, vertex: true, t: unit(sub(next(i), lp[i])) }, type: cType, d: far(lp[i]) });
  }
  const edges: Cand[] = [];
  const v0 = leadValues(kind, row, oType);
  // a point of a curve drawn in pieces: the turn there is small, and not none
  const onCurve = (i: number) => { const d = Math.abs(angleAt(i) - 180); return d > 0.5 && d < 25; };
  for (let i = 0; i < n; i++) {
    const a = lp[i], b = next(i), e = sub(b, a), L = len(e);
    if (L < 1e-6) continue;
    const t = unit(e);
    if (L >= 2 && !(onCurve(i) && onCurve((i + 1) % n))) {
      // a point of the edge, kept off its corners
      const m = Math.min(L / 2, Math.max(1, v0.lin * 0.5));
      const s = Math.max(m, Math.min(L - m, dot(sub(target, a), t)));
      const p = add(a, mul(t, s));
      edges.push({ s: { at: p, edge: i, vertex: false, t }, type: oType, d: far(p) });
    } else if (Math.abs(angleAt(i) - 180) < 25) {
      // a point of a curve (its pieces are chords: their ends lie on the curve, their middles do not)
      edges.push({ s: { at: a, edge: i, vertex: true, t: unit(add(unit(sub(a, prev(i))), t)) }, type: oType, d: far(a) });
    }
  }
  const at = (c: Cand, f: number) => {
    const v = leadValues(kind, row, c.type);
    return leadsAt(lp, kind, rules, row, c.s, c.type, f === 1 ? v : { ...v, lin: v.lin * f, lout: v.lout * f, radius: v.radius * f }, side);
  };
  if (kind === "outer") {
    // An outline. When it comes within PLACE_NEAR_MM of the place (the box's corner), the lead goes there: a
    // sharp corner with the corner type (a straight lead), a radius or an edge with the other type; a corner
    // no farther than the nearest edge point and a lead-in counts as at the place. When the box's corner is
    // empty (a triangle, an L's notch, a slope), the sharp corners come first, the nearest first; an edge
    // point only after them. When the lead at the place does not fit, the next sharp corners: going along
    // the place's side (up or down it) counts half of going across (a tall part: up its side, not across
    // its bottom). Each start is tried at its full lead, then shorter (to 50 %), before the next one.
    const edgeD = edges.reduce((m, c) => Math.min(m, c.d), Infinity), slack = Math.max(5, v0.lin);
    const nearest = Math.min(edgeD, ...corners.map((c) => c.d));
    const along = (c: Cand) => Math.hypot(2 * (c.s.at[0] - target[0]), c.s.at[1] - target[1]);
    const byAlong = (a: Cand, b: Cand) => along(a) - along(b);
    let order: Cand[];
    if (nearest <= PLACE_NEAR_MM) {
      const atPlace = corners.filter((c) => c.d <= edgeD + slack).sort(byDist)[0] ?? edges.slice().sort(byDist)[0];
      order = [atPlace, ...corners.filter((c) => c !== atPlace).sort(byAlong), ...edges.filter((c) => c !== atPlace).sort(byDist)];
    } else order = [...corners.sort(byDist), ...edges.sort(byDist)];
    order = order.filter(Boolean);
    if (!order.length) order.push({ s: { at: lp[0], edge: 0, vertex: true, t: unit(sub(next(0), lp[0])) }, type: oType, d: 0 });
    if (!fit) return at(order[0], 1);
    // a long outline has hundreds of starts: the 40 first corners and 40 nearest edge points are enough
    const tries = [...order.filter((c) => c.type === cType && c.s.vertex).slice(0, 40), ...order.filter((c) => !(c.type === cType && c.s.vertex)).slice(0, 40)];
    tries.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    for (const c of tries) for (const f of FIT_FACTORS) {
      const out = at(c, f);
      if (fit(out)) { if (count && (c !== order[0] || f !== 1)) count.fitted++; return out; }
    }
    if (count) count.tight++;
    return at(order[0], FIT_FACTORS[FIT_FACTORS.length - 1]);
  }
  // A hole: a window's own place, else the nearest sharp corner, else the nearest edge point.
  const cands = [...windows.sort(byDist), ...corners.sort(byDist), ...edges.sort(byDist)];
  if (!cands.length) cands.push({ s: { at: lp[0], edge: 0, vertex: true, t: unit(sub(next(0), lp[0])) }, type: oType, d: 0 });
  const first = at(cands[0], 1);
  if (!fit || fit(first)) return first;
  // the nearest starts are tried (a long outline has hundreds: the 40 nearest of each kind are enough)
  const tries = [...windows.slice(0, 40), ...corners.slice(0, 40), ...edges.slice(0, 40)];
  for (const f of FIT_FACTORS) for (const c of tries) {
    if (f === 1 && c === cands[0]) continue;
    const out = at(c, f);
    if (fit(out)) { if (count) count.fitted++; return out; }
  }
  if (count) count.tight++;
  return at(cands[0], FIT_FACTORS[FIT_FACTORS.length - 1]);
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
  // a gap ending partway along a chord of a circle: on the circle (onArc)
  if (v.gap !== 0 && pts.length > 1) {
    const e = edgeAt(lp, pts[pts.length - 1]);
    if (e >= 0) pts = [...pts.slice(0, -1), onArc(lp, e, pts[pts.length - 1])];
  }

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
    const R0 = Math.min(v.radius, limit(P, nP, v.radius * 2) / 2 || v.radius);
    // a quarter circle from the scrap side: its far end (the pierce of the lead-in) R back along the edge and
    // R off it. Near a corner that end can come onto the next edge (the pierce on the part's edge, or the
    // lead-out nicking it): the arc is made smaller until its end stays at least half of it off the contour.
    const quarter = (c0: Pt, n0: Pt, t0: Pt, back: boolean) => {
      let R = R0, best: { c: Pt; e: Pt } | null = null;
      for (let k = 0; k < 8; k++, R *= 0.75) {
        const c = add(c0, mul(n0, R));
        const a1 = add(c, rot(mul(n0, -R), 90)), a2 = add(c, rot(mul(n0, -R), -90));
        const e = (dot(sub(a1, c0), t0) < 0) === back ? a1 : a2;
        best = { c, e };
        if (loopDist(lp, e) >= 0.5 * R - 1e-6) break;
      }
      return best!;
    };
    const qi = quarter(P, nP, start.t, true);
    leadIn = arcPts(qi.c, qi.e, P);
    const qo = quarter(end, nE, tEnd, false);
    leadOut = arcPts(qo.c, end, qo.e);
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
 * Where the leads may go on a window (an inner contour that is not a round hole): the middles of its
 * arcs (radii) if it has any, else on each straight side at least 2 × the lead-in from its corners (the
 * middle of a side too short for that), nearest the target. The caller takes the one nearest the target.
 */
function windowStarts(lp: Pt[], target: Pt, lin: number): LeadStart[] {
  // lin: how far the lead reaches along the side (leadReach)
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
  if (first < 0) return [];
  // arcs: runs of short segments joined by small turns of one sense
  for (let s0 = 0; s0 < n; s0++) {
    const k0 = (first + s0) % n;
    if (links(k0) || !short(k0)) continue;
    let k = k0, L = lens[k0], turn = curved(k0) ? t[k0] / 2 : 0;
    while (links((k + 1) % n) && (k + 1) % n !== k0) { k = (k + 1) % n; L += lens[k]; turn += t[k]; }
    const end = (k + 1) % n;
    if (curved(end)) turn += t[end] / 2;
    if (k !== k0 && Math.abs(turn) >= 20) {
      // the middle of the arc, on one of its points: a start between two of them is on a chord, and the
      // cut there would be a short straight stub off the arc (the NC program finds the arc again from its points)
      const mid = along(k0, L / 2);
      if (mid.vertex) cands.push(mid);
      else {
        const a = mid.edge, b = (mid.edge + 1) % n;
        const v = len(sub(mid.at, lp[a])) <= len(sub(lp[b], mid.at)) ? a : b;
        cands.push({ at: lp[v], edge: v, vertex: true, t: unit(add(unit(sub(lp[v], lp[(v - 1 + n) % n])), unit(sub(lp[(v + 1) % n], lp[v])))) });
      }
    }
  }
  if (!cands.length) {
    // straight sides between corners (collinear pieces count as one side)
    const corner = (v: number) => Math.abs(t[v]) >= 0.5;
    const c0 = lp.findIndex((_, v) => corner(v));
    if (c0 < 0) return [];
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
  return cands;
}

const totalLen = (pts: Pt[]) => pts.reduce((s, p, i) => (i ? s + len(sub(p, pts[i - 1])) : 0), 0);

// ------------------------------------------------------------------ parts and their order

interface PartGeo {
  i: number; outer: Pt[]; holes: Pt[][]; holeK: number[]; trace: Pt[][]; open: Pt[][]; box: Box; area: number; msig?: string;
  /** per hole: an island (see CutContour.island) */
  island: boolean[];
  /** per hole: the holes (indexes) that lie inside it (cut before it) */
  within: number[][];
}

/** Which of a part's loops lie inside which: per hole (loops 1 on), the other holes inside it, and whether it
 *  is an island (inside an odd number of other holes, so an even number of loops deep with the outline). */
export function loopNesting(holes: Pt[][]): { island: boolean[]; within: number[][] } {
  // a point of b well inside or outside a (a vertex on a's line: touching loops), else b's first point
  const ptOf = (b: Pt[], a: Pt[]) => b.find((q) => !a.some((v) => Math.abs(v[0] - q[0]) < 1e-3 && Math.abs(v[1] - q[1]) < 1e-3)) ?? b[0];
  const boxes = holes.map(boxOf);
  const inside = (b: number, a: number) => {
    const A = boxes[a], B = boxes[b];
    if (B.x0 < A.x0 || B.x1 > A.x1 || B.y0 < A.y0 || B.y1 > A.y1) return false;
    const q = ptOf(holes[b], holes[a]);
    return pointIn(holes[a], q[0], q[1]);
  };
  const within = holes.map((_, a) => holes.flatMap((_, b) => (b !== a && inside(b, a) ? [b] : [])));
  const depth = holes.map((_, b) => within.filter((w) => w.includes(b)).length);
  return { island: depth.map((d) => d % 2 === 1), within };
}

/** A loop scaled about the middle of its box by k (hole compensation). */
export function scaledLoop(lp: Pt[], k: number): Pt[] {
  const b = boxOf(lp), cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  return lp.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]);
}

/** holeK: the machine's hole compensation (1: as drawn): holes marked with the Hole tool are cut that much bigger or smaller. */
async function partGeos(sheet: NestedSheet, paths: Map<string, string>, idx: number[], wantMarks: boolean, mirrored: boolean, holeK = 1): Promise<PartGeo[]> {
  return Promise.all(idx.map(async (i) => {
    const p = sheet.parts[i];
    const path = paths.get(p.partId) ?? "";
    const f = transform(p);
    const read = wantMarks || holeK !== 1 ? await partMarks(p.partId) : null;
    const marks = read && wantMarks ? read : { trace: [], open: [] };
    // a hole marked with the Hole tool (its box matches): scaled by the hole compensation, in the part's own frame
    const marked = holeK !== 1 ? read?.holes ?? [] : [];
    const isMarked = (lp: Pt[]) => {
      const b = boxOf(lp), tol = Math.max(0.2, 0.03 * Math.max(b.x1 - b.x0, b.y1 - b.y0));   // the outline path is rounded, curves drawn in pieces
      return marked.some((h) => Math.abs(h.x0 - b.x0) < tol && Math.abs(h.x1 - b.x1) < tol && Math.abs(h.y0 - b.y0) < tol && Math.abs(h.y1 - b.y1) < tol);
    };
    const raw = partLoops(path);
    const ks = raw.map((lp, k) => (k > 0 && marked.length && isMarked(lp) ? holeK : 1));
    const loops = raw.map((lp, k) => (ks[k] !== 1 ? scaledLoop(lp, ks[k]) : lp)).map((lp) => lp.map(f));
    const outer = loops[0] ? oriented(loops[0], !mirrored) : [];
    const nest = loopNesting(loops.slice(1));
    return {
      i, outer, holes: loops.slice(1).map((lp, j) => oriented(lp, nest.island[j] ? !mirrored : mirrored)), holeK: ks.slice(1),
      island: nest.island, within: nest.within,
      trace: marks.trace.map((l) => l.map(f)), open: marks.open.map((l) => l.map(f)),
      box: boxOf(outer), area: Math.abs(signedArea(outer)),
      ...(read && wantMarks ? { msig: marksSig(read) } : {}),
    };
  }));
}

/** A unit of the order: a part (with what lies in its holes), a common cut block, or big parts with what
 *  lies in their box. c: the middle of its material (an L counts where its material is, not its box). */
interface El { parts: number[]; box: Box; area: number; c: Pt }

const center = (b: Box): Pt => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
const median = (v: number[]) => { const s = v.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

/**
 * Elements in the order of the rule.
 *
 * Left to right (the others alike): columns, the first from the parts nearest the left edge; a column is
 * as wide as the narrowest of them (at least the parts' median width) and takes every part whose middle of
 * material lies in it;
 * each column from the bottom up, then the next column. Bottom to top: rows from the bottom
 * edge, each from left to right. Always the same way (not back and forth), so the operator can follow it.
 */
function sortEls(els: El[], rule: CutRule, from: Pt): El[] {
  if (els.length < 2) return els.slice();
  if (rule === "smallBig") return els.slice().sort((a, b) => a.area - b.area);
  if (rule === "shortest") {
    const left = els.slice(), out: El[] = [];
    let at = from;
    while (left.length) {
      let k = 0, best = Infinity;
      left.forEach((e, j) => { const d = len(sub(e.c, at)); if (d < best) { best = d; k = j; } });
      const e = left.splice(k, 1)[0];
      out.push(e);
      at = e.c;
    }
    return out;
  }
  const cols = rule === "leftRight" || rule === "rightLeft";
  // u: across the lanes, from where the sweep starts; v: along a lane (sheet frame: y down, the bottom edge is the largest y)
  const U = (p: Pt) => (rule === "leftRight" ? p[0] : rule === "rightLeft" ? -p[0] : rule === "bottomTop" ? -p[1] : p[1]);
  const V = (p: Pt) => (cols ? -p[1] : p[0]);
  const span = (e: El): [number, number] => { const a = U([e.box.x0, e.box.y0]), b = U([e.box.x1, e.box.y1]); return [Math.min(a, b), Math.max(a, b)]; };
  const size = median(els.map((e) => { const [a, b] = span(e); return b - a; }));
  const left = els.slice();
  const out: El[] = [];
  while (left.length) {
    // the lane starts at the parts whose edge is nearest where the sweep starts (the lowest, the leftmost);
    // it reaches as far as the shortest of them (at least the median part size), so a tall part beside
    // short ones does not take in the next row
    const u0 = Math.min(...left.map((e) => span(e)[0]));
    const starts = left.filter((e) => span(e)[0] <= u0 + 0.25 * size);
    const edge = Math.max(u0 + size, Math.min(...starts.map((e) => span(e)[1])));
    const lane = left.filter((e) => starts.includes(e) || U(e.c) < edge);
    lane.sort((a, b) => V(a.c) - V(b.c) || U(a.c) - U(b.c));
    out.push(...lane);
    for (const e of lane) left.splice(left.indexOf(e), 1);
  }
  return out;
}

/**
 * Parts lying in a bigger part's box (an L's corner, a frame's inside, a part next to a long arm) are cut
 * before it: the order stays as it is, but a part waits until the smaller ones in its box are done.
 */
function boxFirst(els: El[]): El[] {
  const inBox = (b: Box, p: Pt) => p[0] > b.x0 && p[0] < b.x1 && p[1] > b.y0 && p[1] < b.y1;
  const needs = new Map(els.map((e) => [e, els.filter((f) => f !== e && f.area < e.area && inBox(e.box, f.c))]));
  const out: El[] = [], done = new Set<El>(), left = els.slice();
  while (left.length) {
    const k = left.findIndex((e) => needs.get(e)!.every((f) => done.has(f)));
    const e = left.splice(k < 0 ? 0 : k, 1)[0];
    out.push(e); done.add(e);
  }
  return out;
}

/** The middle of a part's material: its outline less its holes (area-weighted). */
function materialMiddle(outer: Pt[], holes: Pt[][]): Pt {
  const of = (lp: Pt[]): [number, number, number] => {
    let a = 0, cx = 0, cy = 0;
    for (let k = 0; k < lp.length; k++) {
      const [x0, y0] = lp[k], [x1, y1] = lp[(k + 1) % lp.length], c = x0 * y1 - x1 * y0;
      a += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c;
    }
    return Math.abs(a) < 1e-9 ? [0, 0, 0] : [Math.abs(a / 2), cx / (3 * a), cy / (3 * a)];
  };
  const [ao, xo, yo] = of(outer);
  if (ao <= 0) { const b = boxOf(outer); return center(b); }
  let A = ao, X = ao * xo, Y = ao * yo;
  for (const h of holes) { const [ah, xh, yh] = of(h); if (ah > 0 && ah < A) { A -= ah; X -= ah * xh; Y -= ah * yh; } }
  return A > 1e-9 ? [X / A, Y / A] : [xo, yo];
}
const mergeEls = (l: El[]): El => {
  const area = l.reduce((s, e) => s + e.area, 0) || 1;
  return {
    parts: l.flatMap((e) => e.parts), area,
    box: l.reduce((u, e) => ({ x0: Math.min(u.x0, e.box.x0), y0: Math.min(u.y0, e.box.y0), x1: Math.max(u.x1, e.box.x1), y1: Math.max(u.y1, e.box.y1) }), l[0].box),
    c: [l.reduce((s, e) => s + e.c[0] * e.area, 0) / area, l.reduce((s, e) => s + e.c[1] * e.area, 0) / area],
  };
};

/** A part in another part's hole: that part (the smallest one holding it) is its container. */
function containersOf(geos: PartGeo[]): Map<number, number> {
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
  return container;
}

/** The parts' outlines and holes only, as they lie on the sheet (for the order, not for cutting). */
function plainGeos(sheet: NestedSheet, paths: Map<string, string>, idx: number[]): PartGeo[] {
  return idx.flatMap((i) => {
    const p = sheet.parts[i];
    if (!p) return [];
    const f = transform(p);
    const loops = partLoops(paths.get(p.partId) ?? "").map((lp) => lp.map(f));
    if (!loops[0]?.length) return [];
    return [{ i, outer: loops[0], holes: loops.slice(1), holeK: loops.slice(1).map(() => 1), trace: [], open: [], box: boxOf(loops[0]), area: Math.abs(signedArea(loops[0])),
      ...loopNesting(loops.slice(1)) }];
  });
}

/**
 * Some parts of a processed sheet in the order of an Auto cut rule, from `from` (Manual cut → Path cut
 * order: what is left after the parts picked); `together`: parts cut as one.
 */
export const ruleOrder = (sheet: NestedSheet, paths: Map<string, string>, idx: number[], rule: CutRule, machine: Machine, from: Pt, together: number[][] = []): number[] =>
  orderParts(plainGeos(sheet, paths, idx), rule, machine, sheet, from, together);

/** Each part's container (the part whose hole it lies in), among these parts. */
export const partContainers = (sheet: NestedSheet, paths: Map<string, string>, idx: number[]) => containersOf(plainGeos(sheet, paths, idx));

/** The parts in cutting order (see the top of this file). */
function orderParts(geos: PartGeo[], rule: CutRule, machine: Machine, sheet: NestedSheet, from: Pt, together: number[][] = []): number[] {
  const by = new Map(geos.map((g) => [g.i, g]));
  const container = containersOf(geos);
  const kids = new Map<number, number[]>();
  for (const [c, h] of container) kids.set(h, [...(kids.get(h) ?? []), c]);
  const unitOf = (i: number): El => {
    const g = by.get(i)!;
    const inner = sortEls((kids.get(i) ?? []).map(unitOf), rule, from).flatMap((e) => e.parts);
    return { parts: [...inner, i], box: g.box, area: g.area, c: materialMiddle(g.outer, g.holes) };
  };
  let top = geos.filter((g) => !container.has(g.i)).map((g) => unitOf(g.i));
  // a common cut block is one unit of the order (its parts are cut together)
  for (const blk of together) {
    const mine = top.filter((e) => e.parts.some((k) => blk.includes(k)));
    if (mine.length > 1) top = [...top.filter((e) => !mine.includes(e)), mergeEls(mine)];
  }

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
    // what lies in the big parts' box (its middle of material): cut before them
    const members = top.filter((e) => !isBig(e) && !taken.has(e) && e.c[0] > g.box.x0 && e.c[0] < g.box.x1 && e.c[1] > g.box.y0 && e.c[1] < g.box.y1);
    members.forEach((e) => taken.add(e));
    const parts = [...boxFirst(sortEls(members, rule, from)).flatMap((e) => e.parts), ...sortEls(g.bigs, rule, from).flatMap((e) => e.parts)];
    els.push({ parts, box: g.box, area: Math.max(...g.bigs.map((e) => e.area)), c: mergeEls(g.bigs).c });
  }
  for (const e of top) if (!isBig(e) && !taken.has(e)) els.push(e);
  return boxFirst(sortEls(els, rule, from)).flatMap((e) => e.parts);
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
/** A fingerprint of what Auto cut takes from the machine for this sheet: its Technology row (leads, gaps, kerf,
 *  E code limits, ...) and the machine's cutting settings (origin, trims, gaps, kerf, hole compensation,
 *  lines it can do, cut order, lead rules), and the sheet's own gaps. Not its size, postprocessor or folders. */
export function cutSettingsSig(machine: Machine, sheet: Pick<NestedSheet, "material" | "thicknessMm" | "kerfMm" | "partGapMm" | "trims">): string {
  const row = techRowFor(machine.technologies, sheet.material, sheet.thicknessMm)?.row ?? null;
  const m = {
    technology: machine.technology, origin: machine.origin, trims: machine.trims, partGapMm: machine.partGapMm, kerfMm: machine.kerfMm,
    holeCompPct: machine.holeCompPct, lines: machine.lines, cutOrder: machine.cutOrder, leads: machine.leads,
  };
  const sh = { kerfMm: sheet.kerfMm, partGapMm: sheet.partGapMm, trims: sheet.trims };
  return pathSig(JSON.stringify({ row, m, sh }));
}

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
  // the whole sheet processed again: the parts processed before with Selected parts (an order by hand, e.g.
  // some needed before the rest of the sheet) stay as they are, first and in that order; the rest of the
  // sheet is processed after them, from where the head is when they are done
  let first: CutContour[] = [];
  if (!q.parts && q.what === "all" && sheet.cut && !!sheet.cut.mirrored === mirrored) {
    const good = processedParts(sheet);
    const outlined = new Set(sheet.cut.contours.filter((c) => c.picked && c.kind === "outer").flatMap((c) => c.parts ?? [c.part]));
    first = sheet.cut.contours.filter((c) => c.picked && (c.parts ?? [c.part]).every((k) => outlined.has(k) && good.has(k)));
    const done = new Set(first.flatMap((c) => c.parts ?? [c.part]));
    idx = idx.filter((k) => !done.has(k));
  }
  const geos = await partGeos(sheet, q.paths, idx, q.what !== "internal" && (canTrace || canOpen), mirrored, holeCompOf(machine));
  const from = originPoint(sheet, q.origin);
  const lastOfFirst = first[first.length - 1];
  const start: Pt = lastOfFirst ? (lastOfFirst.leadOut[lastOfFirst.leadOut.length - 1] ?? lastOfFirst.pts[lastOfFirst.pts.length - 1]) : from;
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
    if (withEdges.some((w) => w.edges.length)) for (const b of commonBlocks(withEdges, kerf)) for (const i of b.members) blockOf.set(i, b);
  }
  // the order (a block's parts kept together)
  const order = q.ordered ? idx : orderParts(geos, q.rule, machine, sheet, start, [...new Set(blockOf.values())].map((b) => b.members));
  // a block is cut where its last part comes in the order (what lies in its parts' holes is done by then)
  for (const i of order) { const b = blockOf.get(i); if (b) lastOf.set(b, i); }

  // -- the leads fitted to their room: clear of every other part on the sheet (processed now or not),
  // inside the sheet, and not in the part itself. A lead longer than the gap between two parts would
  // pierce in the neighbour: the start moves to where the full lead fits, else the lead is shortened.
  const clr = Math.max(1, 2 * kerf);
  const all = sheet.parts.map((p) => {
    const path = q.paths.get(p.partId);
    if (!path) return null;
    const f = transform(p);
    const loops = partLoops(path).map((lp) => lp.map(f));
    return loops.length ? { loops, box: boxOf(loops[0]) } : null;
  });
  const segDist = (p: Pt, a: Pt, b: Pt) => {
    const e = sub(b, a), l2 = dot(e, e);
    const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), e) / l2)) : 0;
    return len(sub(p, add(a, mul(e, t))));
  };
  const loopDist = (p: Pt, lp: Pt[]) => { let d = Infinity; for (let k = 0; k < lp.length; k++) d = Math.min(d, segDist(p, lp[k], lp[(k + 1) % lp.length])); return d; };
  const onSheet = (p: Pt) => sheet.outline?.length
    ? pointIn(sheet.outline[0], p[0], p[1]) && loopDist(p, sheet.outline[0]) >= clr && !sheet.outline.slice(1).some((h) => pointIn(h, p[0], p[1]) || loopDist(p, h) < clr)
    : p[0] >= clr && p[1] >= clr && p[0] <= sheet.lengthMm - clr && p[1] <= sheet.widthMm - clr;
  /** points along a lead, its end on the contour left out */
  const along = (pl: Pt[], fromEnd: boolean): Pt[] => {
    const out: Pt[] = [];
    for (let k = 1; k < pl.length; k++) {
      const a = pl[k - 1], b = pl[k], n = Math.max(1, Math.ceil(len(sub(b, a)) / 0.5));
      for (let j = 0; j <= n; j++) out.push(add(a, mul(sub(b, a), j / n)));
    }
    const touch = fromEnd ? pl[pl.length - 1] : pl[0];
    return out.filter((p) => len(sub(p, touch)) > 0.3);
  };
  const fitCount: LeadFitCount = { fitted: 0, tight: 0 };
  /** The fit test of a contour: `own` the parts it belongs to, `lp` the contour itself. */
  const fitOf = (own: number[], lp: Pt[], kind: "outer" | "inner"): LeadFit => (c) => {
    for (const [pl, isIn] of [[c.leadIn, true], [c.leadOut, false]] as const) {
      if (pl.length < 2) continue;
      const pts = along(pl, isIn);
      for (const p of pts) {
        if (!onSheet(p)) return false;
        // a hole's lead stays in the hole; an outline's stays out of its own part(s)
        if (kind === "inner" ? !pointIn(lp, p[0], p[1]) : own.some((m) => { const g = all[m]; return !!g && pointIn(g.loops[0], p[0], p[1]) && !g.loops.slice(1).some((h) => pointIn(h, p[0], p[1])); })) return false;
        for (let j = 0; j < all.length; j++) {
          const g = all[j];
          if (!g || own.includes(j)) continue;
          if (p[0] < g.box.x0 - clr || p[0] > g.box.x1 + clr || p[1] < g.box.y0 - clr || p[1] > g.box.y1 + clr) continue;
          // in the other part's material, or nearer its contours than the clearance
          if (g.loops.some((l) => loopDist(p, l) < clr)) return false;
          if (pointIn(g.loops[0], p[0], p[1]) && !g.loops.slice(1).some((h) => pointIn(h, p[0], p[1]))) return false;
        }
      }
      // the pierce (the lead's far end) keeps off the contour it leads to
      const far = isIn ? pl[0] : pl[pl.length - 1], touch = isIn ? pl[pl.length - 1] : pl[0];
      if (kind === "outer" && loopDist(far, lp) < Math.min(clr, 0.5 * len(sub(far, touch)))) return false;
    }
    return true;
  };

  const fresh: CutContour[] = [];
  let at = start;
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
    // the holes, the nearest next; a loop only once everything inside it is cut (an island before the hole
    // it lies in, the island's holes before the island)
    const holes = g.holes.map((lp, j) => {
      const how = g.island[j] ? "outer" : "inner";
      return { j, ...closedContour(lp, how, rules, row, targetOf(boxOf(lp), rules), side, fitOf([i], lp, how), fitCount),
        ...(g.holeK[j] !== 1 ? { holeK: g.holeK[j] } : {}), ...(g.island[j] ? { island: true } : {}) };
    });
    const done = new Set<number>();
    while (holes.length) {
      let k = -1, best = Infinity;
      holes.forEach((h, n) => {
        if (!g.within[h.j].every((x) => done.has(x))) return;
        const d = len(sub(startOf(h), at));
        if (d < best) { best = d; k = n; }
      });
      if (k < 0) k = 0;   // (loops inside each other both ways: cannot be; as found)
      const { j, ...h } = holes.splice(k, 1)[0];
      done.add(j);
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
        const h = closedContour(lp, "inner", rules, row, targetOf(boxOf(lp), rules), side, fitOf(members, lp, "inner"), fitCount);
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
        const o = closedContour(lp, "outer", rules, row, targetOf(boxOf(lp), rules), side, fitOf(members, lp, "outer"), fitCount);
        fresh.push({ part: i, kind: "outer", parts: members, ...o });
        at = endOf(o);
      }
      continue;
    }
    const o = closedContour(g.outer, "outer", rules, row, target, side, fitOf([i], g.outer, "outer"), fitCount);
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
  // Cut internal / Trace on a part already processed: its new holes (or tracing) go right before the rest
  // of that part's path (its outline), not after it: the part must not be cut loose before its holes
  let added = fresh;
  if (q.what !== "all" && kept.length) {
    const into = [...kept];
    added = [];
    const owns = (c: CutContour, k: number) => (c.parts ?? [c.part]).includes(k);
    for (const k of [...new Set(fresh.map((c) => c.part))]) {
      const mine = fresh.filter((c) => c.part === k);
      const at = into.findIndex((c) => owns(c, k));
      if (at < 0) added.push(...mine);
      else into.splice(at, 0, ...mine);
    }
    kept = into;
  }
  // picked by hand: marked, so processing the whole sheet later keeps them first
  if (q.ordered) for (const c of fresh) c.picked = true;
  for (const c of [...first, ...fresh]) for (const k of c.parts ?? [c.part]) keys[k] = partKey(sheet.parts[k]);
  // each processed part's drawing: now for the ones processed now, as before for the ones kept
  const sigs: Record<number, string> = {};
  const now = new Set(fresh.flatMap((c) => c.parts ?? [c.part]));
  for (const k of Object.keys(keys).map(Number)) {
    const path = sheet.parts[k] ? q.paths.get(sheet.parts[k].partId) : undefined;
    const before = sheet.cut?.sigs?.[k];
    if (!now.has(k) && before) sigs[k] = before;
    else if (path !== undefined) sigs[k] = pathSig(path);
  }
  // and its tracing and open cut lines (when they were read: tracing or open cuts processed)
  const msigs: Record<number, string> = {};
  for (const k of Object.keys(keys).map(Number)) {
    const was = sheet.cut?.msigs?.[k];
    const g = now.has(k) ? geos.find((x) => x.i === k) : undefined;
    if (g?.msig) msigs[k] = g.msig;
    else if (!now.has(k) && was) msigs[k] = was;
  }
  // the tracing first, shortest rapids: on a laser the Technology row says (not set: from 4 mm up), on other
  // machines Settings -> Machines -> Cut order. Parts picked by hand (Selected parts): the tracing of the
  // parts picked this time first, then they are cut in the order picked; earlier picks stay as they are.
  // The whole sheet with parts kept first (picked before): they stay first, the rest's tracing after them.
  const traceShortest = machine.technology === "laser"
    ? (row ? traceShortestOf(row) : sheet.thicknessMm >= TRACE_SHORTEST_FROM_MM - 1e-6)
    : cutOrderOf(machine).traceShortest;
  const lastKept = kept[kept.length - 1];
  const batchFrom: Pt = lastKept ? (lastKept.leadOut[lastKept.leadOut.length - 1] ?? lastKept.pts[lastKept.pts.length - 1]) : start;
  let contours: CutContour[];
  if (traceShortest && q.ordered && q.what === "all") contours = [...kept, ...tracesShortest(added, batchFrom)];
  else if (traceShortest && !q.ordered && q.parts && kept.length) {
    // some parts again (Inline cut's reset): the tracing kept stays as it was, the new tracing after it
    const kt = kept.filter((c) => c.kind === "trace" && c.pts.length > 1), lastT = kt[kt.length - 1];
    contours = [...kt, ...tracesShortest([...kept.filter((c) => !kt.includes(c)), ...added], lastT ? lastT.pts[lastT.pts.length - 1] : start)];
  } else if (traceShortest && !q.ordered) contours = tracesShortest([...kept, ...added], start);
  else contours = [...kept, ...added];
  contours = [...first, ...contours];
  // a common pierce group one of whose outlines was processed again: the one left goes back to its own leads
  contours = tidyPierces(contours);
  // Selected parts / Trace / Cut internal pick an order by hand: the rule of the Auto cut before stays the sheet's
  const autoRule = q.parts && q.ordered ? sheet.cut?.autoRule ?? (sheet.cut && sheet.cut.rule !== "manual" ? sheet.cut.rule : q.rule) : q.rule;
  // the settings it was cut with; some parts only, with others cut with other settings before: those stay
  // (Post process asks for the whole sheet to be processed again)
  const sigNow = cutSettingsSig(machine, sheet);
  const techSig = q.parts && sheet.cut && sheet.cut.techSig !== undefined && sheet.cut.techSig !== sigNow && sheet.cut.contours.length ? sheet.cut.techSig : sigNow;
  return { at: new Date().toISOString(), rule: q.parts && q.ordered ? "manual" : q.rule, autoRule, contours, keys, sigs, techSig, ...(Object.keys(msigs).length ? { msigs } : {}), ...(mirrored ? { mirrored } : {}),
    ...(fitCount.fitted || fitCount.tight ? { leadFit: fitCount } : {}),
    ...(first.length ? { keptFirst: new Set(first.flatMap((c) => c.parts ?? [c.part])).size } : {}) };
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
      // a common pierce's point and the leads it goes back to
      ...(c.cp ? { cp: { ...c.cp, at: mv(c.cp.at), orig: { ...c.cp.orig, leadIn: c.cp.orig.leadIn.map(mv), leadOut: c.cp.orig.leadOut.map(mv), ...(c.cp.orig.pts ? { pts: c.cp.orig.pts.map(mv) } : {}) } } } : {}),
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
