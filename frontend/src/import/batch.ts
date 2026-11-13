import { checkGeometry, fixMarkRules, quantityFromName, type Drawing } from "./geometry";
import { DxfError } from "./dxf";
import { drawingBaseName, isDrawingName, readDrawingFile } from "./drawingFile";
import { applyRules, type ImportRules, type Rotation } from "./rules";
import { currentProfile, flatDrawing, isStepName, nestLimits, newStepPart, profileOf, type StepPart } from "./step/stepPart";

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
  /** Opened from the database (EDIT): the part's own properties, used by Process instead of the batch's. */
  source?: { partId: string; name: string; project: string; description: string; material: string; thicknessMm: string;
    rotations: Rotation[]; mirror: boolean; filler: boolean; commonCut: boolean };
  /** Rotations and mirror the part got when it was processed. */
  applied?: { rotations: Rotation[]; mirror: boolean; filler: boolean; commonCut: boolean };
  /** A STEP part (3D): unfolded; `drawing` is its flat pattern. */
  step?: StepPart;
  /** What the part itself asks of nesting and saving (a STEP part: its thickness, foil, grain). */
  own?: { thicknessMm?: string; noMirror?: boolean; rotations?: Rotation[] };
}

/** The Properties for one part: the list's, with what the part itself asks (a STEP part's thickness, foil, grain). */
export function itemProps(item: ImportItem, props: BatchProperties): BatchProperties {
  const o = item.own;
  if (!o) return props;
  return {
    ...props,
    ...(o.thicknessMm ? { thicknessMm: o.thicknessMm } : {}),
    ...(o.rotations ? { rotations: [...o.rotations] } : {}),
    ...(o.noMirror ? { mirror: false } : {}),
  };
}

/** A STEP part's own values from its settings (thickness found, foil, grain). */
export function ownOf(step: StepPart): ImportItem["own"] {
  const lim = nestLimits(step.settings);
  return { ...(step.info.thickness ? { thicknessMm: String(step.info.thickness) } : {}), ...lim };
}

/** Properties (Import panel): used for every part in the list, kept for the next import. */
export interface BatchProperties {
  project: string;
  description: string;
  material: string;
  thicknessMm: string;
  /** Rules: rotation steps the nesting may use, and whether parts may be mirrored. */
  rotations: Rotation[];
  mirror: boolean;
  /** Filler: nested only into gaps among the other parts (see filler.ts). */
  filler: boolean;
  /** Common cut: may share straight cut lines with neighbouring parts (see commonCut.ts); off by default. */
  commonCut: boolean;
}

/** New properties start from the import rules in Settings. */
export const propertiesFrom = (rules: ImportRules): BatchProperties => ({
  project: "", description: "", material: "", thicknessMm: "",
  rotations: [...rules.defaultRotations],
  mirror: rules.mirrorWithoutOpenCut,
  filler: rules.defaultFiller,
  commonCut: rules.commonOnOutline,
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


/**
 * Mirror for one part. With "no open cut allows mirror" on, a part that has open cut
 * lines is never mirrored; otherwise the Mirror tick decides alone.
 */
export const mirrorFor = (item: ImportItem, props: BatchProperties, rules: ImportRules) =>
  mirrorBlocked(item, rules) || item.own?.noMirror ? false : props.mirror;

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

/** The check runs once per version of a drawing: the list asks for it on every redraw. */
const checks = new WeakMap<object, ReturnType<typeof checkGeometry>>();
function checkedOnce(entities: Drawing["entities"]) {
  let r = checks.get(entities);
  if (!r) checks.set(entities, (r = checkGeometry(entities)));
  return r;
}

export function statusOf(item: ImportItem): ItemStatus {
  if (item.state !== "ready" || !item.drawing) {
    const verdict: Verdict = item.state === "dwg" ? "dwg" : item.state === "reading" ? "reading" : "failed";
    return { verdict, openContours: 0, problems: [], splines: 0 };
  }
  const report = checkedOnce(item.drawing.entities);
  const blocking = report.checks.filter((c) => c.id !== "splines" && c.count > 0);
  const open = blocking.reduce((n, c) => n + c.count, 0);
  const splines = report.checks.find((c) => c.id === "splines")?.count ?? 0;
  const verdict: Verdict = !item.checked ? "unchecked" : open > 0 ? "attention"
    : item.processed ? "processed" : item.duplicate ? "duplicate" : "ok";
  return { verdict, openContours: open, problems: blocking.map((c) => `${c.label.toLowerCase()}${c.count > 1 ? ` (${c.count})` : ""}`), splines };
}

let seq = 0;

/** New list entry for a dropped file (DXF, DWG or SVG); read by readItem. */
export function newItem(file: File): ImportItem {
  const name = drawingBaseName(file.name);
  return {
    id: `imp-${Date.now().toString(36)}-${++seq}`,
    fileName: file.name, name, qty: quantityFromName(name),
    state: "reading",
    checked: false, processed: false,
  };
}

export async function readItem(item: ImportItem, file: File, rules: ImportRules, material = ""): Promise<ImportItem> {
  if (item.state === "dwg") return item;
  if (isStepName(file.name)) {
    // a 3D part: unfolded at once with the profile's values; the unfold view changes them
    try {
      const text = await file.text();
      await new Promise((r) => setTimeout(r, 0));
      const { part, u } = newStepPart(text, profileOf(currentProfile()), material);
      if (!u.outline.length) return { ...item, state: "failed", error: u.problems[0] ?? "This STEP part could not be unfolded" };
      return { ...item, state: "ready", step: part, own: ownOf(part), drawing: flatDrawing(item.id, item.name, u, part.settings) };
    } catch (e) {
      return { ...item, state: "failed", error: `Could not read the STEP file (${(e as Error).message})` };
    }
  }
  try {
    const { drawing, ignored, declaredUnits } = await readDrawingFile(file);
    // roles come from layers and colors; the outer contour is always plain cutting and a closed
    // contour never open cut, whatever color it was drawn in
    const { entities } = fixMarkRules(applyRules(drawing.entities, rules));
    return { ...item, state: "ready", drawing: { ...drawing, id: item.id, entities }, ignored, declaredUnits };
  } catch (e) {
    return { ...item, state: "failed", error: e instanceof DxfError ? e.message : `Could not read the file (${(e as Error).message})` };
  }
}

export const isDrawingFile = (f: File) => isDrawingName(f.name);
