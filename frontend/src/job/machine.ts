// Machine settings (GNEZDO menu -> Settings -> Machine).

/** The sheet corner where the machine's 0,0 is; nesting packs the parts towards it. */
export type Origin = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export const ORIGINS: { id: Origin; label: string }[] = [
  { id: "top-left", label: "Top left" },
  { id: "top-right", label: "Top right" },
  { id: "bottom-left", label: "Bottom left" },
  { id: "bottom-right", label: "Bottom right" },
];

export interface MachineSettings {
  origin: Origin;
  /** The largest sheet the machine can cut [mm]; bigger sheets are refused in the STOCK panel. */
  cutLengthMm: number;
  cutWidthMm: number;
}

export const DEFAULT_MACHINE_SETTINGS: MachineSettings = { origin: "top-left", cutLengthMm: 3000, cutWidthMm: 1500 };

const KEY = "gnezdo.machineSettings";

export function loadMachineSettings(): MachineSettings {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<MachineSettings> | null;
    return { ...DEFAULT_MACHINE_SETTINGS, ...(v ?? {}) };
  } catch {
    return DEFAULT_MACHINE_SETTINGS;
  }
}

export function saveMachineSettings(s: MachineSettings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* kept for this session */ }
}
