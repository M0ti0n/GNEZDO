import { checkGeometry, quantityFromName, type Drawing } from "./geometry";
import { DxfError, readDxf } from "./dxf";
import { applyRules, type ImportRules, type Rotation } from "./rules";

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
  /** Process all found a part with the same project and name in the database; process it by hand to replace it. */
  duplicate?: boolean;
  /** Set with the Properties tool for this part; otherwise the list's properties apply. */
  props?: PartProps;
  /** Rotations and mirror the part got when it was processed. */
  applied?: { rotations: Rotation[]; mirror: boolean };
}

/** Shared by every part in the list until changed per part with the Properties tool. */
export interface BatchProperties {
  material: string;
  thicknessMm: string;
  project: string;
  /** Rules: rotation steps the nesting may use, and whether parts may be mirrored. */
  rotations: Rotation[];
  mirror: boolean;
}

/** Properties of one part (Properties tool and Process pop-up). */
export interface PartProps extends BatchProperties {
  description: string;
}

/** New properties start from the import rules in Settings. */
export const propertiesFrom = (rules: ImportRules): BatchProperties => ({
  material: "", thicknessMm: "", project: "",
  rotations: [...rules.defaultRotations],
  mirror: rules.mirrorWithoutOpenCut,
});

const PROPS_KEY = "gnezdo.importProperties";

/**
 * The list's properties carry over: they are kept in this browser, so the next import
 * (and the next visit) starts with the last values instead of the Settings defaults.
 */
export function loadProperties(rules: ImportRules): BatchProperties {
  const base = propertiesFrom(rules);
  try {
    const raw = localStorage.getItem(PROPS_KEY);
    return raw ? { ...base, ...JSON.parse(raw) } : base;
  } catch {
    return base;
  }
}

export function saveProperties(p: BatchProperties) {
  try { localStorage.setItem(PROPS_KEY, JSON.stringify(p)); } catch { /* kept for this session only */ }
}

/** What a part is saved with: its own properties, else the list's. */
export const effectiveProps = (item: ImportItem, list: BatchProperties): PartProps =>
  item.props ?? { ...list, description: "" };

/**
 * Mirror for one part. With "no open cut allows mirror" on, a part that has open cut
 * lines is never mirrored; otherwise the Mirror tick decides alone.
 */
export const mirrorFor = (item: ImportItem, props: BatchProperties, rules: ImportRules) =>
  mirrorBlocked(item, rules) ? false : props.mirror;

/** Mirror is not allowed: the part has open cut lines and the rule says so. */
export const mirrorBlocked = (item: ImportItem, rules: ImportRules) =>
  rules.mirrorWithoutOpenCut && hasOpenCut(item);

export const hasOpenCut = (item: ImportItem) =>
  !!item.drawing?.entities.some((e) => e.role === "openCut");

/**
 * What the list shows for a part:
 *   ok        - only closed contours (open lines are marked as tracing or open cut): ready to process
 *   attention - open lines that are neither tracing nor open cut
 */
export type Verdict = "reading" | "failed" | "dwg" | "unchecked" | "attention" | "duplicate" | "ok" | "processed";

export interface ItemStatus {
  verdict: Verdict;
  openContours: number;       // problems that block processing
  problems: string[];         // their labels with counts, for the list
  splines: number;
}

export function statusOf(item: ImportItem): ItemStatus {
  if (item.state !== "ready" || !item.drawing) {
    const verdict: Verdict = item.state === "dwg" ? "dwg" : item.state === "reading" ? "reading" : "failed";
    return { verdict, openContours: 0, problems: [], splines: 0 };
  }
  const report = checkGeometry(item.drawing.entities);
  const blocking = report.checks.filter((c) => c.id !== "splines" && c.count > 0);
  const open = blocking.reduce((n, c) => n + c.count, 0);
  const splines = report.checks.find((c) => c.id === "splines")?.count ?? 0;
  const verdict: Verdict = !item.checked ? "unchecked" : open > 0 ? "attention"
    : item.processed ? "processed" : item.duplicate ? "duplicate" : "ok";
  return { verdict, openContours: open, problems: blocking.map((c) => `${c.label.toLowerCase()}${c.count > 1 ? ` (${c.count})` : ""}`), splines };
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

export async function readItem(item: ImportItem, file: File, rules: ImportRules): Promise<ImportItem> {
  if (item.state === "dwg") return item;
  try {
    const { drawing, ignored, declaredUnits } = readDxf(await file.text(), file.name);
    const entities = applyRules(drawing.entities, rules);
    return { ...item, state: "ready", drawing: { ...drawing, id: item.id, entities }, ignored, declaredUnits };
  } catch (e) {
    return { ...item, state: "failed", error: e instanceof DxfError ? e.message : `Could not read the file (${(e as Error).message})` };
  }
}

export const isDrawingFile = (f: File) => /\.(dxf|dwg)$/i.test(f.name);
