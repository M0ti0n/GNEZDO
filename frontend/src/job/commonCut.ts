// Common cut in Manual nest: parts whose marked common cut lines (importer, Common cut tool) lie on
// each other, a kerf apart, share that line: it is cut once. Here: the lines of a part on a sheet,
// which placed parts share a line (they may come closer than the part gap there), where a dragged
// part snaps to share one, and the blocks Arrange makes of copies of a part (as the auto nest does,
// nestprep/commoncut.py).
import { api } from "../api/api";
import { commonEdgesOf, type PlacedPart } from "./nest";
import { partLoops, pointIn, transform, type Pt } from "./manualGeom";

/** A marked line of a part (part frame: the thumbnail path's, y down) with its outward normal. */
export interface CommonEdge { a: Pt; b: Pt; n: Pt; len: number }

const MIN_EDGE = 10;

const edgeCache = new Map<string, Promise<[number, number, number, number][]>>();
/** A part's common cut lines when it has the Common cut nesting rule ticked (else none). */
export function partCommonLines(partId: string): Promise<[number, number, number, number][]> {
  let r = edgeCache.get(partId);
  if (!r) {
    r = api.part(partId).then((d) => (d.commonCut ? commonEdgesOf(partId) : []), () => []);
    edgeCache.set(partId, r);
  }
  return r;
}

/** The lines with their outward normals (lines that are not on the part's outside are left out). */
export function commonEdges(path: string, lines: [number, number, number, number][]): CommonEdge[] {
  const outer = partLoops(path)[0];
  if (!outer) return [];
  const out: CommonEdge[] = [];
  for (const [x1, y1, x2, y2] of lines) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < MIN_EDGE) continue;
    const d: Pt = [(x2 - x1) / len, (y2 - y1) / len];
    let n: Pt = [d[1], -d[0]];
    const m: Pt = [(x1 + x2) / 2, (y1 + y2) / 2];
    const inA = pointIn(outer, m[0] + n[0] * 0.3, m[1] + n[1] * 0.3), inB = pointIn(outer, m[0] - n[0] * 0.3, m[1] - n[1] * 0.3);
    if (inA === inB) continue;            // a window's edge, or not on the outline
    if (inA) n = [-n[0], -n[1]];
    out.push({ a: [x1, y1], b: [x2, y2], n, len });
  }
  return out;
}

/** The part's lines on the sheet. */
export function placedEdges(p: Pick<PlacedPart, "x" | "y" | "angle" | "mirror">, edges: CommonEdge[]): CommonEdge[] {
  const f = transform(p);
  const g = transform({ x: 0, y: 0, angle: p.angle, mirror: p.mirror });
  return edges.map((e) => ({ a: f(e.a), b: f(e.b), n: g(e.n), len: e.len }));
}

const dot = (p: Pt, q: Pt) => p[0] * q[0] + p[1] * q[1];

/**
 * Where two lines face each other: parallel, normals opposite, `sep` apart across (from e's line
 * to f's, along e's normal) and overlapping along e by `over` mm (from t0 to t1 along e).
 */
function facing(e: CommonEdge, f: CommonEdge): { sep: number; over: number; t0: number; t1: number } | null {
  if (dot(e.n, f.n) > -0.9995) return null;
  const d: Pt = [(e.b[0] - e.a[0]) / e.len, (e.b[1] - e.a[1]) / e.len];
  const sep = dot([f.a[0] - e.a[0], f.a[1] - e.a[1]], e.n);
  const fa = dot([f.a[0] - e.a[0], f.a[1] - e.a[1]], d), fb = dot([f.b[0] - e.a[0], f.b[1] - e.a[1]], d);
  const t0 = Math.max(0, Math.min(fa, fb)), t1 = Math.min(e.len, Math.max(fa, fb));
  return { sep, over: t1 - t0, t0, t1 };
}

/**
 * Placed parts that share a common cut line (the pair may be closer than the part gap), and the
 * shared lines (sheet frame) to draw. Lines within `kerf` + a little, overlapping by 1 mm or more.
 */
export function sharedLines(parts: { edges: CommonEdge[]; box: { x0: number; y0: number; x1: number; y1: number } }[], kerf: number):
  { pairs: Set<string>; lines: [Pt, Pt][] } {
  const pairs = new Set<string>();
  const lines: [Pt, Pt][] = [];
  const tol = 0.25;
  for (let i = 0; i < parts.length; i++) {
    const A = parts[i];
    if (!A.edges.length) continue;
    for (let j = i + 1; j < parts.length; j++) {
      const B = parts[j];
      if (!B.edges.length) continue;
      if (A.box.x0 > B.box.x1 + kerf + 1 || B.box.x0 > A.box.x1 + kerf + 1 || A.box.y0 > B.box.y1 + kerf + 1 || B.box.y0 > A.box.y1 + kerf + 1) continue;
      for (const e of A.edges) for (const f of B.edges) {
        const r = facing(e, f);
        if (!r || r.over < 1 || r.sep < -0.05 || r.sep > kerf + tol) continue;
        pairs.add(`${i}|${j}`);
        const d: Pt = [(e.b[0] - e.a[0]) / e.len, (e.b[1] - e.a[1]) / e.len];
        const h = r.sep / 2;
        const p0: Pt = [e.a[0] + d[0] * r.t0 + e.n[0] * h, e.a[1] + d[1] * r.t0 + e.n[1] * h];
        const p1: Pt = [e.a[0] + d[0] * r.t1 + e.n[0] * h, e.a[1] + d[1] * r.t1 + e.n[1] * h];
        lines.push([p0, p1]);
      }
    }
  }
  return { pairs, lines };
}

/**
 * Snap while dragging: the move [dx, dy] that brings one of the moving lines onto a line of a
 * still part, `kerf` apart (and their ends together when they are near), when one is within
 * `reach` mm; null: nothing near.
 */
export function snapMove(moving: CommonEdge[], still: CommonEdge[], kerf: number, reach: number): [number, number] | null {
  let best: { d: number; v: [number, number] } | null = null;
  for (const e of still) for (const f of moving) {
    const r = facing(e, f);
    if (!r || r.over <= 0) continue;
    const across = kerf - r.sep;                 // along e.n: f is moved to sep = kerf
    if (Math.abs(across) > reach) continue;
    let v: [number, number] = [e.n[0] * across, e.n[1] * across];
    // ends near each other: lined up too
    const d: Pt = [(e.b[0] - e.a[0]) / e.len, (e.b[1] - e.a[1]) / e.len];
    const fa = dot([f.a[0] - e.a[0], f.a[1] - e.a[1]], d), fb = dot([f.b[0] - e.a[0], f.b[1] - e.a[1]], d);
    let along = Infinity;
    for (const fe of [fa, fb]) for (const ee of [0, e.len]) if (Math.abs(ee - fe) < Math.abs(along)) along = ee - fe;
    if (Math.abs(along) <= reach) v = [v[0] + d[0] * along, v[1] + d[1] * along];
    const dist = Math.abs(across) + (Math.abs(along) <= reach ? Math.abs(along) * 0.5 : 0);
    if (!best || dist < best.d) best = { d: dist, v };
  }
  return best?.v ?? null;
}

// -- blocks for Arrange ------------------------------------------------------------------------

export type Pose = { x: number; y: number; angle: number; mirror: boolean };
const ID: Pose = { x: 0, y: 0, angle: 0, mirror: false };

/** How copies of a part join: a row (one shift), a grid (two shifts) or a pair turned 180 degrees. */
export interface CommonLayout { kind: "row" | "grid" | "pair"; t1: Pose; t2?: Pose }

function samples(loops: Pt[][], step = 2): Pt[] {
  const out: Pt[] = [];
  for (const lp of loops) for (let i = 0; i < lp.length; i++) {
    const a = lp[i], b = lp[(i + 1) % lp.length];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let j = 0; j < n; j++) out.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]);
  }
  return out;
}

const segDist = (p: Pt, a: Pt, b: Pt) => {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy || 1e-18;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};

/** Copy B (at pose) keeps the gap from copy A (at 0) except within the gap of the shared line; never inside it. */
function clear(path: string, pose: Pose, gap: number, shared?: [Pt, Pt], onlyOverlap = false): boolean {
  const loops = partLoops(path);
  const f = transform(pose);
  const A = loops, B = loops.map((lp) => lp.map(f));
  const inMat = (L: Pt[][], x: number, y: number) => pointIn(L[0], x, y) && !L.slice(1).some((h) => pointIn(h, x, y));
  for (const [P, Q] of [[A, B], [B, A]] as [Pt[][], Pt[][]][]) {
    let pts = samples(P);
    if (shared) pts = pts.filter((p) => segDist(p, shared[0], shared[1]) > gap + 0.05);
    const step = Math.max(1, Math.floor(pts.length / 400));
    for (let i = 0; i < pts.length; i += step) if (inMat(Q, pts[i][0], pts[i][1])) return false;
    if (onlyOverlap) continue;
    const qs = samples(Q, 1);
    for (const p of pts) for (const q of qs) if (Math.abs(p[0] - q[0]) < gap && Math.abs(p[1] - q[1]) < gap && Math.hypot(p[0] - q[0], p[1] - q[1]) < gap - 0.6) return false;
  }
  return true;
}

const layoutCache = new Map<string, CommonLayout | null>();
/** How copies of the part join along its common cut lines (null: they do not). */
export function commonLayout(path: string, edges: CommonEdge[], kerf: number, gap: number): CommonLayout | null {
  const key = `${path}|${JSON.stringify(edges.map((e) => [e.a, e.b]))}|${kerf}|${gap}`;
  if (layoutCache.has(key)) return layoutCache.get(key)!;
  const shifts: { t: Pose; len: number }[] = [];
  for (const e1 of edges) for (const e2 of edges) {
    if (e1 === e2 || Math.abs(e1.len - e2.len) > 0.5 || dot(e1.n, e2.n) > -0.999) continue;
    const m1: Pt = [(e1.a[0] + e1.b[0]) / 2, (e1.a[1] + e1.b[1]) / 2], m2: Pt = [(e2.a[0] + e2.b[0]) / 2, (e2.a[1] + e2.b[1]) / 2];
    const t: Pose = { x: m1[0] - m2[0] + e1.n[0] * kerf, y: m1[1] - m2[1] + e1.n[1] * kerf, angle: 0, mirror: false };
    const d: Pt = [(e1.b[0] - e1.a[0]) / e1.len, (e1.b[1] - e1.a[1]) / e1.len];
    if (Math.abs((m2[0] + t.x - m1[0]) * d[0] + (m2[1] + t.y - m1[1]) * d[1]) > 0.5) continue;
    if (shifts.some((s) => (Math.abs(s.t.x - t.x) < 0.01 && Math.abs(s.t.y - t.y) < 0.01) || (Math.abs(s.t.x + t.x) < 0.01 && Math.abs(s.t.y + t.y) < 0.01))) continue;
    if (clear(path, t, gap, [e1.a, e1.b]) && clear(path, { ...t, x: 2 * t.x, y: 2 * t.y }, gap)) shifts.push({ t, len: e1.len });
  }
  shifts.sort((p, q) => q.len - p.len);
  let out: CommonLayout | null = null;
  if (shifts.length) {
    const s1 = shifts[0].t;
    const s2 = shifts.slice(1).find(({ t }) => Math.abs(s1.x * t.y - s1.y * t.x) > 1e-6
      && [1, -1].every((k) => clear(path, { x: s1.x + k * t.x, y: s1.y + k * t.y, angle: 0, mirror: false }, gap, undefined, true)));
    out = s2 ? { kind: "grid", t1: s1, t2: s2.t } : { kind: "row", t1: s1 };
  } else {
    for (const e of edges.slice().sort((p, q) => q.len - p.len)) {
      const m: Pt = [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2];
      const t: Pose = { x: 2 * m[0] + e.n[0] * kerf, y: 2 * m[1] + e.n[1] * kerf, angle: 180, mirror: false };
      if (clear(path, t, gap, [e.a, e.b])) { out = { kind: "pair", t1: t }; break; }
    }
  }
  layoutCache.set(key, out);
  return out;
}

/** The copies of an a (x b) block, in the first copy's frame. */
export function blockPoses(l: CommonLayout, a: number, b = 1): Pose[] {
  if (l.kind === "pair") return [ID, l.t1];
  const t2 = l.t2 ?? ID;
  const out: Pose[] = [];
  for (let j = 0; j < (l.kind === "grid" ? b : 1); j++) for (let i = 0; i < a; i++)
    out.push({ x: i * l.t1.x + j * t2.x, y: i * l.t1.y + j * t2.y, angle: 0, mirror: false });
  return out;
}

/**
 * Blocks for k copies of a part that fit a w x h area (either way round): [a, b] per block, the
 * biggest blocks first; `share` of the biggest block that fits sets their size (1: as big as fits).
 */
export function blockSizes(path: string, l: CommonLayout, k: number, w: number, h: number, share: number): [number, number][] {
  const loops = partLoops(path);
  const size = (a: number, b: number) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of blockPoses(l, a, b)) { const f = transform(p); for (const q of loops[0] ?? []) { const [x, y] = f(q); x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } }
    return [x1 - x0, y1 - y0];
  };
  const fits = (a: number, b: number) => { const [bw, bh] = size(a, b); return (bw <= w && bh <= h) || (bh <= w && bw <= h); };
  let sizes: [number, number][] = [];
  if (l.kind === "pair") sizes = k >= 2 && fits(2, 1) ? [[2, 1]] : [];
  else {
    for (let b = 1; b <= (l.kind === "grid" ? k : 1); b++) for (let a = 1; a * b <= k; a++) {
      if (a * b < 2) continue;
      if (!fits(a, b)) break;
      sizes.push([a, b]);
    }
  }
  if (!sizes.length) return [];
  const kmax = Math.max(...sizes.map(([a, b]) => a * b));
  const best = (n: number): [number, number] | null => {
    const c = sizes.filter(([a, b]) => a * b <= n);
    if (!c.length) return null;
    const sq = ([a, b]: [number, number]) => { const [bw, bh] = size(a, b); return Math.max(bw, bh) / Math.max(1e-9, Math.min(bw, bh)); };
    return c.reduce((p, q) => (q[0] * q[1] > p[0] * p[1] || (q[0] * q[1] === p[0] * p[1] && sq(q) < sq(p)) ? q : p));
  };
  const first = best(Math.max(2, Math.ceil(kmax * share)));
  if (!first) return [];
  const out: [number, number][] = [];
  let left = k;
  const n = first[0] * first[1];
  while (left >= n) { out.push(first); left -= n; }
  if (left >= 2) { const r = best(left); if (r) out.push(r); }
  return out;
}
