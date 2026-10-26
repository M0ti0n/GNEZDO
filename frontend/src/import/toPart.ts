import type { SavePart } from "../api/api";
import { buildContours, checkGeometry, endsOf, pointsAlong, roleOf, type Contour, type Drawing, type Entity, type Pt } from "./geometry";

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

/** Entity ids of a chain in order from one end to the other (a loop: around it). */
function orderChain(c: Contour, byId: Map<string, Entity>): string[] {
  const left = [...c.entityIds];
  if (left.length < 2) return left;
  // start at an entity that has a loose end, so the chain is walked end to end
  const startEnd = c.openEnds[0];
  let i = startEnd ? left.findIndex((id) => { const en = endsOf(byId.get(id)!); return !!en && (near(en[0], startEnd) || near(en[1], startEnd)); }) : 0;
  if (i < 0) i = 0;
  const first = left.splice(i, 1)[0];
  const order = [first];
  const fe = endsOf(byId.get(first)!)!;
  let end = startEnd && near(fe[0], startEnd) ? fe[1] : startEnd && near(fe[1], startEnd) ? fe[0] : fe[1];
  while (left.length) {
    const j = left.findIndex((id) => { const en = endsOf(byId.get(id)!); return !!en && (near(en[0], end) || near(en[1], end)); });
    if (j < 0) { order.push(...left); break; }   // a branch: the rest keeps drawing order
    const id = left.splice(j, 1)[0];
    const en = endsOf(byId.get(id)!)!;
    end = near(en[0], end) ? en[1] : en[0];
    order.push(id);
  }
  return order;
}

/**
 * What path generation does with the part's lines. Saved inside Part.Geometry, next to the lines.
 *   cut      closed cutting contour; lead-in / lead-out from the technology table. slow = marked as
 *            a hole: machines and post processors that can, cut it at a slower speed
 *   openCut  connected open cut lines cut in one go, on the inside of the contour; no lead-in and
 *            no lead-out: piercing is exactly at one end of the chain. Which end, and the direction,
 *            is decided by the cut order rules when the part is placed on a sheet.
 *   engrave  tracing: a separate operation (engraving), not cut through; order and direction are
 *            chosen by path generation for the shortest travel.
 */
export type Operation =
  | { op: "cut"; entityIds: string[]; outer: boolean; slow: boolean }
  | { op: "openCut"; entityIds: string[]; closed: boolean; ends: Pt[]; leadInMm: 0; leadOutMm: 0; start: "cutOrder" }
  | { op: "engrave"; entityIds: string[] };

/** Saved geometry of a part (Part.Geometry, JSON). Version 1 was the bare entity list. */
export interface PartGeometryJson {
  format: "gnezdo-part";
  version: 2;
  units: "mm";
  entities: Entity[];
  operations: Operation[];
}

export function operationsOf(entities: Entity[]): Operation[] {
  const byId = new Map(entities.map((e) => [e.id, e]));
  const of = (role: string) => buildContours(entities.filter((e) => roleOf(e) === role));
  const ops: Operation[] = [];
  // cutting contours come from the geometry check, which also finds the outside contour
  for (const c of checkGeometry(entities).contours) if (c.closed) ops.push({ op: "cut", entityIds: orderChain(c, byId), outer: c.outer, slow: c.entityIds.some((id) => byId.get(id)?.slow) });
  for (const c of of("openCut")) {
    ops.push({ op: "openCut", entityIds: orderChain(c, byId), closed: c.closed, ends: c.openEnds, leadInMm: 0, leadOutMm: 0, start: "cutOrder" });
  }
  for (const c of of("trace")) ops.push({ op: "engrave", entityIds: orderChain(c, byId) });
  return ops;
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
    geometry: JSON.stringify(geometryJson(d)),
  };
}

export function geometryJson(d: Drawing): PartGeometryJson {
  const entities = d.entities.map((e) => ({ ...e, role: roleOf(e) }));
  return { format: "gnezdo-part", version: 2, units: "mm", entities, operations: operationsOf(entities) };
}
