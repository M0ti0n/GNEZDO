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
}

export const DEFAULT_RULES: ImportRules = {
  mirrorWithoutOpenCut: true,
  defaultRotations: [90],
  allLayersAsOne: false,
  traceLayers: "MARK, ENGRAV, GRAV, TRACE, SIGN",
  openCutLayers: "OPEN, SLIT",
  coloursAsCuts: true,
};

/** AutoCAD colour index -> role, when colours decide. Everything else is cutting. */
export const COLOUR_ROLES: { aci: number; name: string; css: string; role: Role }[] = [
  { aci: 7, name: "Black / white", css: "#1b1b1b", role: "cut" },
  { aci: 3, name: "Green", css: "#1fa83a", role: "trace" },
  { aci: 1, name: "Red", css: "#e3262b", role: "trace" },
  { aci: 4, name: "Light blue", css: "#4fc3f7", role: "openCut" },
];

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
  if (rules.coloursAsCuts && e.color !== undefined)
    return COLOUR_ROLES.find((c) => c.aci === e.color)?.role ?? "cut";
  return "cut";
}

export const applyRules = (entities: Entity[], rules: ImportRules): Entity[] =>
  entities.map((e) => ({ ...e, role: roleFromRules(e, rules) }));
