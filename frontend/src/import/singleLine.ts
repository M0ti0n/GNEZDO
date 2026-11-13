// Text as single strokes (for engraving / tracing): the Relief SingleLine font (SIL Open Font License 1.1,
// fonts/relief-singleline/OFL.txt). Each glyph is open paths; a text becomes polylines in mm, ready to be
// traced (one line, no outline to fill).

import font from "../fonts/relief-singleline/glyphs.json";

type P = [number, number];
const glyphs = font.glyphs as unknown as Record<string, [number, string]>;
const UPM = font.unitsPerEm, CAP = font.capHeight;

/** A glyph's paths (font units, y up) as polylines; curves split in `seg` steps. */
const cache = new Map<string, P[][]>();
function glyphLines(ch: string, seg = 8): P[][] {
  const key = `${ch}|${seg}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const d = glyphs[ch]?.[1] ?? "";
  const out: P[][] = [];
  let cur: P[] = [];
  let x = 0, y = 0, sx = 0, sy = 0;
  let lastC: P | null = null, lastQ: P | null = null;
  const toks = d.match(/[MmLlHhVvCcSsQqTtZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  let i = 0, cmd = "";
  const num = () => Number(toks[i++]);
  const flush = () => { if (cur.length > 1) out.push(cur); cur = []; };
  const cubic = (p1: P, p2: P, p3: P) => {
    const p0: P = [x, y];
    for (let k = 1; k <= seg; k++) {
      const t = k / seg, u = 1 - t;
      cur.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]);
    }
    [x, y] = p3;
  };
  const quad = (p1: P, p2: P) => {
    const p0: P = [x, y];
    for (let k = 1; k <= seg; k++) {
      const t = k / seg, u = 1 - t;
      cur.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
    }
    [x, y] = p2;
  };
  while (i < toks.length) {
    if (/[A-Za-z]/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case "M": flush(); x = ox + num(); y = oy + num(); sx = x; sy = y; cur = [[x, y]]; cmd = rel ? "l" : "L"; lastC = lastQ = null; break;
      case "L": x = ox + num(); y = oy + num(); cur.push([x, y]); lastC = lastQ = null; break;
      case "H": x = ox + num(); cur.push([x, y]); lastC = lastQ = null; break;
      case "V": y = oy + num(); cur.push([x, y]); lastC = lastQ = null; break;
      case "C": { const p1: P = [ox + num(), oy + num()], p2: P = [ox + num(), oy + num()], p3: P = [ox + num(), oy + num()]; cubic(p1, p2, p3); lastC = p2; lastQ = null; break; }
      case "S": { const p1: P = lastC ? [2 * x - lastC[0], 2 * y - lastC[1]] : [x, y]; const p2: P = [ox + num(), oy + num()], p3: P = [ox + num(), oy + num()]; cubic(p1, p2, p3); lastC = p2; lastQ = null; break; }
      case "Q": { const p1: P = [ox + num(), oy + num()], p2: P = [ox + num(), oy + num()]; quad(p1, p2); lastQ = p1; lastC = null; break; }
      case "T": { const p1: P = lastQ ? [2 * x - lastQ[0], 2 * y - lastQ[1]] : [x, y]; const p2: P = [ox + num(), oy + num()]; quad(p1, p2); lastQ = p1; lastC = null; break; }
      case "Z": cur.push([sx, sy]); x = sx; y = sy; flush(); lastC = lastQ = null; break;
      default: i++;
    }
  }
  flush();
  cache.set(key, out);
  return out;
}

/** Characters the font does not have are drawn as this. */
const FALLBACK = "?";

/** How wide a text is, in mm, at this cap height (the height of a capital letter). */
export function textWidth(text: string, capMm: number): number {
  const k = capMm / CAP;
  return [...text].reduce((w, ch) => w + (glyphs[ch] ?? glyphs[FALLBACK])[0], 0) * k;
}

export interface TextPlacement {
  /** where the text is anchored (mm), and how */
  at: P;
  align?: "left" | "center" | "right";
  /** baseline: the anchor is on the baseline; middle: in the middle of the capitals */
  valign?: "baseline" | "middle";
  /** degrees, counter-clockwise */
  angle?: number;
  /** cap height in mm */
  capMm: number;
}

/** A text as single-stroke polylines in mm (y up). */
export function textLines(text: string, p: TextPlacement): P[][] {
  const k = p.capMm / CAP;
  // a curve as fine as the size needs: about one segment per 0.4 mm
  const seg = Math.max(3, Math.min(16, Math.round(p.capMm / 1.2)));
  const w = textWidth(text, p.capMm);
  const x0 = p.align === "center" ? -w / 2 : p.align === "right" ? -w : 0;
  const y0 = p.valign === "middle" ? -p.capMm / 2 : 0;
  const a = ((p.angle ?? 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const out: P[][] = [];
  let pen = 0;
  for (const ch of text) {
    const g = glyphs[ch] ? ch : FALLBACK;
    for (const line of glyphLines(g, seg)) {
      out.push(line.map(([gx, gy]) => {
        const lx = x0 + (pen + gx) * k, ly = y0 + gy * k;
        return [p.at[0] + lx * c - ly * s, p.at[1] + lx * s + ly * c] as P;
      }));
    }
    pen += glyphs[g][0];
  }
  return out;
}

/** The font's units per em (for drawing the glyphs directly, e.g. as SVG). */
export const FONT_INFO = { name: font.name, unitsPerEm: UPM, capHeight: CAP };
