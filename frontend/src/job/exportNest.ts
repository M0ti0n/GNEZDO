// GNEZDO menu -> Export solution to DXF: every sheet of the solution shown, in one DXF (R12, mm).
// Sheets one under the other, each with its parts as drawn (lines, arcs, circles, on the layers
// GNEZDO's import rules read back) and a label beside it: solution / sheet, material, thickness,
// size, efficiency, cut number.
import type { JobPart } from "../api/types";
import { checkGeometry, pointsAlong, roleOf, type Entity, type Pt, type Role } from "../import/geometry";
import { download, drawingOfPart } from "../import/partFile";
import { sheetLoops } from "./stock";
import { sheetStats, type NestedSheet, type PlacedPart } from "./nest";
import type { Origin } from "./machine";

const LAYERS: { name: string; color: number }[] = [
  { name: "CUT", color: 7 }, { name: "MARK", color: 3 }, { name: "OPEN_CUT", color: 1 },
  { name: "SHEET", color: 8 }, { name: "TRIM", color: 9 }, { name: "TEXT", color: 2 },
];
const ROLE_LAYER: Record<Role, string> = { cut: "CUT", trace: "MARK", openCut: "OPEN_CUT" };

const num = (v: number) => (Math.abs(v) < 1e-9 ? "0" : String(+v.toFixed(4)));

/** A part's drawing in its outline-path frame (mm, y down, top-left of the outer contour at 0,0). */
interface PartDrawing { entities: Entity[]; minX: number; maxY: number }

async function partDrawing(jp: JobPart): Promise<PartDrawing> {
  const d = await drawingOfPart(jp.part);
  const report = checkGeometry(d.entities);
  const box = report.contours.find((c) => c.closed && c.outer)?.box ?? report.box;
  return { entities: d.entities, minX: box.minX, maxY: box.maxY };
}

export interface ExportInput {
  jobName: string;
  solutionNo: number;
  sheets: NestedSheet[];
  parts: JobPart[];
  origin: Origin;
}

export async function exportSolutionDxf(x: ExportInput): Promise<void> {
  const used = [...new Set(x.sheets.flatMap((sh) => sh.parts.map((p) => p.partId)))];
  const byId = new Map(x.parts.map((jp) => [jp.part.id, jp]));
  const missing = used.filter((id) => !byId.has(id));
  if (missing.length) throw new Error(`${missing.length} nested ${missing.length === 1 ? "part is" : "parts are"} no longer in the work part list`);
  const drawings = new Map(await Promise.all(used.map(async (id) => [id, await partDrawing(byId.get(id)!)] as const)));
  const statParts = new Map(x.parts.map((jp) => [jp.part.id, { path: jp.part.path, areaMm2: jp.part.areaMm2 }]));

  const out: string[] = [];
  const add = (...pairs: (string | number)[]) => { for (const p of pairs) out.push(typeof p === "number" ? num(p) : p); };
  add("0", "SECTION", "2", "HEADER", "9", "$ACADVER", "1", "AC1009", "9", "$INSUNITS", "70", "4", "0", "ENDSEC");
  add("0", "SECTION", "2", "TABLES", "0", "TABLE", "2", "LAYER", "70", String(LAYERS.length));
  for (const l of LAYERS) add("0", "LAYER", "2", l.name, "70", "0", "62", String(l.color), "6", "CONTINUOUS");
  add("0", "ENDTAB", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES");
  const line = (layer: string, a: Pt, b: Pt) => add("0", "LINE", "8", layer, "10", a.x, "20", a.y, "30", 0, "11", b.x, "21", b.y, "31", 0);
  const poly = (layer: string, pts: Pt[]) => pts.forEach((a, i) => line(layer, a, pts[(i + 1) % pts.length]));
  const text = (p: Pt, h: number, s: string) => add("0", "TEXT", "8", "TEXT", "10", p.x, "20", p.y, "30", 0, "40", h, "1", s);

  // sheets one under the other, the first at the top; DXF is y up
  const gap = Math.max(100, Math.max(...x.sheets.map((s) => s.widthMm)) * 0.15);
  let top = 0;
  x.sheets.forEach((sh, k) => {
    const L = sh.lengthMm, W = sh.widthMm;
    // sheet frame (y down) -> drawing (y up)
    const toDxf = (p: Pt): Pt => ({ x: p.x, y: top - p.y });
    for (const lp of sheetLoops(sh)) poly("SHEET", lp.map(([px, py]) => toDxf({ x: px, y: py })));
    const t = sh.trims;
    if (t && !sh.outline?.length) {
      // trims by the machine's axes: X- / Y- at the origin corner
      const right = x.origin.endsWith("right"), bottom = x.origin.startsWith("bottom");
      const l = right ? t.xPlus : t.xMinus, r = right ? t.xMinus : t.xPlus, tp = bottom ? t.yPlus : t.yMinus, bt = bottom ? t.yMinus : t.yPlus;
      if (L - l - r > 0 && W - tp - bt > 0) poly("TRIM", [{ x: l, y: tp }, { x: L - r, y: tp }, { x: L - r, y: W - bt }, { x: l, y: W - bt }].map(toDxf));
    }
    for (const p of sh.parts) placePart(drawings.get(p.partId)!, p, toDxf, line, add);

    // the label beside the sheet
    const st = sheetStats(sh, statParts, x.origin);
    const usedKg = st.sheetKg - st.remnantKg;
    const eff = usedKg > 0 ? (100 * st.partsKg) / usedKg : 0;
    const h = Math.max(20, Math.round(Math.min(W, 1500) / 25));
    const labels = [
      `SOLUTION ${x.solutionNo} / SHEET ${k + 1}`,
      `${sh.material} ${sh.thicknessMm} mm`,
      `${num(L)} x ${num(W)} mm`,
      `EFF. ${eff.toFixed(1)} %`,
      `${sh.parts.length} PCS${(sh.cutNumber ?? 1) > 1 ? `, CUT ${sh.cutNumber}x` : ""}`,
    ];
    labels.forEach((s, i) => text({ x: L + h * 1.5, y: top - h * (1 + i * 1.6) }, i === 0 ? h * 1.25 : h, s));
    top -= W + gap;
  });
  add("0", "ENDSEC", "0", "EOF");
  const safe = (s: string) => s.trim().replace(/[\\/:*?"<>|]+/g, "_") || "job";
  download(`${safe(x.jobName)} - solution ${x.solutionNo}.dxf`, out.join("\r\n") + "\r\n", "application/dxf");
}

/**
 * One placed part: its drawing (y up) into the outline frame (y down), mirrored, turned and moved
 * as nested (the same transform the sheet view draws), then into the export (y up).
 */
export function placePart(d: PartDrawing, p: PlacedPart, toDxf: (p: Pt) => Pt,
  line: (layer: string, a: Pt, b: Pt) => void, add: (...v: (string | number)[]) => void) {
  const a = (p.angle * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const map = (q: Pt): Pt => {
    const x0 = q.x - d.minX, y0 = d.maxY - q.y;          // outline frame
    const x1 = p.mirror ? -x0 : x0;
    return toDxf({ x: x1 * c - y0 * s + p.x, y: x1 * s + y0 * c + p.y });
  };
  // two y flips cancel out; a mirror makes arcs run the other way
  const flips = p.mirror;
  const deg = (o: Pt, q: Pt) => (Math.atan2(q.y - o.y, q.x - o.x) * 180) / Math.PI;
  for (const e of d.entities) {
    const layer = ROLE_LAYER[roleOf(e)];
    if (e.kind === "line") line(layer, map(e.a), map(e.b));
    else if (e.kind === "circle") { const o = map(e.c); add("0", "CIRCLE", "8", layer, "10", o.x, "20", o.y, "30", 0, "40", e.r); }
    else if (e.kind === "arc") {
      const r = (t: number) => ({ x: e.c.x + e.r * Math.cos((t * Math.PI) / 180), y: e.c.y + e.r * Math.sin((t * Math.PI) / 180) });
      const o = map(e.c), s0 = map(r(e.start)), s1 = map(r(e.end));
      const [from, to] = flips ? [s1, s0] : [s0, s1];
      add("0", "ARC", "8", layer, "10", o.x, "20", o.y, "30", 0, "40", e.r, "50", deg(o, from), "51", deg(o, to));
    } else {
      const pts = pointsAlong(e).map(map);
      for (let i = 0; i + 1 < pts.length; i++) line(layer, pts[i], pts[i + 1]);
    }
  }
}
