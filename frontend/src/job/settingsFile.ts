// Settings → Data → Settings file: GNEZDO's shared settings as one readable JSON file, to keep with the
// backups, to set up a new installation, or to move from the desktop to the server. Export writes what
// this page uses; Import replaces the shared settings with what the file has (a part the file does not
// have stays as it is).

import { normalizeRules, type ImportRules } from "../import/rules";
import { normalizeMachines, type MachineList } from "./machine";
import { normalizeNestingRules, type NestingRules } from "./nestRules";
import { normalizeStock, type StockSettings } from "./stock";

/** The added special tools and which tools are off, as the "specialTools" setting keeps them. */
export interface ToolsSetting { tools: unknown[]; off: string[] }

export interface SettingsBundle {
  machines?: MachineList;
  stock?: StockSettings;
  importRules?: ImportRules;
  nestingRules?: NestingRules;
  specialTools?: ToolsSetting;
}

/** The parts of a settings file, as Import lists them. */
export const SETTING_PARTS: { key: keyof SettingsBundle; label: string }[] = [
  { key: "machines", label: "Machines" },
  { key: "stock", label: "Stock and remnants" },
  { key: "importRules", label: "Import rules" },
  { key: "nestingRules", label: "Nesting rules" },
  { key: "specialTools", label: "Special tools" },
];

const KIND = "gnezdo-settings";
const VERSION = 1;

export function settingsFileText(b: SettingsBundle, by?: string): string {
  return JSON.stringify({ kind: KIND, version: VERSION, exportedAt: new Date().toISOString(), ...(by ? { exportedBy: by } : {}), ...b }, null, 2);
}

export function settingsFileName(at = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `gnezdo-settings-${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}.json`;
}

/** Reads a settings file: what it has, checked and filled up with the defaults; throws when it is not one. */
export function readSettingsFile(text: string): { bundle: SettingsBundle; exportedAt?: string; exportedBy?: string } {
  let o: Record<string, unknown>;
  try { o = JSON.parse(text.replace(/^﻿/, "")) as Record<string, unknown>; }
  catch { throw new Error("This is not a GNEZDO settings file (not JSON)."); }
  if (!o || typeof o !== "object" || o.kind !== KIND) throw new Error("This is not a GNEZDO settings file.");
  if (typeof o.version !== "number" || o.version > VERSION) throw new Error("This settings file is from a newer GNEZDO: update GNEZDO first.");
  const bad = (what: string) => new Error(`The settings file's ${what} could not be read.`);
  const b: SettingsBundle = {};
  if (o.machines !== undefined) { b.machines = normalizeMachines(o.machines) ?? undefined; if (!b.machines) throw bad("machines"); }
  if (o.stock !== undefined) { b.stock = normalizeStock(o.stock) ?? undefined; if (!b.stock) throw bad("stock and remnants"); }
  if (o.importRules !== undefined) { b.importRules = normalizeRules(o.importRules) ?? undefined; if (!b.importRules) throw bad("import rules"); }
  if (o.nestingRules !== undefined) { b.nestingRules = normalizeNestingRules(o.nestingRules) ?? undefined; if (!b.nestingRules) throw bad("nesting rules"); }
  if (o.specialTools !== undefined) {
    const t = o.specialTools as Partial<ToolsSetting> | null;
    if (!t || !Array.isArray(t.tools)) throw bad("special tools");
    b.specialTools = {
      tools: t.tools.filter((x) => x && typeof x === "object" && (x as { manifest?: unknown }).manifest && typeof (x as { script?: unknown }).script === "string"),
      off: Array.isArray(t.off) ? t.off.filter((x): x is string => typeof x === "string") : [],
    };
  }
  if (!SETTING_PARTS.some((p) => b[p.key] !== undefined)) throw new Error("The settings file is empty.");
  return { bundle: b, exportedAt: typeof o.exportedAt === "string" ? o.exportedAt : undefined, exportedBy: typeof o.exportedBy === "string" ? o.exportedBy : undefined };
}

/** "3 machines", "2 special tools": what Import replaces, part by part. */
export function partSummary(b: SettingsBundle): string[] {
  return SETTING_PARTS.filter((p) => b[p.key] !== undefined).map((p) => {
    if (p.key === "machines") { const n = b.machines!.list.length; return `Machines (${n} machine${n === 1 ? "" : "s"})`; }
    if (p.key === "specialTools") { const n = b.specialTools!.tools.length; return `Special tools (${n} added tool${n === 1 ? "" : "s"})`; }
    return p.label;
  });
}
