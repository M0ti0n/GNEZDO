import { checkGeometry, quantityFromName, type Drawing } from "./geometry";
import { DxfError, readDxf } from "./dxf";

/** One file in the import list. */
export interface ImportItem {
  id: string;
  fileName: string;          // as dropped, with extension
  name: string;              // without extension, used as part name
  qty: number | null;        // from the file name: last number before the extension
  state: "reading" | "ready" | "failed" | "dwg";
  error?: string;
  drawing?: Drawing;
  ignored?: Record<string, number>;
  declaredUnits?: string;
  checked: boolean;          // Check lines has run on it (or it was opened)
  processed: boolean;
}

/** Shared by every part in the list until changed per part with the Properties tool. */
export interface BatchProperties {
  material: string;
  thicknessMm: string;
  project: string;
}

export const EMPTY_PROPERTIES: BatchProperties = { material: "", thicknessMm: "", project: "" };

/**
 * What the list shows for a part:
 *   ok        - only closed contours (open lines are marked as tracing or open cut): ready to process
 *   attention - open lines that are neither tracing nor open cut
 */
export type Verdict = "reading" | "failed" | "dwg" | "unchecked" | "attention" | "ok" | "processed";

export interface ItemStatus {
  verdict: Verdict;
  openContours: number;
  splines: number;
}

export function statusOf(item: ImportItem): ItemStatus {
  if (item.state !== "ready" || !item.drawing) {
    const verdict: Verdict = item.state === "dwg" ? "dwg" : item.state === "reading" ? "reading" : "failed";
    return { verdict, openContours: 0, splines: 0 };
  }
  const report = checkGeometry(item.drawing.entities);
  const open = report.checks.filter((c) => c.id !== "splines").reduce((n, c) => n + c.count, 0);
  const splines = report.checks.find((c) => c.id === "splines")?.count ?? 0;
  const verdict: Verdict = !item.checked ? "unchecked" : open > 0 ? "attention" : item.processed ? "processed" : "ok";
  return { verdict, openContours: open, splines };
}

let seq = 0;

/** New list entry for a dropped file; DXF is read by readItem. */
export function newItem(file: File): ImportItem {
  const name = file.name.replace(/\.(dxf|dwg)$/i, "");
  const dwg = /\.dwg$/i.test(file.name);
  return {
    id: `imp-${Date.now().toString(36)}-${++seq}`,
    fileName: file.name, name, qty: quantityFromName(name),
    state: dwg ? "dwg" : "reading",
    error: dwg ? "DWG needs the import worker on the server" : undefined,
    checked: false, processed: false,
  };
}

export async function readItem(item: ImportItem, file: File): Promise<ImportItem> {
  if (item.state === "dwg") return item;
  try {
    const { drawing, ignored, declaredUnits } = readDxf(await file.text(), file.name);
    return { ...item, state: "ready", drawing: { ...drawing, id: item.id }, ignored, declaredUnits };
  } catch (e) {
    return { ...item, state: "failed", error: e instanceof DxfError ? e.message : `Could not read the file (${(e as Error).message})` };
  }
}

export const isDrawingFile = (f: File) => /\.(dxf|dwg)$/i.test(f.name);
