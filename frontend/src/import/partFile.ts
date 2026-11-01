// A saved part out of the database: its drawing for the importer canvas (EDIT) and as a file (EXPORT).
import { api } from "../api/api";
import type { PartSummary } from "../api/types";
import { pointsAlong, roleOf, type Drawing, type Entity, type Pt, type Role } from "./geometry";

/**
 * The part's drawing as saved (lines, arcs, circles with their roles, mm, y up). Parts saved without
 * a drawing (sample data) get one from their outline: straight lines, every contour cutting.
 */
export async function drawingOfPart(part: PartSummary): Promise<Drawing> {
  const g = await api.partGeometry(part.id).catch(() => null);
  const entities = g?.entities?.length ? g.entities.map((e) => ({ ...e })) : entitiesFromPath(part.path, part.h);
  return { id: `db-${part.id}-${Date.now().toString(36)}`, fileName: part.name, entities };
}

/** Outline path (y down, origin top-left) -> line entities (y up). */
function entitiesFromPath(path: string, h: number): Entity[] {
  const out: Entity[] = [];
  let n = 0;
  for (const sub of path.split(/(?=[Mm])/)) {
    const nums = sub.match(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];
    const pts: Pt[] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: h - nums[i + 1] });
    if (pts.length < 3) continue;
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length];
      if (Math.hypot(b.x - a.x, b.y - a.y) > 1e-6) out.push({ id: `e${++n}`, kind: "line", a, b });
    });
  }
  return out;
}

// -- export ---------------------------------------------------------------------
/** Layer per role: names GNEZDO's layer rules read back as the same role. */
const LAYER: Record<Role, { name: string; color: number }> = {
  cut: { name: "CUT", color: 7 },
  trace: { name: "MARK", color: 3 },
  openCut: { name: "OPEN_CUT", color: 1 },
};

const num = (v: number) => (Math.abs(v) < 1e-9 ? "0" : String(+v.toFixed(6)));

/** DXF (R12, mm): LINE, ARC, CIRCLE; a spline as straight lines through points on it. */
export function toDxf(d: Drawing): string {
  const out: string[] = [];
  const add = (...pairs: (string | number)[]) => { for (const p of pairs) out.push(typeof p === "number" ? num(p) : p); };
  add("0", "SECTION", "2", "HEADER", "9", "$ACADVER", "1", "AC1009", "9", "$INSUNITS", "70", "4", "0", "ENDSEC");
  add("0", "SECTION", "2", "TABLES", "0", "TABLE", "2", "LAYER", "70", String(Object.keys(LAYER).length));
  for (const l of Object.values(LAYER)) add("0", "LAYER", "2", l.name, "70", "0", "62", String(l.color), "6", "CONTINUOUS");
  add("0", "ENDTAB", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES");
  for (const e of d.entities) {
    const layer = LAYER[roleOf(e)].name;
    if (e.kind === "line") add("0", "LINE", "8", layer, "10", e.a.x, "20", e.a.y, "30", 0, "11", e.b.x, "21", e.b.y, "31", 0);
    else if (e.kind === "circle") add("0", "CIRCLE", "8", layer, "10", e.c.x, "20", e.c.y, "30", 0, "40", e.r);
    else if (e.kind === "arc") add("0", "ARC", "8", layer, "10", e.c.x, "20", e.c.y, "30", 0, "40", e.r, "50", e.start, "51", e.end);
    else {
      const pts = pointsAlong(e);
      for (let i = 0; i + 1 < pts.length; i++)
        add("0", "LINE", "8", layer, "10", pts[i].x, "20", pts[i].y, "30", 0, "11", pts[i + 1].x, "21", pts[i + 1].y, "31", 0);
    }
  }
  add("0", "ENDSEC", "0", "EOF");
  return out.join("\r\n") + "\r\n";
}

const SVG_STROKE: Record<Role, string> = { cut: "#000000", trace: "#1f9d3a", openCut: "#d32f2f" };

/** SVG at 1 unit = 1 mm, y down as SVG has it; one group per role. */
export function toSvg(d: Drawing): string {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const all = d.entities.flatMap((e) => pointsAlong(e));
  for (const p of all) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  if (!all.length) { minX = minY = 0; maxX = maxY = 1; }
  const W = maxX - minX, H = maxY - minY;
  const X = (x: number) => num(x - minX), Y = (y: number) => num(maxY - y);  // flip: y up -> down
  const pathOf = (e: Entity): string => {
    if (e.kind === "line") return `M${X(e.a.x)} ${Y(e.a.y)}L${X(e.b.x)} ${Y(e.b.y)}`;
    if (e.kind === "circle") return `M${X(e.c.x - e.r)} ${Y(e.c.y)}a${num(e.r)} ${num(e.r)} 0 1 0 ${num(2 * e.r)} 0a${num(e.r)} ${num(e.r)} 0 1 0 ${num(-2 * e.r)} 0`;
    if (e.kind === "arc") {
      const rad = (a: number) => (a * Math.PI) / 180;
      const s = { x: e.c.x + e.r * Math.cos(rad(e.start)), y: e.c.y + e.r * Math.sin(rad(e.start)) };
      const t = { x: e.c.x + e.r * Math.cos(rad(e.end)), y: e.c.y + e.r * Math.sin(rad(e.end)) };
      const sweep = (((e.end - e.start) % 360) + 360) % 360;
      // counter-clockwise in y up = clockwise on screen, which is SVG's sweep flag 1
      return `M${X(s.x)} ${Y(s.y)}A${num(e.r)} ${num(e.r)} 0 ${sweep > 180 ? 1 : 0} 1 ${X(t.x)} ${Y(t.y)}`;
    }
    const pts = pointsAlong(e);
    return pts.map((p, i) => `${i ? "L" : "M"}${X(p.x)} ${Y(p.y)}`).join("");
  };
  const groups = (["cut", "trace", "openCut"] as Role[]).map((role) => {
    const paths = d.entities.filter((e) => roleOf(e) === role).map((e) => `    <path d="${pathOf(e)}"/>`);
    return paths.length ? `  <g id="${LAYER[role].name}" fill="none" stroke="${SVG_STROKE[role]}" stroke-width="0.25">\n${paths.join("\n")}\n  </g>` : "";
  }).filter(Boolean);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${num(W)}mm" height="${num(H)}mm" viewBox="0 0 ${num(W)} ${num(H)}">\n${groups.join("\n")}\n</svg>\n`;
}

export function download(fileName: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const safeName = (s: string) => s.trim().replace(/[\\/:*?"<>|]+/g, "_") || "part";

/** EXPORT: the part as a DXF or SVG file (downloaded). */
export async function exportPart(part: PartSummary, format: "dxf" | "svg") {
  const d = await drawingOfPart(part);
  if (format === "dxf") download(`${safeName(part.name)}.dxf`, toDxf(d), "application/dxf");
  else download(`${safeName(part.name)}.svg`, toSvg(d), "image/svg+xml");
}

/** EDIT: asks the app to open the part on the importer canvas (App listens). */
export const EDIT_PART_EVENT = "gnezdo:edit-part";
export function editPart(part: PartSummary) {
  window.dispatchEvent(new CustomEvent<PartSummary>(EDIT_PART_EVENT, { detail: part }));
}
