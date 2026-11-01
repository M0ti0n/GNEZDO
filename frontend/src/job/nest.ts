// Nesting runs from the job tab: what is sent to the server (parts, stock, mode) and what comes back.
// The server runs the nesting engine; this works in the demo too when GNEZDO.exe serves the pages.
import { api } from "../api/api";
import type { JobPart } from "../api/types";
import type { CustomNestSettings } from "../components/CustomNestDialog";
import type { StockSheet } from "./stock";
import type { Origin } from "./machine";

export type NestMode = "fast" | "thorough" | "custom";

export const NEST_MODE_LABEL: Record<NestMode, string> = { fast: "Fast nest", thorough: "Thorough nest", custom: "Custom nest" };

/** Distances until the technology tables exist [mm]. */
export const PART_GAP_MM = 5;
export const EDGE_GAP_MM = 5;

export interface NestRequestPart {
  id: string; name: string; path: string; qty: number;
  rotations: number[]; mirror: boolean; material: string; thicknessMm: number;
}

export interface NestRequestSheet {
  id: string; material: string; thicknessMm: number; lengthMm: number; widthMm: number;
  /** null: as many as needed */
  qty: number | null; source: string;
}

export interface NestRequest {
  mode: NestMode;
  /** the sheet corner the parts are packed towards (the machine's 0,0) */
  origin: Origin;
  minutes: number | null;
  stopAfterMinutes: number | null;
  partGapMm: number;
  edgeGapMm: number;
  parts: NestRequestPart[];
  sheets: NestRequestSheet[];
}

export interface PlacedPart { partId: string; x: number; y: number; angle: number; mirror: boolean }

export interface NestedSheet {
  sheetId: string; lengthMm: number; widthMm: number; material: string; thicknessMm: number;
  parts: PlacedPart[];
}

export interface NestResult {
  state: "done" | "stopped" | "error";
  seconds: number;
  sheets: NestedSheet[];
  /** nested pieces per part id */
  nested: Record<string, number>;
  skipped: { partId: string; reason: string }[];
  valid: boolean;
  errors: string[];
}

export interface NestGroupProgress {
  material: string; thicknessMm: number;
  stage: "waiting" | "prepare" | "nest" | "improve" | "done" | "error";
  sheets?: number; waste?: number; error?: string;
}

export interface NestRun {
  id: string;
  state: "queued" | "running" | "done" | "stopped" | "error";
  stopAsked: boolean;
  seconds: number;
  groups?: NestGroupProgress[];
  result?: NestResult;
  /** while it runs: the best layout found so far */
  best?: { sheets: NestedSheet[] };
  error?: string;
}

/** A nesting of a job tab: the run going on or finished, with what was asked. */
export interface JobNest {
  mode: NestMode;
  custom?: CustomNestSettings;
  run: NestRun | null;
  /** set when the run could not start or failed */
  error?: string;
  startedAt: number;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { Accept: "application/json", "Content-Type": "application/json" } });
  } catch {
    throw new Error("GNEZDO's server cannot be reached. Nesting needs GNEZDO running (start.bat).");
  }
  if (res.status === 404 && url === "/api/nest/status") throw new Error("Nesting needs GNEZDO running (start.bat); this demo page has no server.");
  if (!res.ok) {
    let detail = "";
    try {
      const j = await res.json();
      detail = j.detail ?? Object.values(j.errors ?? {}).flat().join(" ");
    } catch { /* not JSON */ }
    throw new Error(detail || `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export const nestApi = {
  status: () => call<{ available: boolean; reason: string | null }>("/api/nest/status"),
  start: (r: NestRequest) => call<NestRun>("/api/nest", { method: "POST", body: JSON.stringify(r) }),
  get: (id: string) => call<NestRun>(`/api/nest/${id}`),
  stop: (id: string) => call<NestRun>(`/api/nest/${id}/stop`, { method: "POST" }),
};

const sameKey = (m1: string, t1: number, m2: string, t2: number) =>
  m1.trim().toLowerCase() === m2.trim().toLowerCase() && Math.abs(t1 - t2) < 1e-6;

/** What to tell the user before starting, or null when the job can be nested. */
export function nestProblem(parts: JobPart[] | undefined, stock: StockSheet[]): string | null {
  if (!parts?.length) return "Add parts to the job first.";
  const withQty = parts.filter((jp) => jp.qty > 0);
  if (!withQty.length) return "Set Qty req for the parts to nest.";
  if (!stock.length) return "Add stock sheets first (STOCK panel, Add from).";
  const usable = withQty.filter((jp) => stock.some((s) => sameKey(s.material, s.thicknessMm, jp.part.material, jp.part.thicknessMm)));
  if (!usable.length) return "No stock sheet matches the parts' material and thickness.";
  return null;
}

/** The request for a job: parts with their nesting rules (fetched per part), the stock sheets. */
export async function buildRequest(parts: JobPart[], stock: StockSheet[], mode: NestMode, custom?: CustomNestSettings, origin: Origin = "top-left"): Promise<NestRequest> {
  const withQty = parts.filter((jp) => jp.qty > 0);
  const details = await Promise.all(withQty.map((jp) =>
    api.part(jp.part.id).then((d) => ({ rotations: d.rotations, mirror: d.mirror }))
      .catch(() => ({ rotations: [90], mirror: false }))));
  return {
    mode,
    origin,
    minutes: mode === "custom" ? custom?.minutes ?? null : null,
    stopAfterMinutes: mode === "custom" ? custom?.stopAfterMinutes ?? null : null,
    partGapMm: PART_GAP_MM,
    edgeGapMm: EDGE_GAP_MM,
    parts: withQty.map((jp, i) => ({
      id: jp.part.id, name: jp.part.name, path: jp.part.path, qty: jp.qty,
      rotations: details[i].rotations, mirror: details[i].mirror,
      material: jp.part.material, thicknessMm: jp.part.thicknessMm,
    })),
    sheets: stock.map((s) => ({
      id: s.id, material: s.material, thicknessMm: s.thicknessMm, lengthMm: s.lengthMm, widthMm: s.widthMm,
      qty: s.unlimited ? null : s.qty, source: s.source,
    })),
  };
}

export const isFinished = (r: NestRun | null | undefined) => !!r && (r.state === "done" || r.state === "stopped" || r.state === "error");

export const clockOf = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** One nesting of a job: a run (going on or finished) shown as "Solution n" in the SOLUTIONS panel. */
export interface Solution extends JobNest {
  id: string;
  no: number;
  /** sheets (by index) locked against changes; an unlocked sheet of a finished solution can be edited */
  locked: number[];
  /** the corner the parts were packed towards */
  origin?: Origin;
}

export const hms = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  return [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60].map((n) => String(n).padStart(2, "0")).join(":");
};

/** A colour of its own for every part of the job (by its ID in the work part list). */
export function partColor(no: number | undefined): { fill: string; stroke: string } {
  const n = no ?? 0;
  const h = (n * 137.508) % 360;  // golden angle: neighbours get far-apart hues
  // and three levels of lightness, so parts with similar hues still differ
  const l = [68, 56, 76][n % 3], sat = [62, 58, 70][n % 3];
  return { fill: `hsl(${h.toFixed(1)} ${sat}% ${l}%)`, stroke: `hsl(${h.toFixed(1)} 55% 28%)` };
}

/** Density [kg/dm³] from the material name; steel unless the name says otherwise. */
export function densityOf(material: string): number {
  const m = material.toUpperCase();
  if (/\bALU|ALMG|\bAL\b|ALUMIN/.test(m)) return 2.7;
  if (/INOX|1\.43|1\.44|1\.45|STAINLESS|AISI/.test(m)) return 7.9;
  if (/\bCU\b|COPPER/.test(m)) return 8.96;
  if (/BRASS|\bMS\b|MESSING/.test(m)) return 8.5;
  return 7.85;
}

/** Closed loops of a part outline path ("M x y L x y ... Z"), for lengths and extents. */
export function loopsOf(path: string): [number, number][][] {
  const loops: [number, number][][] = [];
  for (const sub of path.split(/(?=[Mm])/)) {
    const nums = sub.match(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];
    const pts: [number, number][] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
    if (pts.length > 2) loops.push(pts);
  }
  return loops;
}

const perimeter = (pts: [number, number][]) =>
  pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + Math.hypot(q[0] - p[0], q[1] - p[1]); }, 0);

/** The parts' extents on a sheet: placed outline points, transformed as the engine placed them. */
function placedExtent(path: string, p: PlacedPart) {
  const a = (p.angle * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const lp of loopsOf(path)) for (const [x0, y] of lp) {
    const x = p.mirror ? -x0 : x0;
    const X = x * c - y * s + p.x, Y = x * s + y * c + p.y;
    minX = Math.min(minX, X); maxX = Math.max(maxX, X); minY = Math.min(minY, Y); maxY = Math.max(maxY, Y);
  }
  return { minX, minY, maxX, maxY };
}

export interface SheetStats {
  /** extents of the parts from the sheet's corner [mm] */
  cutX: number; cutY: number;
  sheetKg: number; partsKg: number;
  /** among the parts, inside the cut area */
  scrapKg: number;
  /** strip after the parts (the sheet's length past the cut area), reusable */
  remnantKg: number; remnantPct: number;
  /** the rest: beside the cut area, too narrow for a remnant strip of the full width */
  unusedKg: number; unusedPct: number;
  /** cut length [m] and pierces (one per closed contour) */
  cutM: number; pierces: number;
  pieces: number;
}

export function sheetStats(sheet: NestedSheet, parts: Map<string, { path: string; areaMm2: number }>, origin: Origin = "top-left"): SheetStats {
  const t = sheet.thicknessMm, rho = densityOf(sheet.material);
  const kg = (areaMm2: number) => (areaMm2 * t * rho) / 1e6;  // mm² · mm → dm³ (1e6 mm³)
  let cutX = 0, cutY = 0, partsArea = 0, cut = 0, pierces = 0;
  for (const p of sheet.parts) {
    const part = parts.get(p.partId);
    if (!part) continue;
    // the cut area is measured from the origin corner
    const e = placedExtent(part.path, p);
    const right = origin.endsWith("right"), bottom = origin.startsWith("bottom");
    cutX = Math.max(cutX, right ? sheet.lengthMm - e.minX : e.maxX);
    cutY = Math.max(cutY, bottom ? sheet.widthMm - e.minY : e.maxY);
    partsArea += part.areaMm2;
    const loops = loopsOf(part.path);
    cut += loops.reduce((s, lp) => s + perimeter(lp), 0);
    pierces += loops.length;
  }
  const L = sheet.lengthMm, W = sheet.widthMm;
  cutX = Math.min(L, cutX); cutY = Math.min(W, cutY);
  const sheetA = L * W, cutA = cutX * cutY, remnantA = (L - cutX) * W;
  const unusedA = Math.max(0, sheetA - cutA - remnantA);
  return {
    cutX, cutY, pieces: sheet.parts.length,
    sheetKg: kg(sheetA), partsKg: kg(partsArea), scrapKg: kg(Math.max(0, cutA - partsArea)),
    remnantKg: kg(remnantA), remnantPct: (100 * remnantA) / sheetA,
    unusedKg: kg(unusedA), unusedPct: (100 * unusedA) / sheetA,
    cutM: cut / 1000, pierces,
  };
}


/** A finished solution as it is stored with the job. */
export interface SavedSolution {
  id: string; no: number; mode: NestMode; custom?: CustomNestSettings; origin?: Origin;
  state: "done" | "stopped"; seconds: number; locked: number[]; result: NestResult;
}

/** What a job stores of its nesting: every finished solution and the one shown (later: post-processed in Process). */
export interface JobNests { selected: string | null; solutions: SavedSolution[] }

/** The job's solutions to save: the finished ones (running and failed ones are not kept). */
export function nestsOfJob(list: Solution[], selected: string | null): JobNests | null {
  const done = list.filter((s) => s.run?.result && (s.run.state === "done" || s.run.state === "stopped"));
  if (!done.length) return null;
  return {
    selected: done.some((s) => s.id === selected) ? selected : done[done.length - 1].id,
    solutions: done.map((s) => ({
      id: s.id, no: s.no, mode: s.mode, custom: s.custom, origin: s.origin,
      state: s.run!.state === "stopped" ? "stopped" : "done", seconds: s.run!.seconds, locked: s.locked, result: s.run!.result!,
    })),
  };
}

/** A saved job's solutions back in the SOLUTIONS panel; null when it has none. */
export function solutionsFromSaved(nest: unknown): { list: Solution[]; sel: { sol: string | null; sheet: number } } | null {
  const n = nest as Partial<JobNests> & Partial<SavedSolution> | null;
  // a job saved with one solution only (before all solutions were kept)
  const saved: SavedSolution[] = n?.solutions ?? (n?.result ? [{ ...(n as SavedSolution), id: "saved", no: 1, locked: [] }] : []);
  const list: Solution[] = saved.filter((x) => x.result?.sheets?.length).map((x) => ({
    id: x.id, no: x.no, mode: x.mode ?? "fast", custom: x.custom, origin: x.origin, locked: x.locked ?? [], startedAt: 0,
    run: { id: x.id, state: x.state ?? "done", stopAsked: false, seconds: x.seconds ?? 0, result: x.result },
  }));
  if (!list.length) return null;
  const sel = list.some((x) => x.id === n?.selected) ? n!.selected! : list[list.length - 1].id;
  return { list, sel: { sol: sel, sheet: 0 } };
}
