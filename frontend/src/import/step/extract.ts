// 3D EXTRACTOR: STEP files read into parts (one per body; an assembly gives each part with its quantity),
// sorted by kind. Nothing here goes to the database: a part's flat pattern is sent to IMPORT 2D, where it
// is processed like any drawing.

import { cross3, dot3, len3, lowHigh, mul3, sub3, unit3, type Face, type RGB, type Solid, type V3 } from "./step";
import { currentProfile, modelOf, newStepPart, profileOf, settingsFrom, type StepPart } from "./stepPart";
import type { Unfolded } from "./unfold";
import { loadLocalMachines } from "../../job/machine";
import { techMaterials } from "../../job/technology";

export type BodyKind = "sheet" | "surface" | "tube" | "profile" | "other" | "hardware";

export const KIND_LABEL: Record<BodyKind, string> = {
  sheet: "Sheet metal", surface: "Surfaces", tube: "Tubes", profile: "Profiles", other: "Other parts", hardware: "Hardware",
};
export const KIND_ORDER: BodyKind[] = ["sheet", "surface", "tube", "profile", "other", "hardware"];

/** One part in the extractor. */
export interface X3Part {
  id: string;
  fileName: string;
  name: string;
  /** how many the file has (an assembly: every placement of the part) */
  qty: number;
  kind: BodyKind;
  step: StepPart;
  /** its flat pattern is in IMPORT 2D (that item's id) */
  sentTo?: string;
  /** its own material (from the STEP file, or set here; else the Import 2D properties' one) */
  material?: string;
  /** its color in the STEP file */
  color?: RGB;
  /** the material the STEP file names (used as its material when the Technology tables know it, or have none) */
  fileMaterial?: string;
  /** a tube or profile: its section and length ("Ø48.3 × 2.6 · L 1200"); it is cut to length, not unfolded */
  section?: string;
}

/** A material named in a STEP file, as the Technology tables spell it; with material tags there and no match: none. */
function knownMaterial(m: string): string | undefined {
  const mats = techMaterials(loadLocalMachines().list.map((x) => x.technologies));
  if (!mats.length) return m.trim();
  return mats.find((x) => x.toLowerCase() === m.trim().toLowerCase());
}

/** Standard parts by their names (English, Slovene, standards, thread sizes). */
const HARDWARE_NAME = /\b(bolts?|screws?|nuts?|washers?|rivets?|pins?|studs?|dowels?|circlips?|vijak\w*|matic\w*|podlo[žz]\w*|zakovic\w*|[žz]eblj\w*|(DIN|ISO|EN|ASME|ANSI)[\s_-]?\d+\w*|M\d+(\.\d+)?\s*[x×]\s*\d+)\b/i;

const box = (s: Solid) => {
  const pts = s.faces.flatMap((f) => f.loops.flatMap((l) => l.edges.flatMap((e) => e.pts)));
  if (!pts.length) return { lo: [0, 0, 0] as V3, hi: [0, 0, 0] as V3, size: [0, 0, 0] };
  const r = [0, 1, 2].map((i) => lowHigh(pts.map((p) => p[i])));
  const lo = r.map((x) => x[0]) as V3, hi = r.map((x) => x[1]) as V3;
  return { lo, hi, size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]].sort((a, b) => b - a) };
};

/** The axis lines of its cylinders: all on one line (a turned part: bolt, nut, pin, bushing). */
function oneAxis(s: Solid): { a: V3; d: V3; radii: number[] } | null {
  const cyl = s.faces.filter((f) => f.surf.kind === "cyl").map((f) => f.surf as { a: V3; d: V3; r: number });
  if (!cyl.length) return null;
  const { a, d } = cyl[0];
  for (const c of cyl) {
    if (Math.abs(Math.abs(dot3(c.d, d)) - 1) > 1e-4) return null;
    const w = sub3(c.a, a);
    if (len3(sub3(w, [d[0] * dot3(w, d), d[1] * dot3(w, d), d[2] * dot3(w, d)])) > 1e-3) return null;
  }
  return { a, d: unit3(d), radii: [...new Set(cyl.map((c) => Math.round(c.r * 1000) / 1000))].sort((x, y) => y - x) };
}

/** A face runs along d: a flat face parallel to it, a round face around it. */
const runsAlong = (f: Face, d: V3) =>
  f.surf.kind === "plane" ? Math.abs(dot3(f.surf.n, d)) < 1e-3 : f.surf.kind === "cyl" ? Math.abs(Math.abs(dot3(f.surf.d, d)) - 1) < 1e-4 : false;
const facePts = (f: Face) => f.loops.flatMap((l) => l.edges.flatMap((e) => e.pts));

/**
 * A long part with the same section along it: the direction, and whether that holds for every face but the
 * two ends (strict), or only apart from holes, notches and cut ends (each face across it much shorter than
 * the part: a tube or profile drilled, notched, mitered), else null.
 */
function longAxis(s: Solid): { d: V3; strict: boolean } | null {
  const normals = s.faces.flatMap((f) => (f.surf.kind === "plane" ? [f.surf.n] : []));
  const dirs: V3[] = s.faces.flatMap((f) => (f.surf.kind === "cyl" ? [f.surf.d] : []));
  for (let i = 0; i < normals.length && i < 12; i++) for (let j = i + 1; j < normals.length && j < 12; j++) {
    const c = cross3(normals[i], normals[j]);
    if (len3(c) > 0.1) dirs.push(unit3(c));
  }
  // only along the part's length (a box-shaped part has the same section along each of its sides)
  const all = s.faces.flatMap(facePts);
  const spanOf = (d: V3) => { const [a, b] = lowHigh(all.map((p) => dot3(p, d))); return b - a; };
  const spanD = dirs.map(spanOf);
  const most = Math.max(0, ...spanD);
  const longDirs = dirs.filter((_, k) => spanD[k] >= 0.9 * most);
  for (const d of longDirs) {
    // every face but the two ends runs along it
    let ends = 0, ok = true;
    for (const f of s.faces) {
      if (runsAlong(f, d)) continue;
      if (f.surf.kind !== "plane" || ++ends > 2) { ok = false; break; }
    }
    if (ok) return { d, strict: true };
  }
  const spans = (f: Face, d: V3) => { const [a, b] = lowHigh(facePts(f).map((p) => dot3(p, d))); return b - a; };
  for (const d of longDirs) {
    const L = spanOf(d);
    if (!(L > 0)) continue;
    let long = 0, ok = true;
    for (const f of s.faces) {
      const w = spans(f, d);
      if (runsAlong(f, d)) { if (w >= 0.9 * L) long++; continue; }
      if (w > 0.3 * L) { ok = false; break; }
    }
    if (ok && long > 0) return { d, strict: false };
  }
  return null;
}

/** A long part's section, seen along it: its size, how far round its outline is, hollow (a tube), round. */
export interface Section {
  /** along the part (over its cut ends) */
  length: number;
  /** the section's size across (along its first flat side, and square to it) */
  w: number; h: number;
  /** the outline of the section, all round (0: no end face to read it from) */
  perimeter: number;
  hollow: boolean;
  /** a round tube or bar: outer diameter, wall (a bar: none) */
  round?: { d: number; wall?: number };
  /** a square or rectangular tube's wall */
  wall?: number;
  strict: boolean;
}

/** The long part's section (null: not a long part with the same section along it). */
export function sectionOf(s: Solid): Section | null {
  const ax = longAxis(s);
  if (!ax) return null;
  const d = ax.d;
  const plane = s.faces.find((f) => f.surf.kind === "plane" && runsAlong(f, d));
  const u0: V3 = plane && plane.surf.kind === "plane" ? unit3(plane.surf.n) : unit3(cross3(d, Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
  const v0 = cross3(d, u0);
  const pr = (p: V3): [number, number] => [dot3(p, u0), dot3(p, v0)];
  const all = s.faces.flatMap(facePts);
  const [a0, a1] = lowHigh(all.map((p) => dot3(p, d)));
  const xs = lowHigh(all.map((p) => dot3(p, u0))), ys = lowHigh(all.map((p) => dot3(p, v0)));
  const w = xs[1] - xs[0], h = ys[1] - ys[0];
  const diag = Math.hypot(w, h);
  // an end: a face across the part whose outline is the whole section (a cut end, square, mitered or notched)
  type Lp = { per: number; diag: number; w: number; h: number };
  const loopOf = (pts: V3[]): Lp => {
    const q = pts.map(pr);
    let per = 0;
    for (let k = 1; k < q.length; k++) per += Math.hypot(q[k][0] - q[k - 1][0], q[k][1] - q[k - 1][1]);
    const lx = lowHigh(q.map((p) => p[0])), ly = lowHigh(q.map((p) => p[1]));
    return { per, diag: Math.hypot(lx[1] - lx[0], ly[1] - ly[0]), w: lx[1] - lx[0], h: ly[1] - ly[0] };
  };
  let end: Lp[] | null = null;
  for (const f of s.faces) {
    if (runsAlong(f, d)) continue;
    const loops = f.loops.map((l) => loopOf(l.edges.flatMap((e) => e.pts))).sort((p, q) => q.diag - p.diag);
    if (loops.length && loops[0].diag >= 0.9 * diag && (!end || f.surf.kind === "plane")) { end = loops; if (f.surf.kind === "plane") break; }
  }
  const hollow = !!end && end.length > 1 && end[1].diag >= 0.4 * diag;
  // round: the faces along it are round faces about one axis
  const cyl = s.faces.filter((f) => f.surf.kind === "cyl" && runsAlong(f, d)).map((f) => f.surf as { a: V3; r: number });
  const radii = [...new Set(cyl.map((c) => Math.round(c.r * 1000) / 1000))].sort((x, y) => y - x);
  // flat faces along it only as the sides of a slot or notch through the wall (no wider than the wall)
  const wallR = radii.length > 1 ? radii[0] - radii[radii.length - 1] : 0;
  const slotSide = (f: Face) => {
    if (f.surf.kind !== "plane" || !wallR) return false;
    const across = unit3(cross3(f.surf.n, d));
    const [lo, hi] = lowHigh(facePts(f).map((p) => dot3(p, across)));
    return hi - lo <= wallR + 0.05;
  };
  const coaxial = cyl.length > 0 && !s.faces.some((f) => f.surf.kind === "plane" && runsAlong(f, d) && !slotSide(f))
    && cyl.every((c) => { const v = sub3(c.a, cyl[0].a); return len3(sub3(v, mul3(d, dot3(v, d)))) < 1e-3; });
  const round = coaxial ? { d: 2 * radii[0], ...(radii.length > 1 ? { wall: Math.round((radii[0] - radii[radii.length - 1]) * 1000) / 1000 } : {}) } : undefined;
  const wall = hollow && !round && end ? Math.round(((end[0].w - end[1].w) / 2) * 100) / 100 : undefined;
  return { length: a1 - a0, w, h, perimeter: end?.[0].per ?? 0, hollow: hollow || (!!round && radii.length > 1), ...(round ? { round } : {}), ...(wall ? { wall } : {}), strict: ax.strict };
}

const mm = (n: number) => String(Math.round(n * 10) / 10);
/** "Ø48.3 × 2.6 · L 1200", "40 × 40 × 3 · L 1000", "50 × 50 · L 1500". */
export function sectionText(x: Section): string {
  const sec = x.round ? `Ø${mm(x.round.d)}${x.round.wall ? ` × ${mm(x.round.wall)}` : ""}`
    : `${mm(Math.max(x.w, x.h))} × ${mm(Math.min(x.w, x.h))}${x.wall ? ` × ${mm(x.wall)}` : ""}`;
  return `${sec} · L ${Math.round(x.length)}`;
}

/**
 * The flat pattern is the whole part: as long as it, and as wide as its section laid out (half the section's
 * outline less the two cut edges: a rolled angle unfolds to one flange only, a bent one to both).
 */
function unfoldsWhole(x: Section, u: Unfolded): boolean {
  if (!x.perimeter || u.thickness === null) return false;
  const [fl, fw] = [Math.max(u.box.x1, u.box.y1), Math.min(u.box.x1, u.box.y1)];
  const laid = (x.perimeter - 2 * u.thickness) / 2;
  return Math.abs(fl - x.length) <= Math.max(1, 0.02 * x.length) && Math.abs(fw - laid) <= Math.max(1, 0.06 * laid);
}

/** What a body is (for sorting; any part can still be opened and unfolded or stitched). */
export function classify(name: string, s: Solid, surface: boolean, u: Unfolded | null): BodyKind {
  const b = box(s);
  const [L, M] = b.size;
  const sheet = !!u && u.thickness !== null && u.outline.length > 0 && u.stats.openEnds === 0 && u.thickness <= 0.25 * Math.min(u.box.x1, u.box.y1);
  // by its name (a standard part); not a bent or a bigger sheet part, whose name may quote a standard
  if (HARDWARE_NAME.test(name) && (!sheet || (!u!.bends.length && L <= 80))) return "hardware";
  if (surface) return "surface";
  // long with the same section (holes, notches and cut ends aside): a tube (hollow: round, square,
  // rectangular), a profile, or sheet metal bent along it (or a strip with holes) that unfolds whole
  const x = sectionOf(s);
  if (x && L > 3 * M && x.length > 0.9 * L) {
    if (x.hollow) return "tube";
    // bent, or with holes or cuts, or a plate too wide for a flat bar (bar stock: up to 20 × its thickness)
    const wide = Math.min(u?.box.x1 ?? 0, u?.box.y1 ?? 0) > 20 * (u?.thickness ?? Infinity);
    if (sheet && unfoldsWhole(x, u!) && (u!.bends.length > 0 || !x.strict || wide)) return "sheet";
    return "profile";
  }
  if (sheet) {
    // a washer: a flat ring (arcs only, around one center: circles may come split in halves), small
    const o = u!.outline;
    const c0 = o[0]?.arc?.c;
    const ring = !!c0 && o.every((e) => e.arc && Math.hypot(e.arc.c[0] - c0[0], e.arc.c[1] - c0[1]) < 0.01) && new Set(o.map((e) => Math.round(e.arc!.r * 100))).size === 2;
    if (!u!.bends.length && ring && L <= 80) return "hardware";
    return "sheet";
  }
  // small turned parts: bolts, nuts, pins, spacers
  if (oneAxis(s) && L <= 150) return "hardware";
  return "other";
}

let seq = 0;

/** A STEP file into parts: every body, its kind, unfolded (sheet metal) with the current profile. */
export async function readExtract(file: File, material = ""): Promise<{ parts: X3Part[]; error?: string }> {
  let text: string;
  try { text = await file.text(); } catch (e) { return { parts: [], error: `${file.name}: ${(e as Error).message}` }; }
  let model;
  try { model = modelOf(text); } catch (e) { return { parts: [], error: `${file.name}: ${(e as Error).message}` }; }
  const profile = profileOf(currentProfile());
  // one part in the file: named as the file
  const base = file.name.replace(/^.*[\\/]/, "").replace(/\.(step|stp)$/i, "");
  const parts: X3Part[] = [];
  for (let i = 0; i < model.bodies.length; i++) {
    const b = model.bodies[i];
    // let the screen breathe between bodies of a big assembly
    if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0));
    let kind: BodyKind;
    let step: StepPart;
    // the part's material from the file (its K-factor too), else the Import 2D one
    const own = b.material ? knownMaterial(b.material) : undefined;
    const mat = own ?? material;
    let color: RGB | undefined;
    try {
      const s = b.solid;
      color = s.color;
      if (b.kind === "surface") {
        step = newStepPart(text, i, profile, mat, true).part;
        kind = classify(b.name, s, true, null);
      } else {
        const { part, u } = newStepPart(text, i, profile, mat);
        step = part;
        kind = classify(b.name, s, false, u);
      }
    } catch (e) {
      // not readable as a part: listed, with the reason
      step = { text, body: i, settings: settingsFrom(profile), info: { thickness: null, bends: 0, w: 0, h: 0, ok: false, problems: [(e as Error).message] } };
      kind = "other";
    }
    let section: string | undefined;
    if (kind === "tube" || kind === "profile") { try { const x = sectionOf(b.solid); if (x) section = sectionText(x); } catch { /* no section */ } }
    parts.push({ id: `x3-${Date.now().toString(36)}-${++seq}`, fileName: file.name, name: model.bodies.length === 1 ? base : b.name || `${base} ${i + 1}`, qty: b.qty, kind, step, ...(section ? { section } : {}), ...(own ? { material: own } : {}), ...(b.material ? { fileMaterial: b.material } : {}), ...(color ? { color } : {}) });
  }
  if (!parts.length) return { parts, error: `${file.name}: no solid or surface in it` };
  // the same name twice (bodies named Body1 in different parts): numbered
  const seen = new Map<string, number>();
  for (const p of parts) { const n = (seen.get(p.name) ?? 0) + 1; seen.set(p.name, n); if (n > 1) p.name = `${p.name} (${n})`; }
  return { parts };
}
