import { pointsAlong, type Entity, type Pt } from "./geometry";

/**
 * Scale tool: the whole part gets bigger or smaller, about its lower-left corner (so it stays where it is).
 *
 *   a length with a unit ("200mm", "8in")  - one item selected: the part scales so that item gets that size
 *                                            (a line its length, an arc its radius, a circle its diameter)
 *   a plain number ("2", "0.5")            - one or more items, or the whole part, selected: the scale factor
 */

const MM_PER_IN = 25.4;

export type ScaleInput =
  | { kind: "size"; mm: number }       // mode 1
  | { kind: "factor"; k: number }      // mode 2
  | { kind: "bad"; message: string };

export function parseScale(text: string): ScaleInput {
  const t = text.trim().toLowerCase().replace(",", ".");
  if (!t) return { kind: "bad", message: "Type a size with a unit (200mm) or a scale factor (2)" };
  const m = /^(\d+(?:\.\d*)?|\.\d+)\s*(mm|in|inch|")?$/.exec(t);
  if (!m) return { kind: "bad", message: `"${text.trim()}" is not a size (200mm, 8in) or a scale factor (2)` };
  const v = parseFloat(m[1]);
  if (!(v > 0)) return { kind: "bad", message: "The value must be more than 0" };
  if (!m[2]) return { kind: "factor", k: v };
  return { kind: "size", mm: m[2] === "mm" ? v : v * MM_PER_IN };
}

/** The size the Scale tool reads from one item: a line's length, an arc's radius, a circle's diameter. */
export function sizeOf(e: Entity): { mm: number; what: string } | null {
  switch (e.kind) {
    case "line": return { mm: Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y), what: "length" };
    case "arc": return { mm: e.r, what: "radius" };
    case "circle": return { mm: 2 * e.r, what: "diameter" };
    default: return null;
  }
}

/** The scale factor for what was typed and what is selected, or why there is none. */
export function factorFor(input: ScaleInput, selected: Entity[]): { ok: true; k: number } | { ok: false; message: string } {
  if (input.kind === "bad") return { ok: false, message: input.message };
  if (!selected.length) return { ok: false, message: "Select a line, an arc or a circle first (or Ctrl+A for the whole part)" };
  if (input.kind === "factor") return { ok: true, k: input.k };
  if (selected.length > 1) return { ok: false, message: "A size with a unit needs exactly one selected item; for more, type a scale factor (2)" };
  const s = sizeOf(selected[0]);
  if (!s || s.mm <= 0) return { ok: false, message: "A size needs a line, an arc or a circle; type a scale factor instead" };
  return { ok: true, k: input.mm / s.mm };
}

const scalePt = (p: Pt, o: Pt, k: number): Pt => ({ x: o.x + (p.x - o.x) * k, y: o.y + (p.y - o.y) * k });

function scaleEntity(e: Entity, o: Pt, k: number): Entity {
  switch (e.kind) {
    case "line": return { ...e, a: scalePt(e.a, o, k), b: scalePt(e.b, o, k) };
    case "arc": return { ...e, c: scalePt(e.c, o, k), r: e.r * k };
    case "circle": return { ...e, c: scalePt(e.c, o, k), r: e.r * k };
    case "spline": return { ...e, fit: e.fit.map((p) => scalePt(p, o, k)) };
  }
}

/** The whole part (and its loose points) scaled by k about its lower-left corner. */
export function scalePart<P extends { p: Pt }>(all: Entity[], k: number, points?: P[]): { entities: Entity[]; points?: P[] } {
  let minX = Infinity, minY = Infinity;
  for (const e of all) for (const p of pointsAlong(e)) { if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y; }
  const o = { x: Number.isFinite(minX) ? minX : 0, y: Number.isFinite(minY) ? minY : 0 };
  return { entities: all.map((e) => scaleEntity(e, o, k)), points: points?.map((x) => ({ ...x, p: scalePt(x.p, o, k) })) };
}

/** A factor as text: 2, 0.5, 1.2345. */
export const factorText = (k: number) => (Math.round(k * 10000) / 10000).toLocaleString("en-GB", { maximumFractionDigits: 4 });
