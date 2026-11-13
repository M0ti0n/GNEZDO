// Process -> Lead in / out: a closed contour's lead pair changed by hand on a processed sheet. A lead
// is moved to another point of its contour, or given another type and values; Reset gives it back
// the automatic cut's type and the Technology row's values, Delete makes it 0 / 0 (pierced on the
// contour). With "all instances" the same change goes to every copy of the part on the sheet (the
// same contour, the same point of it).

import {
  cornerAngle, cornerOnly, leadValues, leadsAt, oriented,
  type CutContour, type LeadSpec, type LeadStart, type SheetCut,
} from "./cutPath";
import { leadRulesOf, type LeadRules, type LeadType } from "./leads";
import type { Machine } from "./machine";
import { partLoops, transform, type Pt } from "./manualGeom";
import type { NestedSheet } from "./nest";
import { techRowFor, type TechRow } from "./technology";

export interface LeadCtx {
  sheet: NestedSheet;
  paths: Map<string, string>;
  rules: LeadRules;
  row: TechRow | null;
}

export function leadCtx(sheet: NestedSheet, paths: Map<string, string>, machine: Machine): LeadCtx {
  return { sheet, paths, rules: leadRulesOf(machine), row: techRowFor(machine.technologies, sheet.material, sheet.thicknessMm)?.row ?? null };
}

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const mul = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k];
const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1];
const len = (a: Pt) => Math.hypot(a[0], a[1]);
const unit = (a: Pt): Pt => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };

/** The nearest point of a closed loop: its edge, how far along it (0..1) and the distance. */
export function nearestOn(lp: Pt[], p: Pt): { edge: number; t: number; at: Pt; d: number } {
  let best = { edge: 0, t: 0, at: lp[0], d: Infinity };
  for (let i = 0; i < lp.length; i++) {
    const a = lp[i], b = lp[(i + 1) % lp.length], e = sub(b, a), L2 = dot(e, e);
    const t = L2 ? Math.max(0, Math.min(1, dot(sub(p, a), e) / L2)) : 0;
    const at = add(a, mul(e, t)), d = len(sub(p, at));
    if (d < best.d) best = { edge: i, t, at, d };
  }
  return best;
}

const distPoly = (pts: Pt[], p: Pt) => {
  let d = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], e = sub(pts[i], a), L2 = dot(e, e);
    const t = L2 ? Math.max(0, Math.min(1, dot(sub(p, a), e) / L2)) : 0;
    d = Math.min(d, len(sub(p, add(a, mul(e, t)))));
  }
  return pts.length === 1 ? len(sub(p, pts[0])) : d;
};

/** A contour this tool works on: an outline or a hole of one part (not a common cut block's). */
export const editable = (c: CutContour) => (c.kind === "outer" || c.kind === "inner") && !c.parts && !c.common && !c.bc && !c.inline;

/** The contour nearest the point (its leads count most: they are what is clicked), within `reach` mm. */
export function contourAt(cut: SheetCut, live: Set<CutContour>, p: Pt, reach: number): number {
  let k = -1, best = Infinity;
  cut.contours.forEach((c, i) => {
    if (!live.has(c) || !(c.kind === "outer" || c.kind === "inner")) return;
    const d = Math.min(
      c.leadIn.length > 1 ? distPoly(c.leadIn, p) * 0.6 : Infinity,
      c.leadOut.length > 1 ? distPoly(c.leadOut, p) * 0.6 : Infinity,
      distPoly(c.pts, p),
      len(sub(c.leadIn[0] ?? c.pts[0], p)) * 0.5,
    );
    if (d < best) { best = d; k = i; }
  });
  return best <= reach ? k : -1;
}

/** The part's loop a contour runs along: sheet frame, in the contour's sense, and unoriented (as drawn). */
export function loopOf(ctx: LeadCtx, c: CutContour, mirrored: boolean): { lp: Pt[]; raw: Pt[]; k: number } | null {
  const p = ctx.sheet.parts[c.part];
  if (!p) return null;
  const f = transform(p);
  const loops = partLoops(ctx.paths.get(p.partId) ?? "").map((lp) => lp.map(f));
  if (!loops.length) return null;
  let k = 0;
  if (c.kind === "inner") {
    let best = Infinity;
    for (let j = 1; j < loops.length; j++) { const d = nearestOn(loops[j], c.pts[0]).d; if (d < best) { best = d; k = j; } }
    if (k === 0) return null;
  }
  const raw = loops[k];
  return { lp: oriented(raw, c.kind === "outer" ? !mirrored : mirrored), raw, k };
}

/** The lead type the automatic cut gives a contour started at this point. */
export function autoType(ctx: LeadCtx, kind: "outer" | "inner", lp: Pt[], s: LeadStart, side: 1 | -1): LeadType {
  const cType = kind === "outer" ? ctx.rules.outCorner : ctx.rules.holeCorner;
  let oType = kind === "outer" ? ctx.rules.outOther : ctx.rules.holeOther;
  if (cornerOnly(oType)) oType = "perp";
  return s.vertex && cornerOnly(cType) && cornerAngle(lp, s.edge, side) <= ctx.rules.sharpMaxDeg ? cType : oType;
}

/** The current type and values of a contour's leads. */
export function leadOf(ctx: LeadCtx, c: CutContour): { type: LeadType; spec: LeadSpec } {
  const kind = c.kind === "outer" ? "outer" : "inner";
  const fallback = kind === "outer" ? ctx.rules.outOther : ctx.rules.holeOther;
  const type = c.lead ?? (cornerOnly(fallback) ? "perp" : fallback);
  return { type, spec: c.spec ?? leadValues(kind, ctx.row, type) };
}

/** Where on the loop a contour starts when it is started near p (corner types: a sharp corner within `snap` mm). */
export function startNear(ctx: LeadCtx, lp: Pt[], p: Pt, type: LeadType | null, side: 1 | -1, snap: number): LeadStart | string {
  const n = lp.length;
  const next = (i: number) => lp[(i + 1) % n], prev = (i: number) => lp[(i - 1 + n) % n];
  const sharp = (i: number) => len(sub(lp[i], prev(i))) >= 0.5 && len(sub(next(i), lp[i])) >= 0.5 && cornerAngle(lp, i, side) <= ctx.rules.sharpMaxDeg;
  // a sharp corner within `snap` mm: there (corner types need one)
  let k = -1, best = Infinity;
  for (let i = 0; i < n; i++) { const d = len(sub(lp[i], p)); if (d < best && sharp(i)) { best = d; k = i; } }
  if (k >= 0 && best <= snap) return { at: lp[k], edge: k, vertex: true, t: unit(sub(next(k), lp[k])) };
  if (type && cornerOnly(type)) return "a corner type needs a sharp corner: click nearer one, or pick another type";
  const q = nearestOn(lp, p);
  const a = lp[q.edge], b = next(q.edge), L = len(sub(b, a));
  // on a corner (or very near one): there; a sharp one with the corner direction
  const atVertex = (i: number) => sharp(i)
    ? { at: lp[i], edge: i, vertex: true, t: unit(sub(next(i), lp[i])) }
    : { at: lp[i], edge: i, vertex: true, t: unit(add(unit(sub(lp[i], prev(i))), unit(sub(next(i), lp[i])))) };
  if (q.t * L < 0.01) return atVertex(q.edge);
  if ((1 - q.t) * L < 0.01) return atVertex((q.edge + 1) % n);
  return { at: q.at, edge: q.edge, vertex: false, t: unit(sub(b, a)) };
}

export type LeadOp =
  | { op: "move"; to: Pt }
  | { op: "set"; type: LeadType; spec: LeadSpec }
  | { op: "reset" }
  | { op: "delete" };

/**
 * The sheet's cut with the op done on contour `k` (and, with `all`, on the same contour of every copy
 * of its part with the same mirror; parts not processed are left out). An error text when it cannot.
 */
export function editLead(ctx: LeadCtx, k: number, op: LeadOp, all: boolean, live: Set<CutContour>, snap = 3): { cut: SheetCut; n: number; note?: string } | string {
  const cut = ctx.sheet.cut;
  const c0 = cut?.contours[k];
  if (!cut || !c0 || !editable(c0)) return "pick an outline or a hole (common cut blocks: not here)";
  const mirrored = !!cut.mirrored;
  const side: 1 | -1 = mirrored ? -1 : 1;
  const L0 = loopOf(ctx, c0, mirrored);
  if (!L0) return "the part's drawing is not there";
  // the point of the loop the change is made at, as an edge of the drawn loop and how far along it
  const target: Pt = op.op === "move" ? op.to : c0.pts[0];
  const q0 = nearestOn(L0.raw, target);
  const p0 = ctx.sheet.parts[c0.part];
  const others = all
    ? cut.contours.map((c, i) => ({ c, i })).filter(({ c, i }) => i !== k && live.has(c) && editable(c) && c.kind === c0.kind
      && ctx.sheet.parts[c.part]?.partId === p0.partId && !!ctx.sheet.parts[c.part]?.mirror === !!p0.mirror)
    : [];
  const contours = cut.contours.slice();
  let n = 0;
  let note: string | undefined;
  const one = (i: number, c: CutContour, L: { lp: Pt[]; raw: Pt[] }) => {
    const kind = c.kind === "outer" ? "outer" : "inner";
    const a = L.raw[q0.edge], b = L.raw[(q0.edge + 1) % L.raw.length];
    if (!a || !b) return "the part's drawing changed";
    const at: Pt = op.op === "move" ? add(a, mul(sub(b, a), q0.t)) : c.pts[0];
    const cur = leadOf(ctx, c);
    let type: LeadType = op.op === "set" ? op.type : cur.type;
    let s = startNear(ctx, L.lp, at, op.op === "reset" ? null : type, side, op.op === "reset" ? 0.05 : snap);
    if (typeof s === "string" && op.op === "move") {
      // a corner type taken somewhere else: the automatic cut's type for there, its values
      s = startNear(ctx, L.lp, at, null, side, snap);
      if (typeof s !== "string") { type = autoType(ctx, kind, L.lp, s, side); note = "no sharp corner there, so the lead type for straight stretches"; }
    }
    if (typeof s === "string") return s;
    let spec: LeadSpec | undefined;
    if (op.op === "reset") { type = autoType(ctx, kind, L.lp, s, side); spec = undefined; }
    else if (op.op === "set") spec = op.spec;
    else if (op.op === "delete") spec = { ...cur.spec, lin: 0, lout: 0, gap: 0 };
    else spec = type === cur.type ? c.spec : undefined;
    const v = spec ?? leadValues(kind, ctx.row, type);
    const made = leadsAt(L.lp, kind, ctx.rules, ctx.row, s, type, v, side);
    const rest: CutContour = { ...c };
    delete rest.spec; delete rest.small;
    contours[i] = { ...rest, ...made, lead: type, ...(spec ? { spec } : {}) };
    n++;
    return null;
  };
  const err = one(k, c0, L0);
  if (err) return err;
  for (const { c, i } of others) {
    const L = loopOf(ctx, c, mirrored);
    if (!L || L.k !== L0.k) continue;
    one(i, c, L);
  }
  return { cut: { ...cut, contours }, n, ...(note ? { note } : {}) };
}
