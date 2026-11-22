import { branchPieces, branchProblems, type BranchValues } from "./branch";
import { foldFields, g, toParts, type Tool } from "./common";

interface V { d1: number; d2: number; h1: number; h2: number; d3: number; l: number; a: number; foldsOn: boolean; folds: number; markLen: number; markGap: number }
const values = (v: V): BranchValues => ({ d1: v.d1, d2: v.d2, h1: v.h1, h2: v.h2, d3: v.d3, l: v.l, a: v.a, folds: v.foldsOn ? v.folds : 0, markLen: v.markLen, markGap: v.markGap });

export const tool: Tool<V> = {
  manifest: {
    id: "branch-reducer", name: "Branch reducer", countLabel: "Fittings",
    description: "A round reducer with a round branch at an angle; D1 = D2 makes a tee or a lateral. From the HVAC Fittings workbench.",
    fields: [
      { key: "d1", type: "number", label: "D1", title: "D1: reducer diameter at the top", unit: "mm", default: 200, min: 0, at: [43, 6], color: "blue" },
      { key: "d2", type: "number", label: "D2", title: "D2: reducer diameter at the bottom", unit: "mm", default: 400, min: 0, at: [43, 82], color: "green" },
      { key: "h1", type: "number", label: "H1", title: "H1: reducer height", unit: "mm", default: 400, min: 0, at: [15, 50], color: "purple" },
      { key: "h2", type: "number", label: "H2", title: "H2: height where the branch axis meets the reducer's side", unit: "mm", default: 200, min: 0, at: [43, 62], color: "brown" },
      { key: "d3", type: "number", label: "D3", title: "D3: branch diameter", unit: "mm", default: 160, min: 0, at: [86, 14], color: "blue" },
      { key: "l", type: "number", label: "L", title: "L: along the branch axis to its end", unit: "mm", default: 250, min: 0, at: [82, 50], color: "green" },
      { key: "a", type: "number", label: "A", title: "A: branch angle above the horizontal (negative: down)", unit: "°", default: 30, min: -89, at: [82, 66], color: "red" },
      ...foldFields(),
    ],
    note: "Seams: the reducer's straight through the middle of the branch hole (two half holes), the branch's on its shortest line. D1 = D2: a straight pipe (tee or lateral); a negative angle points the branch down.",
  },
  problems: (v) => branchProblems(values(v)),
  title: (v) => `RB D${g(v.d1)}-${g(v.d2)} D${g(v.d3)}`,
  parts: (v, gz) => toParts(branchPieces(values(v)), gz),
};
