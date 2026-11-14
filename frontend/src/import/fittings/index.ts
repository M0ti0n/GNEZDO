// FITTINGS: the six fittings of the importer's FITTINGS group (from the HVAC Fittings workbench), their
// values and the flat parts they make.

import type { Entity } from "../geometry";
import type { Lines } from "./arcs";
import { ELBOW_DEFAULTS, elbowPieces, elbowProblems, type ElbowValues } from "./elbow";
import { TRANSITION_DEFAULTS, transitionPieces, transitionProblems, type TransitionValues } from "./transition";
import { BRANCH_DEFAULTS, branchPieces, branchProblems, type BranchValues } from "./branch";
import {
  FLANGE_DEFAULTS, THREAD_FLANGE_DEFAULTS, flangePieces, flangeProblems, threadFlangePieces, threadFlangeProblems,
  type FlangeValues, type ThreadFlangeValues,
} from "./flange";
import { SCREW_DEFAULTS, screwPieces, screwProblems, type ScrewValues } from "./screw";

export type FittingKind = "elbow" | "transition" | "branch" | "flange" | "thread" | "screw";

export interface FittingValues {
  elbow: ElbowValues; transition: TransitionValues; branch: BranchValues;
  flange: FlangeValues; thread: ThreadFlangeValues; screw: ScrewValues;
}

export const FITTING_KINDS: FittingKind[] = ["elbow", "transition", "branch", "flange", "thread", "screw"];

export const FITTING_NAMES: Record<FittingKind, string> = {
  elbow: "Segmented elbow", transition: "Rect. to round transition", branch: "Branch reducer",
  flange: "Flange", thread: "Threaded flange", screw: "Screw flight",
};

export const FITTING_DEFAULTS: FittingValues = {
  elbow: ELBOW_DEFAULTS, transition: TRANSITION_DEFAULTS, branch: BRANCH_DEFAULTS,
  flange: FLANGE_DEFAULTS, thread: THREAD_FLANGE_DEFAULTS, screw: SCREW_DEFAULTS,
};

/** The fitting being made in the Fittings tab: each fitting keeps its values, how many and the part shown. */
export interface FitSession { kind: FittingKind; values: FittingValues; count: Record<FittingKind, number>; pick: Partial<Record<FittingKind, string>> }

export const newFitSession = (kind: FittingKind = "elbow"): FitSession => ({
  kind, values: FITTING_DEFAULTS, count: { elbow: 1, transition: 1, branch: 1, flange: 1, thread: 1, screw: 1 }, pick: {},
});

/** One flat part of a fitting: `qty` of it per fitting. */
export interface FittingPart { key: string; label: string; name: string; qty: number; entities: Entity[]; w: number; h: number }

const g = (x: number) => String(Math.round(x * 100) / 100);

/** The fitting's name in its parts' names: "ELBOW D300 A90". */
export function fittingTitle<K extends FittingKind>(kind: K, values: FittingValues[K]): string {
  const v = values as never as Record<string, number | string>;
  switch (kind) {
    case "elbow": return `ELBOW D${g(+v.d)} A${g(+v.a)}`;
    case "transition": return `TR ${g(+v.a + +v.b)}x${g(+v.e + +v.f)}-D${g(+v.d)}`;
    case "branch": return `RB D${g(+v.d1)}-${g(+v.d2)} D${g(+v.d3)}`;
    case "flange": return `FL A${g(+v.a)}`;
    case "thread": return `TFL A${g(+v.a)} ${v.m}`;
    default: return `SF OD${g(+v.od)} ID${g(+v.id)} P${g(+v.p)}`;
  }
}

/** A part's ending after the fitting's name ("" for the one piece of a fitting, or its whole form). */
const SUFFIX: Record<string, string> = { C: "", W: "", R: "", F: "", SA: "A", SB: "B" };

/** Which part of which fitting with which values: the same again is the same part (replaced in the list). */
export const fittingSig = <K extends FittingKind>(kind: K, values: FittingValues[K], key: string) => `${kind}:${JSON.stringify(values)}:${key}`;

export function fittingProblems<K extends FittingKind>(kind: K, values: FittingValues[K]): string[] {
  const v = values as never;
  switch (kind) {
    case "elbow": return elbowProblems(v);
    case "transition": return transitionProblems(v);
    case "branch": return branchProblems(v);
    case "flange": return flangeProblems(v);
    case "thread": return threadFlangeProblems(v);
    default: return screwProblems(v);
  }
}

/** The fitting's flat parts, or the reason it cannot be made. */
export function fittingParts<K extends FittingKind>(kind: K, values: FittingValues[K]): { parts: FittingPart[]; problems: string[] } {
  const problems = fittingProblems(kind, values);
  if (problems.length) return { parts: [], problems };
  const v = values as never;
  let pieces: { key: string; label: string; qty: number; lines: Lines }[];
  try {
    switch (kind) {
      case "elbow": pieces = elbowPieces(v); break;
      case "transition": pieces = transitionPieces(v); break;
      case "branch": pieces = branchPieces(v); break;
      case "flange": pieces = flangePieces(v); break;
      case "thread": pieces = threadFlangePieces(v); break;
      default: pieces = screwPieces(v);
    }
  } catch (e) {
    return { parts: [], problems: [e instanceof Error ? e.message : String(e)] };
  }
  const title = fittingTitle(kind, values);
  const parts = pieces.map((p) => {
    const b = p.lines.build(`fit-${kind}-${p.key}-`);
    const sfx = SUFFIX[p.key] ?? p.key;
    return { key: p.key, label: p.label, name: sfx ? `${title}-${sfx}` : title, qty: p.qty, entities: b.entities, w: b.w, h: b.h };
  });
  return { parts, problems: [] };
}
