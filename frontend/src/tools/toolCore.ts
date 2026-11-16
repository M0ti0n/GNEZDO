// SPECIAL TOOLS plug-ins: a tool's script compiled and run (inside the sandbox worker, toolWorker.ts), with
// the helpers it gets as `gz`. Pure: no page, no network (also run as is by the tests).
//
//   function parts(v, gz) {
//     const p = gz.part("plate");                 // a part: its label, how many per set (1)
//     p.rect(0, 0, v.w, v.h, v.r);                 // rounded corners r
//     p.circle(v.w / 2, v.h / 2, v.d / 2);
//     return [p];                                  // the parts (or just p)
//   }
//   function problems(v) { return v.d >= v.w ? ["D must be less than W"] : []; }   // optional
//   function title(v) { return `PLATE ${v.w}x${v.h}`; }                            // optional: the parts' name

import type { Entity, Role } from "../import/geometry";
import { Lines, fit, fitPoints, marksOnLine, seg, type P2 } from "../import/fittings/arcs";

export interface ToolPart { key: string; label: string; qty: number; suffix?: string; entities: Entity[]; w: number; h: number }
export type ToolResult = { parts: ToolPart[]; problems: string[]; title?: string } | { error: string };

const ROLES: Role[] = ["cut", "trace", "openCut"];
export const MAX_PARTS = 60;
export const MAX_ENTITIES = 50_000;

const num = (x: unknown, what: string): number => {
  if (typeof x !== "number" || !Number.isFinite(x)) throw new Error(`${what} is not a number (${String(x)})`);
  return x;
};
const pt = (p: unknown, what: string): P2 => {
  if (!Array.isArray(p) || p.length < 2) throw new Error(`${what} must be a point [x, y]`);
  return [num(p[0], `${what} x`), num(p[1], `${what} y`)];
};
const roleOf = (r: unknown): Role => {
  if (r === undefined || r === null) return "cut";
  if (!ROLES.includes(r as Role)) throw new Error(`Unknown line role "${String(r)}" (cut, trace or openCut)`);
  return r as Role;
};
const rad = (d: number) => (d * Math.PI) / 180;

/** One part a tool makes: lines, arcs and circles in mm (y up), any position (it is moved to 0, 0). */
export class ToolPartBuilder {
  key: string | undefined;
  label: string;
  qty: number;
  /** The end of its name after the tool's title ("" none); default: -key when the tool makes several parts */
  suffix: string | undefined;
  /** @internal */ lines = new Lines();
  /** @internal */ count = 0;

  constructor(label = "part", qty = 1, key?: string) {
    this.label = String(label);
    this.qty = qty;
    this.key = key === undefined ? undefined : String(key);
  }
  private add(n = 1) { this.count += n; if (this.count > MAX_ENTITIES) throw new Error(`Too many lines in one part (more than ${MAX_ENTITIES})`); }
  line(x1: number, y1: number, x2: number, y2: number, role?: Role) {
    const a = pt([x1, y1], "line start"), b = pt([x2, y2], "line end");
    this.lines.segs([seg(a, b)], roleOf(role)); this.add(); return this;
  }
  /** Straight lines through the points; closed: back to the first. */
  polyline(points: [number, number][], closed = false, role?: Role) {
    if (!Array.isArray(points) || points.length < 2) throw new Error("polyline needs at least 2 points");
    const p = points.map((q, i) => pt(q, `polyline point ${i + 1}`));
    const list = p.slice(1).map((q, i) => seg(p[i], q));
    if (closed) list.push(seg(p[p.length - 1], p[0]));
    this.lines.segs(list, roleOf(role)); this.add(list.length); return this;
  }
  /** Arc around cx, cy counterclockwise from start to end (degrees, 0 = +x). */
  arc(cx: number, cy: number, r: number, start: number, end: number, role?: Role) {
    const c = pt([cx, cy], "arc center"); num(r, "arc radius"); num(start, "arc start"); num(end, "arc end");
    if (!(r > 0)) throw new Error("arc radius must be above 0");
    let sw = (((end - start) % 360) + 360) % 360;
    if (sw < 1e-9) sw = 360;
    if (sw >= 360) return this.circle(cx, cy, r, role);
    const at = (d: number): P2 => [c[0] + r * Math.cos(rad(d)), c[1] + r * Math.sin(rad(d))];
    this.lines.segs([seg(at(start), at(start + sw), at(start + sw / 2))], roleOf(role)); this.add(); return this;
  }
  /** Arc from a through m to b (three points on it). */
  arc3(a: [number, number], m: [number, number], b: [number, number], role?: Role) {
    this.lines.segs([seg(pt(a, "arc3 start"), pt(b, "arc3 end"), pt(m, "arc3 middle point"))], roleOf(role)); this.add(); return this;
  }
  circle(cx: number, cy: number, r: number, role?: Role) {
    const c = pt([cx, cy], "circle center");
    if (!(num(r, "circle radius") > 0)) throw new Error("circle radius must be above 0");
    this.lines.circle(c, r, roleOf(role)); this.add(); return this;
  }
  /** Rectangle from x, y (lower left), w × h, corners rounded r (0: square). */
  rect(x: number, y: number, w: number, h: number, r = 0, role?: Role) {
    num(x, "rect x"); num(y, "rect y"); num(w, "rect width"); num(h, "rect height"); num(r, "rect corner radius");
    if (!(w > 0 && h > 0)) throw new Error("rect width and height must be above 0");
    const q = Math.max(0, Math.min(r, w / 2, h / 2));
    const R = roleOf(role);
    if (q <= 1e-9) return this.polyline([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true, R);
    const s = Math.SQRT1_2 * q;
    const c = (cx: number, cy: number, dx: number, dy: number): P2 => [cx + dx * s, cy + dy * s];
    const list = [
      seg([x + q, y], [x + w - q, y]), seg([x + w - q, y], [x + w, y + q], c(x + w - q, y + q, 1, -1)),
      seg([x + w, y + q], [x + w, y + h - q]), seg([x + w, y + h - q], [x + w - q, y + h], c(x + w - q, y + h - q, 1, 1)),
      seg([x + w - q, y + h], [x + q, y + h]), seg([x + q, y + h], [x, y + h - q], c(x + q, y + h - q, -1, 1)),
      seg([x, y + h - q], [x, y + q]), seg([x, y + q], [x + q, y], c(x + q, y + q, -1, -1)),
    ].filter((g) => g.m || Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]) > 1e-9);
    this.lines.segs(list, R); this.add(list.length); return this;
  }
  /** Slot (oblong hole) from center x1, y1 to center x2, y2, `width` wide. */
  slot(x1: number, y1: number, x2: number, y2: number, width: number, role?: Role) {
    const a = pt([x1, y1], "slot start"), b = pt([x2, y2], "slot end");
    const r = num(width, "slot width") / 2;
    if (!(r > 0)) throw new Error("slot width must be above 0");
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-9) return this.circle(a[0], a[1], r, role);
    const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, nx = -uy * r, ny = ux * r;
    const list = [
      seg([a[0] - nx, a[1] - ny], [b[0] - nx, b[1] - ny]),
      seg([b[0] - nx, b[1] - ny], [b[0] + nx, b[1] + ny], [b[0] + ux * r, b[1] + uy * r]),
      seg([b[0] + nx, b[1] + ny], [a[0] + nx, a[1] + ny]),
      seg([a[0] + nx, a[1] + ny], [a[0] - nx, a[1] - ny], [a[0] - ux * r, a[1] - uy * r]),
    ];
    this.lines.segs(list, roleOf(role)); this.add(4); return this;
  }
  /** The curve y = f(x) from x0 to x1, as arcs and lines within 0.01 mm (unfolded edges). */
  curve(f: (x: number) => number, x0: number, x1: number, role?: Role) {
    if (typeof f !== "function") throw new Error("curve needs a function f(x)");
    num(x0, "curve x0"); num(x1, "curve x1");
    const g = (x: number) => num(f(x), `curve f(${Math.round(x * 1000) / 1000})`);
    const list = fit(g, x0, x1);
    this.lines.segs(list, roleOf(role)); this.add(list.length); return this;
  }
  /** A smooth curve through many points, as arcs and lines within 0.01 mm. */
  through(points: [number, number][], role?: Role) {
    if (!Array.isArray(points) || points.length < 2) throw new Error("through needs at least 2 points");
    const list = fitPoints(points.map((q, i) => pt(q, `through point ${i + 1}`)));
    this.lines.segs(list, roleOf(role)); this.add(list.length); return this;
  }
  /** A tracing line (marking). */
  mark(x1: number, y1: number, x2: number, y2: number) { return this.line(x1, y1, x2, y2, "trace"); }
  /** Fold marks on the straight line from x1, y1 to x2, y2: `length` long, `gap` in from both ends. */
  foldMarks(x1: number, y1: number, x2: number, y2: number, length = 15, gap = 2) {
    const list = marksOnLine(pt([x1, y1], "fold mark start"), pt([x2, y2], "fold mark end"), num(length, "mark length"), num(gap, "mark gap"));
    this.lines.marks(list); this.add(list.length); return this;
  }
}

/** What a tool's script gets as `gz`. */
export function gzApi() {
  return Object.freeze({
    part: (label?: string, qty?: number, key?: string) => new ToolPartBuilder(label, qty, key),
    PI: Math.PI,
    rad, deg: (r: number) => (r * 180) / Math.PI,
    sind: (d: number) => Math.sin(rad(d)), cosd: (d: number) => Math.cos(rad(d)), tand: (d: number) => Math.tan(rad(d)),
    asind: (x: number) => (Math.asin(x) * 180) / Math.PI, acosd: (x: number) => (Math.acos(x) * 180) / Math.PI,
    atan2d: (y: number, x: number) => (Math.atan2(y, x) * 180) / Math.PI,
    round: (x: number, digits = 2) => { const k = 10 ** digits; return Math.round(x * k) / k; },
  });
}

export interface CompiledTool { parts: (v: unknown, gz: unknown) => unknown; problems?: (v: unknown) => unknown; title?: (v: unknown) => unknown }

/** Words a tool's script may not hold (they could reach past the sandbox). */
const FORBIDDEN = /\bimport\b/;

/** Step 1: the script as a function (not run yet). Throws with the reason. */
export function prepareTool(script: string): (gz: unknown) => unknown {
  if (FORBIDDEN.test(script)) throw new Error('The script may not use the word "import" (tools cannot load other code)');
  try {
    return new Function("gz", `"use strict";\n${script}\n;return {
      parts: typeof parts === "function" ? parts : undefined,
      problems: typeof problems === "function" ? problems : undefined,
      title: typeof title === "function" ? title : undefined };`) as (gz: unknown) => unknown;
  } catch (e) {
    throw new Error(`The script does not load: ${(e as Error).message}`);
  }
}

/** Step 2 (after the sandbox is locked): run its top level; its functions. */
export function loadTool(prepared: (gz: unknown) => unknown, gz = gzApi()): CompiledTool {
  let out: Partial<CompiledTool>;
  try { out = prepared(gz) as Partial<CompiledTool>; } catch (e) { throw new Error(`The script failed while loading: ${(e as Error).message}`); }
  if (typeof out?.parts !== "function") throw new Error("The script has no function parts(v, gz)");
  return out as CompiledTool;
}

const letters = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `P${i + 1}`);

/** The tool run on values: its parts (or the problems with the values, or why it failed). */
export function runTool(tool: CompiledTool, values: Record<string, unknown>, gz = gzApi()): ToolResult {
  try {
    const v = () => JSON.parse(JSON.stringify(values));
    if (tool.problems) {
      const p = tool.problems(v());
      if (p !== undefined && p !== null && !Array.isArray(p)) return { error: "problems(v) must return a list of texts" };
      const list = (p ?? []).map((x: unknown) => String(x)).filter((x: string) => x.trim());
      if (list.length) return { parts: [], problems: list };
    }
    let made = tool.parts(v(), gz);
    if (made instanceof ToolPartBuilder) made = [made];
    if (!Array.isArray(made)) return { error: "parts(v, gz) must return a part or a list of parts (made with gz.part)" };
    if (made.length > MAX_PARTS) return { error: `Too many parts (${made.length}; at most ${MAX_PARTS})` };
    const keys = new Set<string>();
    const parts: ToolPart[] = [];
    made.forEach((b, i) => {
      if (!(b instanceof ToolPartBuilder)) throw new Error(`Part ${i + 1} was not made with gz.part(…)`);
      const qty = b.qty;
      if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 0) throw new Error(`Part ${i + 1} (${b.label}): qty must be a whole number, 0 or more`);
      if (qty === 0) return;
      if (b.count === 0) throw new Error(`Part ${i + 1} (${b.label}) has no lines`);
      let key = (b.key ?? letters(i)).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 12) || letters(i);
      while (keys.has(key)) key += "_";
      keys.add(key);
      const built = b.lines.build(`${key}-`);
      parts.push({ key, label: b.label.slice(0, 60), qty, ...(b.suffix !== undefined ? { suffix: String(b.suffix).slice(0, 20) } : {}), entities: built.entities, w: built.w, h: built.h });
    });
    let title: string | undefined;
    if (tool.title) {
      const t = tool.title(v());
      if (t !== undefined && t !== null) title = String(t).trim().slice(0, 80) || undefined;
    }
    return { parts, problems: [], ...(title ? { title } : {}) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
