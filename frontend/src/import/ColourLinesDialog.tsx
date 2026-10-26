import { useEffect, useMemo, useState } from "react";
import { roleOf, type Entity } from "./geometry";
import { colourKey } from "./rules";
import { IMPORT_TOOLS } from "./ImportTools";

/** What a colour group becomes. */
export type Operation = "cut" | "hole" | "trace" | "openCut";

export const OPERATION_LABEL: Record<Operation, string> = {
  cut: "Cutting",
  hole: "Cutting – hole (slow)",
  trace: "Tracing",
  openCut: "Open cut",
};

const operationOf = (e: Entity): Operation => (roleOf(e) === "cut" ? (e.slow ? "hole" : "cut") : roleOf(e) === "trace" ? "trace" : "openCut");

interface Group { key: string; name: string; hex: string; count: number; now: Operation; mixed: boolean }

interface Props {
  entities: Entity[];
  onCancel: () => void;
  /** The new operation per colour group (only groups that change). */
  onApply: (byColour: Map<string, Operation>) => void;
}

// Colour lines: every colour in the part with the operation its lines get. Change the drop-downs
// and Apply: all lines of that colour get the operation (bulk marking, in one Undo step).
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
  // only the colours whose drop-down was changed are applied: a mixed colour (say one contour
  // already marked as a hole) is left as it is unless it is chosen on purpose
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const changed = groups.filter((g) => touched.has(g.key) && (choice.get(g.key) !== g.now || g.mixed));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="dlg-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <form className="dlg colour-dlg" role="dialog" aria-modal="true" aria-labelledby="cl-title"
        onSubmit={(e) => { e.preventDefault(); onApply(new Map(changed.map((g) => [g.key, choice.get(g.key)!]))); }}>
        <header className="dlg-head">
          <span className="dlg-icon" aria-hidden="true">{IMPORT_TOOLS.find((t) => t.id === "colourLines")?.icon}</span>
          <div className="dlg-title">
            <h2 id="cl-title">Colour lines</h2>
            <p>{groups.length} {groups.length === 1 ? "colour" : "colours"} in this part</p>
          </div>
          <button type="button" className="icon-btn dlg-close" onClick={onCancel} aria-label="Close" title="Close (Esc)">×</button>
        </header>
        <table className="colour-table">
          <thead><tr><th>Colour</th><th className="num">Lines</th><th>Operation</th></tr></thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.key}>
                <td><span className="colour-swatch" style={{ background: g.hex }} />{g.name}</td>
                <td className="num">{g.count}</td>
                <td>
                  <select className="field" value={choice.get(g.key)} aria-label={`Operation for ${g.name}`}
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
          <span className="proc-missing">A hole only counts on a closed contour.</span>
          <button type="button" className="btn btn-plain" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn btn-save" disabled={!changed.length}>Apply</button>
        </footer>
      </form>
    </div>
  );
}

/** Lines get the operation of their colour group. */
export function applyColours(entities: Entity[], byColour: Map<string, Operation>): Entity[] {
  return entities.map((e) => {
    const op = byColour.get(colourKey(e).key);
    if (!op) return e;
    return { ...e, role: op === "hole" ? "cut" : op, slow: op === "hole" ? true : undefined };
  });
}
