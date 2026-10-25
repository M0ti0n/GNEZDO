// Drawing entities of an imported DXF/DWG, in millimetres, y up (as in the CAD file),
// and the geometry check that runs on them.

export interface Pt { x: number; y: number }

/**
 * What the laser does with a line:
 *   cut     - normal cutting contour, must be closed
 *   trace   - tracing / engraving (marking), may be open
 *   openCut - cut on purpose without closing (slits, reliefs)
 */
export type Role = "cut" | "trace" | "openCut";

export type Entity = (
  | { id: string; kind: "line"; a: Pt; b: Pt }
  /** Counter-clockwise from start to end angle, degrees (DXF convention). */
  | { id: string; kind: "arc"; c: Pt; r: number; start: number; end: number }
  | { id: string; kind: "circle"; c: Pt; r: number }
  /** Drawn through its fit points; "sampled" = points already on the curve, joined by straight lines. */
  | { id: string; kind: "spline"; fit: Pt[]; sampled?: boolean }
) & {
  role?: Role;     // missing = cut
  layer?: string;
  color?: number;  // AutoCAD colour index, resolved (no BYLAYER / BYBLOCK): 1 red, 3 green, 4 cyan, 7 black/white
};

export const roleOf = (e: Entity): Role => e.role ?? "cut";

export interface Drawing {
  id: string;
  fileName: string;        // without extension, e.g. "1625-25-01_P1_3kos"
  entities: Entity[];
}

export interface Box { minX: number; minY: number; maxX: number; maxY: number }

/** Closed loops and open chains found by joining entities end to end. */
export interface Contour {
  entityIds: string[];
  closed: boolean;
  openEnds: Pt[];          // loose end points of an open chain
  box: Box;
  outer: boolean;          // the largest contour is the outside of the part
}

export type CheckId = "insideOpen" | "outsideOpen" | "outsidePart" | "splines";

export interface CheckResult {
  id: CheckId;
  label: string;
  count: number;           // 0 = passed
  entityIds: string[];     // what to highlight when the check is selected
  points: Pt[];            // open ends to mark
}

export interface GeometryReport {
  contours: Contour[];     // cutting contours (role cut)
  traceCount: number;      // tracing lines
  openCutCount: number;    // open cut lines
  checks: CheckResult[];
  box: Box;
}

/** Two end points closer than this are joined. */
export const JOIN_TOLERANCE_MM = 0.01;

const rad = (deg: number) => (deg * Math.PI) / 180;
const onCircle = (c: Pt, r: number, deg: number): Pt => ({ x: c.x + r * Math.cos(rad(deg)), y: c.y + r * Math.sin(rad(deg)) });
/** Arc sweep in degrees, 0 < sweep <= 360. */
export const arcSweep = (start: number, end: number) => { const s = (((end - start) % 360) + 360) % 360; return s === 0 ? 360 : s; };

/** Start and end point; circles have none. */
export function endsOf(e: Entity): [Pt, Pt] | null {
  switch (e.kind) {
    case "line": return [e.a, e.b];
    case "arc": return [onCircle(e.c, e.r, e.start), onCircle(e.c, e.r, e.end)];
    case "spline": return [e.fit[0], e.fit[e.fit.length - 1]];
    case "circle": return null;
  }
}

export const emptyBox = (): Box => ({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
const grow = (b: Box, p: Pt) => {
  b.minX = Math.min(b.minX, p.x); b.minY = Math.min(b.minY, p.y);
  b.maxX = Math.max(b.maxX, p.x); b.maxY = Math.max(b.maxY, p.y);
};
export const union = (a: Box, b: Box): Box => ({
  minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY),
  maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY),
});

export function boxOf(e: Entity): Box {
  const b = emptyBox();
  switch (e.kind) {
    case "line": grow(b, e.a); grow(b, e.b); break;
    case "circle": grow(b, { x: e.c.x - e.r, y: e.c.y - e.r }); grow(b, { x: e.c.x + e.r, y: e.c.y + e.r }); break;
    case "spline": e.fit.forEach((p) => grow(b, p)); break;
    case "arc": {
      const sweep = arcSweep(e.start, e.end);
      grow(b, onCircle(e.c, e.r, e.start)); grow(b, onCircle(e.c, e.r, e.end));
      // quadrant points the arc passes through
      for (let q = 0; q < 360; q += 90) if (arcSweep(e.start, q) < sweep) grow(b, onCircle(e.c, e.r, q));
      break;
    }
  }
  return b;
}

/** SVG path data in drawing coordinates (y up); the canvas flips y. */
export function pathOf(e: Entity): string {
  const f = (n: number) => +n.toFixed(4);
  switch (e.kind) {
    case "line": return `M${f(e.a.x)} ${f(e.a.y)}L${f(e.b.x)} ${f(e.b.y)}`;
    case "circle":
      return `M${f(e.c.x - e.r)} ${f(e.c.y)}A${f(e.r)} ${f(e.r)} 0 1 1 ${f(e.c.x + e.r)} ${f(e.c.y)}` +
        `A${f(e.r)} ${f(e.r)} 0 1 1 ${f(e.c.x - e.r)} ${f(e.c.y)}`;
    case "arc": {
      const [a, b] = endsOf(e)!;
      const sweep = arcSweep(e.start, e.end);
      if (sweep >= 359.999) return pathOf({ id: e.id, kind: "circle", c: e.c, r: e.r });
      return `M${f(a.x)} ${f(a.y)}A${f(e.r)} ${f(e.r)} 0 ${sweep > 180 ? 1 : 0} 1 ${f(b.x)} ${f(b.y)}`;
    }
    case "spline": {
      if (e.sampled) return e.fit.map((p, i) => `${i ? "L" : "M"}${f(p.x)} ${f(p.y)}`).join("");
      // Catmull-Rom through the fit points, as cubic Béziers
      const p = e.fit;
      let d = `M${f(p[0].x)} ${f(p[0].y)}`;
      for (let i = 0; i < p.length - 1; i++) {
        const p0 = p[Math.max(i - 1, 0)], p1 = p[i], p2 = p[i + 1], p3 = p[Math.min(i + 2, p.length - 1)];
        d += `C${f(p1.x + (p2.x - p0.x) / 6)} ${f(p1.y + (p2.y - p0.y) / 6)} ` +
          `${f(p2.x - (p3.x - p1.x) / 6)} ${f(p2.y - (p3.y - p1.y) / 6)} ${f(p2.x)} ${f(p2.y)}`;
      }
      return d;
    }
  }
}

/** Joins entities whose end points meet into contours (closed loops or open chains). */
export function buildContours(entities: Entity[]): Contour[] {
  // Cluster end points: each cluster is a node, each entity an edge between two nodes.
  const nodes: Pt[] = [];
  const nodeOf = (p: Pt) => {
    const i = nodes.findIndex((n) => Math.hypot(n.x - p.x, n.y - p.y) <= JOIN_TOLERANCE_MM);
    if (i >= 0) return i;
    nodes.push(p);
    return nodes.length - 1;
  };
  const edges = entities.map((e) => {
    const ends = endsOf(e);
    return ends ? [nodeOf(ends[0]), nodeOf(ends[1])] as const : null;
  });

  const degree = new Array<number>(nodes.length).fill(0);
  edges.forEach((ed) => { if (ed) { degree[ed[0]]++; degree[ed[1]]++; } });

  // Union-find over nodes to get the connected chains.
  const parent = nodes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  edges.forEach((ed) => { if (ed) parent[find(ed[0])] = find(ed[1]); });

  const groups = new Map<number, number[]>();
  const contours: Contour[] = [];
  entities.forEach((e, i) => {
    const ed = edges[i];
    if (!ed) { // a full circle is a closed contour on its own
      contours.push({ entityIds: [e.id], closed: true, openEnds: [], box: boxOf(e), outer: false });
      return;
    }
    const root = find(ed[0]);
    groups.set(root, [...(groups.get(root) ?? []), i]);
  });
  for (const idx of groups.values()) {
    const nodeIds = new Set(idx.flatMap((i) => [...edges[i]!]));
    const loose = [...nodeIds].filter((n) => degree[n] !== 2);
    contours.push({
      entityIds: idx.map((i) => entities[i].id),
      closed: loose.length === 0,
      openEnds: loose.filter((n) => degree[n] === 1).map((n) => nodes[n]),
      box: idx.map((i) => boxOf(entities[i])).reduce(union),
      outer: false,
    });
  }

  return contours;
}

/**
 * Runs the checks. Only cutting lines must form closed contours; tracing and
 * open cut lines are left open on purpose and are joined separately, so a slit
 * that touches the outside does not count as a branch of it.
 */
export function checkGeometry(entities: Entity[]): GeometryReport {
  const contours = buildContours(entities.filter((e) => roleOf(e) === "cut"));
  const area = (b: Box) => (b.maxX - b.minX) * (b.maxY - b.minY);
  const outer = contours.reduce<Contour | null>((best, c) => (!best || area(c.box) > area(best.box) ? c : best), null);
  if (outer) outer.outer = true;

  const openInside = contours.filter((c) => !c.outer && !c.closed);
  const openOutside = contours.filter((c) => c.outer && !c.closed);
  const splines = entities.filter((e) => e.kind === "spline");
  const outsidePart = marksOutsidePart(entities, contours);

  const checks: CheckResult[] = [
    {
      id: "insideOpen", label: "Inside contour open", count: openInside.length,
      entityIds: openInside.flatMap((c) => c.entityIds), points: openInside.flatMap((c) => c.openEnds),
    },
    {
      id: "outsideOpen", label: "Outside contour open", count: openOutside.length,
      entityIds: openOutside.flatMap((c) => c.entityIds), points: openOutside.flatMap((c) => c.openEnds),
    },
    {
      id: "outsidePart", label: "Tracing or open cut outside part", count: outsidePart.length,
      entityIds: outsidePart.flat(), points: [],
    },
    { id: "splines", label: "Splines", count: splines.length, entityIds: splines.map((e) => e.id), points: [] },
  ];

  return {
    contours,
    checks,
    traceCount: entities.filter((e) => roleOf(e) === "trace").length,
    openCutCount: entities.filter((e) => roleOf(e) === "openCut").length,
    box: entities.length ? entities.map(boxOf).reduce(union) : { minX: 0, minY: 0, maxX: 100, maxY: 100 },
  };
}

/** "1625-25-01_P1_3kos" -> 3: the last number before the extension is the quantity. */
export function quantityFromName(fileName: string): number | null {
  const m = fileName.replace(/\.(dxf|dwg)$/i, "").match(/(\d+)\D*$/);
  return m ? Number(m[1]) : null;
}

/** Ids of every entity joined end to end with the given one (the whole chain or loop). */
export function chainOf(entities: Entity[], id: string): string[] {
  return buildContours(entities).find((c) => c.entityIds.includes(id))?.entityIds ?? [id];
}

/* ---- Where tracing and open cut lines may be ----------------------------------------- */

/** Points along an entity, close enough together to follow arcs and splines. */
export function pointsAlong(e: Entity, arcStepDeg = 7.5): Pt[] {
  const on = (c: Pt, r: number, d: number): Pt => ({ x: c.x + r * Math.cos(rad(d)), y: c.y + r * Math.sin(rad(d)) });
  switch (e.kind) {
    case "line": return Array.from({ length: 9 }, (_, i) => ({ x: e.a.x + ((e.b.x - e.a.x) * i) / 8, y: e.a.y + ((e.b.y - e.a.y) * i) / 8 }));
    case "circle": return Array.from({ length: 49 }, (_, i) => on(e.c, e.r, i * 7.5));
    case "arc": {
      const sweep = arcSweep(e.start, e.end);
      const n = Math.max(2, Math.ceil(sweep / arcStepDeg));
      return Array.from({ length: n + 1 }, (_, i) => on(e.c, e.r, e.start + (sweep * i) / n));
    }
    case "spline": return e.fit;
  }
}

type Seg = [Pt, Pt];
const segmentsOf = (c: Contour, byId: Map<string, Entity>): Seg[] =>
  c.entityIds.flatMap((id) => {
    const p = pointsAlong(byId.get(id)!);
    return p.slice(1).map((q, i): Seg => [p[i], q]);
  });

/** Even-odd test; segment order does not matter. */
const inside = (p: Pt, segs: Seg[]) => {
  let n = 0;
  for (const [a, b] of segs)
    if ((a.y > p.y) !== (b.y > p.y) && p.x < a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y)) n++;
  return n % 2 === 1;
};

const distToSeg = (p: Pt, [a, b]: Seg) => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};

/** Points this close to a cutting contour count as on it (a slit may start at the edge). */
const ON_EDGE_MM = 0.05;

/**
 * Tracing and open cut lines must lie on the material: inside the outside contour and
 * not inside a window. A point is on material when an odd number of closed contours
 * contain it (outside = 1, inside a window = 2, on an island in a window = 3 ...).
 * Returns the chains that leave the material, as entity ids.
 */
function marksOutsidePart(entities: Entity[], contours: Contour[]): string[][] {
  // Without a closed outside there is no part to be inside of; the open outside is reported already.
  if (!contours.some((c) => c.outer && c.closed)) return [];
  const byId = new Map(entities.map((e) => [e.id, e]));
  const closed = contours.filter((c) => c.closed).map((c) => ({ box: c.box, segs: segmentsOf(c, byId) }));
  if (!closed.length) return [];
  const onMaterial = (p: Pt) => {
    let n = 0;
    for (const c of closed) {
      if (p.x < c.box.minX - ON_EDGE_MM || p.x > c.box.maxX + ON_EDGE_MM || p.y < c.box.minY - ON_EDGE_MM || p.y > c.box.maxY + ON_EDGE_MM) continue;
      if (c.segs.some((s) => distToSeg(p, s) <= ON_EDGE_MM)) return true;
      if (inside(p, c.segs)) n++;
    }
    return n % 2 === 1;
  };
  const marks = entities.filter((e) => roleOf(e) !== "cut");
  return buildContours(marks)
    .filter((chain) => chain.entityIds.some((id) => !pointsAlong(byId.get(id)!).every(onMaterial)))
    .map((chain) => chain.entityIds);
}
