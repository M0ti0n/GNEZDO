// FITTINGS -> Segmented elbow (from the HVAC Fittings workbench): middle and end sections of a round
// segmented elbow, on the neutral surface. N full middle sections; the two end sections are each half a
// middle section, so one middle section spans A / (N + 1). The seam is always on the side: then every
// other section turned round fits against the next, and all of them stack into one rectangle with open
// cuts between them.
//
//   h(phi) = (R + D/2 cos phi) tan(theta / 2),   phi = 0 on the heel, x along the circumference (0 .. pi D)

import { Lines, fit, mapSeg, rev, seg, type P2, type Seg } from "./arcs";

export interface ElbowValues {
  d: number;        // diameter (neutral)
  a: number;        // elbow angle, degrees
  r: number;        // centerline radius
  n: number;        // full middle sections
  folds: number;    // fold lines around (0: none)
  markLen: number;  // fold mark length
  markGap: number;  // fold mark: from the cut edge
  stacked: boolean; // all sections in one rectangle, open cuts between them
}

export const ELBOW_DEFAULTS: ElbowValues = { d: 300, a: 90, r: 450, n: 3, folds: 24, markLen: 15, markGap: 2, stacked: false };

export function elbowProblems(v: ElbowValues): string[] {
  const e: string[] = [];
  if (!(v.d > 0)) e.push("D must be greater than 0");
  if (!(v.a > 0 && v.a < 180)) e.push("A must be between 0 and 180°");
  if (!(v.n >= 0) || !Number.isInteger(v.n)) e.push("N must be a whole number, 0 or more");
  if (!(v.r >= v.d / 2)) e.push("R must be at least D / 2 (or the throat folds over itself)");
  if (!(v.markLen > 0) || !(v.markGap >= 0)) e.push("Fold marks: length above 0, gap 0 or more");
  if (!(v.folds >= 0) || !Number.isInteger(v.folds)) e.push("Fold lines: a whole number, 0 or more");
  return e;
}

/** The section angle, its tan(theta / 2), the developed width. */
export function elbowBasics(v: ElbowValues) {
  const theta = v.a / (v.n + 1);
  const t = Math.tan((theta * Math.PI) / 180 / 2);
  return { theta, t, width: Math.PI * v.d };
}

/** Two fold marks on a fold from y0 up to y1 (merged into one when they would touch). */
function foldMarks(x: number, y0: number, y1: number, v: ElbowValues): [P2, P2][] {
  const g = v.markGap, L = v.markLen;
  if (y0 + g + L >= y1 - g - L) return y1 - y0 <= 2 * g + 0.5 ? [] : [[[x, y0 + g], [x, y1 - g]]];
  return [[[x, y0 + g], [x, y0 + g + L]], [[x, y1 - g - L], [x, y1 - g]]];
}

export interface ElbowPiece { key: "M" | "E" | "S"; label: string; qty: number; lines: Lines }

export function elbowPieces(v: ElbowValues): ElbowPiece[] {
  const { t, width } = elbowBasics(v);
  const rr = v.d / 2;
  // seam on the side: phi starts at 90°
  const h = (x: number) => (v.r + rr * Math.cos(Math.PI / 2 + x / rr)) * t;
  const hTurned = (x: number) => (v.r - rr * Math.cos(Math.PI / 2 + x / rr)) * t;   // the section turned round
  const foldXs = v.folds > 0 ? Array.from({ length: v.folds }, (_, i) => (width / v.folds) * (i + 0.5)) : [];
  const top = fit(h, 0, width);
  const t0 = top[0].a, t1 = top[top.length - 1].b;
  const down = (s: Seg) => mapSeg(s, ([x, y]) => [x, -y]);

  if (v.stacked) {
    // bottom end section (square edge at 0), middles turned / not turned in turn, top end section:
    // the cut between section k and k+1 is 2Rt·k + (h or h turned); the rectangle is 2Rt·(N + 1) high
    const Rt = v.r * t, H = 2 * Rt * (v.n + 1);
    const L = new Lines();
    L.segs([seg([0, 0], [width, 0]), seg([width, 0], [width, H]), seg([width, H], [0, H]), seg([0, H], [0, 0])]);
    const cutAt = (k: number) => (x: number) => 2 * Rt * k + (k % 2 === 0 ? h(x) : hTurned(x));
    const cuts = Array.from({ length: v.n + 1 }, (_, k) => cutAt(k));
    for (const c of cuts) L.segs(fit(c, 0, width), "openCut");
    // fold marks of every section, from its lower edge to its upper one
    const edges = [() => 0, ...cuts, () => H];
    for (let s = 0; s + 1 < edges.length; s++) for (const x of foldXs) L.marks(foldMarks(x, edges[s](x), edges[s + 1](x), v));
    return [{ key: "S", label: "stacked", qty: 1, lines: L }];
  }

  const mid = new Lines();
  mid.segs([...top, seg(t1, [t1[0], -t1[1]]), ...top.map(down).reverse().map(rev), seg([t0[0], -t0[1]], t0)]);
  for (const x of foldXs) mid.marks(foldMarks(x, -h(x), h(x), v));
  const end = new Lines();
  end.segs([seg([0, 0], [width, 0]), seg([width, 0], t1), ...[...top].reverse().map(rev), seg(t0, [0, 0])]);
  for (const x of foldXs) end.marks(foldMarks(x, 0, h(x), v));
  const out: ElbowPiece[] = [];
  if (v.n > 0) out.push({ key: "M", label: "middle", qty: v.n, lines: mid });
  out.push({ key: "E", label: "end", qty: 2, lines: end });
  return out;
}
