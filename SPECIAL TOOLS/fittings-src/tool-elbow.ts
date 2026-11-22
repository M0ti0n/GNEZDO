import { elbowPieces, elbowProblems, type ElbowValues } from "./elbow";
import { foldFields, g, toParts, type Tool } from "./common";

interface V { d: number; r: number; a: number; n: number; pieces: string; foldsOn: boolean; folds: number; markLen: number; markGap: number }
const values = (v: V): ElbowValues => ({ d: v.d, r: v.r, a: v.a, n: v.n, folds: v.foldsOn ? v.folds : 0, markLen: v.markLen, markGap: v.markGap, stacked: v.pieces === "stacked" });

export const tool: Tool<V> = {
  manifest: {
    id: "segmented-elbow", name: "Segmented elbow", countLabel: "Elbows",
    description: "A round elbow of N middle sections and two end sections (half as wide), seam at the side. From the HVAC Fittings workbench.",
    fields: [
      { key: "d", type: "number", label: "D", title: "D: diameter (neutral)", unit: "mm", default: 300, min: 0, at: [59, 95], color: "blue" },
      { key: "r", type: "number", label: "R", title: "R: centerline radius", unit: "mm", default: 450, min: 0, at: [36, 72], color: "green" },
      { key: "a", type: "number", label: "A", title: "A: elbow angle", unit: "°", default: 90, min: 0, at: [13, 92], color: "purple" },
      { key: "n", type: "int", label: "N", title: "N: middle sections", unit: "middle", default: 3, min: 0, at: [76, 38], color: "brown" },
      { key: "pieces", type: "choice", label: "Pieces", group: "Pieces", default: "separate",
        options: [{ value: "separate", label: "Separate sections" }, { value: "stacked", label: "Stacked in one rectangle" }],
        note: "Seam always at the side, so the sections fit together; stacked, open cuts separate them (every other section turned round)." },
      ...foldFields(),
    ],
  },
  problems: (v) => elbowProblems(values(v)),
  title: (v) => `ELBOW D${g(v.d)} A${g(v.a)}`,
  parts: (v, gz) => toParts(elbowPieces(values(v)), gz),
};
