// A STEP part in the import list: the solid, how it is unfolded, and its flat pattern as a drawing.
// The flat pattern lies with its top side up on the machine: the side with the foil / finish when one
// is marked, else the inside of most bends. Bend marks are traced on the top side, so only on the
// bends that come up from it. A part with foil / finish is never mirrored when nesting; one with a
// grain direction only turns 180° (its grain stays along the sheet's length, X).

import { readDxf } from "../dxf";
import { fixMarkRules, type Drawing, type Role } from "../geometry";
import type { Rotation } from "../rules";
import { readStep, type Solid, type StepModel } from "./step";
import { bendMarks, flatDxf, stitch, unfold, type Unfolded, type V2 } from "./unfold";

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
  /** sheet: unfolded across its bends; stitch: the faces picked laid flat across their shared edges */
  mode: "sheet" | "stitch";
  /** stitch: the faces picked (indexes in the solid's faces), the first one stays */
  stitch: number[];
  /** stitch: the top side is the faces' other side (missing: the inside of most bends) */
  flip?: boolean;
  /** stitch: bend compensation; the faces are the sheet's top or bottom side (none: as they are) */
  comp: { side: "none" | "top" | "bottom"; t: number; r: number };
}

export interface StepPart {
  /** the file's text (read again when the settings change) */
  text: string;
  /** which body of the file (an assembly has many) */
  body: number;
  settings: StepSettings;
  /** what the unfolding found, for the list and the panel */
  info: { thickness: number | null; bends: number; w: number; h: number; ok: boolean; problems: string[] };
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
  return { profile: p.name, kFactor: p.kFactor, foil: p.foil, grain: "none", markLen: p.markLen, markInset: p.markInset, marks: p.marks, annotate: p.annotate, mode: "sheet", stitch: [], comp: { side: "none", t: 0, r: 0 } };
}

// ------------------------------------------------------------------ unfolding

const models = new Map<string, StepModel>();
/** A STEP text's bodies (read once). */
export function modelOf(text: string): StepModel {
  let m = models.get(text);
  if (!m) {
    m = readStep(text);
    if (models.size > 20) models.delete(models.keys().next().value!);
    models.set(text, m);
  }
  return m;
}
/** One body's faces. */
export const solidOf = (text: string, body = 0): Solid => modelOf(text).bodies[body]?.solid ?? { faces: [], unitMm: 1, name: "", problems: ["This body is not in the file"] };

/** The part unfolded with its settings: the top side picked, or the inside of most bends. */
export function unfoldPart(text: string, st: StepSettings, body = 0): Unfolded {
  const s = solidOf(text, body);
  if (st.mode === "stitch") {
    const comp = { ...st.comp, k: st.kFactor };
    let u = stitch(s, st.stitch, { flip: !!st.flip, comp });
    // no side picked: the inside of most bends up (as for sheet metal)
    if (st.flip === undefined && u.bends.filter((b) => !b.up).length > u.bends.filter((b) => b.up).length) u = stitch(s, st.stitch, { flip: true, comp });
    return st.grain === "y" && u.outline.length ? turn90(u) : u;
  }
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

/** A body of a STEP file as a part: unfolded with the profile's values (a surface body: faces to stitch). */
export function newStepPart(text: string, body: number, profile: UnfoldProfile, material: string, stitchMode = false): { part: StepPart; u: Unfolded } {
  const st = settingsFrom(profile);
  const s = solidOf(text, body);
  if (stitchMode) st.mode = "stitch";
  else {
    // the K-factor by the part's thickness (read first)
    const t0 = unfold(s, { kFactor: st.kFactor }).thickness;
    st.kFactor = kFor(profile, material, t0);
  }
  const u = unfoldPart(text, st, body);
  return { part: { text, body, settings: st, info: infoOf(u) }, u };
}

export const infoOf = (u: Unfolded): StepPart["info"] => ({
  thickness: u.thickness, bends: u.bends.length, w: u.box.x1, h: u.box.y1,
  ok: u.outline.length > 0 && u.stats.openEnds === 0 && (u.thickness !== null || !!u.stitched), problems: u.problems,
});

/** What nesting may do with the part: foil / finish up never mirrors; grain only turns 180°. */
export const nestLimits = (st: StepSettings): { noMirror?: boolean; rotations?: Rotation[] } => ({
  ...(st.foil ? { noMirror: true } : {}),
  ...(st.grain !== "none" ? { rotations: [180 as Rotation] } : {}),
});
