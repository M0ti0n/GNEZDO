import { dropBadCommon, type Entity, type Role } from "./geometry";

// Settings -> Rules -> Import rules.
// Kept in this browser for now; they move to the server with user settings.

export const ROTATIONS = [90, 45, 30, 5] as const;
export type Rotation = (typeof ROTATIONS)[number];

export interface ImportRules {
  /** The last number of the file name is the number of pieces needed (shown in Parts, taken into a job). */
  qtyFromName: boolean;
  /** Parts without open cut lines may be mirrored when nesting (Mirror is ticked for them by default). */
  mirrorWithoutOpenCut: boolean;
  /** Rotation steps ticked by default for new imports. */
  defaultRotations: Rotation[];
  /** New import lists start with Filler ticked. */
  defaultFiller: boolean;
  /** One layer: every line starts as cutting; tracing and open cut are marked by hand. */
  allLayersAsOne: boolean;
  /** Layer names (parts of names) that mean tracing / open cut, when layers are used. */
  traceLayers: string;
  openCutLayers: string;
  /** Line colors decide what the laser does (the lists below). */
  coloursAsCuts: boolean;
  /** Which colors mean cutting, tracing, open cut and common cut. */
  colours: ColourRules;
}

/**
 * One color of a list:
 *   exact  - one color: a HEX (#00ff00), the same as an AutoCAD color that has it
 *   aci    - one AutoCAD color number (1-255), the same as its HEX
 *   shade  - any shade of a color: its hue (0-360) within +-width degrees, any brightness and
 *            paleness; colors too gray or too dark to have a hue are left out
 *   grays  - black, white and grays (no hue)
 */
export type ColourEntry =
  | { kind: "exact"; rgb: number }
  | { kind: "aci"; aci: number }
  | { kind: "shade"; hue: number; width: number }
  | { kind: "grays" };

export type LineRole = "cut" | "trace" | "openCut";
export const LINE_ROLES: LineRole[] = ["cut", "trace", "openCut"];
/** The color lists: the three roles, and common cut (cutting lines shared with a neighbouring part). */
export type ColourList = LineRole | "common";
export const COLOUR_LISTS: ColourList[] = ["cut", "trace", "openCut", "common"];
export const LIST_NAME: Record<ColourList, string> = { cut: "Cut contour", trace: "Trace", openCut: "Open cut", common: "Common cut" };

export interface ColourRules {
  cut: ColourEntry[];
  trace: ColourEntry[];
  openCut: ColourEntry[];
  /** Common cut: only straight lines of closed cutting contours take it; other lines of these colors are cut. */
  common: ColourEntry[];
  /** colors in no list */
  other: LineRole;
}

/** As before the lists existed: grays cutting, greens and reds tracing, light blues open cut. */
export const DEFAULT_COLOURS: ColourRules = {
  cut: [{ kind: "grays" }],
  trace: [{ kind: "shade", hue: 115, width: 45 }, { kind: "shade", hue: 0, width: 20 }],
  openCut: [{ kind: "shade", hue: 187, width: 27 }],
  common: [],
  other: "cut",
};

/** The width of "any shade": narrow, normal, wide (degrees each way on the color wheel). */
export const SHADE_WIDTHS = [{ label: "Narrow", deg: 10 }, { label: "Normal", deg: 25 }, { label: "Wide", deg: 40 }] as const;

export const DEFAULT_RULES: ImportRules = {
  qtyFromName: false,
  mirrorWithoutOpenCut: true,
  defaultRotations: [90],
  defaultFiller: false,
  allLayersAsOne: false,
  traceLayers: "MARK, ENGRAV, GRAV, TRACE, SIGN",
  openCutLayers: "OPEN, SLIT",
  coloursAsCuts: true,
  colours: DEFAULT_COLOURS,
};

/** AutoCAD's 256 colors (index 0 unused), as RGB. From ezdxf (MIT License, Manfred Moitzi). */
export const ACI_RGB: number[] = [
  0x000000, 0xff0000, 0xffff00, 0x00ff00, 0x00ffff, 0x0000ff, 0xff00ff, 0xffffff,
  0x808080, 0xc0c0c0, 0xff0000, 0xff7f7f, 0xa50000, 0xa55252, 0x7f0000, 0x7f3f3f,
  0x4c0000, 0x4c2626, 0x260000, 0x261313, 0xff3f00, 0xff9f7f, 0xa52900, 0xa56752,
  0x7f1f00, 0x7f4f3f, 0x4c1300, 0x4c2f26, 0x260900, 0x261713, 0xff7f00, 0xffbf7f,
  0xa55200, 0xa57c52, 0x7f3f00, 0x7f5f3f, 0x4c2600, 0x4c3926, 0x261300, 0x261c13,
  0xffbf00, 0xffdf7f, 0xa57c00, 0xa59152, 0x7f5f00, 0x7f6f3f, 0x4c3900, 0x4c4226,
  0x261c00, 0x262113, 0xffff00, 0xffff7f, 0xa5a500, 0xa5a552, 0x7f7f00, 0x7f7f3f,
  0x4c4c00, 0x4c4c26, 0x262600, 0x262613, 0xbfff00, 0xdfff7f, 0x7ca500, 0x91a552,
  0x5f7f00, 0x6f7f3f, 0x394c00, 0x424c26, 0x1c2600, 0x212613, 0x7fff00, 0xbfff7f,
  0x52a500, 0x7ca552, 0x3f7f00, 0x5f7f3f, 0x264c00, 0x394c26, 0x132600, 0x1c2613,
  0x3fff00, 0x9fff7f, 0x29a500, 0x67a552, 0x1f7f00, 0x4f7f3f, 0x134c00, 0x2f4c26,
  0x092600, 0x172613, 0x00ff00, 0x7fff7f, 0x00a500, 0x52a552, 0x007f00, 0x3f7f3f,
  0x004c00, 0x264c26, 0x002600, 0x132613, 0x00ff3f, 0x7fff9f, 0x00a529, 0x52a567,
  0x007f1f, 0x3f7f4f, 0x004c13, 0x264c2f, 0x002609, 0x135817, 0x00ff7f, 0x7fffbf,
  0x00a552, 0x52a57c, 0x007f3f, 0x3f7f5f, 0x004c26, 0x264c39, 0x002613, 0x13581c,
  0x00ffbf, 0x7fffdf, 0x00a57c, 0x52a591, 0x007f5f, 0x3f7f6f, 0x004c39, 0x264c42,
  0x00261c, 0x135858, 0x00ffff, 0x7fffff, 0x00a5a5, 0x52a5a5, 0x007f7f, 0x3f7f7f,
  0x004c4c, 0x264c4c, 0x002626, 0x135858, 0x00bfff, 0x7fdfff, 0x007ca5, 0x5291a5,
  0x005f7f, 0x3f6f7f, 0x00394c, 0x26427e, 0x001c26, 0x135858, 0x007fff, 0x7fbfff,
  0x0052a5, 0x527ca5, 0x003f7f, 0x3f5f7f, 0x00264c, 0x26397e, 0x001326, 0x131c58,
  0x003fff, 0x7f9fff, 0x0029a5, 0x5267a5, 0x001f7f, 0x3f4f7f, 0x00134c, 0x262f7e,
  0x000926, 0x131758, 0x0000ff, 0x7f7fff, 0x0000a5, 0x5252a5, 0x00007f, 0x3f3f7f,
  0x00004c, 0x26267e, 0x000026, 0x131358, 0x3f00ff, 0x9f7fff, 0x2900a5, 0x6752a5,
  0x1f007f, 0x4f3f7f, 0x13004c, 0x2f267e, 0x090026, 0x171358, 0x7f00ff, 0xbf7fff,
  0x5200a5, 0x7c52a5, 0x3f007f, 0x5f3f7f, 0x26004c, 0x39267e, 0x130026, 0x1c1358,
  0xbf00ff, 0xdf7fff, 0x7c00a5, 0x9152a5, 0x5f007f, 0x6f3f7f, 0x39004c, 0x42264c,
  0x1c0026, 0x581358, 0xff00ff, 0xff7fff, 0xa500a5, 0xa552a5, 0x7f007f, 0x7f3f7f,
  0x4c004c, 0x4c264c, 0x260026, 0x581358, 0xff00bf, 0xff7fdf, 0xa5007c, 0xa55291,
  0x7f005f, 0x7f3f6f, 0x4c0039, 0x4c2642, 0x26001c, 0x581358, 0xff007f, 0xff7fbf,
  0xa50052, 0xa5527c, 0x7f003f, 0x7f3f5f, 0x4c0026, 0x4c2639, 0x260013, 0x58131c,
  0xff003f, 0xff7f9f, 0xa50029, 0xa55267, 0x7f001f, 0x7f3f4f, 0x4c0013, 0x4c262f,
  0x260009, 0x581317, 0x000000, 0x656565, 0x666666, 0x999999, 0xcccccc, 0xffffff,
];

/** A line's color as RGB: its True Color, or its AutoCAD color's; null without a color. */
export function lineRgb(e: { color?: number; rgb?: number }): number | null {
  if (e.rgb !== undefined) return e.rgb;
  if (e.color !== undefined && e.color >= 1 && e.color <= 255) return ACI_RGB[e.color];
  return null;
}

export const hexOf = (rgb: number) => `#${rgb.toString(16).padStart(6, "0")}`;
/** "#00ff00" / "00FF00" / "#0f0" -> RGB; null when it is not a HEX color. */
export function parseHex(s: string): number | null {
  let t = s.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(t)) t = t.split("").map((c) => c + c).join("");
  return /^[0-9a-f]{6}$/i.test(t) ? parseInt(t, 16) : null;
}

/** Too gray or too dark to have a hue: only "black, white and grays" takes it. (The darkest
 *  AutoCAD shades, e.g. 98 = #002600, still count as their color.) */
const isGray = ([, s, v]: [number, number, number]) => s < 0.25 || v < 0.14;
const hueDist = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

/** Does the entry take this color? (exact first, see colourRole) */
export function entryTakes(x: ColourEntry, e: { color?: number; rgb?: number }): boolean {
  const rgb = lineRgb(e) ?? 0xffffff;   // no color: as white / black (AutoCAD 7)
  if (x.kind === "exact") return x.rgb === rgb;
  if (x.kind === "aci") return e.rgb === undefined && e.color !== undefined ? e.color === x.aci : ACI_RGB[x.aci] === rgb;
  const hsv = rgbHsv(rgb);
  if (x.kind === "grays") return isGray(hsv);
  return !isGray(hsv) && hueDist(hsv[0], x.hue) <= x.width;
}

/** The two colors at the ends of a shade range and its middle, for its swatch. */
export const shadeSwatch = (x: { hue: number; width: number }) =>
  [x.hue - x.width, x.hue, x.hue + x.width].map((h) => hsvHex((h + 360) % 360, 1, 1));

export function hsvHex(h: number, s: number, v: number): string {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

/**
 * Colors that two lists both take (the Rules page warns): the same exact color twice, or ranges
 * that overlap. An exact color wins over a range, so an exact color inside another list's range
 * is fine (that is how one shade is taken out of a range).
 */
export function colourConflicts(c: ColourRules): string[] {
  const out: string[] = [];
  const name = (r: ColourList) => LIST_NAME[r];
  const exactRgb = (x: ColourEntry) => (x.kind === "exact" ? x.rgb : x.kind === "aci" ? ACI_RGB[x.aci] : null);
  for (let i = 0; i < COLOUR_LISTS.length; i++) for (let j = i + 1; j < COLOUR_LISTS.length; j++) {
    const a = COLOUR_LISTS[i], b = COLOUR_LISTS[j];
    for (const x of c[a]) for (const y of c[b]) {
      const ex = exactRgb(x), ey = exactRgb(y);
      if (ex !== null && ey !== null && ex === ey) out.push(`${hexOf(ex)} is in ${name(a)} and ${name(b)}`);
      if (x.kind === "shade" && y.kind === "shade" && hueDist(x.hue, y.hue) < x.width + y.width)
        out.push(`The shades around ${Math.round(x.hue)}° (${name(a)}) and ${Math.round(y.hue)}° (${name(b)}) overlap`);
      if (x.kind === "grays" && y.kind === "grays") out.push(`Black, white and grays are in ${name(a)} and ${name(b)}`);
    }
  }
  return out;
}

/** Hue (degrees), saturation and value (0..1) of an AutoCAD color index. */
export function aciHsv(i: number): [number, number, number] {
  const basic: Record<number, [number, number, number]> = {
    1: [0, 1, 1], 2: [60, 1, 1], 3: [120, 1, 1], 4: [180, 1, 1], 5: [240, 1, 1], 6: [300, 1, 1],
    7: [0, 0, 1], 8: [0, 0, 0.5], 9: [0, 0, 0.75],
  };
  if (basic[i]) return basic[i];
  if (i >= 10 && i <= 249) {
    // 24 hues in 15 degree steps, 10 shades each: 5 brightness levels, full and pastel
    const k = (i - 10) % 10;
    return [Math.floor((i - 10) / 10) * 15, k % 2 ? 0.5 : 1, [1, 0.74, 0.5, 0.41, 0.31][k >> 1]];
  }
  return [0, 0, 0.5]; // 250..255 grays, 0 / 256 unresolved
}

export function rgbHsv(rgb: number): [number, number, number] {
  const r = ((rgb >> 16) & 255) / 255, g = ((rgb >> 8) & 255) / 255, b = (rgb & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > 0) h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  return [(h + 360) % 360, max === 0 ? 0 : d / max, max];
}

/**
 * List of a line's color: an exact color (HEX or AutoCAD number) of any list first, then the
 * ranges (any shade; black, white and grays; the closest hue when two take it), else "Other colors".
 */
export function colourRole(e: { color?: number; rgb?: number }, c: ColourRules = DEFAULT_COLOURS): ColourList {
  const lists = COLOUR_LISTS.filter((r) => c[r]);   // rules saved before common cut have no such list
  for (const r of lists) if (c[r].some((x) => (x.kind === "exact" || x.kind === "aci") && entryTakes(x, e))) return r;
  const hsv = rgbHsv(lineRgb(e) ?? 0xffffff);
  let best: { r: ColourList; d: number } | null = null;
  for (const r of lists) for (const x of c[r]) {
    if ((x.kind === "shade" || x.kind === "grays") && entryTakes(x, e)) {
      const d = x.kind === "grays" ? 0 : hueDist(hsv[0], x.hue) / Math.max(1, x.width);
      if (!best || d < best.d) best = { r, d };
    }
  }
  return best?.r ?? c.other;
}

const KEY = "gnezdo.importRules";

export function loadRules(): ImportRules {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_RULES;
    const saved = JSON.parse(raw) as Partial<ImportRules> & { exactColours?: boolean };
    // saved before the color lists: "exact colors only" becomes AutoCAD red / green -> trace, cyan -> open cut
    const colours = saved.colours ?? (saved.exactColours
      ? { cut: [{ kind: "grays" }], trace: [{ kind: "aci", aci: 3 }, { kind: "aci", aci: 1 }], openCut: [{ kind: "aci", aci: 4 }], common: [], other: "cut" } as ColourRules
      : DEFAULT_COLOURS);
    const { exactColours: _old, ...rest } = saved;
    void _old;
    return { ...DEFAULT_RULES, ...rest, colours: { ...colours, common: colours.common ?? [] } };
  } catch {
    return DEFAULT_RULES;
  }
}

export function saveRules(r: ImportRules) {
  try { localStorage.setItem(KEY, JSON.stringify(r)); } catch { /* not stored: rules stay for this session */ }
}

const words = (s: string) => s.split(",").map((w) => w.trim().toUpperCase()).filter(Boolean);

/**
 * Gives each line its role when a file is read. Layer names win over colors
 * (a layer called MARK is tracing whatever its color); with "all layers as one"
 * only colors count, and with neither everything is cutting.
 */
export function roleFromRules(e: Entity, rules: ImportRules): ColourList {
  if (!rules.allLayersAsOne && e.layer) {
    const layer = e.layer.toUpperCase();
    if (words(rules.openCutLayers).some((w) => layer.includes(w))) return "openCut";
    if (words(rules.traceLayers).some((w) => layer.includes(w))) return "trace";
  }
  if (rules.coloursAsCuts) return colourRole(e, rules.colours);
  return "cut";
}

/** Roles from the rules; a common cut color marks only straight lines of closed cutting contours (the rest cut). */
export const applyRules = (entities: Entity[], rules: ImportRules): Entity[] =>
  dropBadCommon(entities.map((e) => {
    const list = roleFromRules(e, rules);
    const role: Role = list === "common" ? "cut" : list;
    return { ...e, role, fileRole: role, common: list === "common" ? true : undefined };
  }));

/** The DXF color as #rrggbb for the light canvas (white shows black; very light colors a little darker). */
export function colourHex(e: { color?: number; rgb?: number }): string {
  if (e.rgb === undefined && e.color === undefined) return "#1b1b1b";
  const [h, sat, val] = e.rgb !== undefined ? rgbHsv(e.rgb) : aciHsv(e.color!);
  if (sat < 0.15) return val > 0.85 || val < 0.15 ? "#1b1b1b" : `#${Math.round(val * 255).toString(16).padStart(2, "0").repeat(3)}`;
  const c = val * sat, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = val - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const k = (r + m) * 0.3 + (g + m) * 0.59 + (b + m) * 0.11 > 0.75 ? 0.78 : 1;
  const to = (v: number) => Math.round((v + m) * 255 * k).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

const ACI_NAME: Record<number, string> = { 1: "Red", 2: "Yellow", 3: "Green", 4: "Cyan", 5: "Blue", 6: "Magenta", 7: "White / black", 8: "Dark gray", 9: "Light gray" };

/** One color group of a drawing: the key, how it is named, and its swatch. */
export function colourKey(e: { color?: number; rgb?: number }): { key: string; name: string; hex: string } {
  if (e.rgb !== undefined) {
    const r = (e.rgb >> 16) & 255, g = (e.rgb >> 8) & 255, b = e.rgb & 255;
    return { key: `rgb:${e.rgb}`, name: `RGB ${r}, ${g}, ${b}`, hex: colourHex(e) };
  }
  if (e.color === undefined || e.color === 0 || e.color === 256) return { key: "none", name: "No color", hex: "#1b1b1b" };
  return { key: `aci:${e.color}`, name: ACI_NAME[e.color] ?? `Color ${e.color}`, hex: colourHex(e) };
}
