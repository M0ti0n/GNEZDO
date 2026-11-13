// A STEP part in the import list: the solid, how it is unfolded, and its flat pattern as a drawing.
// The flat pattern lies with its top side up on the machine: the side with the foil / finish when one
// is marked, else the inside of most bends. Bend marks are traced on the top side, so only on the
// bends that come up from it. A part with foil / finish is never mirrored when nesting; one with a
// grain direction only turns 180° (its grain stays along the sheet's length, X).

import { readDxf } from "../dxf";
import { fixMarkRules, type Drawing, type Role } from "../geometry";
import type { Rotation } from "../rules";
import { readSolid, type Solid } from "./step";
import { bendMarks, flatDxf, unfold, type Unfolded, type V2 } from "./unfold";

export const STEP_ACCEPT = ".step,.stp";
export const isStepName = (name: string) => /\.(step|stp)$/i.test(name);

export type MarkAs = "trace" | "openCut" | "none";
export type Grain = "none" | "x" | "y";

export interface StepSettings {
  profile: string;
  kFactor: number;
  /** the flat face it is unfolded from; missing: the biggest */
  base?: number;
  /** the top side: picked (a face of that side), else automatic (the inside of most bends) */
  top?: number;
  /** the top side has a protective foil or a finish (it must stay up: no mirroring) */
  foil: boolean;
  /** grain along the flat pattern's X or Y (turned so it runs along X; then only 180° turns) */
  grain: Grain;
  markLen: number;
  markInset: number;
  marks: MarkAs;
  /** angle and UP / DOWN shown beside the bends (on the drawing, not engraved) */
  annotate: boolean;
}

export interface StepPart {
  /** the file's text (read again when the settings change) */
  text: string;
  settings: StepSettings;
  /** what the unfolding found, for the list and the panel */
  info: { thickness: number | null; bends: number; w: number; h: number; ok: boolean; problems: string[] };
  /** shown in 3D (the unfold view) or as its 2D drawing */
  view: "3d" | "2d";
}

// ------------------------------------------------------------------ customer profiles

export interface UnfoldProfile {
  name: string;
  /** K-factor for every material and thickness not listed */
  kFactor: number;
  /** K-factors by material and thickness ("" material: any) */
  kTable: { material: string; thicknessMm: number; kFactor: number }[];
  markLen: number;
  markInset: number;
  marks: MarkAs;
  annotate: boolean;
  /** new parts start with foil / finish on the top side */
  foil: boolean;
}

export const DEFAULT_PROFILE: UnfoldProfile = { name: "Standard", kFactor: 0.44, kTable: [], markLen: 20, markInset: 2, marks: "trace", annotate: true, foil: false };

const PROFILES = "gnezdo.unfoldProfiles", CURRENT = "gnezdo.unfoldProfile";
export function loadProfiles(): UnfoldProfile[] {
  try {
    const raw = localStorage.getItem(PROFILES);
    const l = raw ? (JSON.parse(raw) as UnfoldProfile[]) : [];
    return l.length ? l.map((p) => ({ ...DEFAULT_PROFILE, ...p })) : [DEFAULT_PROFILE];
  } catch { return [DEFAULT_PROFILE]; }
}
export const saveProfiles = (l: UnfoldProfile[]) => { try { localStorage.setItem(PROFILES, JSON.stringify(l)); } catch { /* this session only */ } };
export const currentProfile = (): string => { try { return localStorage.getItem(CURRENT) ?? DEFAULT_PROFILE.name; } catch { return DEFAULT_PROFILE.name; } };
export const setCurrentProfile = (n: string) => { try { localStorage.setItem(CURRENT, n); } catch { /* this session only */ } };
export const profileOf = (name: string) => loadProfiles().find((p) => p.name === name) ?? loadProfiles()[0];

/** The profile's K-factor for a material and thickness. */
export function kFor(p: UnfoldProfile, material: string, thicknessMm: number | null): number {
  const m = material.trim().toLowerCase();
  const hit = p.kTable.find((r) => thicknessMm !== null && Math.abs(r.thicknessMm - thicknessMm) < 1e-6 && (!r.material.trim() || r.material.trim().toLowerCase() === m))
    ?? p.kTable.find((r) => thicknessMm !== null && Math.abs(r.thicknessMm - thicknessMm) < 1e-6);
  return hit?.kFactor ?? p.kFactor;
}

export function settingsFrom(p: UnfoldProfile): StepSettings {
  return { profile: p.name, kFactor: p.kFactor, foil: p.foil, grain: "none", markLen: p.markLen, markInset: p.markInset, marks: p.marks, annotate: p.annotate };
}

// ------------------------------------------------------------------ unfolding

const solids = new Map<string, Solid>();
/** The solid of a STEP text (read once). */
export function solidOf(text: string): Solid {
  let s = solids.get(text);
  if (!s) {
    s = readSolid(text);
    if (solids.size > 20) solids.delete(solids.keys().next().value!);
    solids.set(text, s);
  }
  return s;
}

/** The part unfolded with its settings: the top side picked, or the inside of most bends. */
export function unfoldPart(text: string, st: StepSettings): Unfolded {
  const s = solidOf(text);
  const first = unfold(s, { kFactor: st.kFactor, base: st.base });
  let flip: boolean;
  if (st.top !== undefined) flip = !first.skinFaces.includes(st.top);
  else flip = first.bends.filter((b) => !b.inner).length > first.bends.filter((b) => b.inner).length;
  let u = flip ? unfold(s, { kFactor: st.kFactor, base: st.base, flip }) : first;
  if (st.grain === "y") u = turn90(u);
  return u;
}

/** The flat pattern turned 90° (counter-clockwise), back in its corner. */
function turn90(u: Unfolded): Unfolded {
  const H = u.box.y1;
  const t = (p: V2): V2 => [H - p[1], p[0]];
  return {
    ...u,
    outline: u.outline.map((e) => ({ pts: e.pts.map(t), ...(e.arc ? { arc: { c: t(e.arc.c), r: e.arc.r, a0: e.arc.a0 + Math.PI / 2, a1: e.arc.a1 + Math.PI / 2 } } : {}) })),
    bendLines: u.bendLines.map(([a, b]) => [t(a), t(b)] as [V2, V2]),
    box: { x0: 0, y0: 0, x1: u.box.y1, y1: u.box.x1 },
  };
}

/** The bend marks the settings ask for. */
export const marksOf = (u: Unfolded, st: StepSettings) => (st.marks === "none" ? [] : bendMarks(u, st.markLen, st.markInset));

/** The flat pattern as an import drawing: the outline cut, the bend marks traced (or open cut). */
export function flatDrawing(id: string, name: string, u: Unfolded, st: StepSettings): Drawing {
  const text = flatDxf(u, { marks: marksOf(u, st), bendLines: false });
  const r = readDxf(text, `${name}.dxf`);
  const role: Role = st.marks === "openCut" ? "openCut" : "trace";
  const entities = r.drawing.entities.map((e) => (e.layer === "BEND_MARK" ? { ...e, role, fileRole: role } : e));
  return { ...r.drawing, id, fileName: name, entities: fixMarkRules(entities).entities };
}

/** Read a STEP file into a part: unfolded with the profile's values. */
export function newStepPart(text: string, profile: UnfoldProfile, material: string): { part: StepPart; u: Unfolded } {
  const st = settingsFrom(profile);
  const s = solidOf(text);
  // the K-factor by the part's thickness (read first)
  const t0 = unfold(s, { kFactor: st.kFactor }).thickness;
  st.kFactor = kFor(profile, material, t0);
  const u = unfoldPart(text, st);
  return { part: { text, settings: st, info: infoOf(u), view: "3d" }, u };
}

export const infoOf = (u: Unfolded): StepPart["info"] => ({
  thickness: u.thickness, bends: u.bends.length, w: u.box.x1, h: u.box.y1,
  ok: u.thickness !== null && u.outline.length > 0 && u.stats.openEnds === 0, problems: u.problems,
});

/** What nesting may do with the part: foil / finish up never mirrors; grain only turns 180°. */
export const nestLimits = (st: StepSettings): { noMirror?: boolean; rotations?: Rotation[] } => ({
  ...(st.foil ? { noMirror: true } : {}),
  ...(st.grain !== "none" ? { rotations: [180 as Rotation] } : {}),
});
