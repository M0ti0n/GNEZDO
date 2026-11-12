// A sheet's cut path as the program a postprocessor gets (job/postprocessor.ts): the contours in
// cutting order with their leads, then the remnant's cuts; machine coordinates from the machine's 0,0
// corner. Auto cut already runs outlines clockwise and holes counter-clockwise as the machine sees them
// (G41: the kerf on the scrap side), for the 0,0 corner it was made for.

import { liveContours, originMirrors, originPoint, type CutContour } from "./cutPath";
import type { Machine, Origin } from "./machine";
import type { NestedSheet } from "./nest";
import type { NcContour, NcProgram, NcPt } from "./postprocessor";
import { remnantCutPaths } from "./remnantCut";
import { techRowFor } from "./technology";

type Pt = [number, number];

export function sheetProgram(sheet: NestedSheet, machine: Machine, origin: Origin, name: string, partName: (i: number) => string | undefined): NcProgram | { error: string } {
  const live = liveContours(sheet);
  if (!live.length) return { error: "no cut path (Process → Auto cut first)" };
  if (!!sheet.cut?.mirrored !== originMirrors(origin)) return { error: "the machine's 0,0 corner changed since Auto cut: run Auto cut again" };
  const tech = techRowFor(machine.technologies, sheet.material, sheet.thicknessMm);
  if (!tech) return { error: `no Technology row for ${sheet.material} ${sheet.thicknessMm} mm (Settings → Machines → Technology)` };
  const [ox, oy] = originPoint(sheet, origin);
  const map = ([x, y]: Pt): NcPt => ({ x: Math.round(Math.abs(x - ox) * 1000) / 1000, y: Math.round(Math.abs(y - oy) * 1000) / 1000 });

  const contour = (c: Pick<CutContour, "kind" | "pts" | "leadIn" | "leadOut" | "small">, part?: string): NcContour | null => {
    const { leadIn, pts, leadOut } = c;
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
  // the remnant's cuts last, as open cuts (from the end nearer the head; gaps and leads: remnantCut.ts)
  const lastC = live[live.length - 1];
  const at: Pt = lastC.leadOut[lastC.leadOut.length - 1] ?? lastC.pts[lastC.pts.length - 1];
  for (const r of remnantCutPaths(sheet, machine, at)) {
    const c = contour({ kind: "open", ...r }, "Remnant");
    if (c) contours.push(c);
  }
  return {
    name,
    sheet: { lengthMm: sheet.lengthMm, widthMm: sheet.widthMm, thicknessMm: sheet.thicknessMm, material: sheet.material },
    tech: { ...tech.row, name: tech.tech.name },
    contours,
  };
}
