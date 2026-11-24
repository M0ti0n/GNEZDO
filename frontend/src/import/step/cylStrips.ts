// A cylindrical face cannot always be drawn as one flat polygon of its edges: a pipe seen from the side has
// two ellipses and a seam for edges, with no area between, and a bend seen along its axis folds over itself.
// So the 3D view draws round faces as narrow strips along the axis: each strip is cut out of the face in its
// own (angle, length) coordinates, holes and slots included, then wrapped back onto the cylinder. Each
// strip is sorted, lit and picked on its own (the painter's order of the view needs that for a tube).

import { add3, cross3, dot3, mul3, sub3, type Face, type V3 } from "./step";

/** One strip: its outline(s) on the cylinder, its middle normal, and the face's edges that run in it. */
export interface CylStrip { loops: V3[][]; n: V3; segs: { id: number; a: V3; b: V3 }[] }

type UH = [number, number];   // angle (unwrapped, radians), length along the axis
const TAU = 2 * Math.PI;
const wrap = (t: number) => { while (t > Math.PI) t -= TAU; while (t <= -Math.PI) t += TAU; return t; };

/** The strips of a cylindrical face (one that goes at least `minDeg` degrees round); null: draw it as one polygon. */
export function cylStrips(f: Face, minDeg = 0): CylStrip[] | null {
  const s = f.surf;
  if (s.kind !== "cyl") return null;
  const y = cross3(s.d, s.x);
  const ang = (p: V3) => { const v = sub3(p, s.a); return Math.atan2(dot3(v, y), dot3(v, s.x)); };
  const len = (p: V3) => dot3(sub3(p, s.a), s.d);
  const at = (u: number, h: number): V3 => add3(add3(s.a, mul3(s.d, h)), add3(mul3(s.x, s.r * Math.cos(u)), mul3(y, s.r * Math.sin(u))));

  // each loop in (angle, length), the angle unwrapped along it; net: how far round it goes (0 or ±2π)
  const loops = f.loops.map((l) => {
    const pts: V3[] = [];
    for (const e of l.edges) for (const p of e.pts) {
      const q = pts[pts.length - 1];
      if (!q || Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]) + Math.abs(q[2] - p[2]) > 1e-9) pts.push(p);
    }
    if (pts.length > 2) { const a = pts[0], b = pts[pts.length - 1]; if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 1e-9) pts.pop(); }
    const uh: UH[] = [];
    for (const p of pts) {
      const t = ang(p);
      uh.push([uh.length ? uh[uh.length - 1][0] + wrap(t - ang(pts[uh.length - 1])) : t, len(p)]);
    }
    const net = uh.length ? uh[uh.length - 1][0] + wrap(ang(pts[0]) - ang(pts[pts.length - 1])) - uh[0][0] : 0;
    return { uh, net };
  }).filter((l) => l.uh.length >= 2);
  if (!loops.length) return null;

  const bands = loops.filter((l) => Math.abs(Math.abs(l.net) - TAU) < 1);   // a whole circle round the axis
  const closed = loops.filter((l) => Math.abs(l.net) < 1);                  // the face's outline with a seam, or a hole
  let lo: number, hi: number;
  const polys: UH[][] = [];
  if (bands.length === 2) {
    // no seam: the face lies between two loops that go round; from 0 to 2π
    const band = (l: { uh: UH[]; net: number }): UH[] => {
      const seq = l.net < 0 ? l.uh.slice().reverse() : l.uh.slice();
      const two = [...seq, ...seq.map(([u, h]) => [u + TAU, h] as UH), [seq[0][0] + 2 * TAU, seq[0][1]] as UH];
      const u0 = Math.ceil(seq[0][0] / TAU) * TAU;
      const cut = (k: number, u: number): UH => { const [a, b] = [two[k], two[k + 1]]; const t = (u - a[0]) / (b[0] - a[0] || 1); return [u, a[1] + (b[1] - a[1]) * t]; };
      const out: UH[] = [];
      for (let k = 0; k < two.length - 1; k++) {
        const [a, b] = [two[k], two[k + 1]];
        if (a[0] <= u0 && b[0] > u0 && !out.length) out.push(cut(k, u0));
        if (out.length && b[0] < u0 + TAU) out.push(b);
        if (out.length && a[0] < u0 + TAU && b[0] >= u0 + TAU) { out.push(cut(k, u0 + TAU)); break; }
      }
      return out.map(([u, h]) => [u - u0, h]);
    };
    const [a, b] = bands.map(band);
    if (a.length < 2 || b.length < 2) return null;
    polys.push([...a, ...b.reverse()]);
    lo = 0; hi = TAU;
    for (const l of closed) polys.push(shiftInto(l.uh, lo, hi));
  } else if (!bands.length && closed.length) {
    // the outline (with its seam) is the loop that goes farthest round
    const span = (l: { uh: UH[] }) => { const u = l.uh.map((p) => p[0]); return Math.max(...u) - Math.min(...u); };
    const outer = closed.reduce((b, l) => (span(l) > span(b) ? l : b));
    lo = Math.min(...outer.uh.map((p) => p[0])); hi = Math.max(...outer.uh.map((p) => p[0]));
    polys.push(outer.uh);
    for (const l of closed) if (l !== outer) polys.push(shiftInto(l.uh, lo, hi));
  } else return null;
  if (hi - lo < (minDeg * Math.PI) / 180) return null;

  // strips a whole turn: fewer on a small hole (a part may have many), more on a big pipe
  const perTurn = s.r < 8 ? 12 : s.r < 25 ? 24 : s.r < 100 ? 48 : 72;
  const n = Math.max(2, Math.ceil((perTurn * (hi - lo)) / TAU));
  const w = (hi - lo) / n;
  const strips: CylStrip[] = [];
  for (let j = 0; j < n; j++) {
    const a = lo + j * w, b = a + w;
    // a little over its neighbours (not past the face's ends): no hairline gap between the strips
    const ov = w * 0.1;
    const out: V3[][] = [];
    for (const p of polys) {
      const c = clip(clip(p, j ? a - ov : a, 1), j < n - 1 ? b + ov : b, -1);
      if (c.length >= 3) out.push(c.map(([u, h]) => at(u, h)));
    }
    const um = (a + b) / 2;
    strips.push({ loops: out, n: add3(mul3(s.x, Math.cos(um)), mul3(y, Math.sin(um))), segs: [] });
  }
  // the face's edges, piece by piece, to the strip they run in
  for (const l of f.loops) for (const e of l.edges) for (let k = 1; k < e.pts.length; k++) {
    const p = e.pts[k - 1], q = e.pts[k];
    let u = ang(mul3(add3(p, q), 0.5));
    while (u < lo - 1e-6) u += TAU;
    while (u >= lo + TAU - 1e-6) u -= TAU;
    const j = Math.min(n - 1, Math.max(0, Math.floor((u - lo) / w)));
    strips[j].segs.push({ id: e.id, a: p, b: q });
  }
  return strips.filter((st) => st.loops.length || st.segs.length);
}

/** A loop (a hole) moved round by whole turns so its middle is in lo..hi. */
function shiftInto(uh: UH[], lo: number, hi: number): UH[] {
  const m = uh.reduce((s, p) => s + p[0], 0) / uh.length;
  let k = 0;
  while (m + k * TAU < lo) k++;
  while (m + k * TAU > hi) k--;
  return uh.map(([u, h]) => [u + k * TAU, h]);
}

/** Sutherland–Hodgman: the polygon on one side of the angle `at` (side 1: u >= at, -1: u <= at). */
function clip(p: UH[], at: number, side: 1 | -1): UH[] {
  const out: UH[] = [];
  const inside = (q: UH) => (q[0] - at) * side >= 0;
  for (let k = 0; k < p.length; k++) {
    const a = p[k], b = p[(k + 1) % p.length];
    const ia = inside(a), ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) { const t = (at - a[0]) / (b[0] - a[0]); out.push([at, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}
