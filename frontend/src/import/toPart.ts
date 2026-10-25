import type { SavePart } from "../api/api";
import { checkGeometry, endsOf, pointsAlong, roleOf, type Contour, type Drawing, type Entity, type Pt } from "./geometry";

const TOL = 0.01;
const near = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y) <= TOL;

/** Points of a closed contour in order around it (entities may be drawn in any direction). */
export function loopPoints(c: Contour, byId: Map<string, Entity>): Pt[] {
  const left = c.entityIds.map((id) => byId.get(id)!);
  const first = left.shift()!;
  const pts = pointsAlong(first);
  if (first.kind === "circle") return pts;
  while (left.length) {
    const end = pts[pts.length - 1];
    const i = left.findIndex((e) => { const ends = endsOf(e); return !!ends && (near(ends[0], end) || near(ends[1], end)); });
    if (i < 0) break;
    const e = left.splice(i, 1)[0];
    const p = pointsAlong(e);
    if (!near(p[0], end)) p.reverse();
    pts.push(...p.slice(1));
  }
  return pts;
}

const shoelace = (p: Pt[]) => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a.x * b.y - b.x * a.y; }, 0)) / 2;

/** Library fields of a checked drawing: size, net area, outline for thumbnails, geometry. */
export function partGeometry(d: Drawing): Pick<SavePart, "widthMm" | "heightMm" | "areaMm2" | "outlinePath" | "engraved" | "geometry"> {
  const report = checkGeometry(d.entities);
  const byId = new Map(d.entities.map((e) => [e.id, e]));
  const loops = report.contours.filter((c) => c.closed).map((c) => ({ c, pts: loopPoints(c, byId) }));
  const outer = loops.find((l) => l.c.outer);
  const box = outer?.c.box ?? report.box;
  const area = outer ? shoelace(outer.pts) - loops.filter((l) => !l.c.outer).reduce((s, l) => s + shoelace(l.pts), 0) : 0;

  // thumbnails: y down, origin at the top-left corner of the part
  const f = (n: number) => +n.toFixed(2);
  const outlinePath = loops
    .map((l) => l.pts.map((p, i) => `${i ? "L" : "M"}${f(p.x - box.minX)} ${f(box.maxY - p.y)}`).join("") + "Z")
    .join(" ");

  return {
    widthMm: f(box.maxX - box.minX),
    heightMm: f(box.maxY - box.minY),
    areaMm2: Math.round(area),
    outlinePath,
    engraved: d.entities.some((e) => roleOf(e) === "trace"),
    geometry: JSON.stringify(d.entities.map((e) => ({ ...e, role: roleOf(e) }))),
  };
}
