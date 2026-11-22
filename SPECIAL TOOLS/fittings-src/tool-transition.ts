import { transitionPieces, transitionProblems, type TransitionValues } from "./transition";
import { g, toParts, type Tool } from "./common";

interface V { a: number; b: number; e: number; f: number; d: number; h: number; combined: boolean; short: boolean; long: boolean; n: number; folds: boolean; markLen: number }
const values = (v: V): TransitionValues => ({ ...v, markGap: 2 });

export const tool: Tool<V> = {
  manifest: {
    id: "rect-round-transition", name: "Rect. → round", countLabel: "Fittings",
    description: "A transition from a rectangle to a round, the round anywhere over the rectangle (A, B, E, F from its center). From the HVAC Fittings workbench.",
    fields: [
      { key: "a", type: "number", label: "A", title: "A: rectangle edge left of the round's center", unit: "mm", default: 300, min: 0, at: [22, 74], color: "blue" },
      { key: "b", type: "number", label: "B", title: "B: rectangle edge right of the round's center", unit: "mm", default: 200, min: 0, at: [48, 86], color: "green" },
      { key: "e", type: "number", label: "E", title: "E: rectangle edge above the round's center", unit: "mm", default: 150, min: 0, at: [70, 27], color: "purple" },
      { key: "f", type: "number", label: "F", title: "F: rectangle edge below the round's center", unit: "mm", default: 250, min: 0, at: [70, 56], color: "brown" },
      { key: "d", type: "number", label: "D", title: "D: diameter of the round end", unit: "mm", default: 400, min: 0, at: [37, 43], color: "red" },
      { key: "h", type: "number", label: "H", title: "H: height", unit: "mm", default: 300, min: 0, at: [88, 84], color: "dark" },
      { key: "combined", type: "check", label: "Combined", title: "The whole transition in one piece", group: "Pieces", default: true },
      { key: "short", type: "check", label: "Short side", title: "Short side: its triangle and the two corner fans (half the round)", group: "Pieces", default: false },
      { key: "long", type: "check", label: "Long side", title: "Long side: the flat triangle", group: "Pieces", default: false },
      { key: "n", type: "int", label: "Sections per quarter of the round", group: "Pieces", default: 4, min: 1,
        note: "Seam on the longer side, straight down from the round. Short side: its triangle and the two corner fans (half the round); long side: the flat triangle." },
      { key: "folds", type: "check", label: "Fold marks at the round edge", title: "Fold marks: tracing lines", group: "Fold marks", default: true },
      { key: "markLen", type: "number", label: "Mark length", unit: "mm", group: "Fold marks", default: 15, min: 0.5 },
    ],
  },
  problems: (v) => transitionProblems(values(v)),
  title: (v) => `TR ${g(v.a + v.b)}x${g(v.e + v.f)}-D${g(v.d)}`,
  parts: (v, gz) => toParts(transitionPieces(values(v)), gz),
};
