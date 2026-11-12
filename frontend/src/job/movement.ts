// Process -> Movement: a rapid move rerouted by hand through points (SINGLE POINT: one, MULTIPOINT:
// several, closed on a lead-in), or sent to another contour, which changes the cut order:
//  - from a part's outline: to any contour of another part (that part, whole, is cut next; the rapid
//    goes to its first contour);
//  - from a hole, open cut or marking: only to another hole or open cut of the same part (marking
//    from marking too), which is cut next.
// The points belong to the rapid into a contour, and only while the contour before it stays the same
// (cutPath.ts viaOf). DELETE POINT takes one point out; the rapid then goes straight past it.

import { contourKey, viaOf, type CutContour, type SheetCut } from "./cutPath";
import { orderProblem } from "./manualCut";
import type { Pt } from "./manualGeom";

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const distSeg = (p: Pt, a: Pt, b: Pt) => {
  const ex = b[0] - a[0], ey = b[1] - a[1], L2 = ex * ex + ey * ey;
  const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / L2)) : 0;
  return Math.hypot(a[0] + t * ex - p[0], a[1] + t * ey - p[1]);
};
const pierceOf = (c: CutContour): Pt => c.leadIn[0] ?? c.pts[0];

/** The live contours' places in cut.contours, in cutting order. */
export const liveOrder = (cut: SheetCut, live: Set<CutContour>) => cut.contours.flatMap((c, i) => (live.has(c) ? [i] : []));

/** The contour before contour k in cutting order (index in cut.contours), -1: k is the first. */
export function before(order: number[], k: number): number {
  const j = order.indexOf(k);
  return j > 0 ? order[j - 1] : -1;
}

/** Every contour of the part (or common cut block) contour k is in. */
export function unitOf(cut: SheetCut, k: number): number[] {
  const parts = new Set(cut.contours[k].parts ?? [cut.contours[k].part]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of cut.contours) {
      const ps = c.parts ?? [c.part];
      if (ps.some((x) => parts.has(x)) && ps.some((x) => !parts.has(x))) { ps.forEach((x) => parts.add(x)); grew = true; }
    }
  }
  return cut.contours.flatMap((c, i) => ((c.parts ?? [c.part]).some((x) => parts.has(x)) ? [i] : []));
}

/** The rapid (into contour index) nearest p within reach mm, with its points as drawn. */
export function rapidAt(cut: SheetCut, live: Set<CutContour>, from: Pt, p: Pt, reach: number): { k: number; pts: Pt[] } | null {
  const order = liveOrder(cut, live);
  let best: { k: number; pts: Pt[] } | null = null, bd = reach;
  let at = from;
  order.forEach((k, j) => {
    const c = cut.contours[k];
    const pts = [at, ...viaOf(c, j ? cut.contours[order[j - 1]] : undefined), pierceOf(c)];
    for (let i = 1; i < pts.length; i++) { const d = distSeg(p, pts[i - 1], pts[i]); if (d <= bd) { bd = d; best = { k, pts }; } }
    at = c.leadOut[c.leadOut.length - 1] ?? c.pts[c.pts.length - 1] ?? at;
  });
  return best;
}

/** The contour whose lead-in (pierce point) is nearest p within reach mm (-1: none). */
export function pierceAt(cut: SheetCut, live: Set<CutContour>, p: Pt, reach: number): number {
  let k = -1, bd = reach;
  cut.contours.forEach((c, i) => { if (!live.has(c)) return; const d = dist(pierceOf(c), p); if (d <= bd) { bd = d; k = i; } });
  return k;
}

/** Why the rapid into k cannot go to t instead (null: it can). */
export function cannotGo(cut: SheetCut, live: Set<CutContour>, k: number, t: number): string | null {
  if (t === k) return null;
  const order = liveOrder(cut, live);
  const f = before(order, k);
  if (f < 0) return "The first rapid comes from the machine's 0,0: only its way can change, not where it goes";
  const A = cut.contours[f], T = cut.contours[t];
  if (A.common || T.common) return "Common cut lines: their order is not changed here";
  if (t === f) return "That is where the rapid starts";
  const sameUnit = unitOf(cut, f).includes(t);
  if (A.kind === "outer") {
    if (sameUnit) return "From an outline: only to another part's lead-in";
    return null;
  }
  const holeLike = (c: CutContour) => c.kind === "inner" || c.kind === "open" || (A.kind === "trace" && c.kind === "trace");
  if (!sameUnit || !holeLike(T) || T.parts) return `From ${A.kind === "trace" ? "a marking" : A.kind === "open" ? "an open cut" : "a hole"}: only to another hole or open cut of the same part`;
  return null;
}

/**
 * The cut with the rapid into contour k going through `pts` to contour t (k: only the way changes;
 * another contour: the cut order changes as the rules say). An error text when it cannot.
 */
export function routeRapid(cut: SheetCut, live: Set<CutContour>, k: number, t: number, pts: Pt[], nameOf: (part: number) => string): SheetCut | string {
  const no = cannotGo(cut, live, k, t);
  if (no) return no;
  const order = liveOrder(cut, live);
  const f = before(order, k);
  let out = cut.contours.slice();
  let target = k;
  if (t !== k) {
    const A = cut.contours[f];
    // what moves: another part whole (from an outline), else the one contour
    const moving = A.kind === "outer" ? unitOf(cut, t) : [t];
    const set = new Set(moving);
    const rest = out.filter((_, i) => !set.has(i));
    const at = rest.indexOf(A) + 1;
    out = [...rest.slice(0, at), ...moving.map((i) => cut.contours[i]), ...rest.slice(at)];
    // the rapid goes to the first live contour of what moved
    const firstLive = moving.find((i) => live.has(cut.contours[i]));
    target = out.indexOf(cut.contours[firstLive ?? t]);
    const bad = orderProblem(out, nameOf);
    if (bad) return bad;
  }
  const newOrder = out.flatMap((c, i) => (live.has(c) ? [i] : []));
  const prevI = before(newOrder, target);
  const c = out[target];
  const next: CutContour = { ...c };
  delete next.via;
  if (pts.length) next.via = { pts: pts.map((p) => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100] as Pt), after: prevI >= 0 ? contourKey(out[prevI]) : "origin" };
  out[target] = next;
  return { ...cut, contours: pruneVias(out, live), ...(t !== k ? { rule: "manual" as const } : {}) };
}

/** The contours without the points of rapids whose contour before changed (they no longer apply). */
export function pruneVias(contours: CutContour[], live: Set<CutContour>): CutContour[] {
  let prev: CutContour | undefined;
  return contours.map((c) => {
    if (!live.has(c)) return c;
    const p = prev;
    prev = c;
    if (!c.via || viaOf(c, p).length) return c;
    const n = { ...c };
    delete n.via;
    return n;
  });
}

/** The cut with the Movement point nearest p (within reach mm) taken out; null: no point there. */
export function deleteViaPoint(cut: SheetCut, live: Set<CutContour>, p: Pt, reach: number): SheetCut | null {
  const order = liveOrder(cut, live);
  let hit: { k: number; j: number } | null = null, bd = reach;
  order.forEach((k, n) => {
    const via = viaOf(cut.contours[k], n ? cut.contours[order[n - 1]] : undefined);
    via.forEach((q, j) => { const d = dist(q, p); if (d <= bd) { bd = d; hit = { k, j }; } });
  });
  if (!hit) return null;
  const { k, j } = hit as { k: number; j: number };
  const c = cut.contours[k];
  const pts = c.via!.pts.filter((_, i) => i !== j);
  const next: CutContour = { ...c };
  delete next.via;
  if (pts.length) next.via = { ...c.via!, pts };
  const out = cut.contours.slice();
  out[k] = next;
  return { ...cut, contours: out };
}

/** The cut with every Movement point taken out (straight rapids again). */
export function clearVias(cut: SheetCut): SheetCut {
  return { ...cut, contours: cut.contours.map((c) => { if (!c.via) return c; const n = { ...c }; delete n.via; return n; }) };
}
