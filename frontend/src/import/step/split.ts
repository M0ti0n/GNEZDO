// STITCH -> ADD EDGE: a flat face split along a line between two of its corners. A flange running all round
// a part (one face touching every wall) cannot be laid flat with all of them; cut at its corners it becomes
// one piece per wall, each stitched to its own. The new edges are seams: each side gets its own edge (they
// are never stitched together), so the flat pattern is cut there.

import { cross3, dot3, len3, mul3, sub3, unit3, type Edge, type Face, type Solid, type V3 } from "./step";

type P2 = [number, number];
const TOL = 1e-3;   // mm: points this close are the same corner

/** A cut: the two corners (in the part, mm). */
export type FaceCut = [V3, V3];

const near = (a: V3, b: V3) => len3(sub3(a, b)) < TOL;
const ON = 0.01;    // mm: a point this close to an edge is on it

/** Where p lies along the polyline (its segment and how far along it), or null when not on it. */
function along(pts: V3[], p: V3): { k: number; t: number } | null {
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], d = sub3(pts[k], a), L2 = dot3(d, d);
    if (L2 < 1e-18) continue;
    const t = Math.max(0, Math.min(1, dot3(sub3(p, a), d) / L2));
    if (len3(sub3(p, [a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t])) < ON) return { k, t };
  }
  return null;
}
/** Is p on the face's outline (a corner or on an edge)? */
const onOutline = (f: Face, p: V3) => f.loops.some((l) => l.edges.some((e) => along(e.pts, p)));

/** An edge cut in pieces where points lie inside it (the pieces keep its number: shared with its neighbor). */
function splitEdge(e: Edge, ps: V3[]): Edge[] {
  const ends = [e.pts[0], e.pts[e.pts.length - 1]];
  const at = ps.filter((p) => !ends.some((q) => near(p, q))).flatMap((p) => { const a = along(e.pts, p); return a ? [{ ...a, p }] : []; })
    .sort((x, y) => x.k - y.k || x.t - y.t);
  if (!at.length) return [e];
  const out: Edge[] = [];
  let cur: V3[] = [e.pts[0]];
  let k = 1;
  for (const c of at) {
    for (; k < c.k; k++) cur.push(e.pts[k]);
    if (!near(cur[cur.length - 1], c.p)) cur.push(c.p);
    if (cur.length > 1) out.push({ ...e, pts: cur });
    cur = [c.p];
  }
  for (; k < e.pts.length; k++) if (!near(cur[cur.length - 1], e.pts[k])) cur.push(e.pts[k]);
  if (cur.length > 1) out.push({ ...e, pts: cur });
  return out;
}

/** Is p inside the polygon (even-odd)? */
function inPoly(p: P2, poly: P2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const area = (poly: P2[]) => { let s = 0; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += (poly[j][0] - poly[i][0]) * (poly[j][1] + poly[i][1]); return s / 2; };

/** The face's own 2D frame (seen from its normal: counterclockwise is positive). */
function frameOf(f: Face) {
  const s = f.surf as { o: V3; n: V3; x: V3 };
  const n = unit3(s.n), u = unit3(s.x), v = cross3(n, u);
  return (p: V3): P2 => { const w = sub3(p, s.o); return [dot3(w, u), dot3(w, v)]; };
}

/** Does the line a..b run across the face: both ends on its outline (corners or edges), the line inside it (not along an edge, not out of it)? */
export function cutsAcross(f: Face, a: V3, b: V3): boolean {
  if (f.surf.kind !== "plane" || near(a, b)) return false;
  if (!onOutline(f, a) || !onOutline(f, b)) return false;
  const to2 = frameOf(f);
  const loops2 = f.loops.map((l) => l.edges.flatMap((e) => e.pts.map(to2)));
  const inFace = (p: P2) => loops2.reduce((ins, poly) => (inPoly(p, poly) ? !ins : ins), false);
  // face on both sides of the line all along (not along an edge, not out of the face)
  const A = to2(a), B = to2(b);
  const L = Math.hypot(B[0] - A[0], B[1] - A[1]), eps = Math.min(0.01, L / 100);
  const nx = (-(B[1] - A[1]) / L) * eps, ny = ((B[0] - A[0]) / L) * eps;
  for (let k = 1; k < 20; k++) {
    const t = k / 20, x = A[0] + (B[0] - A[0]) * t, y = A[1] + (B[1] - A[1]) * t;
    if (!inFace([x + nx, y + ny]) || !inFace([x - nx, y - ny])) return false;
  }
  return true;
}

/**
 * The face split along its cuts (each between two of its corners, across it): the pieces, the first in the
 * face's place. One piece when the cuts only open a ring (a flange cut once).
 */
export function splitFace(face: Face, cuts: { a: V3; b: V3; no: number }[]): Face[] {
  // the edges the cuts end in the middle of: in pieces there
  const ends = cuts.flatMap((c) => [c.a, c.b]);
  const f: Face = { ...face, loops: face.loops.map((l) => ({ ...l, edges: l.edges.flatMap((e) => splitEdge(e, ends)) })) };
  const to2 = frameOf(f);
  const loops2 = f.loops.map((l) => l.edges.flatMap((e) => e.pts.map(to2)));
  const inFace = (p: P2) => loops2.reduce((ins, poly) => (inPoly(p, poly) ? !ins : ins), false);

  // the graph: corners, the face's edges, and the new edge
  const verts: V3[] = [];
  const vid = (p: V3) => { const i = verts.findIndex((q) => near(p, q)); if (i >= 0) return i; verts.push(p); return verts.length - 1; };
  const edges: { e: Edge | null; from: number; to: number; pts: P2[]; cut?: { a: V3; b: V3; no: number } }[] = [];
  for (const l of f.loops) for (const e of l.edges) edges.push({ e, from: vid(e.pts[0]), to: vid(e.pts[e.pts.length - 1]), pts: e.pts.map(to2) });
  for (const c of cuts) edges.push({ e: null, from: vid(c.a), to: vid(c.b), pts: [to2(c.a), to2(c.b)], cut: c });

  // half edges (both ways), leaving each corner in the order of their direction
  type Half = { k: number; fwd: boolean };
  const pts = (h: Half) => (h.fwd ? edges[h.k].pts : [...edges[h.k].pts].reverse());
  const start = (h: Half) => (h.fwd ? edges[h.k].from : edges[h.k].to);
  const end = (h: Half) => (h.fwd ? edges[h.k].to : edges[h.k].from);
  const dir = (h: Half) => {
    const q = pts(h);
    for (let i = 1; i < q.length; i++) { const dx = q[i][0] - q[0][0], dy = q[i][1] - q[0][1]; if (Math.hypot(dx, dy) > 1e-9) return Math.atan2(dy, dx); }
    return 0;
  };
  const halves: Half[] = edges.flatMap((_, k) => [{ k, fwd: true }, { k, fwd: false }]);
  const out = new Map<number, { h: Half; ang: number }[]>();
  for (const h of halves) { const l = out.get(start(h)) ?? []; l.push({ h, ang: dir(h) }); out.set(start(h), l); }
  const key = (h: Half) => h.k * 2 + (h.fwd ? 0 : 1);
  // next: at the end, the edge first clockwise from the way back (the face stays on the left)
  const next = (h: Half): Half => {
    const back = { k: h.k, fwd: !h.fwd };
    const list = out.get(end(h)) ?? [];
    const angBack = dir(back);
    let best: Half = back, bestTurn = Infinity;
    for (const o of list) {
      if (key(o.h) === key(back) && list.length > 1) continue;
      const turn = ((angBack - o.ang) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI;
      if (turn < bestTurn) { bestTurn = turn; best = o.h; }
    }
    return best;
  };
  // every cycle of half edges
  const seen = new Set<number>();
  const cycles: Half[][] = [];
  for (const h0 of halves) {
    if (seen.has(key(h0))) continue;
    const c: Half[] = [];
    let h = h0;
    for (let guard = 0; guard < halves.length + 2 && !seen.has(key(h)); guard++) { seen.add(key(h)); c.push(h); h = next(h); }
    cycles.push(c);
  }
  const polyOf = (c: Half[]) => c.flatMap((h) => pts(h).slice(0, -1));
  // a point just left of the cycle's first stretch: on the cycle's own side
  const leftOf = (c: Half[]): P2 => {
    const q = pts(c[0]);
    const [x0, y0] = q[0], [x1, y1] = q[1] ?? q[0];
    const L = Math.hypot(x1 - x0, y1 - y0) || 1, eps = Math.min(0.01, L / 10);
    return [(x0 + x1) / 2 - ((y1 - y0) / L) * eps, (y0 + y1) / 2 + ((x1 - x0) / L) * eps];
  };
  // pieces: counterclockwise cycles with material inside; holes: clockwise cycles with material beside them
  const pieces = cycles.filter((c) => area(polyOf(c)) > 0 && inFace(leftOf(c)));
  const holes = cycles.filter((c) => area(polyOf(c)) < 0 && inFace(leftOf(c)));
  if (!pieces.length) return [face];
  const edgeOf = (h: Half): Edge => {
    const g = edges[h.k];
    if (g.cut) {
      // the new edge: its own on each side (a seam, cut)
      const { a, b, no } = g.cut;
      return { id: -(1_000_000 + no * 2 + (h.fwd ? 0 : 1)), pts: h.fwd ? [a, b] : [b, a], line: true };
    }
    if (!g.e) return { id: 0, pts: [] };
    if (h.fwd) return g.e;
    return { ...g.e, pts: [...g.e.pts].reverse(), ...(g.e.arc ? { arc: { ...g.e.arc, z: mul3(g.e.arc.z, -1) } } : {}) };
  };
  return pieces.map((c, i) => {
    const poly = polyOf(c);
    const mine = holes.filter((hc) => inPoly(leftOf(hc), poly)
      && !pieces.some((o) => o !== c && Math.abs(area(polyOf(o))) < Math.abs(area(poly)) && inPoly(leftOf(hc), polyOf(o))));
    const loop = (hs: Half[], outer: boolean) => ({ outer, edges: hs.map(edgeOf) });
    return { ...f, id: i === 0 ? f.id : -(2_000_000 + f.id * 100 + i), loops: [loop(c, true), ...mine.map((hc) => loop(hc, false))] };
  });
}

/** The flat face a cut runs across (its index), or -1. */
export const faceOfCut = (s: Solid, [a, b]: FaceCut) => s.faces.findIndex((f) => cutsAcross(f, a, b));

/**
 * The part with its added edges: each cut splits the flat face it runs across (all of one face's cuts
 * together). The pieces after the first go to the end, in the order the faces were first cut; the faces
 * not cut keep their numbers.
 */
export function withCuts(s: Solid, cuts: FaceCut[]): { solid: Solid; problems: string[] } {
  const problems: string[] = [];
  const byFace = new Map<number, { a: V3; b: V3; no: number }[]>();
  cuts.forEach((c, no) => {
    const i = faceOfCut(s, c);
    if (i < 0) { problems.push(`Added edge ${no + 1}: its two points are not corners of one flat face, with the line across it`); return; }
    byFace.set(i, [...(byFace.get(i) ?? []), { a: c[0], b: c[1], no }]);
  });
  const faces = s.faces.slice();
  for (const [i, list] of byFace) {
    const parts = splitFace(s.faces[i], list);
    faces[i] = parts[0];
    faces.push(...parts.slice(1));
  }
  return { solid: { ...s, faces, problems: [...s.problems, ...problems] }, problems };
}

/** The face a face of the cut part comes from (its STEP number): a piece's number tells it. */
const originOf = (id: number) => (id > -2_000_000 ? id : Math.floor((-id - 2_000_000) / 100));

/**
 * The picked faces (stitch) still meant after the added edges changed: a face split (or no longer split)
 * by the change, and its pieces, drop out (they are picked again); the others keep their numbers.
 */
export function keepPicks(base: Solid, oldCuts: FaceCut[], newCuts: FaceCut[], picks: number[]): number[] {
  const k = (c: FaceCut) => JSON.stringify(c);
  const oldK = new Set(oldCuts.map(k)), newK = new Set(newCuts.map(k));
  const changed = [...oldCuts.filter((c) => !newK.has(k(c))), ...newCuts.filter((c) => !oldK.has(k(c)))];
  const hit = new Set(changed.map((c) => faceOfCut(base, c)).filter((i) => i >= 0).map((i) => base.faces[i].id));
  const a = withCuts(base, oldCuts).solid.faces, b = withCuts(base, newCuts).solid.faces;
  return picks.filter((i) => a[i] && b[i] && a[i].id === b[i].id && !hit.has(originOf(b[i].id)));
}

/** Why the cut cannot be added (null: it can): it must run across one flat face, between two of its
 *  corners, and not cross an edge added before on that face. */
export function cutProblem(base: Solid, cuts: FaceCut[], c: FaceCut): string | null {
  if (near(c[0], c[1])) return "Click a second, different point";
  const i = faceOfCut(base, c);
  if (i < 0) return "Both points must be on the outline of one flat face, with the line between them across the face (not along an edge)";
  const k = JSON.stringify;
  if (cuts.some((o) => k(o) === k(c) || k([o[1], o[0]]) === k(c))) return "That edge is added already";
  const to2 = frameOf(base.faces[i]);
  const A = to2(c[0]), B = to2(c[1]);
  const cross = (p: P2, q: P2, r: P2) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  for (const o of cuts) {
    if (faceOfCut(base, o) !== i) continue;
    const C = to2(o[0]), D = to2(o[1]);
    const shares = [C, D].some((q) => Math.hypot(q[0] - A[0], q[1] - A[1]) < TOL || Math.hypot(q[0] - B[0], q[1] - B[1]) < TOL);
    if (shares) continue;
    const d1 = cross(A, B, C), d2 = cross(A, B, D), d3 = cross(C, D, A), d4 = cross(C, D, B);
    if (((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))) return "It crosses an edge added before: add edges that do not cross";
  }
  return null;
}
