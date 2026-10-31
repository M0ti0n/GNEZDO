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
}

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
export const newSheet = (s: Omit<StockSheet, "id">): StockSheet => ({ id: `st${Date.now().toString(36)}${++seq}`, ...s });

export const sheetKey = (material: string, thicknessMm: number) => `${material.trim().toLowerCase()}|${thicknessMm}`;

/** Largest sheet the machine can cut [length, width] mm: Settings -> Machine -> Cutting area (setMachineLimit). */
export const MACHINE_LIMIT: [number, number] = [3000, 1500];
/** Called when the machine settings are loaded or changed. */
export function setMachineLimit(l: number, w: number) {
  if (l > 0 && w > 0) { MACHINE_LIMIT[0] = l; MACHINE_LIMIT[1] = w; }
}

/** Does a sheet fit the machine's cutting area (either way round)? */
export const fitsMachine = (l: number, w: number) => {
  const [L, W] = MACHINE_LIMIT;
  return (l <= L && w <= W) || (l <= W && w <= L);
};
