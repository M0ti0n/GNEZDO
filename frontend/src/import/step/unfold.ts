// Sheet-metal unfolder: a solid read from STEP (step.ts) laid flat.
//  1. Thickness: pairs of flat faces with opposite normals, one behind the other (material between):
//     the most common distance (by area).
//  2. The skin: from the biggest flat face, every face reached across smooth (tangent) edges: the flat
//     faces of that side and its bends (cylinders). Side faces, hole walls, reliefs meet it at sharp
//     edges and stay out.
//  3. Unfolded face by face from the biggest one: a flat face moves as a whole (rotated about the bend's
//     axis, moved on by the bend's length); a bend becomes a strip as wide as its angle × (inner
//     radius + K × thickness).
//  4. The flat pattern: the skin's edges that only one skin face has (outline, holes); the bends'
//     middle lines as bend lines.

import { add3, cross3, dot3, len3, lowHigh, mul3, normalAt, sub3, unit3, type Face, type Solid, type V3 } from "./step";

export type V2 = [number, number];

export interface FlatEdge {
  pts: V2[];
  /** a circle arc on a flat face: centre, radius, from / to angle [rad], counter-clockwise */
  arc?: { c: V2; r: number; a0: number; a1: number };
}

export interface Bend {
  innerR: number; angleDeg: number; length: number;
  /** the unfolded side is the bend's inner side */
  inner: boolean;
  /** seen from the top side (the side up on the machine) the flange comes up towards the viewer */
  up: boolean;
}

export interface UnfoldOptions {
  /** inner radius + K × thickness is the bend's neutral radius */
  kFactor: number;
  /** the flat face it is unfolded from (index in the solid's faces); missing: the biggest */
  base?: number;
  /** the flat pattern seen from the other side (the side away from the unfolded faces is up) */
  flip?: boolean;
}

export interface Unfolded {
  thickness: number | null;
  kFactor: number;
  bends: Bend[];
  outline: FlatEdge[];
  bendLines: [V2, V2][];
  box: { x0: number; y0: number; x1: number; y1: number };
  /** the faces: on the unfolded side, bends among them, and faces of a kind not handled */
  stats: { faces: number; skin: number; planes: number; cylinders: number; other: number; openEnds: number };
  problems: string[];
  /** the faces unfolded (indexes in the solid's faces) */
  skinFaces: number[];
  /** faces picked and stitched (no thickness needed) */
  stitched?: boolean;
}

interface Rigid { R: number[]; t: V3 }
const I: Rigid = { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };
const app = (g: Rigid, p: V3): V3 => [
  g.R[0] * p[0] + g.R[1] * p[1] + g.R[2] * p[2] + g.t[0],
  g.R[3] * p[0] + g.R[4] * p[1] + g.R[5] * p[2] + g.t[1],
  g.R[6] * p[0] + g.R[7] * p[1] + g.R[8] * p[2] + g.t[2],
];
const rot = (g: Rigid, v: V3): V3 => [g.R[0] * v[0] + g.R[1] * v[1] + g.R[2] * v[2], g.R[3] * v[0] + g.R[4] * v[1] + g.R[5] * v[2], g.R[6] * v[0] + g.R[7] * v[1] + g.R[8] * v[2]];
/** a then b: p -> a(b(p)) */
const compose = (a: Rigid, b: Rigid): Rigid => {
  const R = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) R[i * 3 + j] += a.R[i * 3 + k] * b.R[k * 3 + j];
  return { R, t: app(a, b.t) };
};
/** rotation about the axis through `a` along unit `d` by `th` */
const rotAbout = (a: V3, d: V3, th: number): Rigid => {
  const c = Math.cos(th), s = Math.sin(th), C = 1 - c, [x, y, z] = d;
  const R = [c + x * x * C, x * y * C - z * s, x * z * C + y * s, y * x * C + z * s, c + y * y * C, y * z * C - x * s, z * x * C - y * s, z * y * C + x * s, c + z * z * C];
  const g = { R, t: [0, 0, 0] as V3 };
  return { R, t: sub3(a, app(g, a)) };
};
const move = (v: V3): Rigid => ({ R: I.R, t: v });

/** Newell's vector of a closed polyline: its direction the normal, half its length the area */
const newell = (pts: V3[]): V3 => {
  const n: V3 = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]); n[1] += (a[2] - b[2]) * (a[0] + b[0]); n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return n;
};
const loopPts = (l: Face["loops"][number]) => l.edges.flatMap((e) => e.pts.slice(0, -1));

/** a flat face's area (its outer loop less its holes) and centre */
function planeArea(f: Face): { area: number; c: V3 } {
  if (f.surf.kind !== "plane" || !f.loops.length) return { area: 0, c: [0, 0, 0] };
  const n = f.surf.n;
  const areas = f.loops.map((l) => Math.abs(dot3(newell(loopPts(l)), n)) / 2);
  const outer = areas.indexOf(Math.max(...areas));
  const pts = loopPts(f.loops[outer]);
  const c = mul3(pts.reduce((s, p) => add3(s, p), [0, 0, 0] as V3), 1 / Math.max(1, pts.length));
  return { area: areas[outer] - areas.reduce((s, a, i) => (i === outer ? s : s + a), 0), c };
}

/** The point is inside the flat face's outer loop (projected on its plane). */
function inside(f: Face, p: V3): boolean {
  if (f.surf.kind !== "plane") return false;
  const { n, x } = f.surf;
  const y = cross3(n, x);
  const to2 = (q: V3): V2 => { const v = sub3(q, f.surf.kind === "plane" ? f.surf.o : q); return [dot3(v, x), dot3(v, y)]; };
  const areas = f.loops.map((l) => Math.abs(dot3(newell(loopPts(l)), n)));
  const lp = loopPts(f.loops[areas.indexOf(Math.max(...areas))]).map(to2);
  const [px, py] = to2(p);
  let c = false;
  for (let i = 0, j = lp.length - 1; i < lp.length; j = i++) {
    const [xi, yi] = lp[i], [xj, yj] = lp[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** The sheet's thickness: the most common distance (by area) between flat faces one behind the other. */
export function thicknessOf(s: Solid): number | null {
  const planes = s.faces.map((f) => ({ f, ...planeArea(f) })).filter((p) => p.f.surf.kind === "plane" && p.area > 1e-3);
  const votes = new Map<number, number>();
  for (let i = 0; i < planes.length; i++) {
    const a = planes[i], na = normalAt(a.f, a.c)!;
    // the nearest face behind it (the material between them), over it: the other side of the sheet
    let near: { d: number; area: number } | null = null;
    for (let j = 0; j < planes.length; j++) {
      if (i === j) continue;
      const b = planes[j], nb = normalAt(b.f, b.c)!;
      if (dot3(na, nb) > -0.9999) continue;
      const d = -dot3(sub3(b.c, a.c), na);
      if (d <= 0.05 || (near && d >= near.d)) continue;
      const foot = add3(b.c, mul3(na, d));
      if (!inside(a.f, foot) && !inside(b.f, sub3(a.c, mul3(na, d)))) continue;
      near = { d, area: Math.min(a.area, b.area) };
    }
    if (!near) continue;
    const k = Math.round(near.d * 100) / 100;
    votes.set(k, (votes.get(k) ?? 0) + near.area);
  }
  if (!votes.size) return null;
  const best = [...votes.entries()].sort((x, y) => y[1] - x[1])[0];
  return best[0];
}

/** The angle of q about the axis (a, d) from the radial vector r0, signed (counter-clockwise about d). */
const angleOn = (a: V3, d: V3, r0: V3, q: V3) => {
  const v = sub3(q, a);
  const rq = sub3(v, mul3(d, dot3(v, d)));
  return Math.atan2(dot3(d, cross3(r0, rq)), dot3(r0, rq));
};

interface CylMap { g: Rigid; a: V3; d: V3; r0: V3; sgn: number; rn: number; dir: V3; phi: number }

/** Unfold a solid with this K-factor (inner radius + K × thickness is the bend's neutral radius). */
export function unfold(s: Solid, opt: number | UnfoldOptions = 0.44): Unfolded {
  const opts: UnfoldOptions = typeof opt === "number" ? { kFactor: opt } : opt;
  const kFactor = opts.kFactor, flip = !!opts.flip;
  const problems = [...s.problems];
  const t = thicknessOf(s);
  if (t === null) problems.push("The thickness was not found (no two flat faces one behind the other)");
  const T = t ?? 0;
  const faces = s.faces;
  const stats = { faces: faces.length, skin: 0, planes: 0, cylinders: 0, other: faces.filter((f) => f.surf.kind === "other").length, openEnds: 0 };
  // which faces have each edge
  const byEdge = new Map<number, number[]>();
  faces.forEach((f, i) => f.loops.forEach((l) => l.edges.forEach((e) => { const l2 = byEdge.get(e.id) ?? []; if (!l2.includes(i)) l2.push(i); byEdge.set(e.id, l2); })));
  // the base: the biggest flat face
  const areas = faces.map((f) => planeArea(f).area);
  const base = opts.base !== undefined && faces[opts.base]?.surf.kind === "plane" ? opts.base : areas.indexOf(Math.max(...areas));
  if (base < 0 || areas[base] <= 0) return { thickness: t, kFactor, bends: [], outline: [], bendLines: [], box: { x0: 0, y0: 0, x1: 0, y1: 0 }, stats, problems: [...problems, "No flat face to start from"], skinFaces: [] };

  // walk the skin across smooth edges
  const flat = new Map<number, Rigid>();      // flat faces: their move into the base plane
  const cyl = new Map<number, CylMap>();      // bends: how their points go flat
  const bends: Bend[] = [];
  flat.set(base, I);
  const queue = [base];
  const mid = (pts: V3[]) => pts[Math.floor(pts.length / 2)];
  const tangent = (fa: Face, fb: Face, p: V3) => { const a = normalAt(fa, p), b = normalAt(fb, p); return !!a && !!b && dot3(a, b) > 0.999; };
  const cylPt = (m: CylMap, p: V3): V3 => {
    const v = sub3(p, m.a), s0 = dot3(v, m.d);
    const phi = angleOn(m.a, m.d, m.r0, p) * m.sgn;
    return app(m.g, add3(add3(add3(m.a, mul3(m.d, s0)), m.r0), mul3(m.dir, phi * m.rn)));
  };
  while (queue.length) {
    const i = queue.shift()!;
    const F = faces[i];
    for (const l of F.loops) for (const e of l.edges) {
      for (const j of byEdge.get(e.id) ?? []) {
        if (j === i || flat.has(j) || cyl.has(j)) continue;
        const G = faces[j];
        if (G.surf.kind === "other") continue;
        const p = mid(e.pts);
        if (!tangent(F, G, p)) continue;
        if (F.surf.kind === "plane" && G.surf.kind === "plane") { flat.set(j, flat.get(i)!); queue.push(j); continue; }
        if (F.surf.kind === "plane" && G.surf.kind === "cyl") {
          // a bend starting at this flat face: its strip from the edge on
          const { a, d, r } = G.surf;
          const v = sub3(p, a);
          const r0 = mul3(unit3(sub3(v, mul3(d, dot3(v, d)))), r);
          const all = G.loops.flatMap((lp) => lp.edges.flatMap((x) => x.pts));
          let phi = 0;
          for (const q of all) { const f = angleOn(a, d, r0, q); if (Math.abs(f) > Math.abs(phi)) phi = f; }
          const sgn = phi >= 0 ? 1 : -1;
          // inner or outer side: the outward normal points to the axis on the inner side
          const n = normalAt(G, p)!;
          const innerR = dot3(n, r0) < 0 ? r : Math.max(0, r - T);
          const rn = innerR + kFactor * T;
          const m: CylMap = { g: flat.get(i)!, a, d, r0, sgn, rn, dir: mul3(unit3(cross3(d, r0)), sgn), phi };
          cyl.set(j, m);
          const ext = all.map((q) => dot3(sub3(q, a), d));
          const inner = dot3(n, r0) < 0;
          bends.push({ innerR: Math.round(innerR * 1000) / 1000, angleDeg: Math.round(((Math.abs(phi) * 180) / Math.PI) * 100) / 100, length: Math.round((lowHigh(ext)[1] - lowHigh(ext)[0]) * 100) / 100, inner, up: inner !== flip });
          queue.push(j);
          continue;
        }
        if (F.surf.kind === "cyl" && G.surf.kind === "plane") {
          // the flat face after a bend: turned back about the axis, moved on by the strip
          const m = cyl.get(i)!;
          const phiE = angleOn(m.a, m.d, m.r0, p);
          const g = compose(m.g, compose(move(mul3(m.dir, phiE * m.sgn * m.rn)), rotAbout(m.a, m.d, -phiE)));
          flat.set(j, g);
          queue.push(j);
          continue;
        }
        if (F.surf.kind === "cyl" && G.surf.kind === "cyl") {
          const m = cyl.get(i)!;
          const same = Math.abs(G.surf.r - len3(m.r0)) < 1e-3 && Math.abs(Math.abs(dot3(G.surf.d, m.d)) - 1) < 1e-6 && len3(sub3(sub3(G.surf.a, m.a), mul3(m.d, dot3(sub3(G.surf.a, m.a), m.d)))) < 1e-3;
          if (same) { cyl.set(j, m); queue.push(j); }
          else problems.push("Two different bends meet without a flat face between them: not unfolded");
        }
      }
    }
  }
  stats.skin = flat.size + cyl.size;
  stats.planes = flat.size;
  stats.cylinders = cyl.size;

  // the flat pattern's frame: the base face, its longest straight edge along X, seen from outside
  const B = faces[base];
  // seen from outside the unfolded side, or (flip) from the other side: the flat pattern mirrored
  const nb = mul3(normalAt(B, [0, 0, 0])!, flip ? -1 : 1);
  let u: V3 = B.surf.kind === "plane" ? B.surf.x : [1, 0, 0], best = 0;
  for (const l of B.loops) for (const e of l.edges) if (e.line) { const v = sub3(e.pts[e.pts.length - 1], e.pts[0]); if (len3(v) > best) { best = len3(v); u = unit3(v); } }
  const v = cross3(nb, u);
  const o = B.loops[0].edges[0].pts[0];
  const to2 = (q: V3): V2 => { const w = sub3(q, o); return [dot3(w, u), dot3(w, v)]; };

  // the skin's edges: the ones only one skin face has are the outline
  const skin = (k: number) => flat.has(k) || cyl.has(k);
  const outline: FlatEdge[] = [];
  const mapPt = (k: number, p: V3): V3 => (flat.has(k) ? app(flat.get(k)!, p) : cylPt(cyl.get(k)!, p));
  faces.forEach((f, k) => {
    if (!skin(k)) return;
    for (const l of f.loops) for (const e of l.edges) {
      const users = (byEdge.get(e.id) ?? []).filter(skin);
      if (users.length > 1) continue;
      const pts = e.pts.map((p) => to2(mapPt(k, p)));
      let arc: FlatEdge["arc"];
      if (e.arc && flat.has(k)) {
        const g = flat.get(k)!;
        const c = to2(app(g, e.arc.c));
        const z = rot(g, e.arc.z);
        const ccw = dot3(z, nb) > 0;
        const ang = (q: V2) => Math.atan2(q[1] - c[1], q[0] - c[0]);
        const a0 = ang(pts[0]), a1 = ang(pts[pts.length - 1]);
        arc = ccw ? { c, r: e.arc.r, a0, a1 } : { c, r: e.arc.r, a0: a1, a1: a0 };
        if (len3([pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1], 0]) < 1e-6) arc = { c, r: e.arc.r, a0: 0, a1: 2 * Math.PI };
      }
      outline.push({ pts: simplify(pts), ...(arc ? { arc } : {}) });
    }
  });
  // bend lines: each bend's middle, across its width
  const bendLines: [V2, V2][] = [];
  const seenBend = new Set<CylMap>();
  for (const [k, m] of cyl) {
    if (seenBend.has(m)) continue;
    seenBend.add(m);
    const pts = faces[k].loops.flatMap((l) => l.edges.flatMap((x) => x.pts));
    // over every face of this bend (a bend split in two faces)
    for (const [k2, m2] of cyl) if (m2 === m && k2 !== k) pts.push(...faces[k2].loops.flatMap((l) => l.edges.flatMap((x) => x.pts)));
    const ss = pts.map((q) => dot3(sub3(q, m.a), m.d));
    const [s0, s1] = lowHigh(ss);
    const at = (sv: number): V2 => to2(app(m.g, add3(add3(add3(m.a, mul3(m.d, sv)), m.r0), mul3(m.dir, (Math.abs(m.phi) / 2) * m.rn))));
    bendLines.push([at(s0), at(s1)]);
  }
  // closed? count the ends that meet no other end
  const ends: V2[] = outline.flatMap((e) => [e.pts[0], e.pts[e.pts.length - 1]]);
  stats.openEnds = ends.filter((p, i) => !ends.some((q, j) => j !== i && Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.01)).length;
  if (stats.openEnds) problems.push(`The outline does not close (${stats.openEnds} loose ends)`);
  // in the corner: from 0,0
  const xs = outline.flatMap((e) => e.pts.map((p) => p[0])), ys = outline.flatMap((e) => e.pts.map((p) => p[1]));
  const [x0, xh] = lowHigh(xs), [y0, yh] = lowHigh(ys);
  const sh = (p: V2): V2 => [p[0] - x0, p[1] - y0];
  for (const e of outline) { e.pts = e.pts.map(sh); if (e.arc) e.arc.c = sh(e.arc.c); }
  const bl = bendLines.map(([a, b]) => [sh(a), sh(b)] as [V2, V2]);
  const box = { x0: 0, y0: 0, x1: xh - x0, y1: yh - y0 };
  if (stats.other) problems.push(`${stats.other} faces of a kind not unfolded (side faces of reliefs and corners are fine)`);
  return { thickness: t, kFactor, bends, outline, bendLines: bl, box, stats, problems, skinFaces: faces.map((_, k) => k).filter(skin) };
}

/** Points in line taken out. */
function simplify(pts: V2[]): V2[] {
  if (pts.length < 3) return pts;
  const out: V2[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1], b = pts[i], c = pts[i + 1];
    const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(cr) > 1e-6 * Math.hypot(c[0] - a[0], c[1] - a[1])) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/**
 * Bend marks: short lines on each bend line, `len` long from `inset` in from both ends (a short bend:
 * one line between the insets). Only the bends coming up (traced on the top side), unless `all`.
 */
export function bendMarks(u: Unfolded, len = 20, inset = 2, all = false): [V2, V2][] {
  const out: [V2, V2][] = [];
  u.bendLines.forEach(([a, b], i) => {
    if (!all && !u.bends[i]?.up) return;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L <= 2 * inset + 0.1) return;
    const d: V2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    const at = (t: number): V2 => [a[0] + d[0] * t, a[1] + d[1] * t];
    if (L <= 2 * (inset + len)) { out.push([at(inset), at(L - inset)]); return; }
    out.push([at(inset), at(inset + len)], [at(L - inset - len), at(L - inset)]);
  });
  return out;
}

/** The flat pattern as DXF (R12): outline on layer 0 (lines, arcs, circles); bend marks on BEND_MARK
 *  (traced); the bends' whole lines on BEND (for a drawing, not for cutting) unless left out. */
export function flatDxf(u: Unfolded, o: { marks?: [V2, V2][]; bendLines?: boolean; texts?: V2[][] } = {}): string {
  const out: string[] = ["0", "SECTION", "2", "ENTITIES"];
  const n = (v: number) => (Math.round(v * 1e6) / 1e6).toString();
  const line = (a: V2, b: V2, layer: string) => out.push("0", "LINE", "8", layer, "10", n(a[0]), "20", n(a[1]), "30", "0", "11", n(b[0]), "21", n(b[1]), "31", "0");
  for (const e of u.outline) {
    if (e.arc) {
      const { c, r, a0, a1 } = e.arc;
      if (a1 - a0 >= 2 * Math.PI - 1e-9) out.push("0", "CIRCLE", "8", "0", "10", n(c[0]), "20", n(c[1]), "30", "0", "40", n(r));
      else out.push("0", "ARC", "8", "0", "10", n(c[0]), "20", n(c[1]), "30", "0", "40", n(r), "50", n((a0 * 180) / Math.PI), "51", n((a1 * 180) / Math.PI));
      continue;
    }
    for (let i = 1; i < e.pts.length; i++) line(e.pts[i - 1], e.pts[i], "0");
  }
  for (const [a, b] of o.marks ?? []) line(a, b, "BEND_MARK");
  // engraved labels (single-line text) on BEND_TEXT
  for (const run of o.texts ?? []) for (let i = 1; i < run.length; i++) line(run[i - 1], run[i], "BEND_TEXT");
  if (o.bendLines !== false) for (const [a, b] of u.bendLines) line(a, b, "BEND");
  out.push("0", "ENDSEC", "0", "EOF");
  return out.join("\r\n") + "\r\n";
}

// ------------------------------------------------------------------ stitched faces (surfaces, sharp corners)

export interface StitchOptions {
  /** the flat pattern seen from the other side of the faces */
  flip?: boolean;
  /** bend compensation: the faces are the sheet's top or bottom side (none: laid flat as they are) */
  comp?: { side: "none" | "top" | "bottom"; t: number; r: number; k: number };
}

/**
 * Flat faces picked one by one, laid flat across the edges they share (sharp corners: a surface model, or
 * one side of a part drawn without bend radii). The first face stays; each next one turns about the edge
 * it shares with a face laid already. With compensation each bend gets its allowance less its setbacks
 * (the faces are the sheet's top or bottom side, thickness t, inner radius r, K-factor k).
 */
export function stitch(s: Solid, picked: number[], o: StitchOptions = {}): Unfolded {
  const faces = s.faces;
  const comp = o.comp && o.comp.side !== "none" && o.comp.t > 0 ? o.comp : null;
  const problems: string[] = [];
  const sel = picked.filter((i, k) => faces[i]?.surf.kind === "plane" && picked.indexOf(i) === k);
  if (sel.length < picked.length) problems.push("Only flat faces are stitched");
  const stats = { faces: faces.length, skin: 0, planes: 0, cylinders: 0, other: 0, openEnds: 0 };
  const empty = (msg: string): Unfolded => ({ thickness: comp?.t ?? null, kFactor: comp?.k ?? 0, bends: [], outline: [], bendLines: [], box: { x0: 0, y0: 0, x1: 0, y1: 0 }, stats, problems: [...problems, msg], skinFaces: [] });
  if (!sel.length) return empty("Click the faces to stitch, one next to the other");
  const byEdge = new Map<number, number[]>();
  sel.forEach((i) => faces[i].loops.forEach((l) => l.edges.forEach((e) => { const u = byEdge.get(e.id) ?? []; if (!u.includes(i)) u.push(i); byEdge.set(e.id, u); })));
  const nOf = (i: number) => { const f = faces[i]; return mul3((f.surf as { n: V3 }).n, f.sense ? 1 : -1); };
  const cOf = (i: number) => { const p = faces[i].loops.flatMap((l) => l.edges.flatMap((e) => e.pts)); return mul3(p.reduce((a, q) => add3(a, q), [0, 0, 0] as V3), 1 / Math.max(1, p.length)); };
  const base = sel[0];
  const flip = !!o.flip;
  const top0 = mul3(nOf(base), flip ? -1 : 1);
  const g = new Map<number, Rigid>([[base, I]]);
  // each face's top side, in the file (from the base: whatever way the shell's faces point)
  const nTop = new Map<number, V3>([[base, top0]]);
  const bends: Bend[] = [];
  const joins: { line: [V3, V3]; gi: Rigid; gj: Rigid; i: number; j: number; shift: V3 }[] = [];
  // the edges faces were laid flat across (bends, or flat joins); other shared edges are seams: cut
  const across = new Set<number>();
  const queue = [base];
  while (queue.length) {
    const i = queue.shift()!;
    for (const l of faces[i].loops) for (const e of l.edges) {
      for (const j of byEdge.get(e.id) ?? []) {
        if (j === i || g.has(j)) continue;
        const a = e.pts[0], b = e.pts[e.pts.length - 1];
        const d = unit3(sub3(b, a));
        if (len3(sub3(b, a)) < 1e-6) continue;
        // into each face from the edge, square to it, in its own plane
        const intoI = unit3((() => { const w = sub3(cOf(i), a); return sub3(w, mul3(d, dot3(w, d))); })());
        const intoJ = unit3((() => { const w = sub3(cOf(j), a); return sub3(w, mul3(d, dot3(w, d))); })());
        // turn j about the edge until it lies in i's plane, on the far side of the edge
        const th = Math.atan2(dot3(d, cross3(intoJ, mul3(intoI, -1))), dot3(intoJ, mul3(intoI, -1)));
        const R = rotAbout(a, d, th);
        // the bend: the angle between the faces' planes, up when j rises toward i's top side
        const topI = nTop.get(i)!;
        const phi = Math.acos(Math.max(-1, Math.min(1, -dot3(intoI, intoJ))));
        const up = dot3(intoJ, topI) > 0;
        // j's top side (as the file has it): the one that lies up once turned
        nTop.set(j, rot(rotAbout(a, d, -th), topI));
        let shift: V3 = [0, 0, 0];
        const L = len3(sub3(b, a));
        if (phi > 0.5 * Math.PI / 180) {
          let innerR = 0;
          if (comp) {
            // the faces on the inner side of this bend: a top-side face bent up, a bottom-side face bent down
            const faceInner = (comp.side === "top") === up;
            const sb = (comp.r + (faceInner ? 0 : comp.t)) * Math.tan(phi / 2);
            const ba = phi * (comp.r + comp.k * comp.t);
            shift = mul3(mul3(intoI, -1), ba - 2 * sb);
            innerR = comp.r;
          }
          bends.push({ innerR, angleDeg: Math.round(((phi * 180) / Math.PI) * 100) / 100, length: Math.round(L * 100) / 100, inner: up, up });
        }
        const gj = compose(g.get(i)!, compose(move(shift), R));
        g.set(j, gj);
        across.add(e.id);
        if (phi > 0.5 * Math.PI / 180) joins.push({ line: [a, b], gi: g.get(i)!, gj, i, j, shift });
        queue.push(j);
      }
    }
  }
  const missing = sel.filter((i) => !g.has(i));
  if (missing.length) problems.push(`${missing.length} picked ${missing.length === 1 ? "face does" : "faces do"} not share an edge with the others: left out`);
  stats.skin = stats.planes = g.size;

  // the frame: the base face, its longest straight edge along X, seen from its top side
  const B = faces[base];
  let u: V3 = (B.surf as { x: V3 }).x, best = 0;
  for (const l of B.loops) for (const e of l.edges) if (e.line) { const v = sub3(e.pts[e.pts.length - 1], e.pts[0]); if (len3(v) > best) { best = len3(v); u = unit3(v); } }
  const v = cross3(top0, u);
  const org = B.loops[0].edges[0].pts[0];
  const to2 = (q: V3): V2 => { const w = sub3(q, org); return [dot3(w, u), dot3(w, v)]; };

  let outline: FlatEdge[] = [];
  for (const [k, gk] of g) for (const l of faces[k].loops) for (const e of l.edges) {
    if (across.has(e.id)) continue;
    const pts = e.pts.map((p) => to2(app(gk, p)));
    let arc: FlatEdge["arc"];
    if (e.arc) {
      const c = to2(app(gk, e.arc.c));
      const ccw = dot3(rot(gk, e.arc.z), top0) > 0;
      const ang = (q: V2) => Math.atan2(q[1] - c[1], q[0] - c[0]);
      const a0 = ang(pts[0]), a1 = ang(pts[pts.length - 1]);
      arc = ccw ? { c, r: e.arc.r, a0, a1 } : { c, r: e.arc.r, a0: a1, a1: a0 };
      if (Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-6) arc = { c, r: e.arc.r, a0: 0, a1: 2 * Math.PI };
    }
    outline.push({ pts: simplify(pts), ...(arc ? { arc } : {}) });
  }
  // compensation moved the faces apart (or over each other): close the ends across each bend
  const bendLines: [V2, V2][] = [];
  for (const jn of joins) {
    const [a, b] = jn.line;
    const ai = to2(app(jn.gi, a)), bi = to2(app(jn.gi, b)), aj = to2(app(jn.gj, a)), bj = to2(app(jn.gj, b));
    if (len3(jn.shift) > 1e-9) outline.push({ pts: [ai, aj] }, { pts: [bi, bj] });
    bendLines.push([[(ai[0] + aj[0]) / 2, (ai[1] + aj[1]) / 2], [(bi[0] + bj[0]) / 2, (bi[1] + bj[1]) / 2]]);
  }
  if (comp && joins.length) outline = cancelBacktracks(outline);
  if (!outline.length) return empty("Nothing to lay flat");
  const ends: V2[] = outline.flatMap((e) => [e.pts[0], e.pts[e.pts.length - 1]]);
  stats.openEnds = ends.filter((p, i) => !ends.some((q, j) => j !== i && Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.01)).length;
  if (stats.openEnds) problems.push(`The outline does not close (${stats.openEnds} loose ends)`);
  const xs = outline.flatMap((e) => e.pts.map((p) => p[0])), ys = outline.flatMap((e) => e.pts.map((p) => p[1]));
  const [x0, xh] = lowHigh(xs), [y0, yh] = lowHigh(ys);
  const sh = (p: V2): V2 => [p[0] - x0, p[1] - y0];
  for (const e of outline) { e.pts = e.pts.map(sh); if (e.arc) e.arc.c = sh(e.arc.c); }
  return {
    thickness: comp?.t ?? null, kFactor: comp?.k ?? 0, bends, outline, bendLines: bendLines.map(([a, b]) => [sh(a), sh(b)] as [V2, V2]),
    box: { x0: 0, y0: 0, x1: xh - x0, y1: yh - y0 }, stats, problems, skinFaces: [...g.keys()], stitched: true,
  };
}

/**
 * Straight edges that run back over each other (faces moved over each other by a negative compensation,
 * and the short line closing the gap) cut back: chained end to end, a line going back over the one
 * before shortens it.
 */
function cancelBacktracks(edges: FlatEdge[]): FlatEdge[] {
  const tol = 1e-4;
  const same = (p: V2, q: V2) => Math.hypot(p[0] - q[0], p[1] - q[1]) < tol;
  const lines = edges.filter((e) => !e.arc && e.pts.length === 2).map((e) => [e.pts[0], e.pts[1]] as [V2, V2]);
  const rest = edges.filter((e) => e.arc || e.pts.length !== 2);
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < lines.length; i++) for (let j = 0; j < lines.length; j++) {
      if (i === j) continue;
      let [a, b] = lines[i], [c, d] = lines[j];
      // orient so that b meets c
      if (same(a, c)) [a, b] = [b, a];
      else if (same(a, d)) { [a, b] = [b, a]; [c, d] = [d, c]; }
      else if (same(b, d)) [c, d] = [d, c];
      if (!same(b, c)) continue;
      const u: V2 = [b[0] - a[0], b[1] - a[1]], w: V2 = [d[0] - c[0], d[1] - c[1]];
      const cr = u[0] * w[1] - u[1] * w[0];
      const lu = Math.hypot(...u), lw = Math.hypot(...w);
      if (Math.abs(cr) > 1e-6 * lu * lw || u[0] * w[0] + u[1] * w[1] >= 0) continue;
      // b -> d goes back toward a: the two become a -> d (or nothing)
      const keep = [i, j].sort((x, y) => y - x);
      for (const k of keep) lines.splice(k, 1);
      if (!same(a, d)) lines.push([a, d]);
      changed = true;
      break outer;
    }
  }
  // a chain of a single line once split by an end that is no longer there: joined again by the next pass
  return [...rest, ...lines.map((l) => ({ pts: [l[0], l[1]] }))];
}
