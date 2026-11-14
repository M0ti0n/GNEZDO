// FITTINGS -> Screw flight (from the HVAC Fittings workbench): the blank of one pitch, an annular ring
// with a gap. Standard development:
//   Li = sqrt((pi ID)^2 + P^2), Lo = sqrt((pi OD)^2 + P^2), h = (OD - ID) / 2,
//   Ri = h Li / (Lo - Li), Ro = Ri + h, calculated angle = Li / Ri.
// Shop practice: the blank is extended until its two cut ends are GAP apart at the inner edge
// (blank angle = 360 - 2 asin(GAP / 2 / Ri)). Pieces = ceil(L / P).

import { Lines, seg, type P2, type Seg } from "./arcs";

export interface ScrewValues { od: number; id: number; p: number; l: number; gap: number }

export const SCREW_DEFAULTS: ScrewValues = { od: 315, id: 101.6, p: 300, l: 1000, gap: 6 };

export function screwProblems(v: ScrewValues): string[] {
  const e: string[] = [];
  if (!(v.id > 0)) e.push("ID must be greater than 0");
  if (!(v.od > v.id)) e.push("OD must be larger than ID");
  if (!(v.p > 0)) e.push("P must be greater than 0");
  if (!(v.l > 0)) e.push("L must be greater than 0");
  if (!(v.gap >= 0)) e.push("The gap cannot be negative");
  if (!e.length) { const r = screwResult(v); if (v.gap >= 2 * r.ri) e.push(`The gap is larger than the blank's inside (${(2 * r.ri).toFixed(1)} mm)`); }
  return e;
}

export interface ScrewResult {
  li: number; lo: number; h: number; ri: number; ro: number;
  calc: number; gapAngle: number; blank: number; gapOuter: number;
  pieces: number; turns: number; warning?: string;
}

export function screwResult(v: ScrewValues): ScrewResult {
  const li = Math.hypot(Math.PI * v.id, v.p), lo = Math.hypot(Math.PI * v.od, v.p);
  const h = (v.od - v.id) / 2, ri = (h * li) / (lo - li), ro = ri + h;
  const calc = ((li / ri) * 180) / Math.PI;
  let gapAngle = ((2 * Math.asin(Math.min(1, v.gap / 2 / ri))) * 180) / Math.PI, blank = 360 - gapAngle, warning: string | undefined;
  if (blank < calc) {
    warning = `The calculated blank (${calc.toFixed(2)}°) is more than 360° less the gap: it is not extended and the gap is smaller`;
    blank = calc; gapAngle = 360 - calc;
  }
  const turns = v.l / v.p;
  return { li, lo, h, ri, ro, calc, gapAngle, blank, gapOuter: 2 * ro * Math.sin((gapAngle * Math.PI) / 180 / 2), pieces: Math.max(1, Math.ceil(turns - 1e-9)), turns, warning };
}

export function screwPieces(v: ScrewValues): { key: string; label: string; qty: number; lines: Lines }[] {
  const r = screwResult(v);
  const P = (rad: number, deg: number): P2 => [rad * Math.cos((deg * Math.PI) / 180), rad * Math.sin((deg * Math.PI) / 180)];
  const a0 = 270 + r.gapAngle / 2, a1 = a0 + r.blank, k = Math.max(1, Math.ceil(r.blank / 90)), span = r.blank;
  const outer: Seg[] = [], inner: Seg[] = [];
  for (let i = 0; i < k; i++) {
    outer.push(seg(P(r.ro, a0 + (span * i) / k), P(r.ro, a0 + (span * (i + 1)) / k), P(r.ro, a0 + (span * (i + 0.5)) / k)));
    inner.push(seg(P(r.ri, a1 - (span * i) / k), P(r.ri, a1 - (span * (i + 1)) / k), P(r.ri, a1 - (span * (i + 0.5)) / k)));
  }
  const L = new Lines().segs([...outer, seg(P(r.ro, a1), P(r.ri, a1)), ...inner, seg(P(r.ri, a0), P(r.ro, a0))]);
  return [{ key: "F", label: "flight", qty: r.pieces, lines: L }];
}
