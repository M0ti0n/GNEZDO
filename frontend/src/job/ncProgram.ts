// A sheet's cut path as the program a postprocessor gets (job/postprocessor.ts): the contours in
// cutting order with their leads, then the remnant's cuts; machine coordinates from the machine's 0,0
// corner. Auto cut already runs outlines clockwise and holes counter-clockwise as the machine sees them
// (G41: the kerf on the scrap side), for the 0,0 corner it was made for. Arcs are found again from the
// points (job/ncArcs.ts); each contour says which part it is (a subprogram per part, e.g. LVD G980).

import { liveContours, originMirrors, originPoint, viaOf, type CutContour } from "./cutPath";
import { rowAsCut, type Machine, type Origin } from "./machine";
import type { NestedSheet } from "./nest";
import { fitMoves } from "./ncArcs";
import type { NcContour, NcPart, NcProgram, NcPt } from "./postprocessor";
import { remnantCutPaths } from "./remnantCut";
import { reusesPierce } from "./commonPierce";
import { techColumnsFor, techRowFor, type TechRow } from "./technology";

type Pt = [number, number];

export function sheetProgram(sheet: NestedSheet, machine: Machine, origin: Origin, name: string, partName: (i: number) => string | undefined): NcProgram | { error: string } {
  const live = liveContours(sheet);
  if (!live.length) return { error: "no cut path (Process → Auto cut first)" };
  if (!!sheet.cut?.mirrored !== originMirrors(origin)) return { error: "the machine's 0,0 corner changed since Auto cut: run Auto cut again" };
  const tech = techRowFor(machine.technologies, sheet.material, sheet.thicknessMm);
  if (!tech) return { error: `no Technology row for ${sheet.material} ${sheet.thicknessMm} mm (Settings → Machines → Technology)` };
  const row = checkedRow(machine, tech.row, `${sheet.material} ${sheet.thicknessMm} mm`);
  if (typeof row === "string") return { error: row };
  const [ox, oy] = originPoint(sheet, origin);
  // from the machine's 0,0 corner, signed: a point beyond the sheet's edge (a remnant cut's negative gap,
  // off the plate) stays beyond it, not folded back onto the sheet
  const sx = origin.endsWith("right") ? -1 : 1, sy = origin.startsWith("bottom") ? -1 : 1;
  const r3 = (v: number) => { const r = Math.round(v * 1000) / 1000; return r === 0 ? 0 : r; };
  const map = ([x, y]: Pt): NcPt => ({ x: r3(sx * (x - ox)), y: r3(sy * (y - oy)) });

  const mapped = (pts: Pt[]): NcPt[] => pts.map(map).filter((p, i, a) => !i || Math.hypot(p.x - a[i - 1].x, p.y - a[i - 1].y) > 0.001);

  const restart = (["none", "pierce", "quick"] as const)[row.mjPierce ?? 1] ?? "pierce";
  const contour = (c: Pick<CutContour, "kind" | "pts" | "leadIn" | "leadOut" | "small" | "restart" | "inline"> & { part?: number; parts?: number[] }, part?: string): NcContour | null => {
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
    // its size as drawn: in the part's own frame, so a part nested at 15°, 30° or 45° keeps its size class
    // (E001 / E002 / E003); rounded to 0.001 mm only (the limits are compared with it)
    const ang = ((sheet.parts[c.parts?.[0] ?? c.part ?? -1]?.angle ?? 0) * Math.PI) / 180;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const xs = pts.map(([x, y]) => x * ca + y * sa), ys = pts.map(([x, y]) => -x * sa + y * ca);
    const size = (v: number[]) => Math.round((Math.max(...v) - Math.min(...v)) * 1000) / 1000;
    return {
      kind: c.kind, start, segs,
      leadIn: segIn.length, leadOut: segOut.length,
      // an inline cut's stretch: the whole contour's size (its size class), its own pierce
      widthMm: c.inline ? c.inline.w : size(xs),
      heightMm: c.inline ? c.inline.h : size(ys),
      ...(c.small ? { small: true } : {}), ...(part ? { part } : {}),
      ...(c.inline ? { inline: true, restart: c.inline.pierce, ...(c.inline.rev ? { rev: true } : {}) } : c.restart ? { restart } : {}),
      ...(c.parts?.length ? { partNos: [...c.parts] } : c.part !== undefined ? { partNo: c.part } : {}),
    };
  };

  const contours: NcContour[] = [];
  const boxes = new Map<number, NcPart["box"]>();
  live.forEach((c, i) => {
    const k = contour(c, c.parts?.length ? undefined : plain(partName(c.part)));
    if (!k) return;
    k.cutNo = i;
    // Process → Common pierce: an outline starting in a hole pierced already starts with a quick pierce
    if (reusesPierce(live, i)) k.restart = "quick";
    // Process → Movement: the rapid to it through these points
    const via = mapped(viaOf(c, live[i - 1]));
    if (via.length) k.via = via;
    contours.push(k);
    if (c.parts?.length) return;
    const b = boxes.get(c.part) ?? { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const q of mapped(c.pts)) { b.minX = Math.min(b.minX, q.x); b.minY = Math.min(b.minY, q.y); b.maxX = Math.max(b.maxX, q.x); b.maxY = Math.max(b.maxY, q.y); }
    boxes.set(c.part, b);
  });
  // the remnant's cuts last, as open cuts (from the end nearer the head; gaps and leads: remnantCut.ts)
  const lastC = live[live.length - 1];
  const at: Pt = lastC.leadOut[lastC.leadOut.length - 1] ?? lastC.pts[lastC.pts.length - 1];
  for (const r of remnantCutPaths(sheet, machine, at)) {
    const c = contour({ kind: "open", ...r }, "Remnant");
    if (c) contours.push(c);
  }
  return {
    name: plain(name) ?? "",
    sheet: { lengthMm: sheet.lengthMm, widthMm: sheet.widthMm, thicknessMm: sheet.thicknessMm, material: plain(sheet.material) ?? "" },
    tech: { ...rowAsCut(machine, row), name: plain(tech.tech.name) ?? "", ...(sheet.prePierce !== undefined ? { prePierce: sheet.prePierce ? 1 : 0 } : {}) },
    contours,
    parts: [...boxes].sort((a, b) => a[0] - b[0]).map(([no, box]) => ({ no, ...(partName(no) ? { name: plain(partName(no)) } : {}), box })),
  };
}

/**
 * The Technology row as the postprocessor gets it: every value a number (a machine file edited by hand
 * can have "8" for 8), none below its column's least. Laser: both E-code limits set (0 turns one off) and
 * Slow (E003) not above Medium (E002). A text, otherwise: why not.
 */
function checkedRow(machine: Machine, row: TechRow, of: string): TechRow | string {
  const out: Record<string, unknown> = { ...row };
  const where = `in the Technology row for ${of} (Settings → Machines → Technology)`;
  for (const g of techColumnsFor(machine.technology)) for (const col of g.cols) {
    const v = out[col.key];
    if (v === undefined || v === null || v === "") continue;
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim().replace(",", ".")) : NaN;
    if (!Number.isFinite(n)) return `${g.group} "${col.label}" is ${JSON.stringify(v)} ${where}: it must be a number`;
    if (n < (col.min ?? 0)) return `${g.group} "${col.label}" is ${n} ${where}: it must be ${col.min ?? 0} or more`;
    out[col.key] = n;
  }
  if (machine.technology === "laser") {
    const mid = out.midSizeMm as number | undefined, little = out.littleSizeMm as number | undefined;
    if (mid === undefined || mid === null || little === undefined || little === null)
      return `"Medium (E002) up to" and "Slow (E003) up to" are not set ${where}: set them (0 turns one off)`;
    if (mid > 0 && little > mid) return `"Slow (E003) up to" (${little} mm) is above "Medium (E002) up to" (${mid} mm) ${where}: E002 would never be used`;
  }
  return out as unknown as TechRow;
}

/** Letters a control may not read in a comment, as plain ones (Č → C, ß → SS, Ø → O). */
const SPELLED: Record<string, string> = { ß: "ss", ẞ: "SS", Đ: "D", đ: "d", Ł: "L", ł: "l", Ø: "O", ø: "o", Æ: "AE", æ: "ae", Œ: "OE", œ: "oe", Þ: "TH", þ: "th" };

/**
 * A name as it goes into an NC program: plain ASCII (controls such as LVD's Fanuc read ISO / ASCII, a
 * UTF-8 Č is two odd characters there). Accents go (č, š, ž → c, s, z), a few letters are spelled out,
 * anything else outside printable ASCII (emoji) is left out.
 */
export function plain(s: string | undefined): string | undefined {
  if (s === undefined) return undefined;
  return [...s.normalize("NFD")].map((ch) => SPELLED[ch] ?? ch).join("")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/\s+/g, " ").trim();
}
