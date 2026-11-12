// A remnant's cuts as the machine cuts them (Process -> Remnant, then Post process): the mode's lines
// and the hand cuts (CUT V / CUT H) as open cuts, each from the end nearer the head. Where a cut runs to
// a sheet edge it starts / ends the Technology row's Gap in / Gap out from it (+ inside the sheet, an
// uncut bridge; − beyond the edge); leads of the Leads & cutting type (Remnant cut), from the scrap side.

import { DEFAULT_ANGLE, leadRulesOf } from "./leads";
import type { Machine } from "./machine";
import { pointIn, type Pt } from "./manualGeom";
import type { NestedSheet } from "./nest";
import { remnantValid } from "./remnant";
import { techRowFor } from "./technology";

export interface RemnantCutPath { pts: Pt[]; leadIn: Pt[]; leadOut: Pt[] }

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const mul = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k];
const len = (a: Pt) => Math.hypot(a[0], a[1]);
const unit = (a: Pt): Pt => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
const r2 = (p: Pt): Pt => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100];
const lineLen = (l: Pt[]) => l.reduce((s, p, i) => (i ? s + len(sub(p, l[i - 1])) : 0), 0);

/** The polyline without its first `d` mm. */
function cutStart(l: Pt[], d: number): Pt[] {
  let left = d;
  for (let i = 1; i < l.length; i++) {
    const seg = len(sub(l[i], l[i - 1]));
    if (seg > left) return [add(l[i - 1], mul(unit(sub(l[i], l[i - 1])), left)), ...l.slice(i)];
    left -= seg;
  }
  return [l[l.length - 1]];
}

/** The remnant's cut lines (the mode's and the hand cuts), sheet frame. */
export function remnantLines(sheet: NestedSheet): Pt[][] {
  const rem = sheet.remnant;
  if (!rem || !remnantValid(sheet)) return [];
  return [...rem.lines, ...rem.cuts.map((c): Pt[] => (c.axis === "v" ? [[c.at, c.from], [c.at, c.to]] : [[c.from, c.at], [c.to, c.at]]))]
    .filter((l) => l.length > 1 && lineLen(l) > 0.01);
}

/** The remnant's cuts in cutting order from `from` (where the head is), with gaps and leads. */
export function remnantCutPaths(sheet: NestedSheet, machine: Machine, from: Pt): RemnantCutPath[] {
  const rem = sheet.remnant;
  const left = remnantLines(sheet);
  if (!rem || !left.length) return [];
  const row = techRowFor(machine.technologies, sheet.material, sheet.thicknessMm)?.row;
  const type = leadRulesOf(machine).remnant;
  const gapIn = row?.remGapInMm ?? 0, gapOut = row?.remGapOutMm ?? 0;
  const lin = row?.remLeadInMm ?? 0, lout = row?.remLeadOutMm ?? 0;
  const aIn = ((row?.leadInAngle || DEFAULT_ANGLE.angled!) * Math.PI) / 180, aOut = ((row?.leadOutAngle || DEFAULT_ANGLE.angled!) * Math.PI) / 180;
  const tol = Math.max(1.5, Math.ceil(Math.max(sheet.lengthMm, sheet.widthMm) / 1500) * 1.5);
  const onEdge = ([x, y]: Pt) => x <= tol || y <= tol || x >= sheet.lengthMm - tol || y >= sheet.widthMm - tol;
  const inRemnant = (p: Pt) => rem.pieces.some((q) => !q.window && pointIn(q.outline, p[0], p[1]) && !(q.holes ?? []).some((h) => pointIn(h, p[0], p[1])));

  const out: RemnantCutPath[] = [];
  let at = from;
  while (left.length) {
    let k = 0, rev = false, best = Infinity;
    left.forEach((l, j) => {
      const a = len(sub(l[0], at)), b = len(sub(l[l.length - 1], at));
      if (a < best) { best = a; k = j; rev = false; }
      if (b < best) { best = b; k = j; rev = true; }
    });
    const l0 = left.splice(k, 1)[0];
    let pts = rev ? l0.slice().reverse() : l0.slice();
    const full = lineLen(pts);
    const gi = onEdge(pts[0]) ? gapIn : 0, go = onEdge(pts[pts.length - 1]) ? gapOut : 0;
    // too short for its gaps: as it is
    if (Math.max(0, gi) + Math.max(0, go) < full - 1) {
      if (gi > 0) pts = cutStart(pts, gi);
      else if (gi < 0) pts = [add(pts[0], mul(unit(sub(pts[0], pts[1])), -gi)), ...pts];
      if (go > 0) pts = cutStart(pts.slice().reverse(), go).reverse();
      else if (go < 0) { const n = pts.length; pts = [...pts, add(pts[n - 1], mul(unit(sub(pts[n - 1], pts[n - 2])), -go))]; }
    }
    const s = pts[0], e = pts[pts.length - 1];
    const dS = unit(sub(pts[1], s)), dE = unit(sub(e, pts[pts.length - 2]));
    // the scrap side: the side that is not remnant (both remnant, e.g. a hand cut between two: either)
    const side = (p: Pt, d: Pt): Pt => {
      const n: Pt = [-d[1], d[0]];
      const probe = add(p, mul(d, Math.min(10, full / 2)));
      return inRemnant(add(probe, mul(n, 3))) && !inRemnant(add(probe, mul(n, -3))) ? mul(n, -1) : n;
    };
    const nS = side(s, dS), nE = side(e, mul(dE, -1));
    let leadIn: Pt[] = [], leadOut: Pt[] = [];
    if (lin > 0) {
      const dir = type === "corner" ? mul(dS, -1) : type === "angled" ? unit(add(mul(dS, -Math.cos(aIn)), mul(nS, Math.sin(aIn)))) : nS;
      leadIn = [add(s, mul(dir, lin)), s];
    }
    if (lout > 0) {
      const dir = type === "corner" ? dE : type === "angled" ? unit(add(mul(dE, Math.cos(aOut)), mul(nE, Math.sin(aOut)))) : nE;
      leadOut = [e, add(e, mul(dir, lout))];
    }
    out.push({ pts: pts.map(r2), leadIn: leadIn.map(r2), leadOut: leadOut.map(r2) });
    at = leadOut[leadOut.length - 1] ?? e;
  }
  return out;
}
