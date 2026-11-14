// A saved part out of the database: its drawing for the importer canvas (EDIT) and as a file (EXPORT).
import { api } from "../api/api";
import type { PartSummary } from "../api/types";
import { pointsAlong, roleOf, type Drawing, type Entity, type Pt, type Role } from "./geometry";
import { carcEnt, clipLine } from "./draw";

/**
 * The part's drawing as saved (lines, arcs, circles with their roles, mm, y up). Parts saved without
 * a drawing (sample data) get one from their outline: straight lines, every contour cutting.
 */
export async function drawingOfPart(part: PartSummary): Promise<Drawing> {
  const g = await api.partGeometry(part.id).catch(() => null);
  const entities = g?.entities?.length ? g.entities.map((e) => ({ ...e })) : entitiesFromPath(part.path, part.h);
  return { id: `db-${part.id}-${Date.now().toString(36)}`, fileName: part.name, entities, ...(g?.aids?.length ? { aids: g.aids } : {}) };
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

/** Aid lines and dimensions as plain lines and texts (export with them ticked): layers AID and DIM. */
function aidShapes(d: Drawing): { layer: "AID" | "DIM"; a: Pt; b: Pt }[] {
  const out: { layer: "AID" | "DIM"; a: Pt; b: Pt }[] = [];
  const all = d.entities.flatMap((e) => pointsAlong(e));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of all) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  const pad = Math.max(maxX - minX, maxY - minY, 10) * 0.25;
  const box = { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
  for (const a of d.aids ?? []) {
    if (a.kind === "xline") { const c = clipLine(a.p, a.d, box); if (c) out.push({ layer: "AID", a: c[0], b: c[1] }); }
    else if (a.kind === "cline") out.push({ layer: "AID", a: a.a, b: a.b });
    else if (a.kind === "carc") continue;          // written as arcs / circles (aidArcs)
    else {
      const m = a.m;
      if (m.kind === "distance") { out.push({ layer: "DIM", a: m.from, b: m.to }); for (const [p, q] of m.ext) out.push({ layer: "DIM", a: p, b: q }); }
      else if (m.kind === "diameter") out.push({ layer: "DIM", a: m.a, b: m.b });
      else if (m.kind === "radius") out.push({ layer: "DIM", a: m.c, b: m.to });
      else { const R = 10; out.push({ layer: "DIM", a: m.at, b: { x: m.at.x + m.u1.x * R, y: m.at.y + m.u1.y * R } }, { layer: "DIM", a: m.at, b: { x: m.at.x + m.u2.x * R, y: m.at.y + m.u2.y * R } }); }
    }
  }
  return out;
}
/** Aid arcs and circles (lines, arcs and circles turned into aid lines): layer AID. */
const aidArcs = (d: Drawing): Entity[] => (d.aids ?? []).flatMap((a) => (a.kind === "carc" ? [carcEnt(a)] : []));
/** The dimensions' texts and where they stand. */
function dimTexts(d: Drawing): { at: Pt; text: string }[] {
  const n2 = (v: number) => String(Math.round(v * 100) / 100);
  return (d.aids ?? []).flatMap((a) => {
    if (a.kind !== "dim") return [];
    const m = a.m;
    if (m.kind === "distance") return [{ at: { x: (m.from.x + m.to.x) / 2, y: (m.from.y + m.to.y) / 2 }, text: n2(m.value) }];
    if (m.kind === "diameter") return [{ at: { x: (m.a.x + m.b.x) / 2, y: (m.a.y + m.b.y) / 2 }, text: `%%c${n2(m.d)}` }];
    if (m.kind === "radius") return [{ at: m.to, text: `R${n2(m.r)}` }];
    return [{ at: m.at, text: `${n2(m.deg)}%%d` }];
  });
}

/** DXF (R12, mm): LINE, ARC, CIRCLE; a spline as straight lines through points on it. With aids: layers AID and DIM too. */
export function toDxf(d: Drawing, withAids = false): string {
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
  if (withAids) {
    for (const s of aidShapes(d)) add("0", "LINE", "8", s.layer, "10", s.a.x, "20", s.a.y, "30", 0, "11", s.b.x, "21", s.b.y, "31", 0);
    for (const e of aidArcs(d)) {
      if (e.kind === "circle") add("0", "CIRCLE", "8", "AID", "10", e.c.x, "20", e.c.y, "30", 0, "40", e.r);
      else if (e.kind === "arc") add("0", "ARC", "8", "AID", "10", e.c.x, "20", e.c.y, "30", 0, "40", e.r, "50", e.start, "51", e.end);
    }
    for (const t of dimTexts(d)) add("0", "TEXT", "8", "DIM", "10", t.at.x, "20", t.at.y, "30", 0, "40", 3.5, "1", t.text);
  }
  add("0", "ENDSEC", "0", "EOF");
  return out.join("\r\n") + "\r\n";
}

const SVG_STROKE: Record<Role, string> = { cut: "#000000", trace: "#1f9d3a", openCut: "#d32f2f" };

/** SVG at 1 unit = 1 mm, y down as SVG has it; one group per role. */
export function toSvg(d: Drawing, withAids = false): string {
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
  if (withAids && d.aids?.length) {
    const ln = aidShapes(d).map((s) => `    <path d="M${X(s.a.x)} ${Y(s.a.y)}L${X(s.b.x)} ${Y(s.b.y)}"${s.layer === "AID" ? ' stroke-dasharray="2 1.5"' : ""}/>`)
      .concat(aidArcs(d).map((e) => `    <path d="${pathOf(e)}" stroke-dasharray="2 1.5"/>`));
    const tx = dimTexts(d).map((t) => `    <text x="${X(t.at.x)}" y="${Y(t.at.y)}" font-size="3.5">${t.text.replace("%%c", "Ø").replace("%%d", "°")}</text>`);
    groups.push(`  <g id="AID_DIM" fill="none" stroke="#2f80d0" stroke-width="0.18">\n${ln.join("\n")}\n  </g>\n  <g fill="#2f80d0">\n${tx.join("\n")}\n  </g>`);
  }
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
export async function exportPart(part: PartSummary, format: "dxf" | "svg", withAids = false) {
  const d = await drawingOfPart(part);
  if (format === "dxf") download(`${safeName(part.name)}.dxf`, toDxf(d, withAids), "application/dxf");
  else download(`${safeName(part.name)}.svg`, toSvg(d, withAids), "image/svg+xml");
}

/** EDIT: asks the app to open the part on the importer canvas (App listens). */
export const EDIT_PART_EVENT = "gnezdo:edit-part";
export function editPart(part: PartSummary) {
  window.dispatchEvent(new CustomEvent<PartSummary>(EDIT_PART_EVENT, { detail: part }));
}
