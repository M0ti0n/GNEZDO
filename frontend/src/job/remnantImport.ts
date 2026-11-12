// Import remnant (Remnants panel): a remnant drawn in a DXF, SVG or DWG file: its outline (the largest
// closed contour) and holes, mm, y down from the top-left of its box.

import { readDrawingFile } from "../import/drawingFile";
import { boxOf, union } from "../import/geometry";
import { dxfOutline } from "./dxfSheet";

export interface ImportedRemnant { outline: number[][]; holes: number[][][]; widthMm: number; heightMm: number; areaMm2: number }

const area = (l: number[][]) => Math.abs(l.reduce((a, p, i) => { const q = l[(i + 1) % l.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;

function fromLoops(loops: number[][][], file: string): ImportedRemnant {
  const ok = loops.filter((l) => l.length > 2 && area(l) > 1).sort((a, b) => area(b) - area(a));
  if (!ok.length) throw new Error(`${file}: no closed outline found`);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of ok[0]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const r = (v: number) => Math.round(v * 10) / 10;
  const rel = (l: number[][]) => l.map(([x, y]) => [r(x - x0), r(y - y0)]);
  // holes: the other closed contours inside the outline's box
  const holes = ok.slice(1).filter((l) => l.every(([x, y]) => x >= x0 - 0.1 && x <= x1 + 0.1 && y >= y0 - 0.1 && y <= y1 + 0.1));
  return { outline: rel(ok[0]), holes: holes.map(rel), widthMm: Math.round(x1 - x0), heightMm: Math.round(y1 - y0), areaMm2: Math.round(area(ok[0]) - holes.reduce((a, l) => a + area(l), 0)) };
}

/** The remnant drawn in the file (DXF, SVG, or DWG through the server). Throws with a message for the person. */
export async function remnantFromFile(f: File): Promise<ImportedRemnant> {
  const { drawing } = await readDrawingFile(f);
  if (!drawing.entities.length) throw new Error(`${f.name}: no lines in the file`);
  const b = drawing.entities.map(boxOf).reduce(union);
  return fromLoops((dxfOutline(drawing.entities, b, true) ?? []) as number[][][], f.name);
}
