// 3D EXTRACTOR: STEP files read into parts (one per body; an assembly gives each part with its quantity),
// sorted by kind. Nothing here goes to the database: a part's flat pattern is sent to IMPORT 2D, where it
// is processed like any drawing.

import { cross3, dot3, len3, sub3, unit3, type Solid, type V3 } from "./step";
import { currentProfile, modelOf, newStepPart, profileOf, settingsFrom, type StepPart } from "./stepPart";
import type { Unfolded } from "./unfold";

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
  /** its own material (else the Import 2D properties' one) */
  material?: string;
}

/** Standard parts by their names (English, Slovene, standards, thread sizes). */
const HARDWARE_NAME = /\b(bolts?|screws?|nuts?|washers?|rivets?|pins?|studs?|dowels?|circlips?|vijak\w*|matic\w*|podlo[žz]\w*|zakovic\w*|[žz]eblj\w*|(DIN|ISO|EN|ASME|ANSI)[\s_-]?\d+\w*|M\d+(\.\d+)?\s*[x×]\s*\d+)\b/i;

const box = (s: Solid) => {
  const pts = s.faces.flatMap((f) => f.loops.flatMap((l) => l.edges.flatMap((e) => e.pts)));
  if (!pts.length) return { lo: [0, 0, 0] as V3, hi: [0, 0, 0] as V3, size: [0, 0, 0] };
  const lo = [0, 1, 2].map((i) => Math.min(...pts.map((p) => p[i]))) as V3, hi = [0, 1, 2].map((i) => Math.max(...pts.map((p) => p[i]))) as V3;
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

/** A long part with the same section along it: the direction, else null. */
function longAxis(s: Solid): V3 | null {
  const normals = s.faces.flatMap((f) => (f.surf.kind === "plane" ? [f.surf.n] : []));
  const dirs: V3[] = s.faces.flatMap((f) => (f.surf.kind === "cyl" ? [f.surf.d] : []));
  for (let i = 0; i < normals.length && i < 12; i++) for (let j = i + 1; j < normals.length && j < 12; j++) {
    const c = cross3(normals[i], normals[j]);
    if (len3(c) > 0.1) dirs.push(unit3(c));
  }
  for (const d of dirs) {
    // every face but the two ends runs along it
    let ends = 0, ok = true;
    for (const f of s.faces) {
      if (f.surf.kind === "plane") { if (Math.abs(dot3(f.surf.n, d)) < 1e-3) continue; ends++; }
      else if (f.surf.kind === "cyl") { if (Math.abs(Math.abs(dot3(f.surf.d, d)) - 1) < 1e-4) continue; ok = false; break; }
      else { ok = false; break; }
      if (ends > 2) { ok = false; break; }
    }
    if (ok) return d;
  }
  return null;
}

/** What a body is (for sorting; any part can still be opened and unfolded or stitched). */
export function classify(name: string, s: Solid, surface: boolean, u: Unfolded | null): BodyKind {
  if (HARDWARE_NAME.test(name)) return "hardware";
  if (surface) return "surface";
  const b = box(s);
  const [L, M] = b.size;
  // long with the same section: a tube (round, a wall) or a profile
  const ax = longAxis(s);
  if (ax && L > 3 * M) {
    const ext = s.faces.flatMap((f) => f.loops.flatMap((l) => l.edges.flatMap((e) => e.pts.map((p) => dot3(p, ax)))));
    const along = Math.max(...ext) - Math.min(...ext);
    if (along > 0.9 * L) {
      const one = oneAxis(s);
      return one && one.radii.length >= 2 ? "tube" : "profile";
    }
  }
  const sheet = !!u && u.thickness !== null && u.outline.length > 0 && u.stats.openEnds === 0 && u.thickness <= 0.25 * Math.min(u.box.x1, u.box.y1);
  if (sheet) {
    // a washer: a flat ring, small
    const circles = u!.outline.length === 2 && u!.outline.every((e) => e.arc && e.arc.a1 - e.arc.a0 >= 2 * Math.PI - 1e-6);
    if (!u!.bends.length && circles && L <= 80) return "hardware";
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
    try {
      const s = b.solid;
      if (b.kind === "surface") {
        step = newStepPart(text, i, profile, material, true).part;
        kind = classify(b.name, s, true, null);
      } else {
        const { part, u } = newStepPart(text, i, profile, material);
        step = part;
        kind = classify(b.name, s, false, u);
      }
    } catch (e) {
      // not readable as a part: listed, with the reason
      step = { text, body: i, settings: settingsFrom(profile), info: { thickness: null, bends: 0, w: 0, h: 0, ok: false, problems: [(e as Error).message] } };
      kind = "other";
    }
    parts.push({ id: `x3-${Date.now().toString(36)}-${++seq}`, fileName: file.name, name: model.bodies.length === 1 ? base : b.name || `${base} ${i + 1}`, qty: b.qty, kind, step });
  }
  if (!parts.length) return { parts, error: `${file.name}: no solid or surface in it` };
  // the same name twice (bodies named Body1 in different parts): numbered
  const seen = new Map<string, number>();
  for (const p of parts) { const n = (seen.get(p.name) ?? 0) + 1; seen.set(p.name, n); if (n > 1) p.name = `${p.name} (${n})`; }
  return { parts };
}
