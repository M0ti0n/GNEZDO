// Process -> Break cut: an outline cut so the part stays held in the sheet. A break is a lead pair
// with a negative gap: the cut stops that far short and leaves the bridge. ADD NEW puts a break where
// its balloon is dropped (BC: the gap from the panel, behind the point; manual: from balloon 1, where
// the cut stops, to balloon 2, where it starts again); with "Keep the original lead in / out" the
// outline is then cut in pieces (a pierce each), else the break takes the original lead's place.
// MODIFY EXISTING changes a lead (the original one or a break) to the panel's type and values.
//
// The outline's pieces all carry the plan (its starts in cut order); every change builds them again
// from the part's drawing (job/leadEdit.ts loopOf), so the pieces always meet the plan.

import {
  leadValues, leadsAt,
  type BreakPlan, type BreakStart, type CutContour, type LeadSpec, type SheetCut,
} from "./cutPath";
import { autoType, leadOf, loopOf, nearestOn, startNear, type LeadCtx } from "./leadEdit";
import type { LeadType } from "./leads";
import type { Pt } from "./manualGeom";

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const len = (a: Pt) => Math.hypot(a[0], a[1]);
const r2 = (p: Pt): Pt => [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000];

/** A loop's positions: how far along it (mm from its first point, in its sense) a point is. */
function measure(lp: Pt[]) {
  const n = lp.length;
  const cum = [0];
  for (let i = 1; i <= n; i++) cum.push(cum[i - 1] + len(sub(lp[i % n], lp[i - 1])));
  const P = cum[n];
  const pos = (p: Pt) => { const q = nearestOn(lp, p); return (cum[q.edge] + q.t * (cum[q.edge + 1] - cum[q.edge])) % P; };
  /** the loop from position a forward to b (pa, pb: the points there) */
  const between = (a: number, b: number, pa: Pt, pb: Pt): Pt[] => {
    const d = ((b - a) % P + P) % P;
    const mids: { o: number; i: number }[] = [];
    for (let i = 0; i < n; i++) { const o = ((cum[i] - a) % P + P) % P; if (o > 1e-6 && o < d - 1e-6) mids.push({ o, i }); }
    mids.sort((x, y) => x.o - y.o);
    return [pa, ...mids.map((x) => lp[x.i]), pb];
  };
  /** the point at position d along the loop */
  const at = (d: number): Pt => {
    const q = ((d % P) + P) % P;
    let i = 0;
    while (i < n - 1 && cum[i + 1] < q) i++;
    const a = lp[i], b = lp[(i + 1) % n], L = cum[i + 1] - cum[i];
    const t = L > 0 ? (q - cum[i]) / L : 0;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  return { P, pos, between, at };
}

export const planId = () => Math.random().toString(36).slice(2, 10);

/** Every contour of the outline contour k is a piece of (its own index when it has no plan). */
export function piecesOf(cut: SheetCut, k: number): number[] {
  const c = cut.contours[k];
  if (!c?.bc) return [k];
  const id = c.bc.plan.id;
  return cut.contours.flatMap((d, i) => (d.bc?.plan.id === id ? [i] : []));
}

/** The plan of contour k: its own, or one start (the contour's lead) for an outline without breaks. */
export function planOf(ctx: LeadCtx, cut: SheetCut, k: number): BreakPlan {
  const c = cut.contours[k];
  if (c.bc) return c.bc.plan;
  const { type, spec } = leadOf(ctx, c);
  return { id: planId(), starts: [{ at: c.pts[0], type, spec, tag: "orig" }] };
}

/** The gap of a manual break: the length from balloon 1 forward to balloon 2 (negative), or why not. */
function manualGap(m: ReturnType<typeof measure>, p1: Pt, at: Pt): number | string {
  const d = ((m.pos(at) - m.pos(p1)) % m.P + m.P) % m.P;
  if (d < 0.05) return "Balloons 1 and 2 are on the same point";
  if (d > m.P / 2) return "Balloon 2 must come after balloon 1 in the cut direction (the arrows)";
  return -d;
}

/**
 * The outline's pieces for this plan (the plan's starts put in cut order from its first one), or why
 * not. `base`: a contour of the outline (part, kind, the rapid's points).
 */
export function buildPieces(ctx: LeadCtx, base: CutContour, plan: BreakPlan, mirrored: boolean): CutContour[] | string {
  const L = loopOf(ctx, base, mirrored);
  if (!L) return "the part's drawing is not there";
  const side: 1 | -1 = mirrored ? -1 : 1;
  const kind = base.kind === "outer" ? "outer" : "inner";
  const m = measure(L.lp);
  // each start on the loop, with its values (a manual break's gap: from its balloons)
  const starts: { s: BreakStart; at: ReturnType<typeof startNear>; pos: number; spec: LeadSpec }[] = [];
  for (const s of plan.starts) {
    // a micro joint: `at` is its middle, the cut starts again half its length on (it stops the other half before)
    const from = s.tag === "mj" ? m.at(m.pos(s.at) - s.spec.gap / 2) : s.at;
    const at = startNear(ctx, L.lp, from, s.tag === "mj" ? null : s.type, side, 0.05);
    if (typeof at === "string") return at;
    let spec = s.spec;
    if (s.tag === "manual" && s.p1) {
      const g = manualGap(m, s.p1, at.at);
      if (typeof g === "string") return g;
      spec = { ...spec, gap: g };
    }
    starts.push({ s, at, pos: m.pos(at.at), spec });
  }
  if (!starts.length) return "nothing left to cut";
  const p0 = starts[0].pos;
  starts.sort((a, b) => ((a.pos - p0 + m.P) % m.P) - ((b.pos - p0 + m.P) % m.P));
  const sorted: BreakPlan = { ...plan, starts: starts.map((x) => ({ ...x.s, at: r2(x.s.tag === "mj" ? x.s.at : (x.at as { at: Pt }).at) })) };
  const made = starts.map((x) => leadsAt(L.lp, kind, ctx.rules, ctx.row, x.at as Exclude<typeof x.at, string>, x.s.type, x.spec, side));
  const keep = { part: base.part, kind: base.kind } as Pick<CutContour, "part" | "kind">;
  const one = (k: number, body: Omit<CutContour, "part" | "kind">): CutContour => ({
    ...keep, ...body, lead: starts[k].s.type, spec: starts[k].spec,
    ...(starts[k].s.tag === "mj" ? { restart: true } : {}),
    ...(sorted.starts.length > 1 || sorted.starts[0].tag !== "orig" ? { bc: { plan: sorted, piece: k } } : {}),
    ...(k === 0 && base.via ? { via: base.via } : {}),
  });
  if (starts.length === 1) return [one(0, made[0])];
  // pieces: from each start to the next one's end (its gap), lead-in from this start, lead-out from the next
  const out: CutContour[] = [];
  for (let k = 0; k < starts.length; k++) {
    const nx = (k + 1) % starts.length;
    const end = made[nx].pts[made[nx].pts.length - 1];
    const a = starts[k].pos, b = m.pos(end);
    const span = ((b - a) % m.P + m.P) % m.P;
    const room = ((starts[nx].pos - a) % m.P + m.P) % m.P;
    if (span < 0.5 || span > room + Math.max(0, starts[nx].spec.gap) + 0.01) return "A break's gap is longer than the stretch before it: make it smaller";
    const pts = m.between(a, b, (starts[k].at as { at: Pt }).at, end).map(r2);
    out.push(one(k, { ...made[k], pts, leadOut: made[nx].leadOut }));
  }
  return out;
}

/** The cut with the outline of contour k replaced by these pieces (where its first piece was). */
export function replace(cut: SheetCut, k: number, pieces: CutContour[]): SheetCut {
  const old = new Set(piecesOf(cut, k));
  const first = Math.min(...old);
  const out: CutContour[] = [];
  cut.contours.forEach((c, i) => { if (i === first) out.push(...pieces); if (!old.has(i)) out.push(c); });
  return { ...cut, contours: out };
}

/** A point of the outline of contour `from` at the same place on the outline of contour `to` (a copy of the part). */
export function mapPoint(ctx: LeadCtx, from: CutContour, to: CutContour, p: Pt, mirrored: boolean): Pt | null {
  const A = loopOf(ctx, from, mirrored), B = loopOf(ctx, to, mirrored);
  if (!A || !B || A.raw.length !== B.raw.length) return null;
  const q = nearestOn(A.raw, p);
  const a = B.raw[q.edge], b = B.raw[(q.edge + 1) % B.raw.length];
  return [a[0] + (b[0] - a[0]) * q.t, a[1] + (b[1] - a[1]) * q.t];
}

/** The outlines (first piece each) of the other copies of contour k's part (same mirror). */
export function copiesOf(ctx: LeadCtx, cut: SheetCut, k: number, live: Set<CutContour>): number[] {
  const c0 = cut.contours[k], p0 = ctx.sheet.parts[c0.part];
  const own = new Set(piecesOf(cut, k));
  const seen = new Set<string>();
  const mirrored = !!cut.mirrored;
  const hole0 = c0.kind === "inner" ? loopOf(ctx, c0, mirrored)?.k : undefined;
  return cut.contours.flatMap((c, i) => {
    if (own.has(i) || !live.has(c) || c.kind !== c0.kind || c.parts || c.common || c.inline || c.cp) return [];
    const p = ctx.sheet.parts[c.part];
    if (!p || p.partId !== p0.partId || !!p.mirror !== !!p0.mirror) return [];
    if (c0.kind === "inner" && loopOf(ctx, c, mirrored)?.k !== hole0) return [];
    const g = c.bc ? c.bc.plan.id : `c${i}`;
    if (seen.has(g)) return [];
    seen.add(g);
    return [i];
  });
}

export type BreakOp =
  | { op: "add"; start: BreakStart; keepOrig: boolean }
  | { op: "set"; si: number; type: LeadType; spec: LeadSpec }
  | { op: "reset"; si: number }
  | { op: "move"; si: number; which: "at" | "p1"; to: Pt }
  | { op: "delete"; si: number };

/** The plan with the op done (a start's index si in the plan's order), or why not. */
export function applyOp(ctx: LeadCtx, plan: BreakPlan, op: BreakOp, kind: "outer" | "inner"): BreakPlan | string {
  const starts = plan.starts.slice();
  if (op.op === "add") {
    const rest = op.keepOrig ? starts : starts.filter((s) => s.tag !== "orig");
    const orig = plan.orig ?? starts.find((s) => s.tag === "orig");
    // kept: back in when it had gone; not kept: remembered
    if (op.keepOrig && !rest.some((s) => s.tag === "orig") && plan.orig) rest.unshift(plan.orig);
    return { ...plan, starts: [...rest, op.start], ...(orig ? { orig } : {}) };
  }
  const s = starts[op.si];
  if (!s) return "That lead is not there any more";
  if (op.op === "set") starts[op.si] = { ...s, type: op.type, spec: op.spec };
  else if (op.op === "reset") {
    const type = s.tag === "orig" ? s.type : "perpGap";
    starts[op.si] = { ...s, type, spec: { ...leadValues(kind, ctx.row, type), gap: s.tag === "orig" ? leadValues(kind, ctx.row, type).gap : s.spec.gap } };
  } else if (op.op === "move") starts[op.si] = op.which === "p1" ? { ...s, p1: op.to } : { ...s, at: op.to };
  else {
    if (s.tag === "orig" && starts.length === 1) return "The outline needs a start: change it instead (MODIFY EXISTING)";
    starts.splice(op.si, 1);
  }
  return { ...plan, starts };
}

/**
 * The cut with the op done on the outline of contour k, and with `all` on the same place of every copy
 * of its part (the points mapped; a copy without that lead is left out). The number of outlines changed.
 */
export function editBreak(ctx: LeadCtx, k: number, op: BreakOp, all: boolean, live: Set<CutContour>): { cut: SheetCut; n: number } | string {
  let cut = ctx.sheet.cut;
  const c0 = cut?.contours[k];
  if (!cut || !c0) return "Pick an outline";
  const holes = (op.op === "add" && op.start.tag === "mj") || (op.op !== "add" && c0.bc?.plan.starts[op.si]?.tag === "mj");
  if ((c0.kind !== "outer" && !(holes && c0.kind === "inner")) || c0.parts || c0.common) return holes ? "Micro joints go on part outlines and holes (not on common cut blocks)" : "Break cuts go on part outlines (not on holes or common cut blocks)";
  const mirrored = !!cut.mirrored;
  const kind = c0.kind === "inner" ? "inner" : "outer";
  const plan0 = planOf(ctx, cut, k);
  // a new or moved start: onto the outline (a sharp corner within 3 mm: the corner; corner types need one)
  if (op.op === "add" || op.op === "move") {
    const L = loopOf(ctx, c0, mirrored);
    if (!L) return "the part's drawing is not there";
    const side: 1 | -1 = mirrored ? -1 : 1;
    const type = op.op === "add" ? op.start.type : plan0.starts[op.si]?.type ?? "perpGap";
    const mj = op.op === "add" ? op.start.tag === "mj" : plan0.starts[op.si]?.tag === "mj";
    const snap = (p: Pt, t: LeadType | null) => { const s = startNear(ctx, L.lp, p, mj ? null : t, side, 3); return typeof s === "string" ? s : s.at; };
    if (op.op === "add") {
      const at = snap(op.start.at, op.start.type);
      if (typeof at === "string") return at;
      const p1 = op.start.p1 ? snap(op.start.p1, null) : undefined;
      if (typeof p1 === "string") return p1;
      op = { ...op, start: { ...op.start, at, ...(p1 ? { p1 } : {}) } };
    } else {
      const to = snap(op.to, op.which === "p1" ? null : type);
      if (typeof to === "string") return to;
      op = { ...op, to };
    }
  }
  const first = applyOp(ctx, plan0, op, kind);
  if (typeof first === "string") return first;
  const built = buildPieces(ctx, c0, first, mirrored);
  if (typeof built === "string") return built;
  const copies = all ? copiesOf(ctx, cut, k, live) : [];
  // the copies' contours, by the original's pieces, before the cut changes
  const targets = copies.map((i) => cut!.contours[i]);
  const startAt = op.op !== "add" ? plan0.starts[op.si] : undefined;
  cut = replace(cut, k, built);
  let n = 1;
  for (const t of targets) {
    const i = cut.contours.indexOf(t);
    if (i < 0) continue;
    const map = (p: Pt) => mapPoint(ctx, c0, t, p, mirrored);
    const plan = planOf(ctx, cut, i);
    let o: BreakOp | null = null;
    if (op.op === "add") {
      const at = map(op.start.at), p1 = op.start.p1 ? map(op.start.p1) : undefined;
      if (!at || (op.start.p1 && !p1)) continue;
      o = { ...op, start: { ...op.start, at, ...(p1 ? { p1 } : {}) } };
    } else {
      // the copy's lead at the same place
      const want = startAt && map(startAt.at);
      const si = want ? plan.starts.findIndex((s) => s.tag === startAt!.tag && len(sub(s.at, want)) < 0.5) : -1;
      if (si < 0) continue;
      if (op.op === "move") { const to = map(op.to); if (!to) continue; o = { ...op, si, to }; }
      else o = { ...op, si };
    }
    const p = applyOp(ctx, plan, o, kind);
    if (typeof p === "string") continue;
    const b = buildPieces(ctx, cut.contours[i], p, mirrored);
    if (typeof b === "string") continue;
    cut = replace(cut, i, b);
    n++;
  }
  return { cut, n };
}

/** The balloons of the sheet's break cuts (or micro joints: MJ1, MJ2 … per contour): where, its label,
 *  its contour (a piece's index), start, and what hovering over it tells. */
export interface Balloon { at: Pt; label: string; k: number; si: number; which: "at" | "p1"; neg: boolean; title: string }
const mm = (v: number) => `${+Math.abs(v).toFixed(2)} mm`;
export function balloonsOf(cut: SheetCut | undefined, live: Set<CutContour>, what: "bc" | "mj" = "bc"): Balloon[] {
  if (!cut) return [];
  const out: Balloon[] = [];
  const seen = new Set<string>();
  cut.contours.forEach((c, k) => {
    if (!c.bc || !live.has(c) || seen.has(c.bc.plan.id)) return;
    seen.add(c.bc.plan.id);
    let n = 0;
    c.bc.plan.starts.forEach((s, si) => {
      const neg = s.tag === "manual" || s.spec.gap < 0;
      if (what === "mj") {
        if (s.tag === "mj") { n++; out.push({ at: s.at, label: `MJ${n}`, k, si, which: "at", neg: false, title: `Micro joint ${n}: ${mm(s.spec.gap)}` }); }
        return;
      }
      const gap = s.spec.gap < 0 ? `gap ${mm(s.spec.gap)} (not cut)` : `gap +${mm(s.spec.gap)} (runs past)`;
      if (s.tag === "bc") out.push({ at: s.at, label: "BC", k, si, which: "at", neg, title: `Break cut: ${gap}` });
      if (s.tag === "manual" && s.p1) {
        const t = `Break cut, balloon 1 to 2: ${mm(s.spec.gap)} not cut`;
        out.push({ at: s.p1, label: "1", k, si, which: "p1", neg, title: t }, { at: s.at, label: "2", k, si, which: "at", neg, title: t });
      }
    });
  });
  return out;
}

/** The lead (outline k, start si) whose pierce or balloon is nearest p within reach mm; si -1: none. */
export function leadNear(cut: SheetCut, live: Set<CutContour>, p: Pt, reach: number): { k: number; si: number } | null {
  let best: { k: number; si: number } | null = null, bd = reach;
  for (const b of balloonsOf(cut, live)) { const d = len(sub(b.at, p)); if (d <= bd) { bd = d; best = { k: b.k, si: b.si }; } }
  cut.contours.forEach((c, k) => {
    if (!live.has(c) || c.kind !== "outer" || c.parts || c.common || c.inline || c.cp) return;
    const d = len(sub(c.leadIn[0] ?? c.pts[0], p));
    // a piece's lead is its start in the plan; an outline without breaks: its one start
    if (d <= bd) { bd = d; best = { k, si: c.bc ? c.bc.piece : 0 }; }
  });
  return best;
}

/** The type and values of start si of outline k (as the panel shows them). */
export function startOf(ctx: LeadCtx, cut: SheetCut, k: number, si: number): BreakStart | null {
  return planOf(ctx, cut, k).starts[si] ?? null;
}

/** The automatic cut's type for an outline started at this point (for a new break on a sharp corner). */
export { autoType };
