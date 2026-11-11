// Machines (GNEZDO menu -> Settings -> Machines): shared by everyone, kept on the server (in the demo,
// in the browser). A job is nested for one machine: its 0,0 corner, cutting area and gaps.

/** The sheet corner where the machine's 0,0 is; nesting packs the parts towards it. */
import type { TechSet } from "./technology";
import type { LeadRules } from "./leads";
import type { Postprocessor } from "./postprocessor";

export type Origin = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export const ORIGINS: { id: Origin; label: string }[] = [
  { id: "top-left", label: "Top left" },
  { id: "top-right", label: "Top right" },
  { id: "bottom-left", label: "Bottom left" },
  { id: "bottom-right", label: "Bottom right" },
];

export type Technology = "laser" | "plasma" | "waterjet" | "other";

export const TECHNOLOGIES: { id: Technology; label: string }[] = [
  { id: "laser", label: "Laser" },
  { id: "plasma", label: "Plasma" },
  { id: "waterjet", label: "Waterjet" },
  { id: "other", label: "Other" },
];

export interface Machine {
  id: string;
  name: string;
  technology: Technology;
  /** The largest sheet it can cut [mm]. */
  cutLengthMm: number;
  cutWidthMm: number;
  origin: Origin;
  /** Default gaps of a new sheet for this machine [mm]: edges by the machine's axes, between parts. */
  trims: { xMinus: number; xPlus: number; yMinus: number; yPlus: number };
  partGapMm: number;
  /** Cutting beam diameter [mm]; 0 = not set. */
  kerfMm: number;
  /** Which line properties it cuts; the others are skipped for its jobs (missing = it can). */
  lines?: Partial<Record<LineCapability, boolean>>;
  /** Writes its NC programs (Settings -> Machines -> NC output); missing = none yet. */
  postprocessor?: Postprocessor;
  /** How the automatic cut orders the parts (missing = the defaults). */
  cutOrder?: Partial<CutOrderRules>;
  /** Where the automatic cut puts which lead pair (Settings -> Machines -> Leads & cutting); missing = the defaults. */
  leads?: Partial<LeadRules>;
  /** Technology tables: cutting values per material and thickness (Settings -> Machines -> Technology). */
  technologies?: TechSet[];
  /** Where the server writes this machine's files (Settings -> Machines -> Machine -> Folders). Not in an exported machine file. */
  folders?: Partial<MachineFolders>;
}

/** A machine's folders, paths on the GNEZDO server (or a network share it reaches). */
export interface MachineFolders {
  /** NC programs go here. */
  nc: string;
  /** No NC folder: the NC program is downloaded in the browser instead (else it cannot be written). */
  ncDownload: boolean;
  /** Job files go here, when jobFile is ticked. */
  jobs: string;
  /** Every job saved for the machine is also written as a file (the database stays the main copy). */
  jobFile: boolean;
}

export const foldersOf = (m: Machine | undefined): MachineFolders => ({ nc: "", ncDownload: false, jobs: "", jobFile: false, ...(m?.folders ?? {}) });

/** Line properties of a part a machine may or may not do (contours it always cuts). */
export type LineCapability = "commonCut" | "openCut" | "trace" | "hole";

export const LINE_CAPABILITIES: { id: LineCapability; label: string; help: string }[] = [
  { id: "commonCut", label: "Common cut", help: "Shared straight edges of neighbouring parts cut once" },
  { id: "openCut", label: "Open cut", help: "Cut along open lines (slits)" },
  { id: "trace", label: "Tracing", help: "Marking / engraving lines, not cut through" },
  { id: "hole", label: "Holes", help: "Holes cut at the small-hole speed" },
];

/** The machine's cut order rules for Generate path, in this rank: always (not switchable) holes and
 * tracing first, the outline last, and a part lying inside another part's outline / window before that
 * part (no islands); then, when ticked, significantly bigger parts last (heat expansion). These outrank
 * the order the operator picks under AUTO CUT (direction, shortest travel, small to big, ...). */
export interface CutOrderRules {
  /** Significantly bigger parts last, so heat expansion does not shift the plate. "Last" within the big
   * part's bounding box only: the AUTO CUT order (e.g. left to right) runs as usual up to the box, then
   * cuts every part in the box (touching it counts) in the same order, then the big part, then carries
   * on past the box. Parts away from the box are not held back. */
  bigLast: boolean;
  /** "Significantly bigger": area over this many times the sheet's median part ... */
  bigTimesMedian: number;
  /** ... or over this share of the sheet [%] */
  bigSheetPct: number;
}

export const DEFAULT_CUT_ORDER: CutOrderRules = { bigLast: true, bigTimesMedian: 5, bigSheetPct: 20 };

export const cutOrderOf = (m: Machine | undefined): CutOrderRules => {
  const r = { ...DEFAULT_CUT_ORDER, ...(m?.cutOrder ?? {}) };
  // machines saved earlier also carry directions and holes / inside first: directions go to AUTO CUT, the rest is always on
  return { bigLast: r.bigLast, bigTimesMedian: r.bigTimesMedian, bigSheetPct: r.bigSheetPct };
};

/** Does the machine do this line property? */
export const machineCan = (m: Machine | undefined, c: LineCapability) => m?.lines?.[c] !== false;

export interface MachineList { defaultId: string; list: Machine[] }

export const newMachine = (n: number, base?: Partial<Machine>): Machine => ({
  id: `m${Date.now().toString(36)}${n}`, name: `Machine ${n}`, technology: "laser",
  cutLengthMm: 3000, cutWidthMm: 1500, origin: "top-left",
  trims: { xMinus: 5, xPlus: 5, yMinus: 5, yPlus: 5 }, partGapMm: 5, kerfMm: 0,
  ...base,
});

export const DEFAULT_MACHINES: MachineList = (() => {
  const m = { ...newMachine(1), id: "laser-1", name: "Laser 1" };
  return { defaultId: m.id, list: [m] };
})();

const KEY = "gnezdo.machines";
const OLD_KEY = "gnezdo.machineSettings";  // one machine, before the list existed

/** Fills in what an older or partial list lacks. */
export function normalizeMachines(v: unknown): MachineList | null {
  const m = v as Partial<MachineList> | null;
  if (!m || !Array.isArray(m.list) || !m.list.length) return null;
  const list = m.list.map((x, i) => ({ ...newMachine(i + 1), ...x, trims: { ...newMachine(i + 1).trims, ...(x.trims ?? {}) } }));
  return { defaultId: list.some((x) => x.id === m.defaultId) ? m.defaultId! : list[0].id, list };
}

/** From the browser: the saved list, else the single machine of earlier versions, else the defaults. */
export function loadLocalMachines(): MachineList {
  try {
    const saved = normalizeMachines(JSON.parse(localStorage.getItem(KEY) ?? "null"));
    if (saved) return saved;
    const old = JSON.parse(localStorage.getItem(OLD_KEY) ?? "null") as { origin?: Origin; cutLengthMm?: number; cutWidthMm?: number } | null;
    if (old) return { defaultId: "laser-1", list: [{ ...DEFAULT_MACHINES.list[0], ...old }] };
  } catch { /* defaults */ }
  return DEFAULT_MACHINES;
}

export function saveLocalMachines(m: MachineList) {
  try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* kept for this session */ }
}

export const machineOf = (m: MachineList, id: string | undefined): Machine =>
  m.list.find((x) => x.id === id) ?? m.list.find((x) => x.id === m.defaultId) ?? m.list[0];
