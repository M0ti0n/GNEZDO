// A sheet's cut path as the program a postprocessor gets (job/postprocessor.ts): the contours in
// cutting order with their leads, then the remnant's cuts; machine coordinates from the machine's 0,0
// corner. Auto cut already runs outlines clockwise and holes counter-clockwise as the machine sees them
// (G41: the kerf on the scrap side), for the 0,0 corner it was made for. Arcs are found again from the
// points (job/ncArcs.ts); each contour says which part it is (a subprogram per part, e.g. LVD G980).

import { liveContours, originMirrors, originPoint, type CutContour } from "./cutPath";
import type { Machine, Origin } from "./machine";
import type { NestedSheet } from "./nest";
import { fitMoves } from "./ncArcs";
import type { NcContour, NcPart, NcProgram, NcPt } from "./postprocessor";
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

  const mapped = (pts: Pt[]): NcPt[] => pts.map(map).filter((p, i, a) => !i || Math.hypot(p.x - a[i - 1].x, p.y - a[i - 1].y) > 0.001);

  const contour = (c: Pick<CutContour, "kind" | "pts" | "leadIn" | "leadOut" | "small"> & { part?: number; parts?: number[] }, part?: string): NcContour | null => {
    const { leadIn, pts, leadOut } = c;
    // lead-in, contour and lead-out each as lines and arcs (job/ncArcs.ts)
    const body = mapped(pts);
    if (!body.length) return null;
    const lin = leadIn.length > 1 ? mapped(leadIn) : [];
    const lout = leadOut.length > 1 ? mapped(leadOut) : [];
    const start = lin.length > 1 ? lin[0] : body[0];
    const segIn = lin.length > 1 ? fitMoves([...lin.slice(0, -1), body[0]]) : [];
    const segBody = fitMoves(body);
    const segOut = lout.length > 1 ? fitMoves([body[body.length - 1], ...lout.slice(1)]) : [];
    const segs = [...segIn, ...segBody, ...segOut];
    if (!segs.length) return null;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return {
      kind: c.kind, start, segs,
      leadIn: segIn.length, leadOut: segOut.length,
      widthMm: Math.round((Math.max(...xs) - Math.min(...xs)) * 10) / 10, heightMm: Math.round((Math.max(...ys) - Math.min(...ys)) * 10) / 10,
      ...(c.small ? { small: true } : {}), ...(part ? { part } : {}),
      ...(c.parts?.length ? { partNos: [...c.parts] } : c.part !== undefined ? { partNo: c.part } : {}),
    };
  };

  const contours: NcContour[] = [];
  const boxes = new Map<number, NcPart["box"]>();
  for (const c of live) {
    const k = contour(c, c.parts?.length ? undefined : partName(c.part));
    if (!k) continue;
    contours.push(k);
    if (c.parts?.length) continue;
    const b = boxes.get(c.part) ?? { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const q of mapped(c.pts)) { b.minX = Math.min(b.minX, q.x); b.minY = Math.min(b.minY, q.y); b.maxX = Math.max(b.maxX, q.x); b.maxY = Math.max(b.maxY, q.y); }
    boxes.set(c.part, b);
  }
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
    parts: [...boxes].sort((a, b) => a[0] - b[0]).map(([no, box]) => ({ no, ...(partName(no) ? { name: partName(no) } : {}), box })),
  };
}
