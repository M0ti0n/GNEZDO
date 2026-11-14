// A STEP part in the import list: the solid, how it is unfolded, and its flat pattern as a drawing.
// The flat pattern lies with its top side up on the machine: the side with the foil / finish when one
// is marked, else the inside of most bends. Bend marks are traced on the top side, so only on the
// bends that come up from it. A part with foil / finish is never mirrored when nesting; one with a
// grain direction only turns 180° (its grain stays along the sheet's length, X).

import { readDxf } from "../dxf";
import { fixMarkRules, type Drawing, type Role } from "../geometry";
import type { Rotation } from "../rules";
import { readStep, type Solid, type StepModel } from "./step";
import { textLines, textWidth } from "../singleLine";
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
  /** angle and UP / DOWN shown beside the bends */
  annotate: boolean;
  /** ... and engraved (traced) with the single-line font, `textMm` high (capitals) */
  engraveText?: boolean;
  textMm?: number;
  /** sheet: unfolded across its bends; stitch: the faces picked laid flat across their shared edges */
  mode: "sheet" | "stitch";
  /** stitch: the faces picked (indexes in the solid's faces), the first one stays */
  stitch: number[];
  /** stitch: the top side is the faces' other side (missing: the inside of most bends) */
  flip?: boolean;
  /** threaded holes by their diameter ("6.80"): the thread (M8: marked with a cross and M8, not cut) or
   *  "cut"; a diameter not listed: as its tap drill says (6.8 -> M8), else cut */
  threads?: Record<string, string>;
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
  engraveText?: boolean;
  textMm?: number;
  /** new parts start with foil / finish on the top side */
  foil: boolean;
}

export const DEFAULT_PROFILE: UnfoldProfile = { name: "Standard", kFactor: 0.44, kTable: [], markLen: 20, markInset: 2, marks: "trace", annotate: true, engraveText: false, textMm: 6, foil: false };

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
  return { profile: p.name, kFactor: p.kFactor, foil: p.foil, grain: "none", markLen: p.markLen, markInset: p.markInset, marks: p.marks, annotate: p.annotate, engraveText: !!p.engraveText, textMm: p.textMm ?? 6, mode: "sheet", stitch: [], comp: { side: "none", t: 0, r: 0 } };
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

/** A bend's label: its angle and which way it goes. */
export const bendLabel = (b: { angleDeg: number; up: boolean }) => `${Math.round(b.angleDeg * 10) / 10}° ${b.up ? "UP" : "DOWN"}`;

/**
 * The bends' labels engraved: single-line text beside each bend line, in its middle, along it (turned to
 * be read from below or the right). Shorter bends get smaller text (the text at most 70 % of the bend).
 */
export function bendTexts(u: Unfolded, st: StepSettings): V2[][] {
  if (!st.annotate || !st.engraveText) return [];
  const cap0 = st.textMm ?? 6;
  return u.bendLines.flatMap(([a, b], i) => {
    const bd = u.bends[i];
    if (!bd) return [];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-6) return [];
    const label = bendLabel(bd);
    // fit the text into the bend's middle 70 %
    const w1 = textWidth(label, 1);
    const cap = Math.min(cap0, (0.7 * L) / Math.max(w1, 1e-6));
    if (cap < 1.5) return [];
    let ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
    if (ang > 90.5) ang -= 180; else if (ang <= -89.5) ang += 180;
    const r = (ang * Math.PI) / 180;
    // above the line (its left side, read along it), clear of it
    const gap = Math.max(1, cap * 0.35);
    const at: V2 = [(a[0] + b[0]) / 2 - Math.sin(r) * gap, (a[1] + b[1]) / 2 + Math.cos(r) * gap];
    return textLines(label, { at, align: "center", valign: "baseline", angle: ang, capMm: cap });
  });
}

// ------------------------------------------------------------------ threaded holes

/** Metric coarse threads and their tap drills (mm): a hole of a tap drill's size is most likely tapped. */
export const TAP_DRILLS: [string, number][] = [
  ["M2", 1.6], ["M2.5", 2.05], ["M3", 2.5], ["M4", 3.3], ["M5", 4.2], ["M6", 5], ["M8", 6.8], ["M10", 8.5],
  ["M12", 10.2], ["M14", 12], ["M16", 14], ["M18", 15.5], ["M20", 17.5], ["M22", 19.5], ["M24", 21],
];
export const holeKey = (d: number) => d.toFixed(2);
/** The thread whose tap drill this hole is (within 0.06 mm), else null. */
export const threadByDrill = (d: number) => TAP_DRILLS.find(([, t]) => Math.abs(t - d) <= 0.06)?.[0] ?? null;

interface Hole { c: V2; r: number; edges: number[] }
/** The round holes of the flat pattern: whole circles, or arcs around one center that close (halves). */
function holesOf(u: Unfolded): Hole[] {
  const groups = new Map<string, Hole & { sweep: number }>();
  u.outline.forEach((e, i) => {
    if (!e.arc) return;
    const k = `${Math.round(e.arc.c[0] * 100)},${Math.round(e.arc.c[1] * 100)},${Math.round(e.arc.r * 100)}`;
    const g = groups.get(k) ?? { c: e.arc.c, r: e.arc.r, edges: [], sweep: 0 };
    g.edges.push(i);
    g.sweep += e.arc.a1 - e.arc.a0;
    groups.set(k, g);
  });
  const small = Math.min(u.box.x1, u.box.y1);
  // a whole circle that is not the part's own outline (a round blank)
  return [...groups.values()].filter((g) => g.sweep >= 2 * Math.PI - 1e-3 && 2 * g.r < 0.98 * small);
}

/** The flat pattern's holes by size: how many, and what they are (a thread, or cut). */
export function holeGroups(u: Unfolded, st: StepSettings): { key: string; d: number; count: number; auto: string | null; thread: string | null }[] {
  const by = new Map<string, { key: string; d: number; count: number; auto: string | null; thread: string | null }>();
  for (const h of holesOf(u)) {
    const d = 2 * h.r, key = holeKey(d);
    const g = by.get(key) ?? { key, d, count: 0, auto: threadByDrill(d), thread: null };
    g.count++;
    by.set(key, g);
  }
  for (const g of by.values()) { const set = st.threads?.[g.key]; g.thread = set === undefined ? g.auto : set === "cut" ? null : set; }
  return [...by.values()].sort((a, b) => a.d - b.d);
}

/**
 * Threaded holes are not cut: each is a small traced cross with its thread (M8) beside it, for drilling and
 * tapping after cutting. The flat pattern without those holes, and the lines to trace.
 */
export function applyThreads(u: Unfolded, st: StepSettings): { u: Unfolded; lines: V2[][] } {
  const groups = holeGroups(u, st);
  if (!groups.some((g) => g.thread)) return { u, lines: [] };
  const drop = new Set<number>();
  const lines: V2[][] = [];
  for (const h of holesOf(u)) {
    const t = groups.find((g) => g.key === holeKey(2 * h.r))?.thread;
    if (!t) continue;
    h.edges.forEach((i) => drop.add(i));
    const [x, y] = h.c;
    const a = Math.max(1.5, h.r * 0.8);
    lines.push([[x - a, y], [x + a, y]], [[x, y - a], [x, y + a]]);
    const cap = Math.min(5, Math.max(2.5, h.r * 1.1));
    lines.push(...textLines(t, { at: [x + a + cap * 0.35, y], align: "left", valign: "middle", capMm: cap }));
  }
  return { u: { ...u, outline: u.outline.filter((_, i) => !drop.has(i)) }, lines };
}

/** The flat pattern as an import drawing: the outline cut, the bend marks traced (or open cut), the labels traced. */
export function flatDrawing(id: string, name: string, u0: Unfolded, st: StepSettings): Drawing {
  const { u, lines } = applyThreads(u0, st);
  const text = flatDxf(u, { marks: marksOf(u, st), bendLines: false, texts: bendTexts(u, st), threads: lines });
  const r = readDxf(text, `${name}.dxf`);
  const role: Role = st.marks === "openCut" ? "openCut" : "trace";
  const entities = r.drawing.entities.map((e) => (e.layer === "BEND_MARK" ? { ...e, role, fileRole: role } : e.layer === "BEND_TEXT" || e.layer === "THREAD" ? { ...e, role: "trace" as Role, fileRole: "trace" as Role } : e));
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
