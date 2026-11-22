// Post process: is the sheet's cut path still the sheet? Checked before an NC program is written, so a
// program never looks right and is not:
// - every part on the sheet is processed: none moved, added, or with another drawing (replaced, another
//   revision) since Auto cut. Such a part would be left out of the program, or cut as it was drawn before;
// - no pierce lies in a part: a lead that found no room (tight nesting) may start in the neighbouring part,
//   an outline's pierce must be in the scrap, a hole's in the hole.
// - every part and every cut (its leads too) is on the sheet: a part nested or moved past the edge, or
//   a lead pushed off it, was written all the same (QA R2-08). The remnant's own cuts may leave the sheet.
// Warnings (written anyway): a contour pierced on its own line (no lead-in), but not where a micro joint or a
// break cut starts again (that is how those restart).

import { changedDrawings, liveContours, partKey, processedParts, type CutContour, type PathOf } from "./cutPath";
import { partLoops, pointIn, transform, type Pt } from "./manualGeom";
import type { NestedSheet } from "./nest";

export interface SheetCheck {
  /** why the sheet is not post processed (empty: it may be) */
  errors: string[];
  /** written anyway, said */
  warns: string[];
}

/** Within this of a contour a point is on it, not inside or outside [mm]. */
const ON_LINE_MM = 0.05;
/** A pierce at least this far from any other part (as Auto cut keeps its leads) [mm]: the crater is wider than the kerf. */
const PIERCE_CLEAR_MM = 1;

const segDist = (p: Pt, a: Pt, b: Pt) => {
  const ex = b[0] - a[0], ey = b[1] - a[1], l2 = ex * ex + ey * ey;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / l2)) : 0;
  return Math.hypot(a[0] + t * ex - p[0], a[1] + t * ey - p[1]);
};
const loopDist = (p: Pt, lp: Pt[]) => {
  let d = Infinity;
  for (let i = 0; i < lp.length; i++) d = Math.min(d, segDist(p, lp[i], lp[(i + 1) % lp.length]));
  return d;
};

/** A few names, then how many more. */
const listOf = (names: string[], max = 4) => {
  const u = [...new Set(names)];
  return u.length <= max ? u.join(", ") : `${u.slice(0, max).join(", ")} and ${u.length - max} more`;
};

/** marksChanged: the parts whose tracing or open cut lines changed since Auto cut (changedMarks, read before);
 *  settingsNow: the machine's cutting settings for the sheet now (cutSettingsSig); kerfMm: the kerf it is cut with */
export function checkSheet(sheet: NestedSheet, pathOf: PathOf, nameOf: (part: number) => string, marksChanged?: Set<number>,
  opts?: { settingsNow?: string; kerfMm?: number }): SheetCheck {
  const errors: string[] = [], warns: string[] = [];
  if (!sheet.cut) return { errors, warns };
  if (opts?.settingsNow && sheet.cut.techSig && sheet.cut.techSig !== opts.settingsNow)
    errors.push(`the Technology row for ${sheet.material} ${sheet.thicknessMm} mm or the machine's cutting settings changed since Auto cut (leads, gaps, E code sizes, ...): process the sheet again`);
  // -- every part processed, as it is now
  const changed = changedDrawings(sheet, pathOf);
  const ok = processedParts(sheet, pathOf);
  const moved: string[] = [], added: string[] = [], redrawn: string[] = [];
  sheet.parts.forEach((p, i) => {
    if (ok.has(i)) return;
    if (changed.has(i)) redrawn.push(nameOf(i));
    else if (sheet.cut!.keys[i] !== undefined && sheet.cut!.keys[i] !== partKey(p)) moved.push(nameOf(i));
    else added.push(nameOf(i));
  });
  if (redrawn.length) errors.push(`the drawing of ${listOf(redrawn)} changed since Auto cut (replaced or another version): process the sheet again`);
  if (moved.length) errors.push(`${listOf(moved)} moved since Auto cut: process ${moved.length === 1 ? "it" : "them"} again`);
  const remarked = [...(marksChanged ?? [])].filter((k) => ok.has(k)).map(nameOf);
  if (remarked.length) errors.push(`the tracing or open cut lines of ${listOf(remarked)} changed since Auto cut: process ${remarked.length === 1 ? "it" : "them"} again`);
  if (added.length) errors.push(`${listOf(added)} ${added.length === 1 ? "is" : "are"} not processed: Auto cut ${added.length === 1 ? "it" : "them"} first`);

  // -- the pierce points
  const placed = sheet.parts.map((p) => {
    const path = pathOf(p.partId);
    if (!path) return null;
    const f = transform(p);
    const loops = partLoops(path).map((lp) => lp.map(f));
    if (!loops.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of loops[0]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return { loops, box: { x0, y0, x1, y1 } };
  });
  /** Material is inside an odd number of the part's loops: the outline (1), an island in a hole (3), ... */
  const solid = (loops: Pt[][], q: Pt) => loops.filter((lp) => pointIn(lp, q[0], q[1])).length % 2 === 1;
  /** In the part's material, or nearer its lines than the pierce clearance (a part's hole is scrap, but its edge is the part's). */
  const nearPart = (j: number, q: Pt) => {
    const g = placed[j];
    const c = PIERCE_CLEAR_MM;
    if (!g || q[0] < g.box.x0 - c || q[0] > g.box.x1 + c || q[1] < g.box.y0 - c || q[1] > g.box.y1 + c) return false;
    if (g.loops.some((lp) => loopDist(q, lp) < c)) return true;
    return solid(g.loops, q);
  };
  /** In the part's material (not on its lines, not in its holes). */
  const inMaterial = (j: number, q: Pt) => {
    const g = placed[j];
    if (!g || q[0] < g.box.x0 || q[0] > g.box.x1 || q[1] < g.box.y0 || q[1] > g.box.y1) return false;
    if (g.loops.some((lp) => loopDist(q, lp) <= ON_LINE_MM)) return false;
    return solid(g.loops, q);
  };
  const inOther: string[] = [], inOwn: string[] = [], outOfHole: string[] = [], onLine: string[] = [];
  const own = (c: CutContour) => (c.parts ? c.parts.map(nameOf).join(" + ") : nameOf(c.part));
  for (const c of liveContours(sheet, pathOf)) {
    if (c.kind !== "outer" && c.kind !== "inner") continue;
    if (c.common || c.inline) continue;   // shared lines and inline stretches start as their passes say
    const q = c.leadIn[0] ?? c.pts[0];
    if (!q) continue;
    const mine = c.parts ?? [c.part];
    const other = sheet.parts.findIndex((_, j) => !mine.includes(j) && nearPart(j, q));
    if (other >= 0) { inOther.push(`${own(c)} (at ${nameOf(other)})`); continue; }
    const noLead = c.leadIn.length < 2 && !c.cp;
    if (noLead || loopDist(q, c.pts) <= ON_LINE_MM) {
      if (!c.restart && !c.bc) onLine.push(own(c));
      continue;
    }
    if ((c.kind === "outer" || c.island) && mine.some((j) => inMaterial(j, q))) inOwn.push(own(c));
    // (a hole cut in pieces: each piece is part of the loop only, not a loop to be inside of)
    if (c.kind === "inner" && !c.island && !c.bc && c.pts.length > 2 && !pointIn(c.pts, q[0], q[1])) outOfHole.push(own(c));
  }

  // -- on the sheet: its rectangle, and a shaped sheet's (a remnant's) outline less its cut-outs
  const OFF_MM = 0.05;
  const shape = sheet.outline?.length ? sheet.outline.map((lp) => lp.map(([x, y]) => [x, y] as Pt)) : null;
  const onSheet = (q: Pt) => {
    if (q[0] < -OFF_MM || q[1] < -OFF_MM || q[0] > sheet.lengthMm + OFF_MM || q[1] > sheet.widthMm + OFF_MM) return false;
    if (!shape) return true;
    const edge = (lp: Pt[]) => loopDist(q, lp) <= OFF_MM;
    if (shape.some(edge)) return true;
    return pointIn(shape[0], q[0], q[1]) && !shape.slice(1).some((h) => pointIn(h, q[0], q[1]));
  };
  const offParts: string[] = [];
  placed.forEach((g, j) => { if (g && !g.loops[0].every(onSheet)) offParts.push(nameOf(j)); });
  // (by name: copies of one part are one name, said once)
  const one = new Set(offParts).size === 1 && offParts.length === 1;
  if (offParts.length) errors.push(`${listOf(offParts)}${offParts.length > new Set(offParts).size ? " (copies)" : ""} ${one ? "lies" : "lie"} outside the sheet, wholly or partly: move ${one ? "it" : "them"} onto the sheet`);
  const offCuts: string[] = [];
  for (const c of liveContours(sheet, pathOf)) {
    const mine = c.parts ?? [c.part];
    if (mine.some((j) => offParts.includes(nameOf(j)))) continue;   // said above
    if (![...c.leadIn, ...c.pts, ...c.leadOut].every(onSheet)) offCuts.push(own(c));
  }
  if (offCuts.length) errors.push(`a cut or its lead leaves the sheet: ${listOf(offCuts)}. Shorten or move the lead (Lead in / out), or move the part`);

  if (inOther.length) errors.push(`a pierce lies in or next to another part (closer than ${PIERCE_CLEAR_MM} mm): ${listOf(inOther, 3)}. Its lead has no room: move it (Lead in / out) or nest with a bigger part gap`);
  if (inOwn.length) errors.push(`an outline's pierce lies in its own part: ${listOf(inOwn)}. Move the lead (Lead in / out)`);
  if (outOfHole.length) errors.push(`a hole's pierce is not in the hole: ${listOf(outOfHole)}. Move the lead (Lead in / out)`);
  if (onLine.length) warns.push(`pierced on the contour itself, without a lead-in: ${listOf(onLine)}`);
  // a lead-in shorter than the kerf: the kerf compensation (G41) has no room to come on before the contour,
  // its start-up move notches the contour (QA R2-11)
  const kerf = opts?.kerfMm ?? 0;
  if (kerf > 0) {
    const short: string[] = [];
    for (const c of liveContours(sheet, pathOf)) {
      if ((c.kind !== "outer" && c.kind !== "inner") || c.common || c.inline || c.leadIn.length < 2) continue;
      let L = 0;
      for (let i = 1; i < c.leadIn.length; i++) L += Math.hypot(c.leadIn[i][0] - c.leadIn[i - 1][0], c.leadIn[i][1] - c.leadIn[i - 1][1]);
      if (L < kerf - 1e-6) short.push(own(c));
    }
    if (short.length) warns.push(`a lead-in shorter than the kerf (${kerf} mm): ${listOf(short)}. The kerf compensation may notch the contour where it comes on: make the lead longer (Lead in / out)`);
  }
  return { errors, warns };
}
