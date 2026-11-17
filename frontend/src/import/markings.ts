// Import 2D → MARKINGS: ready-made marks traced (engraved) on the part, each with an optional annotation
// beside it. Click where it goes, then pick the marking, type the annotation, pick the size.
//
// The shapes are the shop's own marking blocks (lines, mm, drawn from 0,0 at the lower left), at their
// MEDIUM size; SMALL is half of it, BIG twice. The annotation's letters follow the size.

import type { Entity, Pt, Role } from "./geometry";
import { textLines, textWidth } from "./singleLine";

type Seg = [number, number, number, number];

export interface MarkingShape {
  id: string;
  label: string;
  /** its box at MEDIUM [mm] */
  w: number;
  h: number;
  lines: Seg[];
}

export const MARKINGS: MarkingShape[] = [
  { id: "u", label: "U", w: 12, h: 7, lines: [[0, 7, 0, 0], [0, 0, 12, 0], [12, 0, 12, 7]] },
  { id: "v", label: "V", w: 12, h: 6, lines: [[0, 6, 6, 0], [12, 6, 6, 0]] },
  { id: "plus", label: "Cross +", w: 12, h: 12, lines: [[12, 6, 0, 6], [6, 0, 6, 12]] },
  { id: "x", label: "Cross ×", w: 8.485, h: 8.485, lines: [[8.485, 8.485, 0, 0], [8.485, 0, 0, 8.485]] },
  {
    id: "octagon", label: "Octagon /", w: 12, h: 12, lines: [
      [0, 0, 12, 12], [10.469, 9.781, 10.469, 2.219], [1.531, 9.781, 1.531, 2.219], [3.75, 12, 1.531, 9.781],
      [3.75, 0, 1.531, 2.219], [8.25, 12, 10.469, 9.781], [8.25, 0, 10.469, 2.219], [3.75, 12, 8.25, 12], [3.75, 0, 8.25, 0],
    ],
  },
];

export type MarkSize = "small" | "medium" | "big";
export const MARK_SIZES: { id: MarkSize; label: string; k: number }[] = [
  { id: "small", label: "SMALL", k: 0.5 },
  { id: "medium", label: "MEDIUM", k: 1 },
  { id: "big", label: "BIG", k: 2 },
];
const kOf = (s: MarkSize) => MARK_SIZES.find((x) => x.id === s)?.k ?? 1;

/** The annotation's letter height at MEDIUM [mm] (SMALL half, BIG twice), and its gap from the marking. */
export const MARK_TEXT_MM = 7;
const GAP_MM = 3;

/** A marking's lines and its annotation's strokes, centered on `at` (the text to its right), in mm. */
export function markingStrokes(shape: MarkingShape, at: Pt, size: MarkSize, text: string): [number, number][][] {
  const k = kOf(size);
  const x0 = at.x - (shape.w * k) / 2, y0 = at.y - (shape.h * k) / 2;
  const out: [number, number][][] = shape.lines.map(([ax, ay, bx, by]) => [[x0 + ax * k, y0 + ay * k], [x0 + bx * k, y0 + by * k]]);
  const t = text.trim();
  if (t) out.push(...textLines(t, { at: [at.x + (shape.w * k) / 2 + GAP_MM * k, at.y], capMm: MARK_TEXT_MM * k, valign: "middle" }));
  return out;
}

/** How wide the marking and its annotation are together [mm] (for the preview). */
export const markingWidth = (shape: MarkingShape, size: MarkSize, text: string) =>
  kOf(size) * (shape.w + (text.trim() ? GAP_MM : 0)) + (text.trim() ? textWidth(text.trim(), MARK_TEXT_MM * kOf(size)) : 0);

/** The marking as lines of the drawing: traced (engraved). */
export function markingEntities(shape: MarkingShape, at: Pt, size: MarkSize, text: string, newId: () => string): Entity[] {
  const role: Role = "trace";
  return markingStrokes(shape, at, size, text).flatMap((pl) => pl.slice(1).flatMap((q, i): Entity[] =>
    Math.hypot(q[0] - pl[i][0], q[1] - pl[i][1]) > 1e-6
      ? [{ id: newId(), kind: "line", a: { x: pl[i][0], y: pl[i][1] }, b: { x: q[0], y: q[1] }, role }]
      : []));
}

/** A small picture of the shape for its button: an SVG path in a 0..1 box (y down), centered. */
export function markingIconPath(shape: MarkingShape): string {
  const s = 1 / Math.max(shape.w, shape.h);
  const ox = (1 - shape.w * s) / 2, oy = (1 - shape.h * s) / 2;
  const f = (v: number) => Math.round(v * 1000) / 1000;
  return shape.lines.map(([ax, ay, bx, by]) =>
    `M${f(ox + ax * s)} ${f(1 - (oy + ay * s))}L${f(ox + bx * s)} ${f(1 - (oy + by * s))}`).join("");
}

// the last marking and size, for the next one
const PREFS = "gnezdo.markings";
export function loadMarkPrefs(): { shape: string; size: MarkSize } {
  try {
    const o = JSON.parse(localStorage.getItem(PREFS) ?? "null") as { shape?: string; size?: MarkSize } | null;
    return { shape: MARKINGS.some((m) => m.id === o?.shape) ? o!.shape! : MARKINGS[0].id, size: MARK_SIZES.some((x) => x.id === o?.size) ? o!.size! : "medium" };
  } catch { return { shape: MARKINGS[0].id, size: "medium" }; }
}
export function saveMarkPrefs(p: { shape: string; size: MarkSize }) {
  try { localStorage.setItem(PREFS, JSON.stringify(p)); } catch { /* not kept */ }
}
