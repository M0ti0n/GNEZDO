// Stock sheets of a job (the STOCK panel of the Work parts screen).

export type StockSource = "parts" | "default1" | "default2" | "default3" | "remnant" | "dxf";

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

export const STOCK_SOURCES: { id: StockSource; label: string }[] = [
  { id: "parts", label: "Job part list" },
  { id: "default1", label: "Default 1" },
  { id: "default2", label: "Default 2" },
  { id: "default3", label: "Default 3" },
  { id: "remnant", label: "Remnant" },
  { id: "dxf", label: "DXF" },
];

/** One of the three default sheet slots (Settings -> Stock): material and size. */
export interface DefaultSlot { material: string; lengthMm: number; widthMm: number }

/** Stock settings (GNEZDO menu -> Settings -> Stock). */
export interface StockSettings {
  /** Size of the sheets "Add from: Job part list" adds, one per material and thickness. */
  globalLengthMm: number;
  globalWidthMm: number;
  slots: [DefaultSlot, DefaultSlot, DefaultSlot];
}

export const DEFAULT_STOCK_SETTINGS: StockSettings = {
  globalLengthMm: 3000,
  globalWidthMm: 1500,
  slots: [
    { material: "", lengthMm: 3000, widthMm: 1500 },
    { material: "", lengthMm: 2500, widthMm: 1250 },
    { material: "", lengthMm: 2000, widthMm: 1000 },
  ],
};

const KEY = "gnezdo.stockSettings";

export function loadStockSettings(): StockSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_STOCK_SETTINGS;
    const v = JSON.parse(raw) as Partial<StockSettings>;
    const slots = DEFAULT_STOCK_SETTINGS.slots.map((d, i) => ({ ...d, ...(v.slots?.[i] ?? {}) })) as StockSettings["slots"];
    return { ...DEFAULT_STOCK_SETTINGS, ...v, slots };
  } catch {
    return DEFAULT_STOCK_SETTINGS;
  }
}

export function saveStockSettings(s: StockSettings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* not stored: kept for this session */ }
}

/** The slot a "Default n" source uses; null for the other sources. */
export const slotOf = (st: StockSettings, src: StockSource): DefaultSlot | null =>
  src === "default1" ? st.slots[0] : src === "default2" ? st.slots[1] : src === "default3" ? st.slots[2] : null;

let seq = 0;
export const newSheet = (s: Omit<StockSheet, "id">): StockSheet =>
  ({ id: `st${Date.now().toString(36)}${++seq}`, ...s, original: s.original ?? { lengthMm: s.lengthMm, widthMm: s.widthMm, outline: s.outline } });

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
