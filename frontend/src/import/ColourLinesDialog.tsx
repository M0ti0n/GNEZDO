import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { IconClose } from "../components/Icons";
import { roleOf, type Entity } from "./geometry";
import { colourKey } from "./rules";
import { IMPORT_TOOLS } from "./ImportTools";

/**
 * The tool applied to all lines of a color, as if each line had been clicked with it:
 * Cut = no tool (plain cutting), Trace, Open cut or Hole. Each gives the line a property that
 * path generation and the post processor read later.
 */
export type Operation = "cut" | "trace" | "openCut" | "hole";

export const OPERATION_LABEL: Record<Operation, string> = {
  cut: "Cut",
  trace: "Trace",
  openCut: "Open cut",
  hole: "Hole",
};

const operationOf = (e: Entity): Operation => (roleOf(e) === "cut" ? (e.slow ? "hole" : "cut") : roleOf(e) === "trace" ? "trace" : "openCut");

interface Group { key: string; name: string; hex: string; count: number; now: Operation; mixed: boolean }

interface Props {
  entities: Entity[];
  onCancel: () => void;
  /** The new operation per color group (only groups that change). */
  onApply: (byColour: Map<string, Operation>) => void;
}

// Color lines: every color in the part with the operation its lines get. Change the drop-downs
// and Apply: all lines of that color get the operation (bulk marking, in one Undo step).
export function ColourLinesDialog({ entities, onCancel, onApply }: Props) {
  const groups = useMemo<Group[]>(() => {
    const m = new Map<string, { key: string; name: string; hex: string; ops: Map<Operation, number> }>();
    for (const e of entities) {
      const k = colourKey(e);
      const g = m.get(k.key) ?? { ...k, ops: new Map() };
      const op = operationOf(e);
      g.ops.set(op, (g.ops.get(op) ?? 0) + 1);
      m.set(k.key, g);
    }
    return [...m.values()].map((g) => {
      const [now] = [...g.ops.entries()].sort((a, b) => b[1] - a[1])[0];
      return { key: g.key, name: g.name, hex: g.hex, count: [...g.ops.values()].reduce((a, b) => a + b, 0), now, mixed: g.ops.size > 1 };
    }).sort((a, b) => b.count - a.count);
  }, [entities]);

  const [choice, setChoice] = useState<Map<string, Operation>>(() => new Map(groups.map((g) => [g.key, g.now])));
  // only the colors whose drop-down was changed are applied: a mixed color (say one contour
  // already marked as a hole) is left as it is unless it is chosen on purpose
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const changed = groups.filter((g) => touched.has(g.key) && (choice.get(g.key) !== g.now || g.mixed));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  // the dialog can be dragged by its header, out of the way of the part
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ px: number; py: number; x: number; y: number; box: DOMRect } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const onHeadDown = (e: RPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    const box = formRef.current?.getBoundingClientRect();
    if (!box) return;
    drag.current = { px: e.clientX, py: e.clientY, x: pos.x, y: pos.y, box };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    e.preventDefault();
  };
  const onHeadMove = (e: RPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    // keep at least part of the header on screen so the dialog can always be grabbed again
    const dx = Math.min(Math.max(e.clientX - d.px, 80 - d.box.right), window.innerWidth - 80 - d.box.left);
    const dy = Math.min(Math.max(e.clientY - d.py, -d.box.top), window.innerHeight - 60 - d.box.top);
    setPos({ x: d.x + dx, y: d.y + dy });
  };
  const onHeadUp = () => { drag.current = null; setDragging(false); };

  return (
    <div className="dlg-backdrop is-light" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <form ref={formRef} className="dlg colour-dlg" role="dialog" style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }} aria-modal="true" aria-labelledby="cl-title"
        onSubmit={(e) => { e.preventDefault(); onApply(new Map(changed.map((g) => [g.key, choice.get(g.key)!]))); }}>
        <header className={`dlg-head is-grab${dragging ? " is-dragging" : ""}`} title="Drag to move"
          onPointerDown={onHeadDown} onPointerMove={onHeadMove} onPointerUp={onHeadUp} onPointerCancel={onHeadUp}>
          <span className="dlg-icon" aria-hidden="true">{IMPORT_TOOLS.find((t) => t.id === "colourLines")?.icon}</span>
          <div className="dlg-title">
            <h2 id="cl-title">Color lines</h2>
            <p>{groups.length} {groups.length === 1 ? "color" : "colors"} in this part</p>
          </div>
          <button type="button" className="icon-btn dlg-close" onClick={onCancel} aria-label="Close" title="Close (Esc)"><IconClose size={16} /></button>
        </header>
        <table className="colour-table">
          <thead><tr><th>Color</th><th className="num">Lines</th><th>Tool</th></tr></thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.key}>
                <td><span className="colour-swatch" style={{ background: g.hex }} />{g.name}</td>
                <td className="num">{g.count}</td>
                <td>
                  <select className="field" value={choice.get(g.key)} aria-label={`Tool for ${g.name}`}
                    onChange={(e) => {
                      setChoice((c) => new Map(c).set(g.key, e.target.value as Operation));
                      setTouched((t) => new Set(t).add(g.key));
                    }}>
                    {(Object.keys(OPERATION_LABEL) as Operation[]).map((op) => <option key={op} value={op}>{OPERATION_LABEL[op]}</option>)}
                  </select>
                  {g.mixed && !touched.has(g.key) && <small className="colour-mixed">mixed: left as it is unless you choose</small>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <footer className="dlg-foot">
          <span className="proc-missing">The outer contour always stays cut; a hole needs a closed contour; a closed contour can't be open cut.</span>
          <button type="button" className="btn btn-plain" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn btn-save" disabled={!changed.length}>Apply</button>
        </footer>
      </form>
    </div>
  );
}

/** Lines get the operation of their color group. */
export function applyColours(entities: Entity[], byColour: Map<string, Operation>): Entity[] {
  return entities.map((e) => {
    const op = byColour.get(colourKey(e).key);
    if (!op) return e;
    return { ...e, role: op === "hole" ? "cut" : op, slow: op === "hole" ? true : undefined };
  });
}
