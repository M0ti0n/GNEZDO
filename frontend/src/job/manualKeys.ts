// Keys for manual nesting (GNEZDO menu -> Settings -> Manual nest): two keys per action, kept in
// this browser. Keys are physical keys (KeyboardEvent.code), so numpad 5 is not the 5 above the letters.

export type KeyAction = "up" | "down" | "left" | "right" | "rotCcw1" | "rotCcw45" | "rotCw1" | "rotCw45";

export const KEY_ACTIONS: { id: KeyAction; label: string }[] = [
  { id: "up", label: "Move up 1 mm" },
  { id: "down", label: "Move down 1 mm" },
  { id: "left", label: "Move left 1 mm" },
  { id: "right", label: "Move right 1 mm" },
  { id: "rotCcw1", label: "Rotate counter-clockwise 1°" },
  { id: "rotCcw45", label: "Rotate counter-clockwise 45°" },
  { id: "rotCw1", label: "Rotate clockwise 1°" },
  { id: "rotCw45", label: "Rotate clockwise 45°" },
];

export type KeyMap = Record<KeyAction, [string, string]>;

/** Numpad as arrows (5 up, 1 left, 2 down, 3 right; 4/6 turn 1°, 7/9 turn 45°); the arrow keys too. */
export const DEFAULT_KEYS: KeyMap = {
  up: ["Numpad5", "ArrowUp"],
  down: ["Numpad2", "ArrowDown"],
  left: ["Numpad1", "ArrowLeft"],
  right: ["Numpad3", "ArrowRight"],
  rotCcw1: ["Numpad4", ""],
  rotCcw45: ["Numpad7", ""],
  rotCw1: ["Numpad6", ""],
  rotCw45: ["Numpad9", ""],
};

const STORE = "gnezdo.manualKeys";

export function loadKeys(): KeyMap {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? "null") as Partial<KeyMap> | null;
    if (!v) return DEFAULT_KEYS;
    const out = { ...DEFAULT_KEYS };
    for (const a of KEY_ACTIONS) {
      const k = v[a.id];
      if (Array.isArray(k)) out[a.id] = [String(k[0] ?? ""), String(k[1] ?? "")];
    }
    return out;
  } catch {
    return DEFAULT_KEYS;
  }
}

export function saveKeys(k: KeyMap) {
  try { localStorage.setItem(STORE, JSON.stringify(k)); } catch { /* this session only */ }
}

export const actionOf = (k: KeyMap, code: string): KeyAction | null =>
  (KEY_ACTIONS.find((a) => k[a.id].includes(code))?.id) ?? null;

/** "Numpad5" -> "Num 5", "ArrowUp" -> "↑", "KeyQ" -> "Q". */
export function keyLabel(code: string): string {
  if (!code) return "–";
  const arrows: Record<string, string> = { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→" };
  if (arrows[code]) return arrows[code];
  if (code.startsWith("Numpad")) return `Num ${code.slice(6).replace("Add", "+").replace("Subtract", "−").replace("Multiply", "×").replace("Divide", "÷").replace("Decimal", ".")}`;
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return code;
}
