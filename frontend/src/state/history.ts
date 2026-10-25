/**
 * Undo / Redo for the whole app. Every screen that can be undone (today the import drawings,
 * later jobs) keeps its own history under its own key, so switching tabs never mixes them up
 * and a tab's history survives switching away and back. The Undo / Redo buttons in the green
 * bar and Ctrl+Z / Ctrl+Y always act on the open tab.
 */
export interface Step<T> {
  /** What the screen looked like before (undo) or after (redo) the change. */
  state: T;
  /** Name of the change, shown on the buttons: "Undo Trim". */
  label: string;
}

interface Entry<T> { past: Step<T>[]; future: Step<T>[]; first: T }

const LIMIT = 100;

export class HistoryStore<T> {
  private map = new Map<string, Entry<T>>();

  /** A new change: remembers the state before it. Steps that were undone are dropped. */
  record(key: string, before: T, label: string) {
    let e = this.map.get(key);
    if (!e) this.map.set(key, (e = { past: [], future: [], first: before }));
    e.past.push({ state: before, label });
    if (e.past.length > LIMIT) e.past.shift();
    e.future = [];
  }

  /** Steps back: returns the state to show, or null when there is nothing to undo. */
  undo(key: string, current: T): Step<T> | null {
    const e = this.map.get(key);
    const step = e?.past.pop();
    if (!e || !step) return null;
    e.future.push({ state: current, label: step.label });
    return step;
  }

  redo(key: string, current: T): Step<T> | null {
    const e = this.map.get(key);
    const step = e?.future.pop();
    if (!e || !step) return null;
    e.past.push({ state: current, label: step.label });
    return step;
  }

  undoLabel = (key: string) => this.map.get(key)?.past.at(-1)?.label ?? null;
  redoLabel = (key: string) => this.map.get(key)?.future.at(-1)?.label ?? null;

  /** Has it been changed since it was opened (something to undo)? */
  changed = (key: string) => (this.map.get(key)?.past.length ?? 0) > 0;

  /** How it was before the first change (kept even when old steps are dropped). */
  original = (key: string): T | null => this.map.get(key)?.first ?? null;

  /** Closed without saving, saved, or removed from the list: its history ends. */
  forget(key: string) { this.map.delete(key); }
}

/** What the Undo / Redo buttons show for the open tab. */
export interface UndoState {
  undoLabel: string | null;   // null = nothing to undo
  redoLabel: string | null;
  onUndo: () => void;
  onRedo: () => void;
}

/** Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z, except while typing in a field (there they undo the typing). */
export function undoKey(e: KeyboardEvent): "undo" | "redo" | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return null;
  const k = e.key.toLowerCase();
  if (k === "z") return e.shiftKey ? "redo" : "undo";
  if (k === "y") return "redo";
  return null;
}
