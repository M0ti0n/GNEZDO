import type { Drawing, Entity, Pt } from "./geometry";

// Reads ASCII DXF files (R12 up to current versions) into drawing entities, in millimetres.
//
// Supported: LINE, ARC, CIRCLE, LWPOLYLINE and POLYLINE (with bulges), SPLINE (NURBS with
// control points, or fit points), ELLIPSE (as short lines), INSERT of blocks (nested, moved,
// scaled, rotated, mirrored) and mirrored entities (extrusion 0,0,-1).
// Text, dimensions, hatches and points are not geometry to cut; they are counted and skipped.
//
// This runs in the browser so a dropped file shows at once. DWG files need converting on the
// server first (import worker).

export interface DxfResult {
  drawing: Drawing;
  ignored: Record<string, number>;   // entity type -> how many were skipped
  /** Units the file says it uses, when not millimetres. The drawing is still read as mm. */
  declaredUnits?: string;
}

type Group = [number, string];
interface Rec { type: string; g: Group[] }

/** x' = a x + c y + e, y' = b x + d y + f */
interface Xf { a: number; b: number; c: number; d: number; e: number; f: number }
const IDENTITY: Xf = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const apply = (t: Xf, p: Pt): Pt => ({ x: t.a * p.x + t.c * p.y + t.e, y: t.b * p.x + t.d * p.y + t.f });
/** Applies `inner` first, then `outer`. */
const compose = (outer: Xf, inner: Xf): Xf => ({
  a: outer.a * inner.a + outer.c * inner.b,
  b: outer.b * inner.a + outer.d * inner.b,
  c: outer.a * inner.c + outer.c * inner.d,
  d: outer.b * inner.c + outer.d * inner.d,
  e: outer.a * inner.e + outer.c * inner.f + outer.e,
  f: outer.b * inner.e + outer.d * inner.f + outer.f,
});
const det = (t: Xf) => t.a * t.d - t.b * t.c;
const MIRROR_X: Xf = { a: -1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/**
 * $INSUNITS names. Laser drawings are in millimetres, and the units setting is often left
 * over from a template, so the drawing is always read as mm and other units are only reported.
 */
const UNIT_NAME: Record<number, string> = { 1: "inches", 2: "feet", 5: "centimetres", 6: "metres", 8: "microinches", 9: "mils", 10: "yards", 14: "decimetres" };

const deg = (r: number) => (r * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;

export class DxfError extends Error {}

/** Key in `ignored` for objects left out because their layer is off, frozen or Defpoints. */
export const HIDDEN = "on hidden layers";

export function readDxf(text: string, fileName: string): DxfResult {
  if (text.startsWith("AutoCAD Binary DXF")) throw new DxfError("Binary DXF is not supported; save it as ASCII DXF");
  const lines = text.split(/\r?\n/);
  const groups: Group[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    if (!Number.isFinite(code)) throw new DxfError(`Not a DXF file (line ${i + 1})`);
    groups.push([code, lines[i + 1].trim()]);
  }

  // Split into sections, and each section into records starting at group code 0.
  const sections = new Map<string, Rec[]>();
  let declaredUnits: string | undefined;
  for (let i = 0; i < groups.length; i++) {
    if (groups[i][0] !== 0 || groups[i][1] !== "SECTION") continue;
    const name = groups[i + 1]?.[1] ?? "";
    const recs: Rec[] = [];
    let j = i + 2;
    for (; j < groups.length && !(groups[j][0] === 0 && groups[j][1] === "ENDSEC"); j++) {
      if (groups[j][0] === 0) recs.push({ type: groups[j][1], g: [] });
      else if (recs.length) recs[recs.length - 1].g.push(groups[j]);
      // header variables are 9/$NAME followed by their value, with no code 0 records
      else if (name === "HEADER" && groups[j][0] === 9 && groups[j][1] === "$INSUNITS") {
        declaredUnits = UNIT_NAME[Number(groups[j + 1]?.[1])];
      }
    }
    sections.set(name, recs);
    i = j;
  }

  // Layer colours, for entities drawn "by layer" (a negative colour means the layer is off).
  // Colour = AutoCAD colour index, plus True Color (RGB) when the drawing has one (group 420).
  const layerColor = new Map<string, Colour>();
  // Layers that do not plot: turned off (negative colour), frozen (flag 1), or Defpoints.
  // What is drawn on them is construction or notes, not something to cut, so it is left out.
  const hidden = new Set<string>(["DEFPOINTS"]);
  for (const r of sections.get("TABLES") ?? [])
    if (r.type === "LAYER") {
      layerColor.set(str(r, 2), { aci: Math.abs(num(r, 62, 7)), rgb: rgbOf(r) });
      if (num(r, 62, 7) < 0 || (num(r, 70) & 1) === 1) hidden.add(str(r, 2).toUpperCase());
    }

  // Blocks: name -> base point and records.
  const blocks = new Map<string, { base: Pt; recs: Rec[] }>();
  let current: { name: string; base: Pt; recs: Rec[] } | null = null;
  for (const r of sections.get("BLOCKS") ?? []) {
    if (r.type === "BLOCK") current = { name: str(r, 2), base: { x: num(r, 10), y: num(r, 20) }, recs: [] };
    else if (r.type === "ENDBLK") { if (current) blocks.set(current.name, current); current = null; }
    else current?.recs.push(r);
  }

  const out: Entity[] = [];
  const ignored: Record<string, number> = {};
  let n = 0;
  const id = () => `e${++n}`;

  // Layer and colour of the entity being converted, added to everything it produces.
  let style: { layer: string; colour: Colour } = { layer: "0", colour: { aci: 7 } };
  const push = (e: Entity) => out.push({ ...e, layer: style.layer, color: style.colour.aci, rgb: style.colour.rgb });

  const emitLine = (a: Pt, b: Pt, _layer?: string) => {
    if (Math.hypot(b.x - a.x, b.y - a.y) > 1e-9) push({ id: id(), kind: "line", a, b });
  };

  /** Arc given in drawing coordinates, transformed; mirroring reverses its direction. */
  const emitArc = (t: Xf, c: Pt, r: number, start: number, end: number, layer: string) => {
    const scale = Math.sqrt(Math.abs(det(t)));
    const cc = apply(t, c);
    const ang = (d: number) => {
      const p = apply(t, { x: c.x + r * Math.cos(rad(d)), y: c.y + r * Math.sin(rad(d)) });
      return deg(Math.atan2(p.y - cc.y, p.x - cc.x));
    };
    const [s, e] = det(t) < 0 ? [ang(end), ang(start)] : [ang(start), ang(end)];
    push({ id: id(), kind: "arc", c: cc, r: r * scale, start: norm(s), end: norm(e), layer });
  };

  /** Polyline vertices with bulges -> lines and arcs. */
  const emitPoly = (t: Xf, v: { x: number; y: number; b: number }[], closed: boolean, layer: string) => {
    const count = closed ? v.length : v.length - 1;
    for (let i = 0; i < count; i++) {
      const p1 = v[i], p2 = v[(i + 1) % v.length];
      const chord = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      if (chord < 1e-9) continue;
      if (Math.abs(p1.b) < 1e-9) { emitLine(apply(t, p1), apply(t, p2), layer); continue; }
      const theta = 4 * Math.atan(p1.b);                     // included angle, + = counter-clockwise
      const r = Math.abs(chord / (2 * Math.sin(theta / 2)));
      const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
      const nx = -(p2.y - p1.y) / chord, ny = (p2.x - p1.x) / chord; // left normal
      const h = chord / 2 / Math.tan(theta / 2);
      const c = { x: mx + nx * h, y: my + ny * h };
      const a1 = deg(Math.atan2(p1.y - c.y, p1.x - c.x)), a2 = deg(Math.atan2(p2.y - c.y, p2.x - c.x));
      if (theta > 0) emitArc(t, c, r, a1, a2, layer);
      else emitArc(t, c, r, a2, a1, layer);
    }
  };

  const convert = (recs: Rec[], t0: Xf, depth: number, parentLayer?: string, parentColour: Colour = { aci: 7 }) => {
    for (let i = 0; i < recs.length; i++) {
      const r = recs[i];
      let layer = str(r, 8) || "0";
      if (layer === "0" && parentLayer) layer = parentLayer;   // block entities on layer 0 take the insert's layer
      const c62 = num(r, 62, 256);
      const rgb = rgbOf(r);
      const color: Colour =
        rgb !== undefined ? { aci: c62 > 0 && c62 < 256 ? c62 : 7, rgb }
        : c62 === 256 ? layerColor.get(layer) ?? { aci: 7 }
        : c62 === 0 ? parentColour
        : { aci: Math.abs(c62) };
      style = { layer, colour: color };
      if (hidden.has(layer.toUpperCase()) && r.type !== "VERTEX" && r.type !== "SEQEND") {
        ignored[HIDDEN] = (ignored[HIDDEN] ?? 0) + 1;
        if (r.type === "POLYLINE") while (i + 1 < recs.length && (recs[i + 1].type === "VERTEX" || recs[i + 1].type === "SEQEND")) i++;
        continue;
      }
      const t = num(r, 230, 1) < 0 ? compose(t0, MIRROR_X) : t0;  // extrusion 0,0,-1 = mirrored
      switch (r.type) {
        case "LINE":
          emitLine(apply(t, { x: num(r, 10), y: num(r, 20) }), apply(t, { x: num(r, 11), y: num(r, 21) }), layer);
          break;
        case "CIRCLE": {
          const c = apply(t, { x: num(r, 10), y: num(r, 20) });
          push({ id: id(), kind: "circle", c, r: num(r, 40) * Math.sqrt(Math.abs(det(t))) });
          break;
        }
        case "ARC":
          emitArc(t, { x: num(r, 10), y: num(r, 20) }, num(r, 40), num(r, 50), num(r, 51), layer);
          break;
        case "LWPOLYLINE": {
          const v: { x: number; y: number; b: number }[] = [];
          for (const [code, val] of r.g) {
            if (code === 10) v.push({ x: Number(val), y: 0, b: 0 });
            else if (code === 20 && v.length) v[v.length - 1].y = Number(val);
            else if (code === 42 && v.length) v[v.length - 1].b = Number(val);
          }
          emitPoly(t, v, (num(r, 70) & 1) === 1, layer);
          break;
        }
        case "POLYLINE": {
          const v: { x: number; y: number; b: number }[] = [];
          while (i + 1 < recs.length && recs[i + 1].type === "VERTEX") {
            const vr = recs[++i];
            const flags = num(vr, 70);
            if (flags & (16 | 128)) continue;                 // spline frame / polyface vertices
            v.push({ x: num(vr, 10), y: num(vr, 20), b: num(vr, 42) });
          }
          if (recs[i + 1]?.type === "SEQEND") i++;
          emitPoly(t, v, (num(r, 70) & 1) === 1, layer);
          break;
        }
        case "SPLINE": {
          const pts = splinePoints(r);
          if (pts.points.length < 2) { ignored.SPLINE = (ignored.SPLINE ?? 0) + 1; break; }
          push({ id: id(), kind: "spline", fit: pts.points.map((p) => apply(t, p)), sampled: pts.sampled });
          break;
        }
        case "ELLIPSE": {
          const c = { x: num(r, 10), y: num(r, 20) };
          const m = { x: num(r, 11), y: num(r, 21) };
          const ratio = num(r, 40, 1);
          let t1 = num(r, 41, 0), t2 = num(r, 42, Math.PI * 2);
          if (t2 <= t1) t2 += Math.PI * 2;
          const steps = Math.max(8, Math.ceil((64 * (t2 - t1)) / (Math.PI * 2)));
          const at = (u: number) => apply(t, {
            x: c.x + m.x * Math.cos(u) - ratio * m.y * Math.sin(u),
            y: c.y + m.y * Math.cos(u) + ratio * m.x * Math.sin(u),
          });
          let prev = at(t1);
          const first = prev;
          for (let k = 1; k <= steps; k++) {
            const p = k === steps && t2 - t1 >= Math.PI * 2 - 1e-9 ? first : at(t1 + ((t2 - t1) * k) / steps);
            emitLine(prev, p, layer);
            prev = p;
          }
          break;
        }
        case "INSERT": {
          const block = blocks.get(str(r, 2));
          if (!block || depth > 16) { ignored.INSERT = (ignored.INSERT ?? 0) + 1; break; }
          const sx = num(r, 41, 1), sy = num(r, 42, 1), rot = rad(num(r, 50));
          const cos = Math.cos(rot), sin = Math.sin(rot);
          const ins = { x: num(r, 10), y: num(r, 20) };
          // p -> rotate(scale(p - base)) + insertion point
          const local: Xf = {
            a: cos * sx, b: sin * sx, c: -sin * sy, d: cos * sy,
            e: ins.x - (cos * sx * block.base.x - sin * sy * block.base.y),
            f: ins.y - (sin * sx * block.base.x + cos * sy * block.base.y),
          };
          convert(block.recs, compose(t, local), depth + 1, layer, color);
          break;
        }
        case "VERTEX": case "SEQEND": case "ATTRIB": case "ATTDEF":
          break;
        default:
          ignored[r.type] = (ignored[r.type] ?? 0) + 1;
      }
    }
  };

  convert(sections.get("ENTITIES") ?? [], IDENTITY, 0);
  if (out.length === 0) throw new DxfError(ignored[HIDDEN] ? "Everything is on layers that are off or frozen" : "No lines, arcs or circles found");

  return { drawing: { id: fileName, fileName: fileName.replace(/\.dxf$/i, ""), entities: out }, ignored, declaredUnits };
}

interface Colour { aci: number; rgb?: number }

/** True Color from group 420 (0xRRGGBB), if present. */
function rgbOf(r: Rec): number | undefined {
  const g = r.g.find((x) => x[0] === 420);
  return g ? Number(g[1]) & 0xffffff : undefined;
}

function str(r: Rec, code: number): string {
  return r.g.find((g) => g[0] === code)?.[1] ?? "";
}
function num(r: Rec, code: number, fallback = 0): number {
  const g = r.g.find((x) => x[0] === code);
  const v = g ? Number(g[1]) : NaN;
  return Number.isFinite(v) ? v : fallback;
}
const norm = (d: number) => ((d % 360) + 360) % 360;

/** Points of a SPLINE: evaluated NURBS when control points and knots are there, else its fit points. */
function splinePoints(r: Rec): { points: Pt[]; sampled: boolean } {
  const p = num(r, 71, 3);
  const knots: number[] = [], weights: number[] = [], ctrl: Pt[] = [], fit: Pt[] = [];
  for (const [code, val] of r.g) {
    const v = Number(val);
    if (code === 40) knots.push(v);
    else if (code === 41) weights.push(v);
    else if (code === 10) ctrl.push({ x: v, y: 0 });
    else if (code === 20 && ctrl.length) ctrl[ctrl.length - 1].y = v;
    else if (code === 11) fit.push({ x: v, y: 0 });
    else if (code === 21 && fit.length) fit[fit.length - 1].y = v;
  }
  const n = ctrl.length;
  if (n > p && knots.length === n + p + 1) {
    const w = weights.length === n ? weights : ctrl.map(() => 1);
    const u0 = knots[p], u1 = knots[n];
    const steps = Math.max(24, n * 10);
    const points = Array.from({ length: steps + 1 }, (_, k) => deBoor(ctrl, w, knots, p, u0 + ((u1 - u0) * k) / steps));
    return { points, sampled: true };
  }
  return { points: fit, sampled: false };
}

function deBoor(ctrl: Pt[], w: number[], knots: number[], p: number, u: number): Pt {
  const n = ctrl.length;
  let k = p;
  while (k < n - 1 && !(u >= knots[k] && u < knots[k + 1])) k++;
  const d = Array.from({ length: p + 1 }, (_, j) => {
    const c = ctrl[j + k - p], wt = w[j + k - p];
    return { x: c.x * wt, y: c.y * wt, w: wt };
  });
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const i = j + k - p;
      const den = knots[i + 1 + p - r] - knots[i];
      const a = den === 0 ? 0 : (u - knots[i]) / den;
      d[j] = { x: (1 - a) * d[j - 1].x + a * d[j].x, y: (1 - a) * d[j - 1].y + a * d[j].y, w: (1 - a) * d[j - 1].w + a * d[j].w };
    }
  }
  return { x: d[p].x / d[p].w, y: d[p].y / d[p].w };
}
