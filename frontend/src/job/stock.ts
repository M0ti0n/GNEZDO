import { DEFAULT_REMNANT_SETTINGS, type RemnantSettings } from "./remnant";
// Stock sheets of a job (the STOCK panel of the Work parts screen).

/** manual: added by Add sheet in Manual nest */
export type StockSource = "parts" | "default1" | "default2" | "default3" | "default4" | "remnant" | "dxf" | "manual";

export interface StockSheet {
  id: string;
  source: StockSource;
  material: string;
  thicknessMm: number;
  lengthMm: number;        // X
  widthMm: number;         // Y
  qty: number;
  unlimited: boolean;
  /** For a sheet from a DXF file: the file it came from. */
  fileName?: string;
  /** For a sheet taken from the remnant store: the saved remnant's name. */
  remnant?: string;
  /**
   * Gap from each sheet edge to the parts [mm], by the machine's axes (X- is the edge at the machine's
   * 0,0 in X, ...): they stay with the machine when the sheet is turned or mirrored. Missing = default.
   */
  trims?: Trims;
  /** Gap between parts on this sheet [mm]; missing = default. */
  partGapMm?: number;
  /** Cutting beam diameter (kerf) [mm], for the post-processor; missing = not set. */
  kerfMm?: number;
  /**
   * The sheet's own shape when it is not a plain rectangle (from a DXF): closed loops, mm, y down,
   * inside 0..length x 0..width; the first loop is the outline, the others holes. Turned and mirrored
   * with the sheet.
   */
  outline?: [number, number][][];
  /** Size (and shape) as added, for RESET. */
  original?: { lengthMm: number; widthMm: number; outline?: [number, number][][] };
}

export interface Trims { xMinus: number; xPlus: number; yMinus: number; yPlus: number }

/** Until the technology tables exist. */
export const DEFAULT_TRIM_MM = 5;
export const DEFAULT_PART_GAP_MM = 5;
export const defaultTrims = (): Trims => ({ xMinus: DEFAULT_TRIM_MM, xPlus: DEFAULT_TRIM_MM, yMinus: DEFAULT_TRIM_MM, yPlus: DEFAULT_TRIM_MM });

type Loops = [number, number][][];

/** Turns the sheet 90 degrees clockwise (as drawn): length and width swap, the shape turns with it. */
export function rotateSheet(s: StockSheet): StockSheet {
  const W = s.widthMm;
  const outline = s.outline?.map((lp) => lp.map(([x, y]) => [W - y, x] as [number, number]));
  return { ...s, lengthMm: s.widthMm, widthMm: s.lengthMm, outline };
}

/** Mirrors the sheet left to right (along X) or top to bottom (along Y); only a shaped sheet changes. */
export function mirrorSheet(s: StockSheet, axis: "x" | "y"): StockSheet {
  const L = s.lengthMm, W = s.widthMm;
  const flip = (lp: [number, number][]) => lp.map(([x, y]) => (axis === "x" ? [L - x, y] : [x, W - y]) as [number, number]).reverse();
  return { ...s, outline: s.outline?.map(flip) };
}

/** The sheet's shape for drawing: its outline, else its rectangle. */
export const sheetLoops = (s: { lengthMm: number; widthMm: number; outline?: Loops }): Loops =>
  s.outline?.length ? s.outline : [[[0, 0], [s.lengthMm, 0], [s.lengthMm, s.widthMm], [0, s.widthMm]]];

/** A saved remnant (Remnants) as a stock sheet: its size, shape and pieces (one sheet per piece, not
 *  unlimited). The material, thickness and gaps come in `base`. A plain rectangle gets no shape. Turned
 *  90° when only that way it fits the machine (`fits`). */
export function remnantSheet(
  r: { name: string; qty?: number; outline: number[][]; holes?: number[][][] },
  base: Omit<StockSheet, "id" | "source" | "lengthMm" | "widthMm" | "qty" | "unlimited">,
  fits: (l: number, w: number) => boolean,
): { sheet: StockSheet; turned: boolean; tooBig: boolean } {
  const loops = [r.outline, ...(r.holes ?? [])].map((l) => l.map(([x, y]) => [x, y] as [number, number]));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of loops[0]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const rd = (v: number) => Math.round(v * 100) / 100;
  const at0 = loops.map((l) => l.map(([x, y]) => [rd(x - x0), rd(y - y0)] as [number, number]));
  const l = rd(x1 - x0), w = rd(y1 - y0);
  const rect = at0.length === 1 && at0[0].length === 4 && at0[0].every(([x, y]) => (Math.abs(x) < 0.05 || Math.abs(x - l) < 0.05) && (Math.abs(y) < 0.05 || Math.abs(y - w) < 0.05));
  const outline = rect ? undefined : at0;
  let sheet = newSheet({ ...base, source: "remnant", remnant: r.name, fileName: undefined, lengthMm: l, widthMm: w,
    qty: Math.max(1, r.qty ?? 1), unlimited: false, outline, original: undefined });
  const turned = !fits(l, w) && fits(w, l);
  if (turned) {
    sheet = rotateSheet(sheet);
    sheet = { ...sheet, original: { lengthMm: sheet.lengthMm, widthMm: sheet.widthMm, outline: sheet.outline } };
  }
  return { sheet, turned, tooBig: !fits(l, w) && !turned };
}

/** Sheets the Job part list / default choices count as there for a material: not remnants or DXF shapes. */
export const isFullSheet = (s: StockSheet) => s.source !== "remnant" && s.source !== "dxf";

export const STOCK_SOURCES: { id: StockSource; label: string }[] = [
  { id: "parts", label: "Job part list" },
  { id: "default1", label: "Default 1" },
  { id: "default2", label: "Default 2" },
  { id: "default3", label: "Default 3" },
  { id: "default4", label: "Default 4" },
  { id: "remnant", label: "Remnant" },
  { id: "dxf", label: "DXF" },
];

/** One of the four default sheet slots (Settings -> Stock): material and size. */
export interface DefaultSlot { material: string; lengthMm: number; widthMm: number }

/** Stock settings (GNEZDO menu -> Settings -> Stock). */
export interface StockSettings {
  /** Size of the sheets "Add from: Job part list" adds, one per material and thickness. */
  globalLengthMm: number;
  globalWidthMm: number;
  slots: [DefaultSlot, DefaultSlot, DefaultSlot, DefaultSlot];
  /** Process -> Remnant */
  remnant: RemnantSettings;
}

export const DEFAULT_STOCK_SETTINGS: StockSettings = {
  globalLengthMm: 3000,
  globalWidthMm: 1500,
  slots: [
    { material: "", lengthMm: 3000, widthMm: 1500 },
    { material: "", lengthMm: 2500, widthMm: 1250 },
    { material: "", lengthMm: 2000, widthMm: 1000 },
    { material: "", lengthMm: 4000, widthMm: 2000 },
  ],
  remnant: DEFAULT_REMNANT_SETTINGS,
};

const KEY = "gnezdo.stockSettings";

/** Stock settings as saved (on the server, or in this browser), filled up with the defaults; null: none saved. */
export function normalizeStock(raw: unknown): StockSettings | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const v = raw as Partial<StockSettings>;
  const slots = DEFAULT_STOCK_SETTINGS.slots.map((d, i) => ({ ...d, ...(v.slots?.[i] ?? {}) })) as StockSettings["slots"];
  return { ...DEFAULT_STOCK_SETTINGS, ...v, slots, remnant: { ...DEFAULT_REMNANT_SETTINGS, ...(v.remnant ?? {}) } };
}

/** This browser's copy (the server's, as last loaded; all there is in the demo). */
export function loadStockSettings(): StockSettings {
  try { return normalizeStock(JSON.parse(localStorage.getItem(KEY) ?? "null")) ?? DEFAULT_STOCK_SETTINGS; }
  catch { return DEFAULT_STOCK_SETTINGS; }
}

export function saveStockSettings(s: StockSettings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* not stored: kept for this session */ }
}

/** The slot a "Default n" source uses; null for the other sources. */
export const slotOf = (st: StockSettings, src: StockSource): DefaultSlot | null =>
  src === "default1" ? st.slots[0] : src === "default2" ? st.slots[1] : src === "default3" ? st.slots[2] : src === "default4" ? st.slots[3] : null;

let seq = 0;
export const newSheet = (s: Omit<StockSheet, "id">): StockSheet =>
  ({ id: `st${Date.now().toString(36)}${++seq}`, ...s, original: s.original ?? { lengthMm: s.lengthMm, widthMm: s.widthMm, outline: s.outline } });

type Stocked = { material: string; thicknessMm: number };
/** A part of this material and thickness may go on the sheet (the same as the sheet's). */
export const sameStock = (a: Stocked, b: Stocked) =>
  a.material.trim().toLowerCase() === b.material.trim().toLowerCase() && Math.abs(a.thicknessMm - b.thicknessMm) < 1e-6;
/** The parts on a sheet (their numbers) that are not of the sheet's material and thickness (e.g. the part
 *  was changed to another thickness after it was nested): they are not cut, nor post processed. */
export function wrongStock(sheet: Stocked & { parts: { partId: string }[] }, partOf: (id: string) => Stocked | undefined): number[] {
  return sheet.parts.flatMap((p, i) => { const q = partOf(p.partId); return q && !sameStock(q, sheet) ? [i] : []; });
}
/** What a sheet with such parts says, e.g. "Sheet 2: BRACKET is S235 15 mm, the sheet HARDOX 10 mm". */
export function wrongStockText(sheetNo: number, sheet: Stocked, wrong: { name: string; material: string; thicknessMm: number }[]): string {
  const first = wrong[0];
  const more = wrong.length > 1 ? ` (and ${wrong.length - 1} more)` : "";
  return `Sheet ${sheetNo}: ${first.name} is ${first.material} ${first.thicknessMm} mm${more}, the sheet ${sheet.material} ${sheet.thicknessMm} mm. Take ${wrong.length > 1 ? "them" : "it"} off the sheet (Manual nest) or nest again`;
}

export const sheetKey = (material: string, thicknessMm: number) => `${material.trim().toLowerCase()}|${thicknessMm}`;

/** Largest sheet the machine can cut [length, width] mm: Settings -> Machine -> Cutting area (setMachineLimit). */
export const MACHINE_LIMIT: [number, number] = [3000, 1500];
/** Called when the machine settings are loaded or changed. */
export function setMachineLimit(l: number, w: number) {
  if (l > 0 && w > 0) { MACHINE_LIMIT[0] = l; MACHINE_LIMIT[1] = w; }
}

/** Does a sheet fit the machine's cutting area as it lies: length within X, width within Y? */
export const fitsMachine = (l: number, w: number) => {
  const [L, W] = MACHINE_LIMIT;
  return l <= L && w <= W;
};
