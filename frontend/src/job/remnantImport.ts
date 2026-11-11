// Import remnant (Remnants panel): a remnant drawn in a DXF or SVG file: its outline (the largest
// closed contour) and holes, mm, y down from the top-left of its box. DWG: saved as DXF first.

import { readDxf } from "../import/dxf";
import { boxOf, union } from "../import/geometry";
import { dxfOutline } from "./dxfSheet";

export interface ImportedRemnant { outline: number[][]; holes: number[][][]; widthMm: number; heightMm: number; areaMm2: number }

const area = (l: number[][]) => Math.abs(l.reduce((a, p, i) => { const q = l[(i + 1) % l.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;

function fromLoops(loops: number[][][], file: string): ImportedRemnant {
  const ok = loops.filter((l) => l.length > 2 && area(l) > 1).sort((a, b) => area(b) - area(a));
  if (!ok.length) throw new Error(`${file}: no closed outline found`);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of ok[0]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const r = (v: number) => Math.round(v * 10) / 10;
  const rel = (l: number[][]) => l.map(([x, y]) => [r(x - x0), r(y - y0)]);
  // holes: the other closed contours inside the outline's box
  const holes = ok.slice(1).filter((l) => l.every(([x, y]) => x >= x0 - 0.1 && x <= x1 + 0.1 && y >= y0 - 0.1 && y <= y1 + 0.1));
  return { outline: rel(ok[0]), holes: holes.map(rel), widthMm: Math.round(x1 - x0), heightMm: Math.round(y1 - y0), areaMm2: Math.round(area(ok[0]) - holes.reduce((a, l) => a + area(l), 0)) };
}

function fromDxf(text: string, name: string): ImportedRemnant {
  const { drawing } = readDxf(text, name);
  if (!drawing.entities.length) throw new Error(`${name}: no lines in the file`);
  const b = drawing.entities.map(boxOf).reduce(union);
  return fromLoops((dxfOutline(drawing.entities, b, true) ?? []) as number[][][], name);
}

// ---- SVG: paths, polygons, polylines, rectangles, circles and ellipses; curves in short lines

const UNIT: Record<string, number> = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96 };

function pathLoops(d: string): number[][][] {
  const toks = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  const loops: number[][][] = [];
  let cur: number[][] = [], x = 0, y = 0, sx = 0, sy = 0, cmd = "", i = 0, cx = 0, cy = 0;
  const num = () => Number(toks[i++]);
  const close = () => { if (cur.length > 2) loops.push(cur); cur = []; };
  const bez = (pts: number[][]) => {
    for (let k = 1; k <= 12; k++) {
      const t = k / 12;
      if (pts.length === 3) { const [a, b, c] = pts; cur.push([(1 - t) ** 2 * a[0] + 2 * (1 - t) * t * b[0] + t * t * c[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * b[1] + t * t * c[1]]); }
      else { const [a, b, c, e] = pts; const u = 1 - t; cur.push([u ** 3 * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t ** 3 * e[0], u ** 3 * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t ** 3 * e[1]]); }
    }
  };
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    if (C === "Z") { x = sx; y = sy; close(); continue; }
    if (C === "M") { close(); x = ox + num(); y = oy + num(); sx = x; sy = y; cur = [[x, y]]; cmd = rel ? "l" : "L"; continue; }
    if (C === "L") { x = ox + num(); y = oy + num(); cur.push([x, y]); continue; }
    if (C === "H") { x = ox + num(); cur.push([x, y]); continue; }
    if (C === "V") { y = oy + num(); cur.push([x, y]); continue; }
    if (C === "C") { const p1 = [ox + num(), oy + num()], p2 = [ox + num(), oy + num()], p = [ox + num(), oy + num()]; bez([[x, y], p1, p2, p]); cx = p2[0]; cy = p2[1]; x = p[0]; y = p[1]; continue; }
    if (C === "S") { const p1 = [2 * x - cx, 2 * y - cy], p2 = [ox + num(), oy + num()], p = [ox + num(), oy + num()]; bez([[x, y], p1, p2, p]); cx = p2[0]; cy = p2[1]; x = p[0]; y = p[1]; continue; }
    if (C === "Q") { const p1 = [ox + num(), oy + num()], p = [ox + num(), oy + num()]; bez([[x, y], p1, p]); x = p[0]; y = p[1]; continue; }
    if (C === "T") { const p = [ox + num(), oy + num()]; cur.push(p); x = p[0]; y = p[1]; continue; }
    if (C === "A") {
      // an arc: in short lines between its ends (radius and sweep from the SVG rules)
      const rx0 = Math.abs(num()), ry0 = Math.abs(num()), rot = (num() * Math.PI) / 180, large = num(), sweep = num();
      const ex = ox + num(), ey = oy + num();
      const cs = Math.cos(rot), sn = Math.sin(rot);
      const dx = (x - ex) / 2, dy = (y - ey) / 2;
      const x1 = cs * dx + sn * dy, y1 = -sn * dx + cs * dy;
      let rx = rx0, ry = ry0;
      const lam = (x1 * x1) / (rx * rx || 1) + (y1 * y1) / (ry * ry || 1);
      if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
      const sgn = large === sweep ? -1 : 1;
      const co = sgn * Math.sqrt(Math.max(0, (rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1) / (rx * rx * y1 * y1 + ry * ry * x1 * x1 || 1)));
      const cxp = (co * rx * y1) / (ry || 1), cyp = (-co * ry * x1) / (rx || 1);
      const ccx = cs * cxp - sn * cyp + (x + ex) / 2, ccy = sn * cxp + cs * cyp + (y + ey) / 2;
      const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
      const t0 = ang(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
      let dt = ang((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
      if (!sweep && dt > 0) dt -= 2 * Math.PI; else if (sweep && dt < 0) dt += 2 * Math.PI;
      const n = Math.max(4, Math.ceil(Math.abs(dt) / (Math.PI / 24)));
      for (let k = 1; k <= n; k++) {
        const t = t0 + (dt * k) / n;
        cur.push([ccx + rx * Math.cos(t) * cs - ry * Math.sin(t) * sn, ccy + rx * Math.cos(t) * sn + ry * Math.sin(t) * cs]);
      }
      x = ex; y = ey;
      continue;
    }
    i++;   // something else: skip
  }
  // an open path that ends where it began counts as closed
  if (cur.length > 2 && Math.hypot(cur[0][0] - cur[cur.length - 1][0], cur[0][1] - cur[cur.length - 1][1]) < 0.01) loops.push(cur);
  return loops;
}

function fromSvg(text: string, name: string): ImportedRemnant {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const svg = doc.querySelector("svg");
  if (!svg) throw new Error(`${name}: not an SVG drawing`);
  // the drawing's unit: from its width (mm, cm, in...) over its viewBox; plain numbers count as mm
  const vb = (svg.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
  const wAttr = svg.getAttribute("width") ?? "";
  const m = /^([\d.]+)\s*([a-z]*)$/i.exec(wAttr.trim());
  let k = 1;
  if (m && vb.length === 4 && vb[2] > 0) k = (Number(m[1]) * (UNIT[m[2].toLowerCase()] ?? 1)) / vb[2];
  else if (m && m[2] && UNIT[m[2].toLowerCase()]) k = UNIT[m[2].toLowerCase()];
  const loops: number[][][] = [];
  const n = (el: Element, a: string) => Number(el.getAttribute(a) ?? 0);
  svg.querySelectorAll("path").forEach((el) => loops.push(...pathLoops(el.getAttribute("d") ?? "")));
  svg.querySelectorAll("polygon, polyline").forEach((el) => {
    const v = (el.getAttribute("points") ?? "").trim().split(/[\s,]+/).map(Number);
    const l: number[][] = [];
    for (let i = 0; i + 1 < v.length; i += 2) l.push([v[i], v[i + 1]]);
    if (el.tagName.toLowerCase() === "polygon" || (l.length > 2 && Math.hypot(l[0][0] - l[l.length - 1][0], l[0][1] - l[l.length - 1][1]) < 0.01)) loops.push(l);
  });
  svg.querySelectorAll("rect").forEach((el) => { const x = n(el, "x"), y = n(el, "y"), w = n(el, "width"), h = n(el, "height"); loops.push([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]); });
  svg.querySelectorAll("circle, ellipse").forEach((el) => {
    const cx = n(el, "cx"), cy = n(el, "cy"), rx = el.hasAttribute("r") ? n(el, "r") : n(el, "rx"), ry = el.hasAttribute("r") ? n(el, "r") : n(el, "ry");
    loops.push(Array.from({ length: 72 }, (_, i) => [cx + rx * Math.cos((i * Math.PI) / 36), cy + ry * Math.sin((i * Math.PI) / 36)]));
  });
  return fromLoops(loops.map((l) => l.map(([x, y]) => [x * k, y * k])), name);
}

/** The remnant drawn in the file. Throws with a message for the person. */
export async function remnantFromFile(f: File): Promise<ImportedRemnant> {
  if (/\.dwg$/i.test(f.name)) throw new Error(`${f.name}: DWG is not read here yet; save it as DXF (or SVG) and import that`);
  const text = await f.text();
  if (/\.svg$/i.test(f.name) || /^\s*(<\?xml|<svg)/.test(text)) return fromSvg(text, f.name);
  return fromDxf(text, f.name);
}
