// FITTINGS -> Branch reducer (from the HVAC Fittings workbench): a round reducer (cone frustum, D2 at the
// bottom, D1 at the top, H1 high; D1 = D2: a straight pipe) with a round branch D3. The branch axis rises
// at A above the horizontal and meets the reducer's side at height H2; its square end is L along the axis
// from there. The hole and the branch's edge come from the exact intersection of the two surfaces.
// Reducer seam: through the middle of the hole (a half hole on each seam edge). Branch seam: its
// shortest line.

import { Lines, fitPoints, marksOnLine, rev, seg, type P2, type Seg } from "./arcs";

export interface BranchValues {
  d1: number; d2: number; h1: number; h2: number;
  d3: number; l: number; a: number;
  folds: number; markLen: number; markGap: number;
}

export const BRANCH_DEFAULTS: BranchValues = { d1: 200, d2: 400, h1: 400, h2: 200, d3: 160, l: 250, a: 30, folds: 24, markLen: 15, markGap: 2 };

export function branchProblems(v: BranchValues): string[] {
  const e: string[] = [];
  for (const [k, l] of [["d1", "D1"], ["d2", "D2"], ["h1", "H1"], ["d3", "D3"], ["l", "L"]] as const) if (!(v[k] > 0)) e.push(`${l} must be greater than 0`);
  if (!(v.h2 > 0 && v.h2 < v.h1)) e.push("H2 must lie between 0 and H1");
  if (!(v.a > -89 && v.a < 90)) e.push("A must be between -89° and 90°");
  if (!(v.folds >= 0) || !Number.isInteger(v.folds)) e.push("Fold lines: a whole number, 0 or more");
  return e;
}

type V3 = [number, number, number];
const SAMPLES = 360;

class Model {
  R2: number; R1: number; k: number; r3: number; u: V3; n: V3; w: V3 = [0, 1, 0]; P: V3;
  constructor(public v: BranchValues) {
    this.R2 = v.d2 / 2; this.R1 = v.d1 / 2; this.k = (this.R1 - this.R2) / v.h1; this.r3 = v.d3 / 2;
    const a = (v.a * Math.PI) / 180;
    this.u = [-Math.cos(a), 0, Math.sin(a)];
    this.n = [Math.sin(a), 0, Math.cos(a)];
    this.P = [-this.R(v.h2), 0, v.h2];
  }
  R(z: number) { return this.R2 + this.k * z; }
  point(beta: number, t: number): V3 {
    const c = Math.cos(beta), s = Math.sin(beta), { P, u, n, w, r3 } = this;
    return [0, 1, 2].map((i) => P[i] + t * u[i] + r3 * (c * n[i] + s * w[i])) as V3;
  }
  f(beta: number, t: number) { const [x, y, z] = this.point(beta, t); return Math.hypot(x, y) - this.R(z); }
  /** Where the branch line at beta meets the reducer (its outer crossing), along the axis. */
  meet(beta: number): number {
    const v = this.v, step = (this.R2 + this.r3) / 400;
    if (this.f(beta, v.l) <= 0) throw new Error("The branch end lies inside the reducer: make L longer");
    const tMin = -2 * (Math.max(this.R1, this.R2) + this.r3 + v.l);
    for (let t = v.l; t > tMin; t -= step) {
      const lo = t - step;
      if (this.f(beta, lo) < 0) {
        let a = lo, b = t;
        for (let i = 0; i < 80; i++) { const m = (a + b) / 2; if (this.f(beta, m) < 0) a = m; else b = m; }
        return (a + b) / 2;
      }
    }
    // only touching (an equal tee's side lines): the closest point
    let best = v.l, bf = Infinity;
    for (let t = v.l; t > tMin; t -= step) { const f = this.f(beta, t); if (f < bf) { bf = f; best = t; } }
    let a = best - step, b = best + step;
    const g = (Math.sqrt(5) - 1) / 2;
    for (let i = 0; i < 100; i++) { const c = b - g * (b - a), d = a + g * (b - a); if (this.f(beta, c) < this.f(beta, d)) b = d; else a = c; }
    const tt = (a + b) / 2;
    if (Math.abs(this.f(beta, tt)) < 1e-4 * (this.R2 + this.r3)) return tt;
    throw new Error("The branch does not meet the reducer");
  }
}

/** The reducer laid flat: phi from the seam line (-x), z the height. */
class Cone {
  q: number; cyl: boolean; zApex = 0; theta = 0;
  constructor(private m: Model) {
    this.q = Math.sqrt(1 + m.k * m.k);
    this.cyl = Math.abs(m.k) < 1e-12;
    if (!this.cyl) { this.zApex = -m.R2 / m.k; this.theta = (2 * Math.PI * Math.abs(m.k)) / this.q; }
  }
  xy(phi: number, z: number): P2 {
    if (this.cyl) return [this.m.R2 * phi, z];
    const ang = Math.PI / 2 + this.theta / 2 - (phi * Math.abs(this.m.k)) / this.q, r = this.q * Math.abs(z - this.zApex);
    return [r * Math.cos(ang), r * Math.sin(ang)];
  }
  arc(z: number, p0: number, p1: number): Seg[] {
    if (this.cyl) return [seg(this.xy(p0, z), this.xy(p1, z))];
    const n = Math.max(1, Math.ceil((Math.abs(p1 - p0) * Math.abs(this.m.k)) / this.q / (Math.PI / 2)));
    return Array.from({ length: n }, (_, i) => {
      const a = p0 + ((p1 - p0) * i) / n, b = p0 + ((p1 - p0) * (i + 1)) / n;
      return seg(this.xy(a, z), this.xy(b, z), this.xy((a + b) / 2, z));
    });
  }
}

const phiS = (x: number, y: number) => { const T = 2 * Math.PI; return (((Math.atan2(y, x) - Math.PI) % T) + T) % T; };
const inPoly = ([x, y]: P2, poly: P2[]) => {
  let inside = false;
  for (let i = 0; i + 1 < poly.length; i++) {
    const [x0, y0] = poly[i], [x1, y1] = poly[i + 1];
    if ((y0 > y) !== (y1 > y) && x0 + ((y - y0) * (x1 - x0)) / (y1 - y0) > x) inside = !inside;
  }
  return inside;
};

export function branchPieces(v: BranchValues): { key: string; label: string; qty: number; lines: Lines }[] {
  const m = new Model(v);
  const betas = Array.from({ length: SAMPLES + 1 }, (_, i) => (2 * Math.PI * i) / SAMPLES);
  const ts = betas.map((b) => m.meet(b));
  const pts3 = betas.map((b, i) => m.point(b, ts[i]));
  const zs = pts3.map((q) => q[2]);
  const zLo = Math.min(...zs), zHi = Math.max(...zs);
  if (zLo < 1 || zHi > v.h1 - 1) throw new Error(`The branch hole runs past the reducer's top or bottom (from ${zLo.toFixed(1)} to ${zHi.toFixed(1)} mm): change H2, D3 or A`);

  // ---- the reducer
  const cone = new Cone(m), half = SAMPLES / 2, T = 2 * Math.PI;
  const right: P2[] = [], left: P2[] = [];
  for (let i = half; i >= 0; i--) { const [x, y, z] = pts3[i]; right.push(cone.xy(i === 0 || i === half ? T : phiS(x, y), z)); }
  for (let i = SAMPLES; i >= half; i--) { const [x, y, z] = pts3[i]; left.push(cone.xy(i === SAMPLES || i === half ? 0 : phiS(x, y), z)); }
  const c: Seg[] = [
    ...cone.arc(0, 0, T),
    seg(cone.xy(T, 0), right[0]), ...fitPoints(right), seg(right[right.length - 1], cone.xy(T, v.h1)),
    ...cone.arc(v.h1, T, 0),
    seg(cone.xy(0, v.h1), left[0]), ...fitPoints(left), seg(left[left.length - 1], cone.xy(0, 0)),
  ];
  const red = new Lines().segs(c);
  if (v.folds > 0) for (let i = 0; i < v.folds; i++) {
    const ph = (T * (i + 0.5)) / v.folds;
    for (const mk of marksOnLine(cone.xy(ph, 0), cone.xy(ph, v.h1), v.markLen, v.markGap))
      if (![right, left].some((poly) => inPoly(mk[0], [...poly, poly[0]]) || inPoly(mk[1], [...poly, poly[0]]))) red.marks([mk]);
  }

  // ---- the branch: seam on its shortest line
  const n = SAMPLES, lengths = ts.slice(0, -1).map((t) => v.l - t);
  let iSeam = 0;
  for (let i = 1; i < n; i++) if (lengths[i] < lengths[iSeam]) iSeam = i;
  const width = Math.PI * v.d3;
  const lengthAt = (bs: number) => v.l - m.meet((betas[iSeam] + bs) % T);
  const edge: P2[] = Array.from({ length: n + 1 }, (_, j) => { const bs = (T * j) / n; return [m.r3 * bs, lengthAt(bs)] as P2; });
  const sLen = edge[0][1];
  const br = new Lines().segs([seg([0, 0], [width, 0]), seg([width, 0], [width, sLen]), ...fitPoints(edge).reverse().map(rev), seg([0, sLen], [0, 0])]);
  if (v.folds > 0) for (let i = 0; i < v.folds; i++) {
    const bs = (T * (i + 0.5)) / v.folds;
    br.marks(marksOnLine([m.r3 * bs, 0], [m.r3 * bs, lengthAt(bs)], v.markLen, v.markGap));
  }
  return [{ key: "R", label: "reducer", qty: 1, lines: red }, { key: "B", label: "branch", qty: 1, lines: br }];
}
