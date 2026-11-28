// Loop corners (Auto cut → Loop corners): at a sharp corner of a part the cut goes on past the corner (the
// lead-out distance, in line with the edge it came along), turns round in a loop of the set radius in the
// scrap, and comes back in to the corner in line with the next edge (the lead-in distance): the corner is
// cut sharp, not burnt round. Only corners whose material angle is LOOP_MIN_DEG..LOOP_MAX_DEG (fixed for
// now), only outlines and holes (closed), and only where the loop stays out of the part itself.
//
// Made by Auto cut (the Technology row's values, checked against the other parts with the kerf between and
// the sheet's edge) and kept on the contour by corner: the contour keeps its own points, the loops are put
// in where the path is cut (NC program, simulation, the sheet's drawing: cutBody). A lead moved onto a
// corner leaves it without its loop (the start has none).

import type { CutContour } from "./cutPath";

type Pt = [number, number];

/** the loop: out past the corner, its radius, back in to the corner [mm] (Technology → Loop corners) */
export interface LoopSpec { outMm: number; rMm: number; inMm: number }

/** a corner gets a loop when the part's angle there is in this range [°] */
export const LOOP_MIN_DEG = 25;
export const LOOP_MAX_DEG = 145;

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const len = (a: Pt) => Math.hypot(a[0], a[1]);
const unit = (a: Pt): Pt => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };

function inPoly(poly: Pt[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** a contour that can have loops: an outline or a hole, whole (closed), not a piece of a break / inline cut */
export function loopable(c: Pick<CutContour, "kind" | "pts" | "bc" | "inline">): boolean {
  if ((c.kind !== "outer" && c.kind !== "inner") || c.bc || c.inline || c.pts.length < 4) return false;
  const a = c.pts[0], b = c.pts[c.pts.length - 1];
  return Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.01;
}

/** a loop at a corner of a contour: the corner, and the loop's points from it back to it (corner not included) */
export interface CornerLoop { at: Pt; pts: Pt[] }

/** The loops of a contour at its sharp corners (Auto cut): each one where it stays out of the part, and
 *  where `blocked` lets it (other parts with the kerf between, the sheet's edge, an island in the hole). */
export function cornerLoops(c: CutContour, spec: LoopSpec, blocked: (q: Pt) => boolean): CornerLoop[] {
  if (spec.rMm <= 0 || !loopable(c)) return [];
  const pts = c.pts, n = pts.length - 1;            // pts[n] is pts[0]
  const ring = pts.slice(0, n);
  // material: inside an outline (an island too), outside a hole
  const hole = c.kind === "inner" && !c.island;
  const material = (q: Pt) => inPoly(ring, q[0], q[1]) !== hole;
  const out: CornerLoop[] = [];
  // not at the start (the lead is there)
  for (let k = 1; k < n; k++) {
    const P = pts[k], prev = pts[k - 1], next = pts[k + 1];
    const l1 = len(sub(P, prev)), l2 = len(sub(next, P));
    if (l1 < 1e-6 || l2 < 1e-6) continue;
    const t1 = unit(sub(P, prev)), t2 = unit(sub(next, P));
    const u: Pt = [-t1[0], -t1[1]];
    const ang = (Math.acos(Math.max(-1, Math.min(1, u[0] * t2[0] + u[1] * t2[1]))) * 180) / Math.PI;
    if (ang < LOOP_MIN_DEG || ang > LOOP_MAX_DEG) continue;
    // the part's side of the corner: between the edges (a sharp corner), not round them (an inner corner)
    const b = unit([u[0] + t2[0], u[1] + t2[1]]);
    const e = Math.min(0.5, l1 / 4, l2 / 4);
    if (!material([P[0] + b[0] * e, P[1] + b[1] * e])) continue;
    const loop = loopAt(P, t1, t2, [-b[0], -b[1]], spec);
    // out of the part itself, and clear of everything else
    if (densify(P, loop).some((q) => material(q) || blocked(q))) continue;
    out.push({ at: P, pts: loop });
  }
  return out;
}

/** the loop's line, a point every 0.5 mm or so (the straight bits too), for the checks */
function densify(P: Pt, loop: Pt[]): Pt[] {
  const all = [P, ...loop, P], out: Pt[] = [];
  for (let i = 1; i < all.length; i++) {
    const a = all[i - 1], b = all[i], k = Math.max(1, Math.ceil(len(sub(b, a)) / 0.5));
    for (let j = i === 1 ? 1 : 0; j < k; j++) out.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
  }
  return out;
}

/** The contour's points as cut: its loops put in at their corners (none: its own points). */
export function cutBody(c: Pick<CutContour, "kind" | "pts" | "bc" | "inline" | "loops">): Pt[] {
  const L = c.loops;
  if (!L?.length || !loopable(c)) return c.pts;
  const pts = c.pts, n = pts.length - 1, out: Pt[] = [pts[0]];
  const near = (a: Pt, b: Pt) => Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) < 0.01;
  for (let k = 1; k < n; k++) {
    out.push(pts[k]);
    const lp = L.find((l) => near(l.at, pts[k]));
    if (lp) out.push(...lp.pts, pts[k]);
  }
  out.push(pts[n]);
  return out;
}

/** Point to segment distance. */
export function segDist(q: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(q[0] - a[0] - t * dx, q[1] - a[1] - t * dy);
}

/** Inside the polygon (even-odd). */
export { inPoly };

/** The loop at corner P: out along t1, an arc of radius r round the outside (o), in along t2 to P. */
function loopAt(P: Pt, t1: Pt, t2: Pt, o: Pt, s: LoopSpec): Pt[] {
  const q1: Pt = [P[0] + t1[0] * s.outMm, P[1] + t1[1] * s.outMm];
  const q2: Pt = [P[0] - t2[0] * s.inMm, P[1] - t2[1] * s.inMm];
  const m: Pt = [(q1[0] + q2[0]) / 2, (q1[1] + q2[1]) / 2];
  const ch = sub(q2, q1), h = len(ch) / 2;
  const r = Math.max(s.rMm, h + 1e-6);
  // the centre on the outer side of the chord: the long way round, out in the scrap
  let nrm: Pt = h > 1e-9 ? [-ch[1] / (2 * h), ch[0] / (2 * h)] : o;
  if (nrm[0] * o[0] + nrm[1] * o[1] < 0) nrm = [-nrm[0], -nrm[1]];
  const d = Math.sqrt(Math.max(0, r * r - h * h));
  const C: Pt = [m[0] + nrm[0] * d, m[1] + nrm[1] * d];
  const a1 = Math.atan2(q1[1] - C[1], q1[0] - C[0]), a2 = Math.atan2(q2[1] - C[1], q2[0] - C[0]);
  const far = Math.atan2(nrm[1], nrm[0]);
  // the way round from q1 to q2 that goes by the far point
  const TAU = 2 * Math.PI, norm = (a: number) => ((a % TAU) + TAU) % TAU;
  const ccw = norm(far - a1) < norm(a2 - a1);
  const sweep = ccw ? norm(a2 - a1) : -norm(a1 - a2);
  // 7.5° a step, as the drawings' arcs: the NC program makes arcs of them again (job/ncArcs.ts)
  const steps = Math.max(8, Math.ceil(Math.abs(sweep) / (Math.PI / 24)));
  const arc: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = a1 + (sweep * i) / steps;
    arc.push([C[0] + r * Math.cos(a), C[1] + r * Math.sin(a)]);
  }
  return [q1, ...arc.slice(1, -1), q2];
}
