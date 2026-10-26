// Drawing entities of an imported DXF/DWG, in millimeters, y up (as in the CAD file),
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
  /** Hole: a cutting contour cut slowly (machines / post processors that support it). */
  slow?: boolean;
  layer?: string;
  color?: number;  // AutoCAD color index, resolved (no BYLAYER / BYBLOCK): 1 red, 3 green, 4 cyan, 7 black/white
  rgb?: number;    // True Color 0xRRGGBB, when the drawing uses one (wins over the index)
};

export const roleOf = (e: Entity): Role => e.role ?? "cut";

export interface Drawing {
  id: string;
  fileName: string;        // without extension, e.g. "1625-25-01_P1_3kos"
  entities: Entity[];
  /** Loose points from the file (DXF POINT): never cut; shown so Sweep can remove them. */
  points?: { id: string; p: Pt; layer?: string }[];
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

export type CheckId = "doubles" | "separate" | "crossing" | "insideOpen" | "outsideOpen" | "outsidePart" | "splines";

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
  // double and tiny lines would make a closed contour look open (three lines at a corner), so
  // they are reported on their own and left out of the contours until they are removed
  const doubles = findDoubles(entities);
  const doubleSet = new Set(doubles);
  const contours = buildContours(entities.filter((e) => roleOf(e) === "cut" && !doubleSet.has(e.id)));
  const area = (b: Box) => (b.maxX - b.minX) * (b.maxY - b.minY);
  const outer = contours.reduce<Contour | null>((best, c) => (!best || area(c.box) > area(best.box) ? c : best), null);
  if (outer) outer.outer = true;

  // Cutting lines that lie wholly outside the outline are not part of this part (another part
  // drawn in the same file, or a stray line): they would be taken for holes or break the check.
  // With a closed outline "outside" is exact; while the outline is still open, a piece counts
  // as outside when it is wholly clear of the outline's extents.
  const separate = !outer ? []
    : outer.closed ? outsideOutline(entities, outer, contours.filter((c) => c !== outer))
    : farFromPart(contours, outer);
  const rest = contours.filter((c) => !separate.includes(c));

  // An open piece that reaches the part's outer edge belongs to the outside contour, even when
  // a fault (a line past a corner) splits the outside into several pieces.
  const all = rest.length ? rest.map((c) => c.box).reduce(union) : null;
  const onEdge = (b: Box) => !!all && (Math.abs(b.minX - all.minX) < 0.01 || Math.abs(b.minY - all.minY) < 0.01 ||
    Math.abs(b.maxX - all.maxX) < 0.01 || Math.abs(b.maxY - all.maxY) < 0.01);
  const openOutside = rest.filter((c) => !c.closed && (c.outer || onEdge(c.box)));
  const openInside = rest.filter((c) => !c.closed && !openOutside.includes(c));
  const splines = entities.filter((e) => e.kind === "spline");
  const crossing = crossingContours(entities, rest.filter((c) => c.closed));
  const outsidePart = marksOutsidePart(entities.filter((e) => !doubleSet.has(e.id)), rest);

  const checks: CheckResult[] = [
    { id: "doubles", label: "Double or tiny lines", count: doubles.length, entityIds: doubles, points: [] },
    {
      id: "separate", label: "Lines outside the part outline", count: separate.length,
      entityIds: separate.flatMap((c) => c.entityIds), points: [],
    },
    {
      id: "crossing", label: "Contours cross each other", count: crossing.groups.length,
      entityIds: crossing.groups.flat(), points: crossing.points,
    },
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
    contours: rest,
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
 * While the outline is open: pieces belong to the part when they are within 10 mm of it, piece
 * by piece (an outline broken into several pieces stays one part); what is further away is outside.
 */
function farFromPart(contours: Contour[], outer: Contour): Contour[] {
  const NEAR = 10;
  const gap = (a: Box, b: Box) => Math.max(0, a.minX - b.maxX, b.minX - a.maxX, a.minY - b.maxY, b.minY - a.maxY);
  const inPart = new Set<Contour>([outer]);
  for (let grew = true; grew;) {
    grew = false;
    for (const c of contours) if (!inPart.has(c) && [...inPart].some((p) => gap(c.box, p.box) <= NEAR)) { inPart.add(c); grew = true; }
  }
  return contours.filter((c) => !inPart.has(c));
}


/** Contours that lie wholly outside the closed outline (no point inside it or on it). */
function outsideOutline(entities: Entity[], outer: Contour, others: Contour[]): Contour[] {
  const byId = new Map(entities.map((e) => [e.id, e]));
  const segs = segmentsOf(outer, byId);
  const b = outer.box;
  const outside = (p: Pt) =>
    p.x < b.minX - ON_EDGE_MM || p.x > b.maxX + ON_EDGE_MM || p.y < b.minY - ON_EDGE_MM || p.y > b.maxY + ON_EDGE_MM ||
    (!segs.some((sg) => distToSeg(p, sg) <= ON_EDGE_MM) && !inside(p, segs));
  return others.filter((c) => c.entityIds.every((id) => pointsAlong(byId.get(id)!).every(outside)));
}

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

/* ---- Double and tiny lines ------------------------------------------------------------ */

/** Lines shorter than this are too small to cut and only confuse the contours. */
export const TINY_MM = JOIN_TOLERANCE_MM;
/** A line closer than this to another line, along its whole length, lies on top of it. */
export const OVERLAP_MM = 0.1;

/** Length of an entity along its path. */
export function lengthOf(e: Entity): number {
  if (e.kind === "line") return Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y);
  if (e.kind === "arc") return rad(arcSweep(e.start, e.end)) * e.r;
  if (e.kind === "circle") return 2 * Math.PI * e.r;
  return e.fit.slice(1).reduce((s, q, i) => s + Math.hypot(q.x - e.fit[i].x, q.y - e.fit[i].y), 0);
}

const distPtSeg = (p: Pt, a: Pt, b: Pt) => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};

/**
 * Does `a` lie along `b` for its whole length (the same line drawn twice, or a piece on top of it),
 * within OVERLAP_MM? For lines, `a` must also overlap `b` along its length, so the short pieces of
 * a curve drawn as many little lines are not taken for doubles of their neighbours.
 */
function coveredBy(a: Entity, b: Entity): boolean {
  const T = OVERLAP_MM;
  if (a.kind === "line" && b.kind === "line") {
    if (distPtSeg(a.a, b.a, b.b) > T || distPtSeg(a.b, b.a, b.b) > T) return false;
    const dx = b.b.x - b.a.x, dy = b.b.y - b.a.y, l2 = dx * dx + dy * dy;
    if (!l2) return false;
    const t = (p: Pt) => ((p.x - b.a.x) * dx + (p.y - b.a.y) * dy) / l2;
    const lo = Math.max(0, Math.min(t(a.a), t(a.b))), hi = Math.min(1, Math.max(t(a.a), t(a.b)));
    const overlap = Math.max(0, hi - lo) * Math.sqrt(l2);
    // nearly all of it must run along b (for short pieces the 0.1 mm allowance alone is not enough)
    const la = lengthOf(a);
    return overlap >= la - T && overlap >= la * 0.9;
  }
  if ((a.kind === "arc" || a.kind === "circle") && (b.kind === "arc" || b.kind === "circle")) {
    if (Math.hypot(a.c.x - b.c.x, a.c.y - b.c.y) > T || Math.abs(a.r - b.r) > T) return false;
    if (b.kind === "circle") return true;
    if (a.kind === "circle") return false;
    const sweep = arcSweep(b.start, b.end), slack = (T / b.r) * (180 / Math.PI);
    return pointsAlong(a).every((p) => arcSweep(b.start, (Math.atan2(p.y - b.c.y, p.x - b.c.x) * 180) / Math.PI) % 360 <= sweep + slack
      || Math.hypot(p.x - b.c.x - b.r * Math.cos(rad(b.start)), p.y - b.c.y - b.r * Math.sin(rad(b.start))) <= T);
  }
  if (a.kind === "spline" && b.kind === "spline") {
    const same = (p: Pt[], q: Pt[]) => p.length === q.length && p.every((x, i) => Math.hypot(x.x - q[i].x, x.y - q[i].y) <= T);
    return same(a.fit, b.fit) || same(a.fit, [...b.fit].reverse());
  }
  return false;
}

/**
 * Ids of lines that are tiny (shorter than 0.01 mm) or lie on top of another line (within 0.1 mm) of the same
 * kind (cutting, tracing or open cut). Of two identical lines only one is listed.
 */
export function findDoubles(entities: Entity[]): string[] {
  const out = new Set<string>();
  const live = entities.filter((e) => {
    if (lengthOf(e) < TINY_MM) { out.add(e.id); return false; }
    return true;
  });
  const T = OVERLAP_MM;
  const boxes = live.map(boxOf);
  for (let i = 0; i < live.length; i++) {
    for (let j = 0; j < live.length; j++) {
      if (i === j || out.has(live[j].id) || roleOf(live[i]) !== roleOf(live[j])) continue;
      const a = boxes[i], b = boxes[j];
      // a can only lie on b when a's box is inside b's box
      if (a.minX < b.minX - T || a.maxX > b.maxX + T || a.minY < b.minY - T || a.maxY > b.maxY + T) continue;
      if (!coveredBy(live[i], live[j])) continue;
      // identical pair: keep the first, list the later one
      if (coveredBy(live[j], live[i]) && j > i) continue;
      out.add(live[i].id);
      break;
    }
  }
  return entities.filter((e) => out.has(e.id)).map((e) => e.id);
}

/* ---- Contours that cross ----------------------------------------------------------------- */

/** Arcs and circles are followed closely (at most 0.01 mm off), so near misses are not taken for crossings. */
function finePoints(e: Entity): Pt[] {
  if (e.kind === "line") return [e.a, e.b];   // a line is one segment: crossings in its middle are found exactly
  if (e.kind !== "arc" && e.kind !== "circle") return pointsAlong(e);
  const step = Math.min(7.5, Math.max(0.25, (2 * Math.acos(Math.max(-1, 1 - 0.01 / e.r)) * 180) / Math.PI));
  const start = e.kind === "arc" ? e.start : 0, sweep = e.kind === "arc" ? arcSweep(e.start, e.end) : 360;
  const n = Math.max(2, Math.ceil(sweep / step));
  return Array.from({ length: n + 1 }, (_, i) => onCircle(e.c, e.r, start + (sweep * i) / n));
}

const cross2 = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
/** Do segments p1-p2 and q1-q2 cross or touch? With `strict`, meeting only at end points does not count. */
function segsMeet(p1: Pt, p2: Pt, q1: Pt, q2: Pt, strict: boolean): Pt | null {
  const d1 = cross2(q1, q2, p1), d2 = cross2(q1, q2, p2), d3 = cross2(p1, p2, q1), d4 = cross2(p1, p2, q2);
  const E = 1e-9;
  if (((d1 > E && d2 < -E) || (d1 < -E && d2 > E)) && ((d3 > E && d4 < -E) || (d3 < -E && d4 > E))) {
    const t = d1 / (d1 - d2);
    return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
  }
  if (strict) return null;
  // touching: an end point lying on the other segment
  for (const [p, a, b] of [[p1, q1, q2], [p2, q1, q2], [q1, p1, p2], [q2, p1, p2]] as const)
    if (distToSeg(p, [a, b]) <= 1e-6) return p;
  return null;
}

/**
 * Closed cutting contours that cross or touch each other (a hole over the edge of another hole or
 * of the outline), or a contour that crosses itself (figure eight). Each group = the entity ids of
 * the contours involved; points = where they meet.
 */
function crossingContours(entities: Entity[], closed: Contour[]): { groups: string[][]; points: Pt[] } {
  const byId = new Map(entities.map((e) => [e.id, e]));
  // segments per contour, each remembering its entity and place, to skip neighbours on the same contour
  const segs = closed.map((c) => c.entityIds.flatMap((id) => {
    const p = finePoints(byId.get(id)!);
    return p.slice(1).map((q, i) => ({ a: p[i], b: q }));
  }));
  const hit = new Set<number>();
  const points: Pt[] = [];
  const overlaps = (a: Box, b: Box) => a.minX <= b.maxX + 1e-6 && b.minX <= a.maxX + 1e-6 && a.minY <= b.maxY + 1e-6 && b.minY <= a.maxY + 1e-6;
  const segBox = (s: { a: Pt; b: Pt }): Box => ({ minX: Math.min(s.a.x, s.b.x), minY: Math.min(s.a.y, s.b.y), maxX: Math.max(s.a.x, s.b.x), maxY: Math.max(s.a.y, s.b.y) });
  for (let i = 0; i < closed.length; i++) {
    for (let j = i + 1; j < closed.length; j++) {
      if (!overlaps(closed[i].box, closed[j].box)) continue;
      let at: Pt | null = null;
      for (const s of segs[i]) {
        const sb = segBox(s);
        if (!overlaps(sb, closed[j].box)) continue;
        for (const t of segs[j]) if (overlaps(sb, segBox(t)) && (at = segsMeet(s.a, s.b, t.a, t.b, false))) break;
        if (at) break;
      }
      if (at) { hit.add(i); hit.add(j); points.push(at); }
    }
    // a contour crossing itself (figure eight): two of its segments cross properly; neighbours
    // only meet at their shared end, which does not count
    const own = segs[i], boxes = own.map(segBox);
    outer: for (let x = 0; x < own.length; x++) for (let y = x + 1; y < own.length; y++) {
      if (!overlaps(boxes[x], boxes[y])) continue;
      const at = segsMeet(own[x].a, own[x].b, own[y].a, own[y].b, true);
      if (at) { hit.add(i); points.push(at); break outer; }
    }
  }
  // contours that cross are reported together, one group per connected set
  const groups: string[][] = [];
  const done = new Set<number>();
  for (const i of hit) {
    if (done.has(i)) continue;
    done.add(i);
    groups.push(closed[i].entityIds);
  }
  return { groups, points };
}
