// A stock sheet from a DXF file (a remnant drawn in CAD): its size and shape. Used by the STOCK panel
// (Add from DXF) and Manual nest's Add sheet (ADD FROM DXF).
import { readDxf } from "../import/dxf";
import { boxOf, checkGeometry, union, type Entity } from "../import/geometry";
import { loopPoints } from "../import/toPart";
import { fitsMachine, rotateSheet, type StockSheet } from "./stock";

export type DxfSheet =
  | { ok: true; sheet: StockSheet; turned: boolean }
  | { ok: false; tooBig?: { l: number; w: number }; message: string };

/**
 * The file's sheet on top of `base` (material, gaps...): size from its extents, its own shape when it
 * is not a plain rectangle; turned 90° when it fits the machine only that way.
 */
export async function sheetFromDxf(f: File, base: StockSheet): Promise<DxfSheet> {
  try {
    const { drawing } = readDxf(await f.text(), f.name);
    if (!drawing.entities.length) return { ok: false, message: `${f.name}: no lines to take the sheet size from` };
    const b = drawing.entities.map(boxOf).reduce(union);
    const r = (v: number) => Math.round(v * 10) / 10;
    const l = r(b.maxX - b.minX), w = r(b.maxY - b.minY);
    const turn = !fitsMachine(l, w) && fitsMachine(w, l);
    if (!fitsMachine(l, w) && !turn) return { ok: false, tooBig: { l, w }, message: `${f.name} is ${l} × ${w} mm: bigger than the machine can cut` };
    let sheet: StockSheet = {
      ...base, source: "dxf", lengthMm: l, widthMm: w, qty: 1, unlimited: false,
      fileName: f.name.replace(/\.dxf$/i, ""), outline: dxfOutline(drawing.entities, b), original: undefined,
    };
    if (turn) {
      sheet = rotateSheet(sheet);
      sheet = { ...sheet, original: { lengthMm: sheet.lengthMm, widthMm: sheet.widthMm, outline: sheet.outline } };
    }
    return { ok: true, sheet, turned: turn };
  } catch (e) {
    return { ok: false, message: `${f.name}: ${(e as Error).message}` };
  }
}

/**
 * A DXF sheet's own shape: its closed contours, mm, y down from the top-left of its extents; the
 * largest is the outline, the others holes. Null for a plain rectangle (the size says it all).
 */
function dxfOutline(entities: Entity[], b: { minX: number; minY: number; maxX: number; maxY: number }): [number, number][][] | undefined {
  const byId = new Map(entities.map((e) => [e.id, e]));
  const area = (p: { x: number; y: number }[]) => Math.abs(p.reduce((a, q, i) => { const r = p[(i + 1) % p.length]; return a + q.x * r.y - r.x * q.y; }, 0)) / 2;
  const loops = checkGeometry(entities.map((e) => ({ ...e, role: "cut" as const }))).contours
    .filter((c) => c.closed).map((c) => loopPoints(c, byId)).filter((p) => p.length > 2)
    .sort((a, c) => area(c) - area(a));
  if (!loops.length) return undefined;
  const r = (v: number) => Math.round(v * 100) / 100;
  const out = loops.map((p) => p.map((q) => [r(q.x - b.minX), r(b.maxY - q.y)] as [number, number]));
  const rect = out.length === 1 && out[0].length === 4 && area(loops[0]) >= 0.999 * (b.maxX - b.minX) * (b.maxY - b.minY);
  return rect ? undefined : out;
}
