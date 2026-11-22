// The fittings as plug-in special tools: what each tool's script hands GNEZDO. The fitting's own code makes
// its pieces (lines and arcs, Lines); here they are drawn on the tool's parts with gz (line, arc, circle).

import type { Lines } from "../../frontend/src/import/arcs";

export interface Piece { key: string; label: string; qty: number; lines: Lines }

/** What the tool's script gets as gz (the part of it used here). */
interface PartBuilder {
  suffix: string | undefined;
  line(x1: number, y1: number, x2: number, y2: number, role?: string): PartBuilder;
  arc(cx: number, cy: number, r: number, start: number, end: number, role?: string): PartBuilder;
  circle(cx: number, cy: number, r: number, role?: string): PartBuilder;
}
export interface Gz { part(label: string, qty?: number, key?: string): PartBuilder }

/** The ending of a part's name after the fitting's name (as before: none for the one piece). */
const SUFFIX: Record<string, string> = { C: "", W: "", R: "", F: "", SA: "A", SB: "B" };

/** The pieces as the tool's parts; `label`: a piece's label as shown (default: its own). */
export function toParts(pieces: Piece[], gz: Gz, label: (p: Piece) => string = (p) => p.label) {
  return pieces.map((p) => {
    const part = gz.part(label(p), p.qty, p.key);
    part.suffix = SUFFIX[p.key] ?? p.key;
    for (const e of p.lines.build(`${p.key}-`).entities) {
      const role = e.role ?? "cut";
      if (e.kind === "line") part.line(e.a.x, e.a.y, e.b.x, e.b.y, role);
      else if (e.kind === "arc") part.arc(e.c.x, e.c.y, e.r, e.start, e.end, role);
      else if (e.kind === "circle") part.circle(e.c.x, e.c.y, e.r, role);
      else throw new Error(`A ${e.kind} in ${p.label}: not drawn`);
    }
    return part;
  });
}

export const g = (x: number) => String(Math.round(x * 100) / 100);

/** A field of tool.json (see SPECIAL TOOLS/README.md). */
export interface Field {
  key: string; type: "number" | "int" | "check" | "choice" | "text"; label: string; title?: string; unit?: string;
  default: number | boolean | string; min?: number; max?: number; at?: [number, number];
  color?: "blue" | "green" | "purple" | "brown" | "red" | "dark" | "orange"; group?: string;
  options?: { value: string | number; label: string }[]; note?: string;
}
export interface Manifest {
  id: string; name: string; description: string; countLabel: string; fields: Field[]; note?: string;
}
/** A tool: its tool.json, and what its script does. */
export interface Tool<V> {
  manifest: Manifest;
  problems(v: V): string[];
  title(v: V): string;
  parts(v: V, gz: Gz): unknown;
}

/** Fold mark fields (as the elbow's and the branch reducer's). */
export const foldFields = (): Field[] => [
  { key: "foldsOn", type: "check", label: "Fold marks", title: "Fold marks: tracing lines on the fold lines", group: "Fold marks", default: true },
  { key: "folds", type: "int", label: "Around", title: "How many fold lines around", unit: "lines", group: "Fold marks", default: 24, min: 1 },
  { key: "markLen", type: "number", label: "Mark length", unit: "mm", group: "Fold marks", default: 15, min: 0.5 },
  { key: "markGap", type: "number", label: "In from the edge", unit: "mm", group: "Fold marks", default: 2, min: 0 },
];
