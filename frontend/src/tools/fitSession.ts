// SPECIAL TOOLS: the tool being used (a plug-in tool, Settings -> Special tools), its values, how many, the part
// shown, and the name, material and thickness its parts go to Import 2D with ("" / missing: the tool's own
// name, the Import 2D properties' material and thickness).

import type { Entity } from "../import/geometry";

export interface FitSession {
  /** The tool: "tool:<its id>" ("": none picked yet, the first one) */
  kind: `tool:${string}` | "";
  /** The tools' values, by tool id */
  tools?: Record<string, Record<string, number | boolean | string>>;
  count: Partial<Record<string, number>>; pick: Partial<Record<string, string>>;
  name?: Partial<Record<string, string>>; material?: Partial<Record<string, string>>; thick?: Partial<Record<string, string>>;
}

export const newFitSession = (): FitSession => ({ kind: "", tools: {}, count: {}, pick: {}, name: {}, material: {}, thick: {} });

/** One part a tool makes: `qty` of it per set. */
export interface FittingPart { key: string; label: string; name: string; qty: number; entities: Entity[]; w: number; h: number }
