// A sheet's cut path as the program a postprocessor gets (job/postprocessor.ts): the contours in
// cutting order with their leads, then the remnant's cuts; machine coordinates from the machine's 0,0
// corner. Outlines run clockwise and holes counter-clockwise as the machine sees them (G41: the kerf on
// the scrap side): with a 0,0 corner that mirrors the sheet as drawn, the contours are turned round.

import { liveContours, originPoint, type CutContour } from "./cutPath";
import type { Machine, Origin } from "./machine";
import type { NestedSheet } from "./nest";
import type { NcContour, NcProgram, NcPt } from "./postprocessor";
import { remnantValid } from "./remnant";
import { techRowFor } from "./technology";

type Pt = [number, number];

export function sheetProgram(sheet: NestedSheet, machine: Machine, origin: Origin, name: string, partName: (i: number) => string | undefined): NcProgram | { error: string } {
  const live = liveContours(sheet);
  if (!live.length) return { error: "no cut path (Process → Auto cut first)" };
  const [ox, oy] = originPoint(sheet, origin);
  const map = ([x, y]: Pt): NcPt => ({ x: Math.round(Math.abs(x - ox) * 1000) / 1000, y: Math.round(Math.abs(y - oy) * 1000) / 1000 });
  // the sheet as drawn has y down; machine Y up: one axis flipped keeps the turning sense, none or two mirror it
  const mirrored = (ox > 0) === (oy > 0);

  const contour = (c: Pick<CutContour, "kind" | "pts" | "leadIn" | "leadOut" | "small">, part?: string): NcContour | null => {
    let leadIn = c.leadIn, pts = c.pts, leadOut = c.leadOut;
    if (mirrored && (c.kind === "outer" || c.kind === "inner")) {
      // turned round: the lead-out (backwards) leads in, the lead-in (backwards) leads out
      [leadIn, pts, leadOut] = [leadOut.slice().reverse(), pts.slice().reverse(), leadIn.slice().reverse()];
    }
    const path: Pt[] = [...(leadIn.length ? leadIn : [pts[0]]), ...pts.slice(1), ...leadOut.slice(1)];
    const all = path.map(map).filter((p, i, a) => !i || Math.hypot(p.x - a[i - 1].x, p.y - a[i - 1].y) > 0.001);
    if (all.length < 2) return null;
    const nIn = Math.max(0, leadIn.length - 1), nOut = Math.max(0, leadOut.length - 1);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return {
      kind: c.kind, start: all[0], segs: all.slice(1).map((to) => ({ k: "line" as const, to })),
      leadIn: nIn, leadOut: nOut,
      widthMm: Math.round((Math.max(...xs) - Math.min(...xs)) * 10) / 10, heightMm: Math.round((Math.max(...ys) - Math.min(...ys)) * 10) / 10,
      ...(c.small ? { small: true } : {}), ...(part ? { part } : {}),
    };
  };

  const contours: NcContour[] = [];
  for (const c of live) { const k = contour(c, partName(c.part)); if (k) contours.push(k); }
  // the remnant's cuts last, as open cuts (from the end nearer the head)
  if (sheet.remnant && remnantValid(sheet)) {
    const lines: Pt[][] = [...sheet.remnant.lines, ...sheet.remnant.cuts.map((c): Pt[] => (c.axis === "v" ? [[c.at, c.from], [c.at, c.to]] : [[c.from, c.at], [c.to, c.at]]))];
    const lastC = live[live.length - 1];
    let at: Pt = lastC.leadOut[lastC.leadOut.length - 1] ?? lastC.pts[lastC.pts.length - 1];
    const left = lines.filter((l) => l.length > 1);
    while (left.length) {
      let k = 0, rev = false, best = Infinity;
      left.forEach((l, j) => {
        const a = Math.hypot(l[0][0] - at[0], l[0][1] - at[1]), b = Math.hypot(l[l.length - 1][0] - at[0], l[l.length - 1][1] - at[1]);
        if (a < best) { best = a; k = j; rev = false; }
        if (b < best) { best = b; k = j; rev = true; }
      });
      const l = left.splice(k, 1)[0];
      const pts = rev ? l.slice().reverse() : l;
      const c = contour({ kind: "open", pts, leadIn: [], leadOut: [] }, "Remnant");
      if (c) contours.push(c);
      at = pts[pts.length - 1];
    }
  }
  const tech = techRowFor(machine.technologies, sheet.material, sheet.thicknessMm);
  return {
    name,
    sheet: { lengthMm: sheet.lengthMm, widthMm: sheet.widthMm, thicknessMm: sheet.thicknessMm, material: sheet.material },
    tech: { ...(tech?.row ?? {}), name: tech?.tech.name },
    contours,
  };
}
