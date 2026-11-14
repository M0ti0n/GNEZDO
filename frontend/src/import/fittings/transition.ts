// FITTINGS -> Rect. to round transition (from the HVAC Fittings workbench), by triangulation: every
// developed length is its true 3D length, the round edge is exactly pi·D. Top view, origin = the round's
// center: the rectangle runs from -A to +B across and from -F to +E up and down; the round (D) is H above.
// Seam on the longer side, straight down from the round. Pieces: Combined (one), Short side (its triangle
// and the two corner fans: half the round), Long side (the flat triangle).

import { Lines, fitPoints, mapSeg, rev, seg, marksOnLine, type P2, type Seg } from "./arcs";

export interface TransitionValues {
  a: number; b: number; e: number; f: number;
  d: number; h: number;
  n: number;            // sections per quarter of the round
  combined: boolean; short: boolean; long: boolean;
  folds: boolean;       // fold marks at the round edge
  markLen: number; markGap: number;
}

export const TRANSITION_DEFAULTS: TransitionValues = {
  a: 300, b: 200, e: 150, f: 250, d: 400, h: 300, n: 4, combined: true, short: false, long: false, folds: true, markLen: 15, markGap: 2,
};

export function transitionProblems(v: TransitionValues): string[] {
  const e: string[] = [];
  if (!(v.d > 0)) e.push("D must be greater than 0");
  if (!(v.h > 0)) e.push("H must be greater than 0");
  for (const [k, l] of [["a", "A"], ["b", "B"], ["e", "E"], ["f", "F"]] as const)
    if (!(v[k] > 0)) e.push(`${l} must be greater than 0 (the round's center inside the rectangle, seen from above)`);
  if (!(v.n >= 1) || !Number.isInteger(v.n)) e.push("N must be a whole number, 1 or more");
  if (!v.combined && !v.short && !v.long) e.push("Pick at least one: Combined, Short side, Long side");
  return e;
}

type V3 = [number, number, number];
const SB = 0, SE = 1, SA = 2, SF = 3;          // right, top, left, bottom (counterclockwise)
const NAME = ["B", "E", "A", "F"];
const SUB = 128;                                // fine steps per quarter of the round
const d3 = (u: V3, w: V3) => Math.hypot(u[0] - w[0], u[1] - w[1], u[2] - w[2]);
const cross = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** The point X with |PX| = dP and |QX| = dQ, on the side orient(X) > 0. */
function third(P: P2, Q: P2, dP: number, dQ: number, orient: (x: P2) => number): P2 {
  const dx = Q[0] - P[0], dy = Q[1] - P[1], d = Math.hypot(dx, dy);
  const a = (dP * dP - dQ * dQ + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(dP * dP - a * a, 0));
  const bx = P[0] + (a * dx) / d, by = P[1] + (a * dy) / d;
  const c1: P2 = [bx - (h * dy) / d, by + (h * dx) / d], c2: P2 = [bx + (h * dy) / d, by - (h * dx) / d];
  return orient(c1) >= orient(c2) ? c1 : c2;
}

/** A strip of triangles between the rectangle edge (bottom) and the round edge (top), laid flat. */
class Strip {
  b2: P2 = [0, 0]; t2: P2;
  bottom: P2[]; top: P2[];
  constructor(public b3: V3, public t3: V3) { this.t2 = [0, d3(b3, t3)]; this.bottom = [this.b2]; this.top = [this.t2]; }
  private place(n3: V3): P2 { const b2 = this.b2, t2 = this.t2; return third(b2, t2, d3(this.b3, n3), d3(this.t3, n3), (X) => cross(b2, X, t2)); }
  addBottom(n3: V3) { this.b2 = this.place(n3); this.b3 = n3; this.bottom.push(this.b2); }
  addTop(n3: V3) { this.t2 = this.place(n3); this.t3 = n3; this.top.push(this.t2); }
}

interface Piece { key: string; label: string; qty: number; lines: Lines }

export function transitionPieces(v: TransitionValues): Piece[] {
  const N = v.n, sub = Math.max(1, Math.ceil(SUB / N)), steps = N * sub;
  const R = v.d / 2;
  const corner = (s: number): V3 => (s === SB ? [v.b, v.e, 0] : s === SE ? [-v.a, v.e, 0] : s === SA ? [-v.a, -v.f, 0] : [v.b, -v.f, 0]);
  const round = (th: number): V3 => [R * Math.cos(th), R * Math.sin(th), v.h];
  const longerAB = v.a + v.b >= v.e + v.f;
  const marks = (L: Lines, folds: [P2, P2][]) => { if (v.folds) for (const [a, b] of folds) L.marks(marksOnLine(a, b, v.markLen, v.markGap, "end")); };

  // a piece from its strip: rectangle edge (lines), joint, round edge (arcs by corner fan), joint
  const finish = (st: Strip, fans: [number, number][], folds: [P2, P2][], turn: boolean): Lines => {
    let c: Seg[] = [];
    for (let j = 0; j + 1 < st.bottom.length; j++) c.push(seg(st.bottom[j], st.bottom[j + 1]));
    c.push(seg(st.bottom[st.bottom.length - 1], st.top[st.top.length - 1]));
    const roundSegs: Seg[] = fans.flatMap(([i0, i1]) => fitPoints(st.top.slice(i0, i1 + 1)));
    c.push(...[...roundSegs].reverse().map(rev));
    c.push(seg(st.top[0], st.bottom[0]));
    let fl = folds;
    if (turn) {
      // its rectangle edge along the x axis
      const [x0, y0] = st.bottom[0], [x1, y1] = st.bottom[st.bottom.length - 1];
      const ang = -Math.atan2(y1 - y0, x1 - x0), co = Math.cos(ang), sn = Math.sin(ang);
      const tr = (q: P2): P2 => { const x = q[0] - x0, y = q[1] - y0; return [x * co - y * sn, x * sn + y * co]; };
      c = c.map((s) => mapSeg(s, tr));
      fl = folds.map(([a, b]) => [tr(a), tr(b)]);
    }
    const L = new Lines().segs(c);
    marks(L, fl);
    return L;
  };

  const out: Piece[] = [];
  if (v.combined) {
    const seam = longerAB ? (v.e >= v.f ? SE : SF) : (v.b >= v.a ? SB : SA);
    const th0 = (seam * Math.PI) / 2;
    const foot: V3 = seam === SB ? [v.b, 0, 0] : seam === SE ? [0, v.e, 0] : seam === SA ? [-v.a, 0, 0] : [0, -v.f, 0];
    const st = new Strip(foot, round(th0));
    const folds: [P2, P2][] = [], fans: [number, number][] = [];
    for (let j = 0; j < 4; j++) {
      const side = (seam + j) % 4;
      st.addBottom(corner(side));
      const start = st.top.length - 1;
      folds.push([st.b2, st.t2]);
      for (let k = 1; k <= steps; k++) {
        st.addTop(round(th0 + ((j * steps + k) * (Math.PI / 2)) / steps));
        if (k % sub === 0) folds.push([st.b2, st.t2]);
      }
      fans.push([start, st.top.length - 1]);
    }
    st.addBottom(foot);
    out.push({ key: "C", label: "combined", qty: 1, lines: finish(st, fans, folds, false) });
  }
  const shortSides = longerAB ? [SA, SB] : [SE, SF], longSides = longerAB ? [SE, SF] : [SA, SB];
  const same = (s: number[]) => (s.includes(SA) ? Math.abs(v.a - v.b) < 1e-9 : Math.abs(v.e - v.f) < 1e-9);
  if (v.short) {
    const make = (side: number): Lines => {
      const th = (side * Math.PI) / 2;
      const st = new Strip(corner((side + 3) % 4), round(th - Math.PI / 2));
      const folds: [P2, P2][] = [], fans: [number, number][] = [];
      for (let k = 1; k <= steps; k++) { st.addTop(round(th - Math.PI / 2 + (k * (Math.PI / 2)) / steps)); if (k % sub === 0) folds.push([st.b2, st.t2]); }
      fans.push([0, st.top.length - 1]);
      st.addBottom(corner(side));
      folds.push([st.b2, st.t2]);
      const start = st.top.length - 1;
      for (let k = 1; k <= steps; k++) { st.addTop(round(th + (k * (Math.PI / 2)) / steps)); if (k % sub === 0 && k < steps) folds.push([st.b2, st.t2]); }
      fans.push([start, st.top.length - 1]);
      return finish(st, fans, folds, true);
    };
    if (same(shortSides)) out.push({ key: "S", label: "short side", qty: 2, lines: make(shortSides[0]) });
    else shortSides.forEach((s, i) => out.push({ key: `S${i + 1}`, label: `short side ${NAME[s]}`, qty: 1, lines: make(s) }));
  }
  if (v.long) {
    const make = (side: number): Lines => {
      const st = new Strip(corner((side + 3) % 4), round((side * Math.PI) / 2));
      st.addBottom(corner(side));
      return finish(st, [], [], true);
    };
    if (same(longSides)) out.push({ key: "L", label: "long side", qty: 2, lines: make(longSides[0]) });
    else longSides.forEach((s, i) => out.push({ key: `L${i + 1}`, label: `long side ${NAME[s]}`, qty: 1, lines: make(s) }));
  }
  return out;
}
