// Process -> Manual cut: contours of a processed sheet picked one by one take the places they had in
// the cut path, in the order picked (the rest stays where it is). Picking every contour sets the whole
// order. A part's outline must still come after its own holes, marking and open cuts.

import type { CutContour, SheetCut } from "./cutPath";
import type { Pt } from "./manualGeom";

const distPoly = (pts: Pt[], p: Pt) => {
  let d = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], ex = pts[i][0] - a[0], ey = pts[i][1] - a[1], L2 = ex * ex + ey * ey;
    const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / L2)) : 0;
    d = Math.min(d, Math.hypot(a[0] + t * ex - p[0], a[1] + t * ey - p[1]));
  }
  return pts.length === 1 ? Math.hypot(pts[0][0] - p[0], pts[0][1] - p[1]) : d;
};

/** The contour (index in cut.contours) nearest the point, within `reach` mm; -1: none. */
export function pickContour(cut: SheetCut, live: Set<CutContour>, p: Pt, reach: number): number {
  let k = -1, best = Infinity;
  cut.contours.forEach((c, i) => {
    if (!live.has(c)) return;
    const d = Math.min(distPoly(c.pts, p), c.leadIn.length > 1 ? distPoly(c.leadIn, p) : Infinity, c.leadOut.length > 1 ? distPoly(c.leadOut, p) : Infinity);
    if (d < best) { best = d; k = i; }
  });
  return best <= reach ? k : -1;
}

/** What a contour is, in words. */
export function contourKind(c: CutContour): string {
  if (c.common) return "Common cut line";
  if (c.kind === "outer") return c.parts ? "Block outline" : "Outline";
  if (c.kind === "inner") return c.parts ? "Block hole" : c.island ? "Island" : "Hole";
  return c.kind === "trace" ? "Marking" : "Open cut";
}

/**
 * The cut with the picked contours (indexes) in the places they had, in the order picked; an error text
 * when a part's outline would come before something of the part itself.
 */
export function reorderCut(cut: SheetCut, picked: number[], nameOf: (part: number) => string): SheetCut | string {
  const slots = picked.slice().sort((a, b) => a - b);
  const out = cut.contours.slice();
  slots.forEach((s, j) => { out[s] = cut.contours[picked[j]]; });
  const bad = orderProblem(out, nameOf);
  if (bad) return `${bad} Pick it before the outline.`;
  return { ...cut, contours: out, rule: "manual", at: new Date().toISOString() };
}

/** A part's outline before something of its own (the part would fall out first): what, in words; null: fine. */
export function orderProblem(out: CutContour[], nameOf: (part: number) => string): string | null {
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    if (c.kind !== "outer") continue;
    // an inline outline is cut in stretches: the part falls out only at its last one
    if (c.inline && out.some((d, j) => j > i && d.inline && d.kind === "outer" && d.part === c.part)) continue;
    const own = new Set(c.parts ?? [c.part]);
    for (let j = i + 1; j < out.length; j++) {
      const d = out[j];
      // inline hole stretches go in the passes with the outline's (their order is the passes')
      if (d.kind === "outer" || (c.inline && d.inline)) continue;
      if ((d.parts ?? [d.part]).some((x) => own.has(x))) {
        return `${c.parts ? "A common cut block" : nameOf(c.part)}: its outline would be cut before its ${contourKind(d).toLowerCase()} (the part would fall out first).`;
      }
    }
  }
  return null;
}

// ------------------------------------------------------------------ Path cut order
//
// The cut path as the parts drop out one after another (a step each): the timeline goes step by step.
// What is cut as one is one step and moves as one: a common cut block, the parts of the inline passes,
// a common pierce group. Tracing done first of all (the shortest way, before any part) stays first.

/** Parts cut as one, and their contours (indexes in the live path) in cut order. */
export interface CutUnit {
  parts: number[];
  ks: number[];
  /** where its last contour is: it is cut out there */
  end: number;
  /** why its parts go together (none: one part) */
  why?: "block" | "inline" | "pierce";
}

export interface PathSteps {
  /** the live contours in cut order */
  list: CutContour[];
  /** the tracing at the start of the path (before any other contour): always kept first */
  lead: number;
  /** in the order they are cut out */
  units: CutUnit[];
  /** a part's unit (index in units) */
  unitOf: Map<number, number>;
}

/** The steps of a live cut path. */
export function pathSteps(list: CutContour[]): PathSteps {
  const up = new Map<number, number>();
  const find = (a: number): number => { let r = a; while (up.has(r) && up.get(r) !== r) r = up.get(r)!; up.set(a, r); return r; };
  const join = (a: number, b: number) => { const x = find(a), y = find(b); if (x !== y) up.set(y, x); };
  const why = new Map<number, CutUnit["why"]>();
  const pierce = new Map<string, number>();
  let inl: number | null = null;
  for (const c of list) {
    const own = c.parts ?? [c.part];
    own.forEach((k) => find(k));
    if (c.parts) { own.forEach((k) => { join(own[0], k); why.set(k, "block"); }); }
    if (c.cp) { const p0 = pierce.get(c.cp.id); if (p0 === undefined) pierce.set(c.cp.id, c.part); else join(p0, c.part); if (!why.has(c.part)) why.set(c.part, "pierce"); }
    // the inline passes cut stretches of many parts in turn: those parts go as one
    if (c.inline) { if (inl === null) inl = c.part; else join(inl, c.part); why.set(c.part, "inline"); }
  }
  let lead = 0;
  while (lead < list.length && list[lead].kind === "trace") lead++;
  const byRoot = new Map<number, CutUnit>();
  list.forEach((c, k) => {
    if (k < lead) return;
    const r = find(c.parts?.[0] ?? c.part);
    let u = byRoot.get(r);
    if (!u) { u = { parts: [], ks: [], end: -1 }; byRoot.set(r, u); }
    u.ks.push(k);
    u.end = k;
    for (const p of c.parts ?? [c.part]) if (!u.parts.includes(p)) u.parts.push(p);
  });
  const units = [...byRoot.values()].sort((a, b) => a.end - b.end);
  for (const u of units) {
    const w = u.parts.map((p) => why.get(p)).filter(Boolean);
    const one = w.includes("block") ? "block" : w.includes("inline") ? "inline" : w.includes("pierce") ? "pierce" : undefined;
    if (u.parts.length > 1 && one) u.why = one;
  }
  const unitOf = new Map<number, number>();
  units.forEach((u, j) => u.parts.forEach((p) => unitOf.set(p, j)));
  return { list, lead, units, unitOf };
}

/** The last contour (index in steps.list) kept with the timeline at `at` steps (-1: none). */
export const keptEnd = (steps: PathSteps, at: number) => (at <= 0 ? steps.lead - 1 : steps.units[Math.min(at, steps.units.length) - 1].end);

/** Units put in order after the timeline: what lies in a unit's part's hole goes in before it. */
function placer(steps: PathSteps, at: number, container: Map<number, number>) {
  const kids = new Map<number, number[]>();
  for (const [kid, box] of container) {
    const a = steps.unitOf.get(box), b = steps.unitOf.get(kid);
    if (a === undefined || b === undefined || a === b) continue;
    kids.set(a, [...(kids.get(a) ?? []), b]);
  }
  const placed = new Set<number>(), order: number[] = [];
  const place = (j: number) => {
    if (placed.has(j) || j < at || j >= steps.units.length) return;
    placed.add(j);
    for (const k of kids.get(j) ?? []) place(k);
    order.push(j);
  };
  return { order, place };
}

/** The units the picked ones bring after the timeline, in that order (the picked ones with what lies in their holes before them). */
export function pickedPlan(steps: PathSteps, at: number, picked: number[], container: Map<number, number>): number[] {
  const { order, place } = placer(steps, at, container);
  picked.forEach(place);
  return order;
}

/**
 * The cut with the first `at` steps as they are, then the picked units (indexes in steps.units) in the
 * order picked, then the others in the order of `rest` (their parts in an Auto cut rule's order; parts
 * not in it: as they were). A part lying in a hole of another one comes before it (`container`). The
 * contours of a unit keep their order; contours of parts not processed any more go at the end, as they
 * were. `next`: the steps the picked units take now (with what had to come before them). An error text
 * when a part's outline would come before something of its own.
 */
export function pathReorder(cut: SheetCut, steps: PathSteps, at: number, picked: number[], rest: number[], container: Map<number, number>,
  nameOf: (part: number) => string): { cut: SheetCut; next: number } | string {
  at = Math.max(0, Math.min(Math.floor(at), steps.units.length));
  // only units still ahead of the timeline, each once (a pick left over from an older path is dropped)
  picked = [...new Set(picked)].filter((j) => Number.isInteger(j) && j >= at && j < steps.units.length);
  const end = keptEnd(steps, at);
  const tail = steps.units.map((_, j) => j).filter((j) => j >= at);
  const { order, place } = placer(steps, at, container);
  const rank = new Map<number, number>();
  rest.forEach((p, k) => { const j = steps.unitOf.get(p); if (j !== undefined && !rank.has(j)) rank.set(j, k); });
  const others = tail.filter((j) => !picked.includes(j)).sort((a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity) || a - b);
  picked.forEach(place);
  const next = order.length;
  others.forEach(place);
  const live = new Set(steps.list);
  const contours = [
    ...steps.list.slice(0, end + 1),
    ...order.flatMap((j) => steps.units[j].ks.filter((k) => k > end).map((k) => steps.list[k])),
    ...cut.contours.filter((c) => !live.has(c)),
  ];
  const bad = orderProblem(contours, nameOf);
  if (bad) return bad;
  return { cut: { ...cut, contours, rule: "manual", at: new Date().toISOString() }, next };
}
