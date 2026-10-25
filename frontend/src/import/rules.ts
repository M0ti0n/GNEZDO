import type { Entity, Role } from "./geometry";

// Settings -> Rules -> Import rules.
// Kept in this browser for now; they move to the server with user settings.

export const ROTATIONS = [90, 45, 30, 5] as const;
export type Rotation = (typeof ROTATIONS)[number];

export interface ImportRules {
  /** Parts without open cut lines may be mirrored when nesting (Mirror is ticked for them by default). */
  mirrorWithoutOpenCut: boolean;
  /** Rotation steps ticked by default for new imports. */
  defaultRotations: Rotation[];
  /** One layer: every line starts as cutting; tracing and open cut are marked by hand. */
  allLayersAsOne: boolean;
  /** Layer names (parts of names) that mean tracing / open cut, when layers are used. */
  traceLayers: string;
  openCutLayers: string;
  /** Colours decide: black/white cutting, green or red tracing, light blue open cut. */
  coloursAsCuts: boolean;
  /** Only the basic colours 1 red, 3 green, 4 cyan count; otherwise every shade of them does. */
  exactColours: boolean;
}

export const DEFAULT_RULES: ImportRules = {
  mirrorWithoutOpenCut: true,
  defaultRotations: [90],
  allLayersAsOne: false,
  traceLayers: "MARK, ENGRAV, GRAV, TRACE, SIGN",
  openCutLayers: "OPEN, SLIT",
  coloursAsCuts: true,
  exactColours: false,
};

/**
 * Colour groups, when colours decide. "shades" are examples for the Rules page;
 * any colour whose hue falls in the range counts (dark, light or True Color).
 * Black, white, greys, very dark colours and other hues (blue, yellow, magenta) are cutting.
 */
export const COLOUR_ROLES: { name: string; aci: number; hue: [number, number]; shades: string[]; role: Role }[] = [
  { name: "Greens", aci: 3, hue: [70, 160], role: "trace", shades: ["#00ff00", "#00bd00", "#008100", "#3f803f", "#7fff7f"] },
  { name: "Reds", aci: 1, hue: [340, 20], role: "trace", shades: ["#ff0000", "#bd0000", "#810000", "#ff3f00", "#ff7f7f"] },
  { name: "Light blues and cyans", aci: 4, hue: [160, 215], role: "openCut", shades: ["#00ffff", "#00bfff", "#00a5bd", "#3fbfff", "#7fdfff"] },
];

/** Hue (degrees), saturation and value (0..1) of an AutoCAD colour index. */
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
  return [0, 0, 0.5]; // 250..255 greys, 0 / 256 unresolved
}

export function rgbHsv(rgb: number): [number, number, number] {
  const r = ((rgb >> 16) & 255) / 255, g = ((rgb >> 8) & 255) / 255, b = (rgb & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > 0) h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  return [(h + 360) % 360, max === 0 ? 0 : d / max, max];
}

const inHue = (h: number, [from, to]: [number, number]) => (from <= to ? h >= from && h <= to : h >= from || h <= to);

/** Role from a line's colour, or "cut" when the colour means nothing special. */
export function colourRole(e: { color?: number; rgb?: number }, exact: boolean): Role {
  if (exact) return COLOUR_ROLES.find((c) => c.aci === e.color)?.role ?? "cut";
  if (e.rgb === undefined && e.color === undefined) return "cut";
  const [h, sat, val] = e.rgb !== undefined ? rgbHsv(e.rgb) : aciHsv(e.color!);
  if (sat < 0.25 || val < 0.2) return "cut";           // black, white, greys, almost black
  return COLOUR_ROLES.find((c) => inHue(h, c.hue))?.role ?? "cut";
}

const KEY = "gnezdo.importRules";

export function loadRules(): ImportRules {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_RULES, ...JSON.parse(raw) } : DEFAULT_RULES;
  } catch {
    return DEFAULT_RULES;
  }
}

export function saveRules(r: ImportRules) {
  try { localStorage.setItem(KEY, JSON.stringify(r)); } catch { /* not stored: rules stay for this session */ }
}

const words = (s: string) => s.split(",").map((w) => w.trim().toUpperCase()).filter(Boolean);

/**
 * Gives each line its role when a file is read. Layer names win over colours
 * (a layer called MARK is tracing whatever its colour); with "all layers as one"
 * only colours count, and with neither everything is cutting.
 */
export function roleFromRules(e: Entity, rules: ImportRules): Role {
  if (!rules.allLayersAsOne && e.layer) {
    const layer = e.layer.toUpperCase();
    if (words(rules.openCutLayers).some((w) => layer.includes(w))) return "openCut";
    if (words(rules.traceLayers).some((w) => layer.includes(w))) return "trace";
  }
  if (rules.coloursAsCuts) return colourRole(e, rules.exactColours);
  return "cut";
}

export const applyRules = (entities: Entity[], rules: ImportRules): Entity[] =>
  entities.map((e) => ({ ...e, role: roleFromRules(e, rules) }));
