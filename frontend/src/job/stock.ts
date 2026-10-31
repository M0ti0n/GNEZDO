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

/** Default sheet sizes [length, width] mm. Will be set in Settings; these until then. */
export const DEFAULT_SIZES: Record<"default1" | "default2" | "default3", [number, number]> = {
  default1: [3000, 1500],
  default2: [2500, 1250],
  default3: [2000, 1000],
};

let seq = 0;
export const newSheet = (s: Omit<StockSheet, "id">): StockSheet => ({ id: `st${Date.now().toString(36)}${++seq}`, ...s });

export const sheetKey = (material: string, thicknessMm: number) => `${material.trim().toLowerCase()}|${thicknessMm}`;
