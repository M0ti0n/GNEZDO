// Splines into polylines (Geometry check → Splines → To polyline): a spline becomes lines and arcs that
// follow it as it is drawn, within a tolerance (Settings → Rules → Import rules; default 0.01 mm), each
// keeping the spline's role and the rest of its marks.
// Lines and arcs can be trimmed, extended, measured and cut cleanly; a spline cannot.

import { circleThrough, fitPoints, type P2 } from "./fittings/arcs";
import { splinePoints, type Entity } from "./geometry";
import { SPLINE_TOL_DEFAULT } from "./rules";

const norm = (x: number) => ((x % 360) + 360) % 360;

/** The lines and arcs for one spline (ids from the spline's: id~1, id~2, …). */
export function splineToPolyline(e: Extract<Entity, { kind: "spline" }>, tol = SPLINE_TOL_DEFAULT): Entity[] {
  const { id, kind: _k, fit: _f, sampled: _s, ...marks } = e;
  const pts = splinePoints(e).map((q): P2 => [q.x, q.y]);
  // without repeated points (a zero-length piece fits nothing)
  const clean = pts.filter((q, i) => i === 0 || Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1]) > 1e-9);
  if (clean.length < 2) return [];
  const out: Entity[] = [];
  let n = 0;
  for (const s of fitPoints(clean, tol)) {
    const a = { x: s.a[0], y: s.a[1] }, b = { x: s.b[0], y: s.b[1] };
    const ci = s.m && circleThrough(s.a, s.m, s.b);
    if (!s.m || !ci) {
      if (Math.hypot(b.x - a.x, b.y - a.y) > 1e-9) out.push({ ...marks, id: `${id}~${++n}`, kind: "line", a, b });
      continue;
    }
    const deg = (q: P2) => (Math.atan2(q[1] - ci.c[1], q[0] - ci.c[0]) * 180) / Math.PI;
    // counterclockwise from start to end: a -> m -> b turning left runs from a, else from b
    const left = (s.m[0] - s.a[0]) * (s.b[1] - s.m[1]) - (s.m[1] - s.a[1]) * (s.b[0] - s.m[0]) > 0;
    out.push({ ...marks, id: `${id}~${++n}`, kind: "arc", c: { x: ci.c[0], y: ci.c[1] }, r: ci.r,
      start: norm(deg(left ? s.a : s.b)), end: norm(deg(left ? s.b : s.a)) });
  }
  return out;
}

/** The drawing's splines (those in `ids`, or all) as polylines within tol [mm]; how many were changed. */
export function splinesToPolylines(entities: Entity[], ids?: Set<string>, tol = SPLINE_TOL_DEFAULT): { entities: Entity[]; changed: number } {
  let changed = 0;
  const out = entities.flatMap((e) => {
    if (e.kind !== "spline" || (ids && !ids.has(e.id))) return [e];
    const made = splineToPolyline(e, tol);
    if (!made.length) return [e];
    changed++;
    return made;
  });
  return { entities: out, changed };
}
