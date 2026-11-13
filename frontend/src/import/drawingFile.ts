// A drawing file as entities, whatever it is: DXF (read here), SVG (read here) or DWG (converted to
// DXF by the GNEZDO server: ODA File Converter or LibreDWG on its PC).

import { api } from "../api/api";
import { DxfError, readDxf, type DxfResult } from "./dxf";
import { readSvg } from "./svg";

/** The files the importers take. */
export const DRAWING_ACCEPT = ".dxf,.dwg,.svg";
export const isDrawingName = (name: string) => /\.(dxf|dwg|svg)$/i.test(name);
export const drawingBaseName = (name: string) => name.replace(/\.(dxf|dwg|svg)$/i, "");

export async function readDrawingFile(f: File): Promise<DxfResult> {
  if (/\.dwg$/i.test(f.name)) {
    let text: string;
    try { text = await api.dwgToDxf(f); }
    catch (e) { throw new DxfError((e as Error).message); }
    const r = readDxf(text, f.name.replace(/\.dwg$/i, ".dxf"));
    return { ...r, drawing: { ...r.drawing, fileName: drawingBaseName(f.name) } };
  }
  const text = await f.text();
  if (/\.svg$/i.test(f.name) || /^\s*(<\?xml|<svg|<!DOCTYPE svg)/i.test(text)) return readSvg(text, f.name);
  return readDxf(text, f.name);
}
