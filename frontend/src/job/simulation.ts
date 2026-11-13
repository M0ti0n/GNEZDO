// Process -> Simulation: the sheet's cut path played back in time. The head goes from the machine's
// 0,0 corner to every pierce at the rapid speed, pierces (the Technology row's pierce time), cuts the
// lead-in, the contour and the lead-out at the row's speed (small holes at theirs), and so on. A part
// counts as cut out when its outline is done (a common cut block's parts: when the block's outline is).
// The times are an estimate (no acceleration).

import { viaOf, type CutContour } from "./cutPath";
import type { Pt } from "./manualGeom";
import type { TechRow } from "./technology";

/** Cutting speed when the Technology row has none [mm/min] */
const FALLBACK_SPEED = 2000;

interface Leg {
  /** index in the contours */
  k: number;
  phase: "rapid" | "pierce" | "cut";
  t0: number;
  t1: number;
  pts: Pt[];
  /** cumulative lengths along pts */
  acc: number[];
}

export interface SimTimeline {
  contours: CutContour[];
  legs: Leg[];
  total: number;
  /** the time each contour starts (its rapid) and ends */
  start: number[];
  end: number[];
  /** the time each part is cut out (its outline done) */
  partDone: Map<number, number>;
  /** the cutting speed was the Technology row's */
  fromTech: boolean;
}

const lenOf = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const accOf = (pts: Pt[]) => { const a = [0]; for (let i = 1; i < pts.length; i++) a.push(a[i - 1] + lenOf(pts[i - 1], pts[i])); return a; };
/** The whole cut of a contour: lead-in, contour, lead-out, as one polyline */
const cutPts = (c: CutContour): Pt[] => [...c.leadIn, ...(c.leadIn.length ? c.pts.slice(1) : c.pts), ...(c.leadOut.length ? c.leadOut.slice(1) : [])];

/** rapidMmMin: the machine's rapid speed (rapidOf) */
export function simTimeline(contours: CutContour[], from: Pt, row: TechRow | null, rapidMmMin: number): SimTimeline {
  const fromTech = !!row && row.speed > 0;
  const speed = fromTech ? row!.speed : FALLBACK_SPEED;
  const legs: Leg[] = [];
  const start: number[] = [], end: number[] = [];
  const partDone = new Map<number, number>();
  let t = 0, at = from;
  contours.forEach((c, k) => {
    const path = cutPts(c);
    start.push(t);
    if (!path.length) { end.push(t); return; }
    const p0 = path[0];
    // the rapid, through Movement's points
    const rp: Pt[] = [at, ...viaOf(c, contours[k - 1]), p0];
    const racc = accOf(rp), d = racc[racc.length - 1];
    if (d > 0.01) { const dt = (d / rapidMmMin) * 60; legs.push({ k, phase: "rapid", t0: t, t1: t + dt, pts: rp, acc: racc }); t += dt; }
    if (c.kind !== "trace") {
      const dt = row?.pierceS || 0;
      if (dt > 0) { legs.push({ k, phase: "pierce", t0: t, t1: t + dt, pts: [p0], acc: [0] }); t += dt; }
    }
    const v = c.small && row && row.smallHoleSpeed > 0 ? row.smallHoleSpeed : speed;
    const acc = accOf(path);
    const dt = (acc[acc.length - 1] / v) * 60;
    legs.push({ k, phase: "cut", t0: t, t1: t + dt, pts: path, acc });
    t += dt;
    end.push(t);
    at = path[path.length - 1];
    if (c.kind === "outer") for (const p of c.parts ?? [c.part]) partDone.set(p, t);
  });
  return { contours, legs, total: t, start, end, partDone, fromTech };
}

/** The polyline cut `d` mm along */
function cutTo(pts: Pt[], acc: number[], d: number): Pt[] {
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (acc[i] <= d) { out.push(pts[i]); continue; }
    const s = acc[i] - acc[i - 1];
    const f = s > 0 ? (d - acc[i - 1]) / s : 0;
    out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f]);
    break;
  }
  return out;
}

export interface SimState {
  /** the contour the head is at (contours before it are done); contours.length: all done */
  k: number;
  phase: "rapid" | "pierce" | "cut" | "start" | "done";
  head: Pt;
  /** the contours cut so far, the one being cut as far as it is */
  shown: CutContour[];
  /** the one being cut (in shown) */
  current?: CutContour;
  /** rapids so far (the current one as far as the head is) */
  rapids: [Pt, Pt][];
  /** parts cut out */
  done: Set<number>;
}

export function simAt(tl: SimTimeline, t: number, from: Pt): SimState {
  const done = new Set<number>();
  for (const [p, at] of tl.partDone) if (at <= t + 1e-9) done.add(p);
  if (t <= 0 || !tl.legs.length) return { k: 0, phase: "start", head: from, shown: [], rapids: [], done };
  const rapids: [Pt, Pt][] = [];
  const shown: CutContour[] = [];
  let head = from, k = tl.contours.length, phase: SimState["phase"] = "done", current: CutContour | undefined;
  for (const leg of tl.legs) {
    if (leg.t1 <= t) {
      if (leg.phase === "rapid") for (let i = 1; i < leg.pts.length; i++) rapids.push([leg.pts[i - 1], leg.pts[i]]);
      if (leg.phase === "cut") shown.push(tl.contours[leg.k]);
      head = leg.pts[leg.pts.length - 1];
      continue;
    }
    // the leg the head is on
    k = leg.k; phase = leg.phase;
    const f = leg.t1 > leg.t0 ? (t - leg.t0) / (leg.t1 - leg.t0) : 1;
    const d = f * leg.acc[leg.acc.length - 1];
    if (leg.phase === "rapid") {
      const part = cutTo(leg.pts, leg.acc, d);
      head = part[part.length - 1];
      for (let i = 1; i < part.length; i++) rapids.push([part[i - 1], part[i]]);
    } else if (leg.phase === "pierce") head = leg.pts[0];
    else {
      const part = cutTo(leg.pts, leg.acc, d);
      head = part[part.length - 1];
      const c = tl.contours[leg.k];
      // drawn as an open run so far (no lead colors while it is being cut)
      current = { ...c, pts: part, leadIn: [], leadOut: [] };
      shown.push(current);
    }
    break;
  }
  return { k, phase, head, shown, current, rapids, done };
}

/** m:ss (h:mm:ss from an hour) */
export function clock(s: number): string {
  const v = Math.max(0, Math.round(s));
  const h = Math.floor(v / 3600), m = Math.floor((v % 3600) / 60), sec = v % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}
