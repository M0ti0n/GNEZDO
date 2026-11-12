import type { Entity, Pt } from "./geometry";
import { DxfError, type DxfResult } from "./dxf";

// Reads SVG drawings into the same entities as a DXF, in millimeters, y up.
//
// Supported: path (M L H V C S Q T A Z, absolute and relative), line, polyline, polygon, rect (with
// rounded corners), circle, ellipse; groups and transforms (matrix, translate, scale, rotate, skewX,
// skewY); stroke colors (attribute, style, inherited) for the color rules; Inkscape layers as layers.
// Arcs and circles stay arcs and circles where the transform keeps them round; curves become
// splines through points on the curve. Text, images and <use> are skipped and counted.
//
// Size: the document's width / height in mm, cm, in, pt or pc with its viewBox give the scale; with
// no unit at all a user unit is a millimeter (as CAD programs write them; reported so the size can be
// checked), with "px" a pixel (96 per inch).

type M = [number, number, number, number, number, number];   // a b c d e f
const ID: M = [1, 0, 0, 1, 0, 0];
const mul = (p: M, q: M): M => [
  p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1],
  p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3],
  p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5],
];
const ap = (m: M, x: number, y: number): Pt => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

const UNIT_MM: Record<string, number> = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96, "": 1 };

function length(v: string | null): { n: number; unit: string } | null {
  const m = /^\s*(-?[\d.]+(?:e[-+]?\d+)?)\s*([a-z%]*)\s*$/i.exec(v ?? "");
  return m ? { n: parseFloat(m[1]), unit: m[2].toLowerCase() } : null;
}

function parseTransform(t: string | null): M {
  let m: M = ID;
  if (!t) return m;
  for (const [, fn, args] of t.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = (args.match(/-?[\d.]+(?:e[-+]?\d+)?/gi) ?? []).map(Number);
    let q: M = ID;
    if (fn === "matrix" && a.length === 6) q = a as M;
    else if (fn === "translate") q = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
    else if (fn === "scale") q = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
    else if (fn === "rotate") {
      const r = ((a[0] ?? 0) * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r), cx = a[1] ?? 0, cy = a[2] ?? 0;
      q = mul(mul([1, 0, 0, 1, cx, cy], [c, s, -s, c, 0, 0]), [1, 0, 0, 1, -cx, -cy]);
    } else if (fn === "skewX") q = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
    else if (fn === "skewY") q = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
    m = mul(m, q);
  }
  return m;
}

/** Stroke color as 0xRRGGBB; null = none / not set. */
function colorOf(v: string | null | undefined): number | null | "none" {
  if (!v) return null;
  const s = v.trim().toLowerCase();
  if (s === "none" || s === "transparent") return "none";
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return parseInt(m[1].split("").map((c) => c + c).join(""), 16);
  m = /^#([0-9a-f]{6})/.exec(s);
  if (m) return parseInt(m[1], 16);
  const r = /^rgb\(\s*([\d.]+)(%?)\s*,\s*([\d.]+)(%?)\s*,\s*([\d.]+)(%?)/.exec(s);
  if (r) { const c = (n: string, p: string) => Math.round(Math.min(255, p ? (parseFloat(n) * 255) / 100 : parseFloat(n))); return (c(r[1], r[2]) << 16) | (c(r[3], r[4]) << 8) | c(r[5], r[6]); }
  const named: Record<string, number> = { black: 0, white: 0xffffff, red: 0xff0000, lime: 0x00ff00, green: 0x008000, blue: 0x0000ff, yellow: 0xffff00, cyan: 0x00ffff, aqua: 0x00ffff, magenta: 0xff00ff, fuchsia: 0xff00ff, gray: 0x808080, grey: 0x808080, orange: 0xffa500, purple: 0x800080, darkgreen: 0x006400 };
  return named[s] ?? null;
}

const styleProp = (el: Element, name: string): string | null => {
  const st = el.getAttribute("style");
  if (st) { const m = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, "i").exec(st); if (m) return m[1].trim(); }
  return el.getAttribute(name);
};

interface Ctx { m: M; stroke: number | null | "none"; layer?: string }

export function readSvg(text: string, fileName: string): DxfResult {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== "svg" || doc.getElementsByTagName("parsererror").length) throw new DxfError("Not an SVG file");

  // user units -> mm
  const vb = (root.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
  const w = length(root.getAttribute("width")), h = length(root.getAttribute("height"));
  const abs = (l: typeof w) => !!l && l.unit !== "" && l.unit !== "px" && l.unit !== "%" && UNIT_MM[l.unit] !== undefined;
  const said = (l: typeof w) => (l?.unit === "px" ? undefined : "no units");
  let sx = UNIT_MM[""], sy = UNIT_MM[""], tx = 0, ty = 0;
  let declaredUnits: string | undefined;
  if (vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0 && w && h && w.unit !== "%" && UNIT_MM[w.unit] !== undefined) {
    sx = (w.n * UNIT_MM[w.unit]) / vb[2]; sy = (h.n * UNIT_MM[h.unit]) / vb[3];
    tx = -vb[0] * sx; ty = -vb[1] * sy;
    if (!abs(w)) declaredUnits = said(w);
  } else if (w && h && w.unit !== "" && h.unit !== "" && UNIT_MM[w.unit] !== undefined && UNIT_MM[h.unit] !== undefined) {
    // no viewBox: user units are pixels, the size says what one is
    sx = UNIT_MM.px; sy = UNIT_MM.px;
  } else {
    if (vb.length === 4 && vb.every(Number.isFinite)) { tx = -vb[0] * sx; ty = -vb[1] * sy; }
    declaredUnits = said(w);
  }
  // mm, and y up as in a CAD file
  const base: M = [sx, 0, 0, -sy, tx, -ty];

  const out: Entity[] = [];
  const ignored: Record<string, number> = {};
  let n = 0;
  const id = () => `svg${++n}`;
  const skip = (k: string) => { ignored[k] = (ignored[k] ?? 0) + 1; };
  const tag = (c: Ctx): Partial<Entity> => {
    const s = c.stroke;
    // black or white: like AutoCAD color 7 (plain cutting by the color rules); other colors exact
    const col = typeof s === "number" && s !== 0 && s !== 0xffffff ? { rgb: s } : { color: 7 };
    return { ...col, ...(c.layer ? { layer: c.layer } : {}) };
  };
  const similar = (m: M) => {
    const sa = Math.hypot(m[0], m[1]), sb = Math.hypot(m[2], m[3]);
    return Math.abs(sa - sb) < 1e-6 * Math.max(1, sa) && Math.abs(m[0] * m[2] + m[1] * m[3]) < 1e-6 * Math.max(1, sa * sb);
  };
  const line = (c: Ctx, a: Pt, b: Pt) => { if (Math.hypot(a.x - b.x, a.y - b.y) > 1e-9) out.push({ id: id(), kind: "line", a, b, ...tag(c) } as Entity); };
  const curve = (c: Ctx, pts: Pt[]) => { if (pts.length > 1) out.push({ id: id(), kind: "spline", fit: pts, sampled: true, ...tag(c) } as Entity); };

  /** An elliptical arc in user units (center form), drawn through the transform. */
  const arc = (c: Ctx, cx: number, cy: number, rx: number, ry: number, phi: number, t0: number, dt: number) => {
    const m = c.m;
    if (Math.abs(rx - ry) < 1e-9 * Math.max(1, rx) && similar(m) && Math.abs(dt) > 1e-9) {
      // a circular arc: centre, radius and angles where it lands (y up, counter-clockwise)
      const C = ap(m, cx, cy), r = rx * Math.hypot(m[0], m[1]);
      if (Math.abs(Math.abs(dt) - 2 * Math.PI) < 1e-9) { out.push({ id: id(), kind: "circle", c: C, r, ...tag(c) } as Entity); return; }
      const cp = Math.cos(phi), sp = Math.sin(phi);
      const at = (t: number) => { const x = rx * Math.cos(t), y = ry * Math.sin(t); const p = ap(m, cx + x * cp - y * sp, cy + x * sp + y * cp); return (Math.atan2(p.y - C.y, p.x - C.x) * 180) / Math.PI; };
      const a0 = at(t0), a1 = at(t0 + dt);
      // which way it turns where it lands: the determinant flips the sense
      const ccw = (dt > 0) === (m[0] * m[3] - m[1] * m[2] > 0);
      out.push({ id: id(), kind: "arc", c: C, r, start: ccw ? a0 : a1, end: ccw ? a1 : a0, ...tag(c) } as Entity);
      return;
    }
    const k = Math.max(8, Math.ceil(Math.abs(dt) / (Math.PI / 36)));
    const cp = Math.cos(phi), sp = Math.sin(phi);
    curve(c, Array.from({ length: k + 1 }, (_, i) => {
      const t = t0 + (dt * i) / k, x = rx * Math.cos(t), y = ry * Math.sin(t);
      return ap(m, cx + x * cp - y * sp, cy + x * sp + y * cp);
    }));
  };

  const path = (c: Ctx, d: string) => {
    const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [];
    let i = 0, cmd = "", x = 0, y = 0, sx0 = 0, sy0 = 0, qx = 0, qy = 0, cx2 = 0, cy2 = 0, last = "";
    const num = () => Number(tokens[i++]);
    const more = () => i < tokens.length && !/^[a-zA-Z]$/.test(tokens[i]);
    const P = (px: number, py: number) => ap(c.m, px, py);
    const bez = (pts: [number, number][]) => {
      const k = 16, o: Pt[] = [];
      for (let s = 0; s <= k; s++) {
        const t = s / k;
        if (pts.length === 4) {
          const u = 1 - t, b = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
          o.push(P(b.reduce((a, bb, j) => a + bb * pts[j][0], 0), b.reduce((a, bb, j) => a + bb * pts[j][1], 0)));
        } else {
          const u = 1 - t, b = [u * u, 2 * u * t, t * t];
          o.push(P(b.reduce((a, bb, j) => a + bb * pts[j][0], 0), b.reduce((a, bb, j) => a + bb * pts[j][1], 0)));
        }
      }
      curve(c, o);
    };
    while (i < tokens.length) {
      if (/^[a-zA-Z]$/.test(tokens[i])) cmd = tokens[i++];
      else if (!cmd) { i++; continue; }
      const rel = cmd === cmd.toLowerCase();
      const C = cmd.toUpperCase();
      const ox = rel ? x : 0, oy = rel ? y : 0;
      if (C === "Z") { if (x !== sx0 || y !== sy0) line(c, P(x, y), P(sx0, sy0)); x = sx0; y = sy0; last = "Z"; continue; }
      if (!more()) { if (C !== "Z") i++; continue; }
      if (C === "M") {
        x = ox + num(); y = oy + num(); sx0 = x; sy0 = y; last = "M";
        cmd = rel ? "l" : "L";   // further pairs are lines
        continue;
      }
      if (C === "L") { const nx = ox + num(), ny = oy + num(); line(c, P(x, y), P(nx, ny)); x = nx; y = ny; }
      else if (C === "H") { const nx = (rel ? x : 0) + num(); line(c, P(x, y), P(nx, y)); x = nx; }
      else if (C === "V") { const ny = (rel ? y : 0) + num(); line(c, P(x, y), P(x, ny)); y = ny; }
      else if (C === "C" || C === "S") {
        let x1: number, y1: number;
        if (C === "C") { x1 = ox + num(); y1 = oy + num(); }
        else { x1 = last === "C" || last === "S" ? 2 * x - cx2 : x; y1 = last === "C" || last === "S" ? 2 * y - cy2 : y; }
        const x2 = ox + num(), y2 = oy + num(), nx = ox + num(), ny = oy + num();
        bez([[x, y], [x1, y1], [x2, y2], [nx, ny]]);
        cx2 = x2; cy2 = y2; x = nx; y = ny;
      } else if (C === "Q" || C === "T") {
        let x1: number, y1: number;
        if (C === "Q") { x1 = ox + num(); y1 = oy + num(); }
        else { x1 = last === "Q" || last === "T" ? 2 * x - qx : x; y1 = last === "Q" || last === "T" ? 2 * y - qy : y; }
        const nx = ox + num(), ny = oy + num();
        bez([[x, y], [x1, y1], [nx, ny]]);
        qx = x1; qy = y1; x = nx; y = ny;
      } else if (C === "A") {
        let rx = Math.abs(num()), ry = Math.abs(num());
        const phi = (num() * Math.PI) / 180, fa = num(), fs = num(), nx = ox + num(), ny = oy + num();
        if (rx < 1e-12 || ry < 1e-12) line(c, P(x, y), P(nx, ny));
        else if (nx !== x || ny !== y) {
          // endpoint -> centre parametrization (SVG 1.1, F.6.5)
          const cp = Math.cos(phi), sp = Math.sin(phi);
          const dx = (x - nx) / 2, dy = (y - ny) / 2, x1 = cp * dx + sp * dy, y1 = -sp * dx + cp * dy;
          const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
          if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
          const num2 = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1, den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
          const co = (fa === fs ? -1 : 1) * Math.sqrt(Math.max(0, num2 / den));
          const cxp = (co * rx * y1) / ry, cyp = (-co * ry * x1) / rx;
          const ccx = cp * cxp - sp * cyp + (x + nx) / 2, ccy = sp * cxp + cp * cyp + (y + ny) / 2;
          const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
          const t0 = ang(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
          let dt = ang((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
          if (!fs && dt > 0) dt -= 2 * Math.PI; else if (fs && dt < 0) dt += 2 * Math.PI;
          arc(c, ccx, ccy, rx, ry, phi, t0, dt);
        }
        x = nx; y = ny;
      } else { i++; continue; }
      last = C;
    }
  };

  const nums = (v: string | null) => (v?.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number);
  const attr = (el: Element, a: string) => { const l = length(el.getAttribute(a)); return l ? l.n : 0; };

  const walk = (el: Element, parent: Ctx) => {
    const name = el.localName.toLowerCase();
    if (["defs", "clippath", "mask", "symbol", "marker", "pattern", "metadata", "title", "desc", "style", "script", "namedview"].includes(name)) return;
    const display = styleProp(el, "display"), vis = styleProp(el, "visibility");
    if (display === "none" || vis === "hidden") { skip("hidden"); return; }
    const sc = colorOf(styleProp(el, "stroke"));
    const isLayer = name === "g" && (el.getAttribute("inkscape:groupmode") ?? el.getAttributeNS("http://www.inkscape.org/namespaces/inkscape", "groupmode")) === "layer";
    const label = isLayer ? el.getAttribute("inkscape:label") ?? el.getAttributeNS("http://www.inkscape.org/namespaces/inkscape", "label") ?? el.getAttribute("id") : null;
    const c: Ctx = { m: mul(parent.m, parseTransform(el.getAttribute("transform"))), stroke: sc ?? parent.stroke, layer: label ?? parent.layer };
    // a shape with no stroke but a fill is still drawn: its outline is the contour
    if (name === "svg" || name === "g" || name === "a" || name === "switch") { for (const k of Array.from(el.children)) walk(k, c); return; }
    switch (name) {
      case "path": path(c, el.getAttribute("d") ?? ""); break;
      case "line": line(c, ap(c.m, attr(el, "x1"), attr(el, "y1")), ap(c.m, attr(el, "x2"), attr(el, "y2"))); break;
      case "polyline": case "polygon": {
        const v = nums(el.getAttribute("points"));
        const pts: Pt[] = [];
        for (let k = 0; k + 1 < v.length; k += 2) pts.push(ap(c.m, v[k], v[k + 1]));
        for (let k = 1; k < pts.length; k++) line(c, pts[k - 1], pts[k]);
        if (name === "polygon" && pts.length > 2) line(c, pts[pts.length - 1], pts[0]);
        break;
      }
      case "rect": {
        const x = attr(el, "x"), y = attr(el, "y"), W = attr(el, "width"), H = attr(el, "height");
        if (!(W > 0 && H > 0)) break;
        let rx = attr(el, "rx"), ry = attr(el, "ry");
        if (!el.hasAttribute("rx")) rx = ry; if (!el.hasAttribute("ry")) ry = rx;
        rx = Math.min(rx, W / 2); ry = Math.min(ry, H / 2);
        if (rx > 0 && ry > 0) {
          const q = Math.PI / 2;
          line(c, ap(c.m, x + rx, y), ap(c.m, x + W - rx, y)); arc(c, x + W - rx, y + ry, rx, ry, 0, -q, q);
          line(c, ap(c.m, x + W, y + ry), ap(c.m, x + W, y + H - ry)); arc(c, x + W - rx, y + H - ry, rx, ry, 0, 0, q);
          line(c, ap(c.m, x + W - rx, y + H), ap(c.m, x + rx, y + H)); arc(c, x + rx, y + H - ry, rx, ry, 0, q, q);
          line(c, ap(c.m, x, y + H - ry), ap(c.m, x, y + ry)); arc(c, x + rx, y + ry, rx, ry, 0, 2 * q, q);
        } else {
          const p = [ap(c.m, x, y), ap(c.m, x + W, y), ap(c.m, x + W, y + H), ap(c.m, x, y + H)];
          for (let k = 0; k < 4; k++) line(c, p[k], p[(k + 1) % 4]);
        }
        break;
      }
      case "circle": { const r = attr(el, "r"); if (r > 0) arc(c, attr(el, "cx"), attr(el, "cy"), r, r, 0, 0, 2 * Math.PI); break; }
      case "ellipse": { const rx = attr(el, "rx"), ry = attr(el, "ry"); if (rx > 0 && ry > 0) arc(c, attr(el, "cx"), attr(el, "cy"), rx, ry, 0, 0, 2 * Math.PI); break; }
      case "text": case "image": case "use": case "foreignobject": skip(name); break;
      default: if (el.children.length) for (const k of Array.from(el.children)) walk(k, c);
    }
  };
  walk(root, { m: base, stroke: null });
  if (!out.length) throw new DxfError("No lines in this SVG");
  return { drawing: { id: fileName, fileName: fileName.replace(/\.svg$/i, ""), entities: out }, ignored, ...(declaredUnits ? { declaredUnits } : {}) };
}
