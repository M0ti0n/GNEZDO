import { screwPieces, screwProblems, screwResult, type ScrewValues } from "./screw";
import { g, toParts, type Tool } from "./common";

export const tool: Tool<ScrewValues> = {
  manifest: {
    id: "screw-flight", name: "Screw flight", countLabel: "Screws",
    description: "The blank of one pitch of a screw flight (an annular ring with a gap); L / P of them for the screw. From the HVAC Fittings workbench.",
    fields: [
      { key: "od", type: "number", label: "OD", title: "OD: outer diameter of the flight", unit: "mm", default: 315, min: 0, at: [14, 22], color: "blue" },
      { key: "id", type: "number", label: "ID", title: "ID: inner diameter of the flight (the shaft)", unit: "mm", default: 101.6, min: 0, at: [50, 50], color: "purple" },
      { key: "p", type: "number", label: "P", title: "P: pitch", unit: "mm", default: 300, min: 0, at: [15, 83], color: "green" },
      { key: "l", type: "number", label: "L", title: "L: screw length", unit: "mm", default: 1000, min: 0, at: [32, 93], color: "brown" },
      { key: "gap", type: "number", label: "Gap", title: "Gap between the cut ends at the inner edge", unit: "mm", default: 6, min: 0, at: [76, 8], color: "orange" },
    ],
    note: "The blank is extended past the calculated angle until the cut ends are Gap apart at the inner edge. The part's label gives the blank's angle and radii; pieces = L / P, up.",
  },
  problems: screwProblems,
  title: (v) => `SF OD${g(v.od)} ID${g(v.id)} P${g(v.p)}`,
  parts: (v, gz) => {
    const r = screwResult(v);
    return toParts(screwPieces(v), gz, (p) => `${p.label}, ${r.blank.toFixed(1)}°${r.warning ? " (not extended)" : ""}, Ri ${g(r.ri)}, Ro ${g(r.ro)}`);
  },
};
