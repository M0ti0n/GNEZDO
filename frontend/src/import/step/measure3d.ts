// Measuring the 3D part (3D Extractor -> MEASURE 3D): what was clicked (a corner, a straight edge, a
// circle edge, a flat face, a round face) and what lies between two of them: the offset of parallel
// faces, hole sizes and the distance between holes (their axes), distances to a face, angles.

import { add3, cross3, dot3, len3, lowHigh, mul3, normalAt, sub3, unit3, type Face, type Solid, type V3 } from "./step";

export type MPick =
  | { kind: "point"; face: number; p: V3; what: "corner" | "center" }
  | { kind: "line"; face: number; edge: number; a: V3; b: V3 }
  | { kind: "circle"; face: number; edge: number; c: V3; z: V3; r: number; full: boolean }
  | { kind: "plane"; face: number; o: V3; n: V3 }
  | { kind: "cyl"; face: number; c: V3; d: V3; r: number };

const f2 = (v: number) => (Math.round(v * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
const deg = (rad: number) => `${f2((rad * 180) / Math.PI)}°`;
const facePts = (f: Face) => f.loops.flatMap((l) => l.edges.flatMap((e) => e.pts));
const centroid = (pts: V3[]) => mul3(pts.reduce((s, p) => add3(s, p), [0, 0, 0] as V3), 1 / Math.max(1, pts.length));

/** A face as something to measure: flat (its plane, through its middle) or round (its axis and radius). */
export function facePick(s: Solid, i: number): MPick | null {
  const f = s.faces[i];
  const pts = facePts(f);
  if (!pts.length) return null;
  if (f.surf.kind === "plane") {
    const c = centroid(pts);
    return { kind: "plane", face: i, o: c, n: normalAt(f, c)! };
  }
  if (f.surf.kind === "cyl") {
    const { a, d, r } = f.surf;
    const ts = pts.map((p) => dot3(sub3(p, a), d));
    const [t0, t1] = lowHigh(ts);
    const c = add3(a, mul3(d, (t0 + t1) / 2));
    return { kind: "cyl", face: i, c, d: unit3(d), r };
  }
  return null;
}

/** An edge as something to measure: a circle (arc) or a straight line between its ends. */
export function edgePick(s: Solid, face: number, edge: number): MPick | null {
  const e = s.faces[face].loops.flatMap((l) => l.edges).find((x) => x.id === edge);
  if (!e) return null;
  const a = e.pts[0], b = e.pts[e.pts.length - 1];
  if (e.arc) return { kind: "circle", face, edge, c: e.arc.c, z: unit3(e.arc.z), r: e.arc.r, full: len3(sub3(a, b)) < 1e-6 };
  return { kind: "line", face, edge, a, b };
}

/** The point it stands for (a distance between two picks is measured between these). */
export const refPoint = (m: MPick): V3 =>
  m.kind === "point" ? m.p : m.kind === "line" ? mul3(add3(m.a, m.b), 0.5) : m.kind === "plane" ? m.o : m.c;

/** What one pick is. */
export function describe(m: MPick): { title: string; lines: string[] } {
  switch (m.kind) {
    case "point": return { title: m.what === "center" ? "Center" : "Corner", lines: [`X ${f2(m.p[0])}  Y ${f2(m.p[1])}  Z ${f2(m.p[2])}`] };
    case "line": return { title: "Straight edge", lines: [`Length ${f2(len3(sub3(m.b, m.a)))}`] };
    case "circle": return { title: m.full ? "Circle (hole / round edge)" : "Arc", lines: [`Ø ${f2(2 * m.r)}  (R ${f2(m.r)})`, ...(m.full ? [] : [`Center X ${f2(m.c[0])}  Y ${f2(m.c[1])}  Z ${f2(m.c[2])}`])] };
    case "plane": return { title: "Flat face", lines: [] };
    case "cyl": return { title: "Round face (hole / bend)", lines: [`Ø ${f2(2 * m.r)}  (R ${f2(m.r)})`] };
  }
}

/** The direction of an axis-like pick (a hole's axis, a circle's normal, an edge), else null. */
const axisOf = (m: MPick): V3 | null =>
  m.kind === "cyl" ? m.d : m.kind === "circle" ? m.z : m.kind === "line" ? unit3(sub3(m.b, m.a)) : null;
const roundish = (m: MPick) => m.kind === "cyl" || m.kind === "circle";
const PAR = 1 - 1e-6;

/** What lies between two picks. */
export function relate(a: MPick, b: MPick): string[] {
  const out: string[] = [];
  const pa = refPoint(a), pb = refPoint(b);
  const dv = sub3(pb, pa);
  const delta = `ΔX ${f2(Math.abs(dv[0]))}  ΔY ${f2(Math.abs(dv[1]))}  ΔZ ${f2(Math.abs(dv[2]))}`;
  // two flat faces: parallel -> their offset; else the angle between them
  if (a.kind === "plane" && b.kind === "plane") {
    const c = dot3(a.n, b.n);
    if (Math.abs(c) > PAR) {
      out.push(`Offset between the faces: ${f2(Math.abs(dot3(dv, a.n)))}`);
      out.push(c < 0 ? "Faces facing each other or away (a thickness, a slot, a gap)" : "Faces facing the same way (a step)");
    } else {
      const th = Math.acos(Math.max(-1, Math.min(1, c)));
      out.push(`Angle between the faces: ${deg(Math.PI - th)} (normals ${deg(th)})`);
    }
    return out;
  }
  // a flat face and something else: its distance from the face (or the angle to it)
  if (a.kind === "plane" || b.kind === "plane") {
    const pl = (a.kind === "plane" ? a : b) as Extract<MPick, { kind: "plane" }>;
    const o = a.kind === "plane" ? b : a;
    const ax = axisOf(o);
    const along = ax && (o.kind === "circle" ? Math.abs(dot3(ax, pl.n)) > PAR : Math.abs(dot3(ax, pl.n)) < 1e-6);
    if (o.kind === "point" || along || (o.kind === "circle")) {
      const what = o.kind === "point" ? "Point" : o.kind === "line" ? "Edge" : o.kind === "cyl" ? "Axis" : "Center";
      out.push(`${what} to the face: ${f2(Math.abs(dot3(sub3(refPoint(o), pl.o), pl.n)))}`);
    }
    if (ax && o.kind !== "circle" && !along) out.push(`Angle to the face: ${deg(Math.asin(Math.min(1, Math.abs(dot3(ax, pl.n)))))}`);
    if (roundish(o)) out.push(`Ø ${f2(2 * (o as { r: number }).r)}`);
    return out;
  }
  // two holes / circles: centre to centre, and axis to axis when their axes are parallel
  if (roundish(a) && roundish(b)) {
    const da = axisOf(a)!, db = axisOf(b)!;
    out.push(`Ø ${f2(2 * (a as { r: number }).r)}  ·  Ø ${f2(2 * (b as { r: number }).r)}`);
    if (Math.abs(dot3(da, db)) > PAR) {
      const across = sub3(dv, mul3(da, dot3(dv, da)));
      out.push(len3(across) < 0.005 ? "On the same axis (coaxial)" : `Axis to axis: ${f2(len3(across))}`);
      if (Math.abs(dot3(dv, da)) > 1e-3) out.push(`Along the axes: ${f2(Math.abs(dot3(dv, da)))}`);
      const gap = len3(across) - (a as { r: number }).r - (b as { r: number }).r;
      if (gap > 0) out.push(`Wall between them: ${f2(gap)}`);
    } else {
      out.push(`Center to center: ${f2(len3(dv))}`, `Angle between the axes: ${deg(Math.acos(Math.min(1, Math.abs(dot3(da, db)))))}`);
    }
    out.push(delta);
    return out;
  }
  // two straight edges: parallel -> the distance between them; else their angle
  if (a.kind === "line" && b.kind === "line") {
    const da = axisOf(a)!, db = axisOf(b)!;
    if (Math.abs(dot3(da, db)) > PAR) {
      const w = sub3(b.a, a.a);
      out.push(`Distance between the edges: ${f2(len3(sub3(w, mul3(da, dot3(w, da)))))}`);
    } else {
      const th = Math.acos(Math.min(1, Math.abs(dot3(da, db))));
      out.push(`Angle between the edges: ${deg(th)}`);
      const n = cross3(da, db);
      if (len3(n) > 1e-9 && Math.abs(dot3(sub3(b.a, a.a), unit3(n))) > 1e-3) out.push(`Shortest distance (skew): ${f2(Math.abs(dot3(sub3(b.a, a.a), unit3(n))))}`);
    }
    return out;
  }
  // a hole and an edge or a point: from its axis (when parallel) or its center
  if (roundish(a) || roundish(b)) {
    const h = roundish(a) ? a : b, o = roundish(a) ? b : a;
    const ax = axisOf(h)!;
    if (o.kind === "line" && Math.abs(dot3(ax, axisOf(o)!)) > PAR) {
      const w = sub3(o.a, refPoint(h));
      out.push(`Axis to edge: ${f2(len3(sub3(w, mul3(ax, dot3(w, ax)))))}`);
    } else if (o.kind === "line") {
      // the center to the edge's line
      const d = axisOf(o)!, w = sub3(refPoint(h), o.a);
      out.push(`Center to the edge: ${f2(len3(sub3(w, mul3(d, dot3(w, d)))))}`);
    } else {
      const w = sub3(refPoint(o), refPoint(h));
      out.push(`Axis to point: ${f2(len3(sub3(w, mul3(ax, dot3(w, ax)))))}`);
    }
    out.push(`Ø ${f2(2 * (h as { r: number }).r)}`, delta);
    return out;
  }
  // a point and an edge: to the edge's line
  if ((a.kind === "line" && b.kind === "point") || (a.kind === "point" && b.kind === "line")) {
    const l = (a.kind === "line" ? a : b) as Extract<MPick, { kind: "line" }>, p = refPoint(a.kind === "line" ? b : a);
    const d = axisOf(l)!, w = sub3(p, l.a);
    out.push(`Point to the edge: ${f2(len3(sub3(w, mul3(d, dot3(w, d)))))}`);
    return out;
  }
  out.push(`Distance: ${f2(len3(dv))}`, delta);
  return out;
}
