// Postprocessors: a machine's NC output is written by a small JavaScript file it carries
// (Settings -> Machines -> NC output; it goes with Export / Import machine). The file defines
//
//   function postprocess(program) { ...; return "the NC program as text"; }
//
// and gets the sheet's cutting path as below (coordinates in mm, from the sheet's 0,0 corner as the
// machine has it, X along the sheet's length). Contours come in cut order; each starts at its pierce
// point and its segments include the lead-in (first) and lead-out (last). Segments are lines and arcs
// (arcs found again from the drawing's points, at most 180° each: job/ncArcs.ts).

import type { TechRow } from "./technology";

export interface NcPt { x: number; y: number }
export type NcSeg =
  | { k: "line"; to: NcPt }
  /** Arc to `to` around `c`; clockwise or not. A full circle has `to` = its start. */
  | { k: "arc"; to: NcPt; c: NcPt; cw: boolean };

export interface NcContour {
  /** outer: a part's outline, inner: a hole / window, open: an open cut (no kerf compensation), trace: marking */
  kind: "outer" | "inner" | "open" | "trace";
  start: NcPt;
  segs: NcSeg[];
  /** How many of the first / last segments are the lead-in / lead-out */
  leadIn: number;
  leadOut: number;
  /** Size of the contour itself (without leads) [mm] */
  widthMm: number;
  heightMm: number;
  /** Cut at the small-hole speed (marked as a hole in the importer, or set by hand); missing = by size */
  small?: boolean;
  /** Starts again right after a micro joint (no lead-in): pierce as the Technology row's MJ restart says */
  restart?: "pierce" | "quick" | "none";
  /** Process → Movement: the rapid to `start` goes through these points first (in order) */
  via?: NcPt[];
  /** Which part it belongs to (its name), for comments */
  part?: string;
  /** The part's number on the sheet (program.parts); a common cut block's shared lines and outline: every member in `partNos` */
  partNo?: number;
  partNos?: number[];
}

export interface NcPart {
  /** as in NcContour.partNo */
  no: number;
  name?: string;
  /** The box around the part's contours (machine coordinates, without leads) */
  box: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface NcProgram {
  /** Program name (the sheet's / file's) */
  name: string;
  sheet: { lengthMm: number; widthMm: number; thicknessMm: number; material: string };
  /** The Technology row for the sheet (speeds, pierce time, ...; `extra` holds an imported table's other columns) */
  tech: Partial<TechRow> & { name?: string };
  contours: NcContour[];
  /** The sheet's parts that have contours (by partNo) */
  parts?: NcPart[];
}

export interface Postprocessor {
  name: string;
  /** NC file extension, e.g. ".nc" */
  extension: string;
  source: string;
}

/** Runs a postprocessor's source on a program: the NC text, or why it failed. */
export function runPostprocessor(source: string, program: NcProgram): { ok: true; text: string } | { ok: false; error: string } {
  let fn: unknown;
  try {
    fn = new Function(`"use strict";\n${source}\n;return typeof postprocess === "function" ? postprocess : undefined;`)();
  } catch (e) {
    return { ok: false, error: `The postprocessor does not load: ${(e as Error).message}` };
  }
  if (typeof fn !== "function") return { ok: false, error: "The postprocessor has no function postprocess(program)" };
  try {
    const text = (fn as (p: NcProgram) => unknown)(structuredClone(program));
    if (typeof text !== "string") return { ok: false, error: "postprocess(program) did not return text" };
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: `The postprocessor failed: ${(e as Error).message}` };
  }
}

/** A small sheet to try a postprocessor on: a 200 × 100 plate with a Ø30 hole and a slot, leads in place. */
export function sampleProgram(tech: NcProgram["tech"], thicknessMm = 10): NcProgram {
  const hole: NcContour = {
    kind: "inner", start: { x: 60, y: 50 }, leadIn: 1, leadOut: 0, widthMm: 30, heightMm: 30,
    segs: [{ k: "line", to: { x: 75, y: 50 } }, { k: "arc", to: { x: 75, y: 50 }, c: { x: 60, y: 50 }, cw: false }],
  };
  const slot: NcContour = {
    kind: "inner", start: { x: 140, y: 50 }, leadIn: 1, leadOut: 1, widthMm: 40, heightMm: 12,
    segs: [
      { k: "line", to: { x: 140, y: 44 } }, { k: "line", to: { x: 154, y: 44 } },
      { k: "arc", to: { x: 154, y: 56 }, c: { x: 154, y: 50 }, cw: false }, { k: "line", to: { x: 126, y: 56 } },
      { k: "arc", to: { x: 126, y: 44 }, c: { x: 126, y: 50 }, cw: false }, { k: "line", to: { x: 140, y: 44 } },
      { k: "line", to: { x: 140, y: 50 } },
    ],
  };
  const outline: NcContour = {
    kind: "outer", start: { x: 208, y: 0 }, leadIn: 1, leadOut: 1, widthMm: 200, heightMm: 100,
    segs: [
      { k: "line", to: { x: 200, y: 0 } }, { k: "line", to: { x: 0, y: 0 } }, { k: "line", to: { x: 0, y: 100 } },
      { k: "line", to: { x: 200, y: 100 } }, { k: "line", to: { x: 200, y: 0 } }, { k: "line", to: { x: 200, y: -8 } },
    ],
  };
  return {
    name: "SAMPLE", sheet: { lengthMm: 300, widthMm: 200, thicknessMm, material: "S235" }, tech,
    contours: [hole, slot, outline].map((c) => ({ ...c, part: "Sample plate", partNo: 0 })),
    parts: [{ no: 0, name: "Sample plate", box: { minX: 0, minY: 0, maxX: 200, maxY: 100 } }],
  };
}

/** A plain ISO postprocessor (absolute coordinates), the starting point for a machine without its own. */
export const GENERIC_POSTPROCESSOR: Postprocessor = {
  name: "Generic ISO (absolute)",
  extension: ".nc",
  source: `// GNEZDO generic ISO postprocessor: absolute coordinates, kerf compensation left (G41).
// Change it to suit the machine; see program in Settings > Machines > NC output.
function postprocess(p) {
  const out = [];
  let n = 0;
  const N = (s) => { n += 10; out.push("N" + n + " " + s); };
  const f = (v) => (Math.round(v * 1000) / 1000).toFixed(3).replace(/\\.?0+$/, "") || "0";
  out.push("%", "(" + p.name + " - " + p.sheet.material + " " + p.sheet.thicknessMm + " mm)");
  N("G90 G21 G40");
  for (const c of p.contours) {
    N("G00 X" + f(c.start.x) + " Y" + f(c.start.y));
    const feed = c.kind !== "outer" && c.small ? (p.tech.smallHoleSpeed || p.tech.speed) : p.tech.speed;
    const comp = c.kind === "open" || c.kind === "trace" ? "" : "G41 ";
    N("M07");
    let pos = c.start;
    c.segs.forEach((s, i) => {
      const head = i === 0 ? comp + "F" + Math.round(feed || 0) + " " : "";
      if (s.k === "line") N(head + "G01 X" + f(s.to.x) + " Y" + f(s.to.y));
      else N(head + (s.cw ? "G02" : "G03") + " X" + f(s.to.x) + " Y" + f(s.to.y) + " I" + f(s.c.x - pos.x) + " J" + f(s.c.y - pos.y));
      pos = s.to;
    });
    N("M08");
    N("G40");
  }
  N("G00 X0 Y0");
  N("M30");
  out.push("%");
  return out.join("\\r\\n") + "\\r\\n";
}
`,
};
