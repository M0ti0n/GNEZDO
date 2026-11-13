// Process -> Micro joint: small uncut places along a contour (an outline or a hole) that keep it held.
// A micro joint is a start of the contour's plan (job/breakCut.ts) tagged "mj": its middle point and
// its length (a negative gap); the cut stops half the length before it and starts again half after it,
// with no lead-in or lead-out (the Technology row's MJ restart: pierce, quick pierce or none).
//
// Placed by hand (MANUAL), or on a contour clicked:
//  CORNERS: on the sharp corners towards the sheet's four corners (on a round corner: its point that
//    way); SIDES: on the middles of the sides towards the sheet's four sides. Four, or three when the
//    original lead in / out is kept (the one nearest the lead goes).
//  OPPOSITE SIDES X: the middles of the top and bottom sides; Y: of the left and right sides.
//  OPPOSITE CORNERS X: the corner towards the machine's 0,0 corner and the one across; Y: the other two.
//    These two take the original lead's place: the cut starts at one of the two joints.
// The directions are the sheet's (its whole four sides, whatever a shaped remnant's outline).
//
// RESET (here and in Break cut): every micro joint and break of the part out, and its contours'
// leads back to the automatic cut's (where the cut started).

import { buildPieces, copiesOf, piecesOf, planId, planOf, replace } from "./breakCut";
import { cornerAngle, leadValues, type BreakPlan, type BreakStart, type CutContour, type LeadSpec, type SheetCut } from "./cutPath";
import { autoType, loopOf, nearestOn, startNear, type LeadCtx } from "./leadEdit";
import type { Origin } from "./machine";
import type { Pt } from "./manualGeom";

export type AutoMode = "corners" | "sides" | "oppSidesX" | "oppSidesY" | "oppCornersX" | "oppCornersY";
export const OPPOSITE: AutoMode[] = ["oppSidesX", "oppSidesY", "oppCornersX", "oppCornersY"];

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** A micro joint's values: no leads, its length as a negative gap. */
export function mjSpec(ctx: LeadCtx, kind: "outer" | "inner", lengthMm: number): LeadSpec {
  return { ...leadValues(kind, ctx.row, "perpGap"), lin: 0, lout: 0, gap: -Math.abs(lengthMm) };
}
/** The micro joint length the Technology row gives (1 mm when it has none). */
export const mjDefault = (ctx: LeadCtx | null) => (ctx?.row?.mjGapMm && ctx.row.mjGapMm > 0 ? ctx.row.mjGapMm : 1);

const mjStart = (ctx: LeadCtx, kind: "outer" | "inner", at: Pt, lengthMm: number): BreakStart =>
  ({ at, type: "perpGap", spec: mjSpec(ctx, kind, lengthMm), tag: "mj" });

/** Where the joints of an automatic mode go on this contour (sheet frame, y down), in no order. */
function spots(ctx: LeadCtx, c: CutContour, mode: AutoMode, origin: Origin, mirrored: boolean): Pt[] | string {
  const L = loopOf(ctx, c, mirrored);
  if (!L) return "the part's drawing is not there";
  const lp = L.lp;
  const xs = lp.map((p) => p[0]), ys = lp.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  const side: 1 | -1 = mirrored ? -1 : 1;
  const n = lp.length;
  const sharp = lp.map((p, i) => ({ p, i })).filter(({ p, i }) => dist(p, lp[(i - 1 + n) % n]) >= 0.5 && dist(lp[(i + 1) % n], p) >= 0.5
    && cornerAngle(lp, i, side) <= ctx.rules.sharpMaxDeg).map(({ p }) => p);
  const onLoop = (t: Pt): Pt => nearestOn(lp, t).at;
  // a corner: the sharp corner nearest the box's corner that way, unless the outline comes clearly nearer
  // there (a round corner: its point nearest the box's corner)
  const corner = (t: Pt): Pt => {
    const near = onLoop(t);
    const best = sharp.reduce<Pt | null>((b, p) => (!b || dist(p, t) < dist(b, t) ? p : b), null);
    return best && dist(best, t) <= dist(near, t) + 0.15 * Math.min(x1 - x0, y1 - y0) ? best : near;
  };
  const sideMid = { left: [x0, my], right: [x1, my], top: [mx, y0], bottom: [mx, y1] } as Record<string, Pt>;
  // the sheet as drawn has y down: "bottom" is y1; the 0,0 corner and the one across
  const oCorner: Pt = [origin.endsWith("right") ? x1 : x0, origin.startsWith("bottom") ? y1 : y0];
  const across: Pt = [oCorner[0] === x0 ? x1 : x0, oCorner[1] === y0 ? y1 : y0];
  const others: Pt[] = [[oCorner[0], across[1]], [across[0], oCorner[1]]];
  switch (mode) {
    case "corners": return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map((t) => corner(t as Pt));
    case "sides": return Object.values(sideMid).map(onLoop);
    case "oppSidesX": return [sideMid.top, sideMid.bottom].map(onLoop);
    case "oppSidesY": return [sideMid.left, sideMid.right].map(onLoop);
    case "oppCornersX": return [oCorner, across].map(corner);
    case "oppCornersY": return others.map(corner);
  }
}

/** The contour's plan with an automatic mode's joints (its other joints out), or why not. */
function autoPlan(ctx: LeadCtx, cut: SheetCut, k: number, mode: AutoMode, keepOrig: boolean, lengthMm: number, origin: Origin): BreakPlan | string {
  const c = cut.contours[k];
  const kind = c.kind === "inner" ? "inner" : "outer";
  const plan = planOf(ctx, cut, k);
  const opposite = OPPOSITE.includes(mode);
  const keep = keepOrig && !opposite;
  // the contour's own lead: in the plan, or remembered from before a joint took its place
  const orig = plan.starts.find((s) => s.tag === "orig") ?? plan.orig;
  let pts = spots(ctx, c, mode, origin, !!cut.mirrored);
  if (typeof pts === "string") return pts;
  // one joint per place (a small or round contour can give the same point twice)
  pts = pts.filter((p, i, a) => a.findIndex((q) => dist(p, q) < Math.max(2, 2 * lengthMm)) === i);
  // kept lead: the joint nearest it goes (at most 3)
  if (keep && orig && pts.length > 3) {
    const far = pts.reduce((b, p) => (dist(p, orig.at) < dist(b, orig.at) ? p : b));
    pts = pts.filter((p) => p !== far);
  }
  if (keep && orig) pts = pts.filter((p) => dist(p, orig.at) > lengthMm + 1);
  if (!pts.length) return "No room for micro joints on this contour";
  // without the lead the cut starts at the joint nearest where it started
  const from = orig?.at ?? plan.starts[0]?.at ?? c.pts[0];
  pts.sort((a, b) => dist(a, from) - dist(b, from));
  const rest = plan.starts.filter((s) => s.tag !== "mj" && s.tag !== "orig");
  const mjs = pts.map((p) => mjStart(ctx, kind, p, lengthMm));
  return { id: plan.id, starts: keep && orig ? [orig, ...rest, ...mjs] : [...mjs, ...rest], ...(orig ? { orig } : {}) };
}

/** A contour's lead back to the automatic cut's, where it started: one start, no joints or breaks. */
function resetPlan(ctx: LeadCtx, cut: SheetCut, k: number): BreakPlan | string {
  const c = cut.contours[k];
  const plan = planOf(ctx, cut, k);
  const L = loopOf(ctx, c, !!cut.mirrored);
  if (!L) return "the part's drawing is not there";
  const side: 1 | -1 = cut.mirrored ? -1 : 1;
  const kind = c.kind === "inner" ? "inner" : "outer";
  const where = plan.starts.find((s) => s.tag === "orig")?.at ?? plan.orig?.at ?? plan.starts[0]?.at ?? c.pts[0];
  const s = startNear(ctx, L.lp, where, null, side, 0.05);
  if (typeof s === "string") return s;
  const type = autoType(ctx, kind, L.lp, s, side);
  return { id: planId(), starts: [{ at: s.at, type, spec: leadValues(kind, ctx.row, type), tag: "orig" }] };
}

/** The cut with contour k's plan replaced (its pieces built again), or why not. */
function rebuild(ctx: LeadCtx, cut: SheetCut, k: number, plan: BreakPlan, plain = false): SheetCut | string {
  const built = buildPieces(ctx, cut.contours[k], plan, !!cut.mirrored);
  if (typeof built === "string") return built;
  // back to the automatic lead: the Technology row's values, not set by hand
  const pieces = plain ? built.map((p) => { const q = { ...p }; delete q.spec; delete q.restart; return q; }) : built;
  return replace(cut, k, pieces);
}

const usable = (c: CutContour) => (c.kind === "outer" || c.kind === "inner") && !c.parts && !c.common && !c.inline && !c.cp;

/** An automatic mode on contour k (and with `all`, the same contour of every copy, each by its own directions). */
export function autoJoints(ctx: LeadCtx, k: number, mode: AutoMode, keepOrig: boolean, lengthMm: number, origin: Origin, all: boolean, live: Set<CutContour>): { cut: SheetCut; n: number } | string {
  const cut0 = ctx.sheet.cut;
  const c0 = cut0?.contours[k];
  if (!cut0 || !c0) return "Pick a contour";
  if (!usable(c0)) return "Micro joints go on part outlines and holes (not on common cut blocks)";
  let cut: SheetCut = cut0;
  const targets = [c0, ...(all ? copiesOf(ctx, cut0, k, live).map((i) => cut0.contours[i]) : [])];
  let n = 0, why = "";
  for (const t of targets) {
    const i = cut.contours.indexOf(t);
    if (i < 0) continue;
    const plan = autoPlan(ctx, cut, i, mode, keepOrig, lengthMm, origin);
    const next = typeof plan === "string" ? plan : rebuild(ctx, cut, i, plan);
    if (typeof next === "string") { why ||= next; continue; }
    cut = next;
    n++;
  }
  return n ? { cut, n } : why || "Nothing changed";
}

/** RESET: the part of contour k (with `all`, every copy of it): no joints or breaks, its leads the automatic cut's. */
export function resetPart(ctx: LeadCtx, k: number, all: boolean, live: Set<CutContour>): { cut: SheetCut; n: number } | string {
  const cut0 = ctx.sheet.cut;
  const c0 = cut0?.contours[k];
  if (!cut0 || !c0) return "Pick a part";
  let cut: SheetCut = cut0;
  const id = ctx.sheet.parts[c0.part]?.partId;
  const parts = new Set(all ? ctx.sheet.parts.flatMap((p, i) => (p.partId === id ? [i] : [])) : [c0.part]);
  // one contour of each plan (a cut in pieces is one contour here)
  const seen = new Set<string>();
  const firsts = cut.contours.filter((c, i) => {
    if (!live.has(c) || !usable(c) || !parts.has(c.part)) return false;
    const key = c.bc ? c.bc.plan.id : `c${i}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  let n = 0;
  for (const t of firsts) {
    const i = cut.contours.indexOf(t);
    if (i < 0) continue;
    const plan = resetPlan(ctx, cut, i);
    if (typeof plan === "string") continue;
    const next = rebuild(ctx, cut, i, plan, true);
    if (typeof next === "string") continue;
    cut = next;
    n++;
  }
  return n ? { cut, n: parts.size } : "Nothing to reset";
}

/** The contour's starts whose joints are taken out: when none is left, the cut starts where the joint was, with the automatic lead. */
export function withoutJoint(ctx: LeadCtx, cut: SheetCut, k: number, si: number): BreakPlan | string {
  const plan = planOf(ctx, cut, k);
  const s = plan.starts[si];
  if (!s) return "That micro joint is not there any more";
  const starts = plan.starts.filter((_, i) => i !== si);
  if (starts.length) return { ...plan, starts };
  if (plan.orig) return { id: plan.id, starts: [plan.orig] };
  const c = cut.contours[k];
  const L = loopOf(ctx, c, !!cut.mirrored);
  if (!L) return "the part's drawing is not there";
  const side: 1 | -1 = cut.mirrored ? -1 : 1;
  const kind = c.kind === "inner" ? "inner" : "outer";
  const at = startNear(ctx, L.lp, s.at, null, side, 0.05);
  if (typeof at === "string") return at;
  const type = autoType(ctx, kind, L.lp, at, side);
  return { id: plan.id, starts: [{ at: at.at, type, spec: leadValues(kind, ctx.row, type), tag: "orig" }] };
}

/** DELETE: the micro joint out (with `all`, the joint at the same place of every copy). */
export function deleteJoint(ctx: LeadCtx, k: number, si: number, all: boolean, live: Set<CutContour>, mapPoint: (from: CutContour, to: CutContour, p: Pt) => Pt | null): { cut: SheetCut; n: number } | string {
  const cut0 = ctx.sheet.cut;
  if (!cut0?.contours[k]) return "Pick a micro joint";
  let cut: SheetCut = cut0;
  const c0 = cut.contours[k];
  const s0 = planOf(ctx, cut, k).starts[si];
  if (!s0 || s0.tag !== "mj") return "Pick a micro joint (its balloon)";
  const targets = all ? copiesOf(ctx, cut0, k, live).map((i) => cut0.contours[i]) : [];
  const p0 = withoutJoint(ctx, cut, k, si);
  if (typeof p0 === "string") return p0;
  const first = rebuild(ctx, cut, k, p0, !p0.starts.some((s) => s.tag !== "orig"));
  if (typeof first === "string") return first;
  cut = first;
  let n = 1;
  for (const t of targets) {
    const i = cut.contours.indexOf(t);
    if (i < 0) continue;
    const want = mapPoint(c0, t, s0.at);
    if (!want) continue;
    const j = planOf(ctx, cut, i).starts.findIndex((s) => s.tag === "mj" && dist(s.at, want) < 0.5);
    if (j < 0) continue;
    const p = withoutJoint(ctx, cut, i, j);
    if (typeof p === "string") continue;
    const next = rebuild(ctx, cut, i, p, !p.starts.some((s) => s.tag !== "orig"));
    if (typeof next === "string") continue;
    cut = next;
    n++;
  }
  return { cut, n };
}

/** The micro joints on the contour of piece k, in cut order (for numbering). */
export const jointsOf = (ctx: LeadCtx, cut: SheetCut, k: number) => planOf(ctx, cut, k).starts.flatMap((s, si) => (s.tag === "mj" ? [{ s, si }] : []));

export { piecesOf };
