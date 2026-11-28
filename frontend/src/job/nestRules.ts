// GNEZDO menu -> Rules -> Nesting rules. Shared on the server (an admin changes them); this browser keeps
// the copy last loaded, which the nest reads.

export interface NestingRules {
  /** Arrange (manual nest): the arranged parts go towards the machine's 0,0; off: they are packed where they are. */
  arrangeToOrigin: boolean;
  /** Thorough / Custom nest: how much a block's box may grow to take a bigger part [% of its width or height]. */
  blockMarginPct: number;
  /** Automatic nest: each search round this many times wider than the last (PackingSolver: 1.5). */
  searchGrowth: number;
  /** Automatic nest: the last sheet's parts packed into the smallest box at the machine's 0,0 ("box"), or as short as they can be along X or Y. */
  lastSheet: LastSheetGoal;
}

export type LastSheetGoal = "box" | "x" | "y";

export const SEARCH_GROWTH_MIN = 1.2;
export const SEARCH_GROWTH_MAX = 2.0;

export const DEFAULT_NESTING_RULES: NestingRules = { arrangeToOrigin: true, blockMarginPct: 10, searchGrowth: 1.5, lastSheet: "box" };

const STORE = "gnezdo.nestingRules";

/** Nesting rules as saved, filled up with the defaults; null: none saved. */
export function normalizeNestingRules(raw: unknown): NestingRules | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = { ...DEFAULT_NESTING_RULES, ...(raw as Partial<NestingRules>) };
  return ["box", "x", "y"].includes(r.lastSheet) ? r : { ...r, lastSheet: "box" };
}

export function loadNestingRules(): NestingRules {
  try { return normalizeNestingRules(JSON.parse(localStorage.getItem(STORE) ?? "null")) ?? DEFAULT_NESTING_RULES; }
  catch { return DEFAULT_NESTING_RULES; }
}

export function saveNestingRules(r: NestingRules) {
  try { localStorage.setItem(STORE, JSON.stringify(r)); } catch { /* this session only */ }
}
