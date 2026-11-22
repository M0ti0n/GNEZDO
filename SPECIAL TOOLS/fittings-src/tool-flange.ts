import { flangeFor, flangePieces, flangeProblems, type FlangeValues } from "./flange";
import { g, toParts, type Field, type Tool } from "./common";

interface V { table: boolean; a: number; b: number; m: number; e: number; n: number; whole: boolean; divided: boolean }
const values = (v: V): FlangeValues => {
  const std = flangeFor(v.a, v);
  return v.table ? std : { ...std, b: v.b, m: v.m, e: v.e, n: v.n };
};

/** The size fields of both flanges. */
export const sizeNote = "From the table: B, E, N (and the slot width or thread) for A from the standard sizes, A80 … A820 (an A between two sizes: as the smaller one). Untick to enter them.";
export const pieceFields = (what: string): Field[] => [
  { key: "whole", type: "check", label: "Combined", title: "The whole ring in one piece", group: "Pieces", default: true },
  { key: "divided", type: "check", label: "Divided (3 × 120°)", title: `Three 120° sections, the first cut midway between the top ${what} and the next`, group: "Pieces", default: false,
    note: `Only flanges over A 100 with 3 ${what}s or more are divided.` },
];

export const tool: Tool<V> = {
  manifest: {
    id: "flange", name: "Flange", countLabel: "Flanges",
    description: "A flat ring with N arc slots (25 mm) on the B circle, sizes from the standard table; whole or in three 120° sections. From the HVAC Fittings workbench.",
    fields: [
      { key: "table", type: "check", label: "Sizes from the table", group: "Size", default: true, note: sizeNote },
      { key: "a", type: "number", label: "A", title: "A: inner (nominal) diameter", unit: "mm", default: 400, min: 0, at: [37, 58], color: "blue" },
      { key: "b", type: "number", label: "B", title: "B: diameter the slots lie on (not from the table)", unit: "mm", default: 435, min: 0, at: [64, 22], color: "green" },
      { key: "m", type: "number", label: "M", title: "M: slot width (not from the table)", unit: "mm", default: 11, min: 0, at: [37, 9], color: "purple" },
      { key: "e", type: "number", label: "E", title: "E: ring width (not from the table)", unit: "mm", default: 30, min: 0, at: [84, 51], color: "brown" },
      { key: "n", type: "int", label: "N", title: "N: number of slots (not from the table)", unit: "slots", default: 10, min: 0, at: [84, 70], color: "dark" },
      ...pieceFields("slot"),
    ],
    note: "D = A + 2E. The parts' label says the thickness the table recommends.",
  },
  problems: (v) => flangeProblems(values(v)),
  title: (v) => `FL A${g(v.a)}`,
  parts: (v, gz) => { const f = values(v); return toParts(flangePieces(f), gz, (p) => `${p.label}, D ${g(f.a + 2 * f.e)}, T ${g(f.t)} recommended`); },
};
