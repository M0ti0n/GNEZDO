// Process -> Inline cut: a flying cut for grids of parts on thin sheet. The parts' contours are cut
// in stretches, pass by pass across the sheet, instead of contour by contour: first every pass along
// X (snake: one way, then back on the next pass), then every pass along Y (or Y first). At the end
// every side of every part is cut.
//
// A contour is split where its direction turns more than 45° from X to Y (or back) and where it turns
// round along the pass: each stretch then runs one way along X (or Y), within 45° of it. Stretches
// whose cross extent fits in the corridor width and that do not overlap along the pass go in one
// pass (one corridor). A contour is cut inline only when all its stretches fit a corridor; the
// others stay as they were (holes before the passes, outlines after them), so a part never drops
// before its holes are cut.
//
// Each stretch is its own cut (the head moving on along the pass): the pierce chosen in the panel
// (quick by default), outlines with a short run-in in line with the pass on the scrap side (none
// where that would be in a part), holes without. The kerf compensation is the contour's: a stretch
// cut against the contour's direction is marked `rev` (G42 instead of G41).

import type { CutContour, SheetCut } from "./cutPath";
import { pointIn, type Pt } from "./manualGeom";

export type InlineAxis = "x" | "y";
export type InlinePierce = "pierce" | "quick" | "none";

export interface InlineOptions {
  /** the passes along this axis first */
  first: InlineAxis;
  /** how far apart (across the pass) stretches of one pass may be [mm] */
  width: number;
  /** outlines: the run-in before each stretch, on the scrap side [mm] (holes: none) */
  runIn: number;
  pierce: InlinePierce;
}

export const DEFAULT_INLINE: InlineOptions = { first: "x", width: 3, runIn: 2, pierce: "quick" };

/** A contour may go inline: an outline or a hole of one part, not a common cut, not in pieces already. */
export const inlineable = (c: CutContour) =>
  (c.kind === "outer" || c.kind === "inner") && !c.parts && !c.common && !c.bc && !c.inline;

const near = (a: Pt, b: Pt, d = 1e-3) => Math.hypot(a[0] - b[0], a[1] - b[1]) < d;

/** The contour's closed line (without its overcut; a tab's gap closed by a straight line). */
function loopOf(pts: Pt[]): Pt[] {
  let lp = pts;
  for (let k = 2; k < pts.length; k++) if (near(pts[k], pts[0])) { lp = pts.slice(0, k); break; }
  const out: Pt[] = [];
  for (const p of lp) if (!out.length || !near(out[out.length - 1], p)) out.push(p);
  while (out.length > 2 && near(out[0], out[out.length - 1])) out.pop();
  return out;
}

interface Stretch {
  /** candidate (contour) number */
  k: number;
  axis: InlineAxis;
  /** in the contour's direction */
  pts: Pt[];
  /** across the pass */
  lo: number; hi: number;
  /** along the pass */
  a0: number; a1: number;
}

const A = (axis: InlineAxis) => (axis === "x" ? 0 : 1);
const C = (axis: InlineAxis) => (axis === "x" ? 1 : 0);

/** The loop in stretches: a new one where the direction turns to the other axis or back along it. */
function stretchesOf(lp: Pt[], k: number): Stretch[] {
  const n = lp.length;
  if (n < 3) return [];
  const seg = Array.from({ length: n }, (_, i) => {
    const a = lp[i], b = lp[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const axis: InlineAxis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
    return { axis, sign: Math.sign(axis === "x" ? dx : dy) };
  });
  const same = (i: number, j: number) => seg[i].axis === seg[j].axis && seg[i].sign === seg[j].sign;
  // start where a stretch starts (the whole loop one way along one axis cannot be: it is closed)
  let s = -1;
  for (let i = 0; i < n; i++) if (!same((i + n - 1) % n, i)) { s = i; break; }
  if (s < 0) return [];
  const out: Stretch[] = [];
  let cur: Pt[] = [];
  let axis = seg[s].axis;
  const flush = () => {
    if (cur.length < 2) return;
    const ci = C(axis), ai = A(axis);
    const cs = cur.map((p) => p[ci]), as = cur.map((p) => p[ai]);
    out.push({ k, axis, pts: cur, lo: Math.min(...cs), hi: Math.max(...cs), a0: Math.min(...as), a1: Math.max(...as) });
  };
  for (let t = 0; t < n; t++) {
    const i = (s + t) % n;
    if (t > 0 && !same((i + n - 1) % n, i)) { flush(); cur = []; }
    if (!cur.length) { cur.push(lp[i]); axis = seg[i].axis; }
    cur.push(lp[(i + 1) % n]);
  }
  flush();
  return out;
}

interface Corridor { lo: number; hi: number; items: Stretch[] }

/** Stretches of one axis into corridors: within the width across, none overlapping along. */
function corridorsOf(list: Stretch[], width: number): Corridor[] {
  const tol = 0.05;
  const out: Corridor[] = [];
  for (const s of [...list].sort((a, b) => (a.lo + a.hi) - (b.lo + b.hi) || a.a0 - b.a0)) {
    let best: Corridor | null = null, bd = Infinity;
    for (const c of out) {
      if (Math.max(c.hi, s.hi) - Math.min(c.lo, s.lo) > width + 1e-6) continue;
      if (c.items.some((it) => s.a0 < it.a1 - tol && it.a0 < s.a1 - tol)) continue;
      const d = Math.abs((c.lo + c.hi) / 2 - (s.lo + s.hi) / 2);
      if (d < bd) { bd = d; best = c; }
    }
    if (best) { best.items.push(s); best.lo = Math.min(best.lo, s.lo); best.hi = Math.max(best.hi, s.hi); }
    else out.push({ lo: s.lo, hi: s.hi, items: [s] });
  }
  return out;
}

const boxOf = (pts: Pt[]) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { w: x1 - x0, h: y1 - y0 };
};

export interface InlineResult { cut: SheetCut; contours: number; stretches: number; passes: number; left: number }

/**
 * The sheet's cut path with the contours of these parts (null: every part) cut inline, from `from` (the
 * machine's 0,0). `live`: the contours still good. A message when nothing can go inline.
 */
export function inlineCut(cut: SheetCut, live: Set<CutContour>, parts: number[] | null, from: Pt, o: InlineOptions): InlineResult | string {
  const want = parts && parts.length ? new Set(parts) : null;
  const cand = cut.contours.filter((c) => live.has(c) && inlineable(c) && (!want || want.has(c.part)));
  if (!cand.length) return want ? "The selected parts have no outlines or holes to cut inline (process them first: Auto cut)" : "Nothing to cut inline: process the sheet first (Auto cut)";
  const width = Math.max(0.1, o.width);
  // each contour's stretches; a contour goes inline only when every stretch fits a corridor
  const loops = cand.map((c) => loopOf(c.pts));
  const all: Stretch[] = [];
  const ok: boolean[] = [];
  cand.forEach((_, k) => {
    const st = stretchesOf(loops[k], k);
    ok[k] = st.length >= 2 && st.every((s) => s.hi - s.lo <= width + 1e-6);
    if (ok[k]) all.push(...st);
  });
  const going = cand.filter((_, k) => ok[k]);
  if (!going.length) return `No contour fits: every one has a stretch wider than ${width} mm across its pass (a bigger corridor width, or Auto cut for these)`;

  // where the material is (a run-in must not go into a part): every part's outline less its holes
  const solids = new Map<number, { outer: Pt[][]; holes: Pt[][] }>();
  for (const c of cut.contours) {
    if (!live.has(c) || (c.kind !== "outer" && c.kind !== "inner") || c.common || c.parts || c.inline || c.bc) continue;
    const s = solids.get(c.part) ?? { outer: [], holes: [] };
    (c.kind === "outer" ? s.outer : s.holes).push(loopOf(c.pts));
    solids.set(c.part, s);
  }
  const inMaterial = (p: Pt) => [...solids.values()].some((s) => s.outer.some((lp) => lp.length > 2 && pointIn(lp, p[0], p[1])) && !s.holes.some((lp) => lp.length > 2 && pointIn(lp, p[0], p[1])));

  // the passes: corridors of the first axis, then of the other; snake from where the head is
  const pieces: CutContour[] = [];
  let at = from, passes = 0;
  const axes: InlineAxis[] = o.first === "x" ? ["x", "y"] : ["y", "x"];
  for (const axis of axes) {
    const cors = corridorsOf(all.filter((s) => s.axis === axis), width).sort((a, b) => (a.lo + a.hi) - (b.lo + b.hi));
    if (!cors.length) continue;
    const ai = A(axis), ci = C(axis);
    const mid = (c: Corridor) => (c.lo + c.hi) / 2;
    if (Math.abs(mid(cors[cors.length - 1]) - at[ci]) < Math.abs(mid(cors[0]) - at[ci])) cors.reverse();
    // the first pass from its end nearer the head, then back and forth
    const lo0 = Math.min(...cors[0].items.map((s) => s.a0)), hi0 = Math.max(...cors[0].items.map((s) => s.a1));
    let dir = Math.abs(at[ai] - lo0) <= Math.abs(at[ai] - hi0) ? 1 : -1;
    for (const cor of cors) {
      const items = [...cor.items].sort((a, b) => (dir > 0 ? a.a0 - b.a0 : b.a1 - a.a1));
      for (const s of items) {
        const c = cand[s.k];
        const fwd = s.pts[s.pts.length - 1][ai] >= s.pts[0][ai];
        const rev = fwd !== dir > 0;
        const pts = rev ? [...s.pts].reverse() : s.pts;
        const start = pts[0];
        let leadIn: Pt[] = [];
        if (c.kind === "outer" && o.runIn > 0) {
          const p: Pt = axis === "x" ? [start[0] - dir * o.runIn, start[1]] : [start[0], start[1] - dir * o.runIn];
          const m: Pt = [(p[0] + start[0]) / 2, (p[1] + start[1]) / 2];
          if (!inMaterial(p) && !inMaterial(m)) leadIn = [p, start];
        }
        const b = boxOf(c.pts);
        pieces.push({
          part: c.part, kind: c.kind, pts, leadIn, leadOut: [],
          ...(c.small ? { small: true } : {}),
          inline: { axis, rev, pierce: o.pierce, w: Math.round(b.w * 10) / 10, h: Math.round(b.h * 10) / 10 },
        });
        at = pts[pts.length - 1];
      }
      passes++;
      dir = -dir;
    }
  }

  // the cut order: the inline passes where the first of these parts was; their contours not inline
  // (holes, tracing, open cuts) before the passes, outlines after them
  const goingSet = new Set(going);
  const touched = new Set(going.map((c) => c.part));
  const before: CutContour[] = [], after: CutContour[] = [];
  for (const c of cut.contours) {
    if (goingSet.has(c) || !touched.has(c.part) || c.parts) continue;
    (c.kind === "outer" ? after : before).push(c);
  }
  const out: CutContour[] = [];
  let placed = false;
  for (const c of cut.contours) {
    const mine = !c.parts && touched.has(c.part);
    if (!mine) { out.push(c); continue; }
    if (!placed) { out.push(...before, ...pieces, ...after); placed = true; }
  }
  return { cut: { ...cut, contours: out }, contours: going.length, stretches: pieces.length, passes, left: cand.length - going.length };
}

/** The parts that are cut inline (some of their contours are stretches). */
export const inlineParts = (cut: SheetCut | undefined, live: Set<CutContour>) =>
  new Set((cut?.contours ?? []).filter((c) => c.inline && live.has(c)).map((c) => c.part));
