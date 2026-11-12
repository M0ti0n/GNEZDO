// The cut path's points as NC moves: arcs found again where the points lie on a circle (a part's
// arcs and circles come from the drawing as points 7.5° apart), straight lines merged where they
// continue each other. Every vertex stays within `tol` of the move it ends up in; arcs are cut at
// 180° (a full circle is two moves) and need at least 3 chords, each at most 8° of the arc, so a
// polygon with long sides stays a polygon.

import type { NcPt, NcSeg } from "./postprocessor";

const TOL = 0.012;
const MAX_CHORD = (8 * Math.PI) / 180;
const MAX_R = 20000;

const sub = (a: NcPt, b: NcPt) => ({ x: a.x - b.x, y: a.y - b.y });
const len = (a: NcPt) => Math.hypot(a.x, a.y);
const cross = (a: NcPt, b: NcPt) => a.x * b.y - a.y * b.x;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** The circle through p[i..j] (center on the bisector of p[i], p[j]), or null. */
function arcThrough(p: NcPt[], i: number, j: number, tol: number): { c: NcPt; cw: boolean } | null {
  const a = p[i], b = p[j];
  const ch = sub(b, a), L = len(ch);
  const turn = cross(sub(p[i + 1], a), sub(p[i + 2], p[i + 1]));
  if (Math.abs(turn) < 1e-12) return null;
  const ccw = turn > 0;
  // every corner turns the same way
  for (let k = i + 1; k < j; k++) {
    const t = cross(sub(p[k], p[k - 1]), sub(p[k + 1], p[k]));
    if (t > 0 !== ccw || Math.abs(t) < 1e-12) return null;
  }
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  // the center on the bisector: each inner point gives one, the median is used
  let c: NcPt;
  if (L < 1e-6) {
    return null;   // a closed run: never one arc (arcs stop at 180°)
  } else {
    const n = { x: -ch.y / L, y: ch.x / L };
    const ts: number[] = [];
    const ai = sub(a, mid), da = ai.x * ai.x + ai.y * ai.y;
    for (let k = i + 1; k < j; k++) {
      const q = sub(p[k], mid), dn = n.x * q.x + n.y * q.y;
      if (Math.abs(dn) < 1e-12) return null;
      ts.push((q.x * q.x + q.y * q.y - da) / (2 * dn));
    }
    ts.sort((x, y) => x - y);
    const t = ts[ts.length >> 1];
    c = { x: mid.x + n.x * t, y: mid.y + n.y * t };
  }
  const r = len(sub(a, c));
  if (!(r > 0.05) || r > MAX_R) return null;
  if (Math.abs(len(sub(b, c)) - r) > tol) return null;
  let sweep = 0;
  for (let k = i; k < j; k++) {
    const q = p[k + 1];
    if (Math.abs(len(sub(q, c)) - r) > tol) return null;
    const ang = 2 * Math.asin(Math.min(1, len(sub(q, p[k])) / (2 * r)));
    if (ang > MAX_CHORD) return null;
    sweep += ang;
  }
  if (sweep > Math.PI + 1e-6) return null;
  // the center lies on the side the path turns to
  const side = cross(sub(b, a), sub(c, a));
  if (Math.abs(side) > 1e-9 && side > 0 !== ccw && sweep > 1e-3) return null;
  return { c, cw: !ccw };
}

/** p[i..j] lie on the straight line p[i] -> p[j], going forward. */
function straight(p: NcPt[], i: number, j: number, tol: number): boolean {
  const a = p[i], d = sub(p[j], a), L = len(d);
  if (L < 1e-9) return false;
  let last = 0;
  for (let k = i + 1; k < j; k++) {
    const q = sub(p[k], a);
    if (Math.abs(cross(d, q)) / L > tol) return false;
    const along = (d.x * q.x + d.y * q.y) / L;
    if (along < last - 1e-9 || along > L + 1e-9) return false;
    last = along;
  }
  return true;
}

/** The moves through p (p[0]: where the head is). */
export function fitMoves(p: NcPt[], tol = TOL): NcSeg[] {
  const out: NcSeg[] = [];
  let i = 0;
  while (i < p.length - 1) {
    // the straight run first: points a line takes are never an arc (a slightly noisy line fits a big circle)
    let k = i + 1;
    while (k + 1 < p.length && straight(p, i, k + 1, tol)) k++;
    let arc: { j: number; c: NcPt; cw: boolean } | null = null;
    for (let j = i + 3; j < p.length; j++) {
      const a = arcThrough(p, i, j, tol);
      if (!a) break;
      arc = { j, ...a };
    }
    if (arc && arc.j > k) {
      out.push({ k: "arc", to: p[arc.j], c: { x: r3(arc.c.x), y: r3(arc.c.y) }, cw: arc.cw });
      i = arc.j;
      continue;
    }
    out.push({ k: "line", to: p[k] });
    i = k;
  }
  return out;
}
