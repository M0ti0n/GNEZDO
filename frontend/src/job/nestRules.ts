// GNEZDO menu -> Rules -> Nesting rules. Kept in this browser for now (like the manual nest keys).

export interface NestingRules {
  /** Arrange (manual nest): the arranged parts go towards the machine's 0,0; off: they are packed where they are. */
  arrangeToOrigin: boolean;
}

export const DEFAULT_NESTING_RULES: NestingRules = { arrangeToOrigin: true };

const STORE = "gnezdo.nestingRules";

export function loadNestingRules(): NestingRules {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? "null") as Partial<NestingRules> | null;
    return { ...DEFAULT_NESTING_RULES, ...(v ?? {}) };
  } catch {
    return DEFAULT_NESTING_RULES;
  }
}

export function saveNestingRules(r: NestingRules) {
  try { localStorage.setItem(STORE, JSON.stringify(r)); } catch { /* this session only */ }
}
