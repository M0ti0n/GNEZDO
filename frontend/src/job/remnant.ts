// Remnants (Process -> Remnant): what is left of a sheet after its parts, kept for later. A mode works
// out the remnant and the cut lines that free it; CUT V / CUT H add open cuts that split a remnant;
// every piece big enough gets a name REM_<job>_S<sheet>_<n> (1 = the biggest) and can be saved.
//
//   TRIM         a rough outline of the parts: straight edges only, angles 90° to 270° (45° steps), no
//                edge shorter than the minimum; the remnant lies beyond it
//   RECTANGULAR  one cut across the whole sheet, a second one up to it: rectangles only
//   SKELET       close round the parts at the minimum distance (the whole skeleton); windows in parts
//                are remnants too, without a cut
//
// Worked out on a grid (a few mm a cell): the parts drawn in, grown by the minimum distance, the free
// cells grouped into pieces and their outlines traced and straightened. Sheet frame: mm, y down.

import { partLoops, pointIn, transform, type Pt } from "./manualGeom";
import type { NestedSheet } from "./nest";
import { partKey } from "./cutPath";

export type RemnantMode = "trim" | "rect" | "skelet";

export interface RemnantSettings {
  /** Distance kept from the parts [mm] */
  minDistMm: number;
  /** No remnant edge (and no step of a TRIM outline) shorter than this [mm] */
  minEdgeMm: number;
  /** A piece smaller than this share of the sheet is scrap [%] */
  minAreaPct: number;
  /** RECTANGULAR: the first cut runs along X (across the sheet's length) or along Y */
  rectDir: "x" | "y";
}

export const DEFAULT_REMNANT_SETTINGS: RemnantSettings = { minDistMm: 10, minEdgeMm: 100, minAreaPct: 3, rectDir: "x" };

/** An open cut added by hand (CUT V / CUT H): at x (vertical) or y (horizontal), from..to along the other axis. */
export interface RemnantCut { axis: "v" | "h"; at: number; from: number; to: number }

export interface RemnantPiece {
  name: string;
  /** outline (and its holes), sheet frame */
  outline: Pt[];
  holes?: Pt[][];
  areaMm2: number;
  /** its box */
  x0: number; y0: number; x1: number; y1: number;
  /** where its name goes */
  label: Pt;
  /** a window in a part: free once the part is cut, no remnant cut */
  window?: boolean;
  status?: "saved" | "discarded";
}

export interface SheetRemnant {
  mode: RemnantMode;
  settings: RemnantSettings;
  at: string;
  /** the parts it was worked out for (moved since: not valid) */
  key: string;
  /** cut lines of the mode (red) */
  lines: Pt[][];
  /** open cuts added by hand (magenta) */
  cuts: RemnantCut[];
  pieces: RemnantPiece[];
}

export const sheetPartsKey = (sheet: NestedSheet) => sheet.parts.map(partKey).join(";");
export const remnantValid = (sheet: NestedSheet) => !!sheet.remnant && sheet.remnant.key === sheetPartsKey(sheet);

/** REM_<job>_S<sheet>_<n> */
export const remnantName = (job: string, sheetNo: number, n: number) =>
  `REM_${(job.trim() || "job").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "")}_S${sheetNo}_${n}`;

// ------------------------------------------------------------------ the grid

interface Grid { nx: number; ny: number; r: number; L: number; W: number }

const gridOf = (L: number, W: number): Grid => {
  const r = Math.max(1, Math.ceil(Math.max(L, W) / 1500));
  return { nx: Math.max(1, Math.ceil(L / r)), ny: Math.max(1, Math.ceil(W / r)), r, L, W };
};

/** Cells covered by the loops (even-odd: holes stay free), marked with `v`; a cell counts when its centre is in. */
function fillLoops(g: Grid, m: Uint8Array | Int32Array, loops: Pt[][], v: number) {
  let y0 = Infinity, y1 = -Infinity;
  for (const lp of loops) for (const p of lp) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  const j0 = Math.max(0, Math.floor(y0 / g.r)), j1 = Math.min(g.ny - 1, Math.ceil(y1 / g.r));
  for (let j = j0; j <= j1; j++) {
    const y = (j + 0.5) * g.r;
    const xs: number[] = [];
    for (const lp of loops) for (let k = 0, n = lp.length; k < n; k++) {
      const a = lp[k], b = lp[(k + 1) % n];
      if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil(xs[k] / g.r - 0.5)), i1 = Math.min(g.nx - 1, Math.floor(xs[k + 1] / g.r - 0.5));
      for (let i = i0; i <= i1; i++) m[j * g.nx + i] = v;
    }
  }
}

/** Squared distance (in cells) from every cell to the nearest marked one (Felzenszwalb). */
function distance2(g: Grid, on: Uint8Array): Float64Array {
  const INF = 1e20, { nx, ny } = g;
  const d = new Float64Array(nx * ny);
  for (let k = 0; k < d.length; k++) d[k] = on[k] ? 0 : INF;
  const n = Math.max(nx, ny);
  const f = new Float64Array(n), z = new Float64Array(n + 1), out = new Float64Array(n);
  const v = new Int32Array(n);
  const pass = (len: number, get: (i: number) => number, set: (i: number, x: number) => void) => {
    for (let i = 0; i < len; i++) f[i] = get(i);
    let k = 0;
    v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; out[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
    for (let i = 0; i < len; i++) set(i, out[i]);
  };
  for (let i = 0; i < nx; i++) pass(ny, (j) => d[j * nx + i], (j, x) => { d[j * nx + i] = x; });
  for (let j = 0; j < ny; j++) pass(nx, (i) => d[j * nx + i], (i, x) => { d[j * nx + i] = x; });
  return d;
}

interface Placed { loops: Pt[][]; holes: Pt[][] }

function placedParts(sheet: NestedSheet, paths: Map<string, string>): Placed[] {
  return sheet.parts.map((p) => {
    const f = transform(p);
    const loops = partLoops(paths.get(p.partId) ?? "").map((lp) => lp.map(f));
    return { loops, holes: loops.slice(1) };
  });
}

/** The parts' cells (1) and the cells within the minimum distance of them (dilated). */
function occupied(g: Grid, parts: Placed[], dist: number) {
  const occ = new Uint8Array(g.nx * g.ny);
  for (const p of parts) if (p.loops.length) fillLoops(g, occ, p.loops, 1);
  const d2 = distance2(g, occ);
  const lim = (dist / g.r + 0.5) ** 2;
  const dil = new Uint8Array(occ.length);
  for (let k = 0; k < dil.length; k++) dil[k] = d2[k] <= lim ? 1 : 0;
  return { occ, dil };
}

// ------------------------------------------------------------------ outlines of cell groups

/** The loops round the cells of `m` equal to `id` (cell corners, mm), straightened. */
function traceLoops(g: Grid, m: Int32Array, id: number, x0: number, y0: number, x1: number, y1: number): Pt[][] {
  const { nx, ny } = g;
  const inn = (i: number, j: number) => i >= 0 && j >= 0 && i < nx && j < ny && m[j * nx + i] === id;
  // boundary edges, the piece on their right (y down: clockwise as seen)
  const next = new Map<number, number[]>();
  const key = (i: number, j: number) => j * (nx + 1) + i;
  const add = (a: number, b: number) => { const l = next.get(a); if (l) l.push(b); else next.set(a, [b]); };
  for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
    if (!inn(i, j)) continue;
    if (!inn(i, j - 1)) add(key(i, j), key(i + 1, j));
    if (!inn(i + 1, j)) add(key(i + 1, j), key(i + 1, j + 1));
    if (!inn(i, j + 1)) add(key(i + 1, j + 1), key(i, j + 1));
    if (!inn(i - 1, j)) add(key(i, j + 1), key(i, j));
  }
  const loops: Pt[][] = [];
  for (const start of [...next.keys()]) {
    while (next.get(start)?.length) {
      const pts: number[] = [start];
      let at = start;
      for (let guard = 0; guard < 4 * nx * ny; guard++) {
        const l = next.get(at)!;
        const b = l.pop()!;
        if (!l.length) next.delete(at);
        if (b === start) break;
        pts.push(b);
        at = b;
        if (!next.get(at)?.length) break;
      }
      const lp = pts.map((k): Pt => [(k % (nx + 1)) * g.r, Math.floor(k / (nx + 1)) * g.r]);
      const s = simplify(lp.map(([x, y]) => [Math.min(x, g.L), Math.min(y, g.W)] as Pt), g.r * 0.9);
      if (s.length >= 3) loops.push(s);
    }
  }
  return loops;
}

/** Douglas-Peucker on a closed loop. */
function simplify(lp: Pt[], tol: number): Pt[] {
  if (lp.length < 4) return lp;
  // start at the point farthest from the first, so the loop splits into two open runs
  let far = 0, best = -1;
  for (let k = 0; k < lp.length; k++) { const d = Math.hypot(lp[k][0] - lp[0][0], lp[k][1] - lp[0][1]); if (d > best) { best = d; far = k; } }
  const run = (pts: Pt[]): Pt[] => {
    if (pts.length < 3) return pts;
    const a = pts[0], b = pts[pts.length - 1];
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1e-9;
    let k = -1, dmax = -1;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = Math.abs((pts[i][0] - a[0]) * dy - (pts[i][1] - a[1]) * dx) / L;
      if (d > dmax) { dmax = d; k = i; }
    }
    if (dmax <= tol) return [a, b];
    return [...run(pts.slice(0, k + 1)).slice(0, -1), ...run(pts.slice(k))];
  };
  const one = run([...lp.slice(0, far + 1)]);
  const two = run([...lp.slice(far), lp[0]]);
  return [...one.slice(0, -1), ...two.slice(0, -1)];
}

const loopArea = (lp: Pt[]) => Math.abs(lp.reduce((s, p, i) => { const q = lp[(i + 1) % lp.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;

/** Lines along the sheet's edges are not cut: the loop's other stretches as open runs. */
function offEdges(lp: Pt[], L: number, W: number, tol: number): Pt[][] {
  const on = (a: Pt, b: Pt) =>
    (Math.abs(a[0]) <= tol && Math.abs(b[0]) <= tol) || (Math.abs(a[0] - L) <= tol && Math.abs(b[0] - L) <= tol) ||
    (Math.abs(a[1]) <= tol && Math.abs(b[1]) <= tol) || (Math.abs(a[1] - W) <= tol && Math.abs(b[1] - W) <= tol);
  const n = lp.length;
  const edge = Array.from({ length: n }, (_, k) => on(lp[k], lp[(k + 1) % n]));
  if (edge.every(Boolean)) return [];
  if (!edge.some(Boolean)) return [[...lp, lp[0]]];
  // start after an edge stretch
  const s = edge.findIndex((e, k) => e && !edge[(k + 1) % n]);
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  for (let t = 1; t <= n; t++) {
    const k = (s + t) % n;
    if (edge[k]) { if (cur.length > 1) out.push(cur); cur = []; continue; }
    if (!cur.length) cur.push(lp[k]);
    cur.push(lp[(k + 1) % n]);
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

// ------------------------------------------------------------------ the modes

/**
 * Which way the remnant lies: the free side of the parts with the most room. u runs from the parts
 * towards the remnant, v across; `toSheet` maps back.
 */
function frameOf(g: Grid, dil: Uint8Array, axis?: "x" | "y") {
  let i0 = g.nx, i1 = -1, j0 = g.ny, j1 = -1;
  for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) if (dil[j * g.nx + i]) { i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j); }
  if (i1 < 0) return null;
  const right = g.nx - 1 - i1, left = i0, down = g.ny - 1 - j1, up = j0;
  const freeX = Math.max(right, left) * g.ny, freeY = Math.max(down, up) * g.nx;
  const alongX = axis ? axis === "x" : freeX >= freeY;
  return { alongX, plus: alongX ? right >= left : down >= up, box: { i0, i1, j0, j1 } };
}

interface Region { mask: Int32Array; lines: Pt[][]; windows?: Set<number>; /** the mode's own cuts that part pieces (RECTANGULAR) */ splits?: RemnantCut[] }

/** TRIM: a staircase round the parts (45° where the corner is clear), steps no shorter than the minimum. */
function trimRegion(g: Grid, dil: Uint8Array, s: RemnantSettings): Region | null {
  const fr = frameOf(g, dil);
  if (!fr) return null;
  const { alongX, plus } = fr;
  const nu = alongX ? g.nx : g.ny, nv = alongX ? g.ny : g.nx;
  const at = (u: number, v: number) => {
    const uu = plus ? u : nu - 1 - u;
    return alongX ? dil[v * g.nx + uu] : dil[uu * g.nx + v];
  };
  // per row across: the far end of the parts (cells; 0 = none)
  const f = new Array<number>(nv).fill(0);
  for (let v = 0; v < nv; v++) for (let u = nu - 1; u >= 0; u--) if (at(u, v)) { f[v] = u + 1; break; }
  const minE = Math.max(1, Math.round(s.minEdgeMm / g.r));
  // a strip thinner than the smallest edge between the parts and the far edge is no remnant
  for (let v = 0; v < nv; v++) if (f[v] > 0 && nu - f[v] < minE) f[v] = nu;
  // runs of one level; a run too short, or a step too small, goes up to its neighbour
  type Run = { a: number; b: number; f: number };
  let runs: Run[] = [];
  for (let v = 0; v < nv; v++) { const l = runs[runs.length - 1]; if (l && l.f === f[v]) l.b = v + 1; else runs.push({ a: v, b: v + 1, f: f[v] }); }
  while (runs.length > 1) {
    // the shortest offending run first
    let k = -1, worst = Infinity;
    runs.forEach((r, i) => {
      const short = r.b - r.a < minE;
      const smallStep = (i > 0 && Math.abs(runs[i - 1].f - r.f) < minE) || (i < runs.length - 1 && Math.abs(runs[i + 1].f - r.f) < minE);
      if ((short || smallStep) && r.b - r.a < worst) { worst = r.b - r.a; k = i; }
    });
    if (k < 0) break;
    const r = runs[k];
    const nb = [runs[k - 1], runs[k + 1]].filter(Boolean) as Run[];
    // merge with the neighbour nearest in level, at the higher level (never into the parts)
    const m = nb.reduce((a, b) => (Math.abs(a.f - r.f) <= Math.abs(b.f - r.f) ? a : b));
    const lv = Math.max(m.f, r.f);
    const merged = { a: Math.min(m.a, r.a), b: Math.max(m.b, r.b), f: lv };
    runs = [...runs.filter((x) => x !== m && x !== r), merged].sort((p, q) => p.a - q.a);
    // neighbours of the same level join
    runs = runs.reduce<Run[]>((o, x) => { const l = o[o.length - 1]; if (l && l.f === x.f) l.b = x.b; else o.push({ ...x }); return o; }, []);
  }
  // the outline (u, v in cells): along each run, a 45° corner instead of a step where it is clear
  const pts: [number, number][] = [];
  const clear = (u0: number, u1: number, v0: number, v1: number, rising: boolean) => {
    // the triangle between the step and the diagonal has no part cell
    for (let v = v0; v < v1; v++) {
      const t = (v + 0.5 - v0) / (v1 - v0);
      const ulim = rising ? u0 + t * (u1 - u0) : u1 - t * (u1 - u0);
      for (let u = Math.floor(Math.min(u0, ulim)); u < Math.ceil(Math.max(u0, u1)); u++) {
        if (u < 0 || u >= nu) continue;
        const inTri = rising ? u + 0.5 >= ulim && u < u1 : u + 0.5 >= ulim && u < u1;
        if (inTri && at(u, v)) return false;
      }
    }
    return true;
  };
  pts.push([runs[0].f, 0]);
  for (let k = 0; k < runs.length; k++) {
    const r = runs[k], nx = runs[k + 1];
    if (!nx) { pts.push([r.f, nv]); break; }
    const d = Math.abs(nx.f - r.f);
    if (nx.f > r.f && r.f > 0 && nx.f < nu && nx.b - nx.a >= d + minE && clear(r.f, nx.f, nx.a, nx.a + d, true)) {
      pts.push([r.f, nx.a], [nx.f, nx.a + d]);              // the parts step out: cut the corner in the next run
    } else if (nx.f < r.f && nx.f > 0 && r.f < nu && r.b - r.a >= d + minE && clear(nx.f, r.f, r.b - d, r.b, false)) {
      pts.push([r.f, r.b - d], [nx.f, r.b]);                // the parts step in: cut the corner in this run
    } else pts.push([r.f, r.b], [nx.f, nx.a]);
  }
  // the remnant: beyond the outline in every row
  const uAt = (vc: number) => {
    for (let k = 0; k + 1 < pts.length; k++) {
      const [ua, va] = pts[k], [ub, vb] = pts[k + 1];
      if (vb > va && vc >= va && vc <= vb) return ua + ((vc - va) * (ub - ua)) / (vb - va);
    }
    return nu;
  };
  const mask = new Int32Array(g.nx * g.ny);
  for (let v = 0; v < nv; v++) {
    const lim = uAt(v + 0.5);
    for (let u = 0; u < nu; u++) {
      if (u + 0.5 < lim) continue;
      const uu = plus ? u : nu - 1 - u;
      mask[alongX ? v * g.nx + uu : uu * g.nx + v] = 1;
    }
  }
  const toSheet = ([u, v]: [number, number]): Pt => {
    const uu = (plus ? u : nu - u) * g.r, vv = v * g.r;
    return alongX ? [Math.min(uu, g.L), Math.min(vv, g.W)] : [Math.min(vv, g.L), Math.min(uu, g.W)];
  };
  const clean = pts.filter((p, k) => !k || p[0] !== pts[k - 1][0] || p[1] !== pts[k - 1][1]).map(toSheet);
  // cut where it is not the sheet's edge (u = 0: no parts in the row, u = nu: the parts reach the far edge)
  const lines: Pt[][] = [];
  let cur: Pt[] = [];
  for (let k = 0; k + 1 < clean.length; k++) {
    const a = clean[k], b = clean[k + 1];
    const along = (q: number, lim: number) => Math.abs(q - lim) < 0.5 * g.r;
    const edge = (along(a[0], 0) && along(b[0], 0)) || (along(a[0], g.L) && along(b[0], g.L)) || (along(a[1], 0) && along(b[1], 0)) || (along(a[1], g.W) && along(b[1], g.W));
    if (edge) { if (cur.length > 1) lines.push(cur); cur = []; continue; }
    if (!cur.length) cur.push(a);
    cur.push(b);
  }
  if (cur.length > 1) lines.push(cur);
  return { mask, lines };
}

/** RECTANGULAR: a cut across the whole sheet past the parts, a second one up to it past the parts. */
function rectRegion(g: Grid, dil: Uint8Array, s: RemnantSettings): Region | null {
  const fr = frameOf(g, dil);
  if (!fr) return null;
  const { i0, i1, j0, j1 } = fr.box;
  const minE = s.minEdgeMm + g.r;
  // the parts' box in mm (the free side of each axis)
  const right = (g.nx - 1 - i1) >= i0, down = (g.ny - 1 - j1) >= j0;
  const xc = right ? (i1 + 1) * g.r : i0 * g.r, yc = down ? (j1 + 1) * g.r : j0 * g.r;
  const freeX = right ? g.L - xc : xc, freeY = down ? g.W - yc : yc;
  const mask = new Int32Array(g.nx * g.ny);
  const lines: Pt[][] = [];
  const fill = (x0: number, y0: number, x1: number, y1: number) => {
    for (let j = Math.max(0, Math.floor(y0 / g.r)); j < Math.min(g.ny, Math.ceil(y1 / g.r)); j++)
      for (let i = Math.max(0, Math.floor(x0 / g.r)); i < Math.min(g.nx, Math.ceil(x1 / g.r)); i++) mask[j * g.nx + i] = 1;
  };
  const yEdgeParts = down ? 0 : g.W, xEdgeParts = right ? 0 : g.L;
  if (s.rectDir === "x") {
    // first along X, the whole length, past the parts in Y; then across up to it, past the parts in X
    if (freeY >= minE) { lines.push([[0, yc], [g.L, yc]]); fill(0, Math.min(yc, down ? g.W : 0), g.L, Math.max(yc, down ? g.W : 0)); }
    const yTo = freeY >= minE ? yc : (down ? g.W : 0);
    if (freeX >= minE) { lines.push([[xc, yEdgeParts], [xc, yTo]]); fill(Math.min(xc, right ? g.L : 0), Math.min(yEdgeParts, yTo), Math.max(xc, right ? g.L : 0), Math.max(yEdgeParts, yTo)); }
  } else {
    if (freeX >= minE) { lines.push([[xc, 0], [xc, g.W]]); fill(Math.min(xc, right ? g.L : 0), 0, Math.max(xc, right ? g.L : 0), g.W); }
    const xTo = freeX >= minE ? xc : (right ? g.L : 0);
    if (freeY >= minE) { lines.push([[xEdgeParts, yc], [xTo, yc]]); fill(Math.min(xEdgeParts, xTo), Math.min(yc, down ? g.W : 0), Math.max(xEdgeParts, xTo), Math.max(yc, down ? g.W : 0)); }
  }
  // the first cut parts the two rectangles
  const splits: RemnantCut[] = !lines.length ? [] : s.rectDir === "x" && freeY >= minE ? [{ axis: "h", at: yc, from: 0, to: g.L }]
    : s.rectDir === "y" && freeX >= minE ? [{ axis: "v", at: xc, from: 0, to: g.W }] : [];
  return { mask, lines, splits };
}

/** SKELET: every free stretch at the minimum distance from the parts; windows in parts are remnants too. */
function skeletRegion(g: Grid, dil: Uint8Array, parts: Placed[], s: RemnantSettings): Region {
  // free cells, without channels narrower than the smallest edge (an opening: what a disc of that size reaches)
  const rad2 = (s.minEdgeMm / 2 / g.r) ** 2;
  const fromParts = distance2(g, dil);
  const core = new Uint8Array(dil.length);
  for (let k = 0; k < core.length; k++) core[k] = !dil[k] && fromParts[k] > rad2 ? 1 : 0;
  const fromCore = distance2(g, core);
  const mask = new Int32Array(g.nx * g.ny);
  for (let k = 0; k < mask.length; k++) mask[k] = !dil[k] && fromCore[k] <= rad2 ? 1 : 0;
  // windows: free cells in a part's hole
  const windows = new Set<number>();
  const win = new Int32Array(g.nx * g.ny);
  let w = 0;
  for (const p of parts) for (const h of p.holes) { w++; fillLoops(g, win, [h], w); }
  for (let k = 0; k < mask.length; k++) if (mask[k] && win[k]) windows.add(k);
  return { mask, lines: [], windows };
}

// ------------------------------------------------------------------ pieces

function piecesOf(g: Grid, region: Region, cuts: RemnantCut[], s: RemnantSettings, sheetArea: number, skelet: boolean) {
  const mask = region.mask.slice();
  // the hand cuts (and the mode's own parting cuts) split the region
  for (const c of [...(region.splits ?? []), ...cuts]) {
    if (c.axis === "v") {
      const i = Math.min(g.nx - 1, Math.max(0, Math.floor(c.at / g.r)));
      for (let j = Math.max(0, Math.floor(c.from / g.r)); j < Math.min(g.ny, Math.ceil(c.to / g.r)); j++) mask[j * g.nx + i] = 0;
    } else {
      const j = Math.min(g.ny - 1, Math.max(0, Math.floor(c.at / g.r)));
      for (let i = Math.max(0, Math.floor(c.from / g.r)); i < Math.min(g.nx, Math.ceil(c.to / g.r)); i++) mask[j * g.nx + i] = 0;
    }
  }
  // groups of free cells
  const lab = new Int32Array(mask.length);
  const groups: { id: number; n: number; i0: number; j0: number; i1: number; j1: number; sx: number; sy: number; window: boolean }[] = [];
  const stack: number[] = [];
  for (let k0 = 0; k0 < mask.length; k0++) {
    if (!mask[k0] || lab[k0]) continue;
    const id = groups.length + 1;
    const gr = { id, n: 0, i0: g.nx, j0: g.ny, i1: 0, j1: 0, sx: 0, sy: 0, window: true };
    lab[k0] = id; stack.push(k0);
    while (stack.length) {
      const k = stack.pop()!;
      const i = k % g.nx, j = (k - i) / g.nx;
      gr.n++; gr.sx += i; gr.sy += j;
      gr.i0 = Math.min(gr.i0, i); gr.i1 = Math.max(gr.i1, i); gr.j0 = Math.min(gr.j0, j); gr.j1 = Math.max(gr.j1, j);
      if (!region.windows?.has(k)) gr.window = false;
      const nb = [i > 0 ? k - 1 : -1, i < g.nx - 1 ? k + 1 : -1, j > 0 ? k - g.nx : -1, j < g.ny - 1 ? k + g.nx : -1];
      for (const q of nb) if (q >= 0 && mask[q] && !lab[q]) { lab[q] = id; stack.push(q); }
    }
    groups.push(gr);
  }
  const minA = (s.minAreaPct / 100) * sheetArea;
  const minE = s.minEdgeMm;
  const pieces: RemnantPiece[] = [];
  const lines: Pt[][] = [];
  for (const gr of groups) {
    const area = gr.n * g.r * g.r;
    if (area < minA) continue;
    const w = (gr.i1 - gr.i0 + 1) * g.r, h = (gr.j1 - gr.j0 + 1) * g.r;
    if (Math.min(w, h) < minE) continue;
    const loops = traceLoops(g, lab, gr.id, gr.i0, gr.j0, gr.i1, gr.j1);
    if (!loops.length) continue;
    const outer = loops.reduce((a, b) => (loopArea(b) > loopArea(a) ? b : a));
    const holes = loops.filter((l) => l !== outer);
    // the name goes on a cell of the piece near its middle
    let cx = gr.sx / gr.n, cy = gr.sy / gr.n;
    if (lab[Math.round(cy) * g.nx + Math.round(cx)] !== gr.id) {
      let best = Infinity;
      for (let j = gr.j0; j <= gr.j1; j += 2) for (let i = gr.i0; i <= gr.i1; i += 2) {
        if (lab[j * g.nx + i] !== gr.id) continue;
        const d = (i - cx) ** 2 + (j - cy) ** 2;
        if (d < best) { best = d; cx = i; cy = j; }
      }
    }
    pieces.push({
      name: "", outline: outer, ...(holes.length ? { holes } : {}), areaMm2: Math.round(loopArea(outer) - holes.reduce((a, l) => a + loopArea(l), 0)),
      x0: gr.i0 * g.r, y0: gr.j0 * g.r, x1: Math.min(g.L, (gr.i1 + 1) * g.r), y1: Math.min(g.W, (gr.j1 + 1) * g.r),
      label: [(cx + 0.5) * g.r, (cy + 0.5) * g.r], ...(skelet && gr.window ? { window: true } : {}),
    });
    // SKELET: the piece's outline is its cut (not along the sheet's edges; windows need none)
    if (skelet && !gr.window) for (const l of [outer, ...holes]) lines.push(...offEdges(l, g.L, g.W, g.r * 0.6));
  }
  return { pieces, lines, lab };
}

// ------------------------------------------------------------------ the whole step

export interface RemnantInput {
  sheet: NestedSheet;
  sheetNo: number;
  paths: Map<string, string>;
  jobName: string;
  mode: RemnantMode;
  settings: RemnantSettings;
  cuts?: RemnantCut[];
  /** the pieces before (their Saved / Discarded marks stay with a piece of the same name and size) */
  before?: RemnantPiece[];
}

const cache = new Map<string, { g: Grid; dil: Uint8Array; parts: Placed[] }>();

function base(sheet: NestedSheet, paths: Map<string, string>, dist: number) {
  const k = `${sheet.lengthMm}x${sheet.widthMm}|${dist}|${sheetPartsKey(sheet)}`;
  let c = cache.get(k);
  if (!c) {
    const g = gridOf(sheet.lengthMm, sheet.widthMm);
    const parts = placedParts(sheet, paths);
    const dil = occupied(g, parts, dist).dil;
    // a shaped sheet (a remnant itself): nothing outside its outline
    if (sheet.outline?.length) {
      const inside = new Uint8Array(dil.length);
      fillLoops(g, inside, sheet.outline, 1);
      for (let k = 0; k < dil.length; k++) if (!inside[k]) dil[k] = 1;
    }
    c = { g, parts, dil };
    if (cache.size > 6) cache.delete(cache.keys().next().value!);
    cache.set(k, c);
  }
  return c;
}

/** The sheet's remnant for this mode (and the hand cuts given). */
export function computeRemnant(q: RemnantInput): SheetRemnant {
  const { sheet, settings: s } = q;
  const { g, dil, parts } = base(sheet, q.paths, s.minDistMm);
  const region = q.mode === "trim" ? trimRegion(g, dil, s) : q.mode === "rect" ? rectRegion(g, dil, s) : skeletRegion(g, dil, parts, s);
  const empty: SheetRemnant = { mode: q.mode, settings: s, at: new Date().toISOString(), key: sheetPartsKey(sheet), lines: [], cuts: q.cuts ?? [], pieces: [] };
  if (!region) return empty;
  const sheetArea = sheet.lengthMm * sheet.widthMm;
  const { pieces } = piecesOf(g, region, q.cuts ?? [], s, sheetArea, q.mode === "skelet");
  // SKELET cuts round the pieces as the mode makes them (the hand cuts are their own lines)
  const near = (p: Pt, b: RemnantPiece) => p[0] >= b.x0 - 2 * g.r && p[0] <= b.x1 + 2 * g.r && p[1] >= b.y0 - 2 * g.r && p[1] <= b.y1 + 2 * g.r;
  const mid = (l: Pt[]): Pt => [(l[0][0] + l[l.length - 1][0]) / 2, (l[0][1] + l[l.length - 1][1]) / 2];
  const lines = q.mode === "skelet" ? piecesOf(g, region, [], s, sheetArea, true).lines
    : q.mode === "rect" ? region.lines.filter((l) => pieces.some((p) => near(mid(l), p))) : region.lines;
  pieces.sort((a, b) => b.areaMm2 - a.areaMm2);
  pieces.forEach((p, i) => {
    p.name = remnantName(q.jobName, q.sheetNo, i + 1);
    const was = q.before?.find((b) => b.name === p.name && Math.abs(b.areaMm2 - p.areaMm2) <= 0.01 * p.areaMm2);
    if (was?.status) p.status = was.status;
  });
  const r2 = (p: Pt): Pt => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10];
  const round = (l: Pt[]) => l.map(r2);
  return {
    ...empty,
    lines: lines.map(round),
    pieces: pieces.map((p) => ({ ...p, outline: round(p.outline), ...(p.holes ? { holes: p.holes.map(round) } : {}), label: r2(p.label) })),
  };
}

/**
 * CUT V / CUT H at a point: the open cut through it across the remnant piece there, from edge to edge
 * (a remnant edge or the sheet's). null: the point is not on a remnant.
 */
export function cutAt(sheet: NestedSheet, paths: Map<string, string>, rem: SheetRemnant, axis: "v" | "h", x: number, y: number): RemnantCut | null {
  const { g, dil, parts } = base(sheet, paths, rem.settings.minDistMm);
  const region = rem.mode === "trim" ? trimRegion(g, dil, rem.settings) : rem.mode === "rect" ? rectRegion(g, dil, rem.settings) : skeletRegion(g, dil, parts, rem.settings);
  if (!region) return null;
  const { lab } = piecesOf(g, region, rem.cuts, rem.settings, sheet.lengthMm * sheet.widthMm, rem.mode === "skelet");
  const i = Math.floor(x / g.r), j = Math.floor(y / g.r);
  if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) return null;
  const id = lab[j * g.nx + i];
  if (!id || !rem.pieces.some((p) => pointIn(p.outline, x, y))) return null;
  if (axis === "v") {
    let a = j, b = j;
    while (a > 0 && lab[(a - 1) * g.nx + i] === id) a--;
    while (b < g.ny - 1 && lab[(b + 1) * g.nx + i] === id) b++;
    const at = Math.round((i + 0.5) * g.r * 10) / 10;
    return { axis, at, from: a * g.r, to: Math.min(g.W, (b + 1) * g.r) };
  }
  let a = i, b = i;
  while (a > 0 && lab[j * g.nx + a - 1] === id) a--;
  while (b < g.nx - 1 && lab[j * g.nx + b + 1] === id) b++;
  const at = Math.round((j + 0.5) * g.r * 10) / 10;
  return { axis, at, from: a * g.r, to: Math.min(g.L, (b + 1) * g.r) };
}

/** The hand cut nearest the point, within `tol` mm (DELETE CUT). */
export function cutNear(rem: SheetRemnant, x: number, y: number, tol: number): number {
  let best = -1, bd = tol;
  rem.cuts.forEach((c, k) => {
    const [px, py] = c.axis === "v" ? [c.at, Math.max(c.from, Math.min(c.to, y))] : [Math.max(c.from, Math.min(c.to, x)), c.at];
    const d = Math.hypot(px - x, py - y);
    if (d <= bd) { bd = d; best = k; }
  });
  return best;
}

/** A remnant as it is saved: its outline from its box's corner, with what it is. */
export function remnantRecord(p: RemnantPiece, sheet: NestedSheet, jobName: string, sheetNo: number) {
  const rel = (l: Pt[]) => l.map(([x, y]) => [Math.round((x - p.x0) * 10) / 10, Math.round((y - p.y0) * 10) / 10]);
  return {
    name: p.name, material: sheet.material, thicknessMm: sheet.thicknessMm, job: jobName, sheet: sheetNo, qty: sheet.cutNumber ?? 1,
    widthMm: Math.round(p.x1 - p.x0), heightMm: Math.round(p.y1 - p.y0), areaMm2: p.areaMm2,
    outline: rel(p.outline), ...(p.holes ? { holes: p.holes.map(rel) } : {}), ...(p.window ? { window: true } : {}),
  };
}
