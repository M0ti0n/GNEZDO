// Reports of a job (toolbar -> Report): the numbers behind the Nest report (a page per sheet, with
// its parts) and the Cost report (a price per part). Weights from the part areas; times estimated from
// the machine's Technology row (cut length / speed, a pierce per contour, rapids between the parts)
// until Generate path works the real path out.

import type { JobPart } from "../api/types";
import { densityOf, loopsOf, sheetStats, type NestedSheet, type SheetStats } from "./nest";
import type { Machine, Origin } from "./machine";
import { techRowFor, type TechRow } from "./technology";

/** Rapid speed assumed for the estimate [mm/min] (the machine's own comes with Motion & times). */
export const RAPID_MM_MIN = 20000;

type Loop = [number, number][];
const perimeter = (pts: Loop) => pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + Math.hypot(q[0] - p[0], q[1] - p[1]); }, 0);
const area = (pts: Loop) => Math.abs(pts.reduce((a, p, i) => { const q = pts[(i + 1) % pts.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
const box = (pts: Loop) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
};

/** Cutting time of one piece [s] with this row: the outline at the cutting speed, small holes slower, a pierce each. */
export function partCutSeconds(path: string, row: TechRow | null | undefined, small?: boolean): number | null {
  if (!row || !(row.speed > 0)) return null;
  const loops = loopsOf(path);
  if (!loops.length) return 0;
  const outer = loops.reduce((a, b) => (area(b) > area(a) ? b : a));
  let s = 0;
  for (const lp of loops) {
    const b = box(lp);
    const isSmall = lp !== outer && (small || (row.smallHoleMm > 0 && b.w + b.h <= 2 * row.smallHoleMm));
    const v = isSmall && row.smallHoleSpeed > 0 ? row.smallHoleSpeed : row.speed;
    s += (perimeter(lp) / v) * 60 + (row.pierceS || 0);
    // lead-in and lead-out
    s += (((lp === outer ? row.outLeadInMm + row.outLeadOutMm : row.holeLeadInMm + row.holeLeadOutMm) || 0) / v) * 60;
  }
  return s;
}

/** Weight of one piece [kg] */
export const partKg = (p: { areaMm2: number; material: string; thicknessMm: number }) => (p.areaMm2 * p.thicknessMm * densityOf(p.material)) / 1e6;

export interface SheetReport {
  stats: SheetStats;
  /** estimated [s]; null: no Technology row for the sheet */
  cutS: number | null; rapidS: number | null; totalS: number | null;
  row: TechRow | null;
  /** the parts on the sheet, by job ID */
  parts: { jp: JobPart | undefined; partId: string; qty: number; kg: number; cutS: number | null }[];
}

export function sheetReport(sheet: NestedSheet, jobParts: JobPart[], machine: Machine, origin: Origin): SheetReport {
  const byId = new Map(jobParts.map((jp) => [jp.part.id, jp]));
  const refs = new Map(jobParts.map((jp) => [jp.part.id, { path: jp.part.path, areaMm2: jp.part.areaMm2 }]));
  const stats = sheetStats(sheet, refs, origin);
  const row = techRowFor(machine.technologies, sheet.material, sheet.thicknessMm)?.row ?? null;
  const counts = new Map<string, number>();
  for (const p of sheet.parts) counts.set(p.partId, (counts.get(p.partId) ?? 0) + 1);
  const parts = [...counts].map(([partId, qty]) => {
    const jp = byId.get(partId);
    return {
      jp, partId, qty,
      kg: jp ? partKg({ areaMm2: jp.part.areaMm2, material: sheet.material, thicknessMm: sheet.thicknessMm }) : 0,
      cutS: jp ? partCutSeconds(jp.part.path, row) : null,
    };
  }).sort((a, b) => (a.jp?.no ?? 1e9) - (b.jp?.no ?? 1e9));
  let cutS: number | null = null, rapidS: number | null = null;
  if (row) {
    cutS = parts.reduce((s, p) => s + (p.cutS ?? 0) * p.qty, 0);
    // rapids: from 0,0 through the parts bottom-up (rows of about a part's height), and between each part's contours
    const pts = sheet.parts.map((p) => ({ x: p.x, y: sheet.widthMm - p.y }));
    pts.sort((a, b) => Math.round(a.y / 100) - Math.round(b.y / 100) || a.x - b.x);
    let d = 0, at = { x: 0, y: 0 };
    for (const q of pts) { d += Math.hypot(q.x - at.x, q.y - at.y); at = q; }
    d += Math.hypot(at.x, at.y);
    for (const p of sheet.parts) {
      const jp = byId.get(p.partId);
      if (!jp) continue;
      const n = loopsOf(jp.part.path).length;
      d += Math.max(0, n - 1) * Math.hypot(jp.part.w, jp.part.h) * 0.35;
    }
    rapidS = (d / RAPID_MM_MIN) * 60;
  }
  return { stats, row, cutS, rapidS, totalS: cutS !== null && rapidS !== null ? cutS + rapidS : null, parts };
}

export const hmsOf = (s: number | null) => {
  if (s === null || !Number.isFinite(s)) return "—";
  const t = Math.round(s);
  return [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60].map((n) => String(n).padStart(2, "0")).join(":");
};
export const mmss = (s: number | null) => {
  if (s === null || !Number.isFinite(s)) return "—";
  const t = Math.round(s);
  return t >= 3600 ? hmsOf(t) : `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

/** "3,4,8" / "2-5, 9" -> page numbers */
export function parsePages(text: string, max: number): number[] {
  const out = new Set<number>();
  for (const part of text.split(/[,;\s]+/)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
    if (!m) continue;
    const a = +m[1], b = m[2] ? +m[2] : a;
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (i >= 1 && i <= max) out.add(i);
  }
  return [...out].sort((x, y) => x - y);
}
