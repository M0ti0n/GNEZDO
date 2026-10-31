// Nesting runs from the job tab: what is sent to the server (parts, stock, mode) and what comes back.
// The server runs the nesting engine; this works in the demo too when GNEZDO.exe serves the pages.
import { api } from "../api/api";
import type { JobPart } from "../api/types";
import type { CustomNestSettings } from "../components/CustomNestDialog";
import type { StockSheet } from "./stock";

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
export async function buildRequest(parts: JobPart[], stock: StockSheet[], mode: NestMode, custom?: CustomNestSettings): Promise<NestRequest> {
  const withQty = parts.filter((jp) => jp.qty > 0);
  const details = await Promise.all(withQty.map((jp) =>
    api.part(jp.part.id).then((d) => ({ rotations: d.rotations, mirror: d.mirror }))
      .catch(() => ({ rotations: [90], mirror: false }))));
  return {
    mode,
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
