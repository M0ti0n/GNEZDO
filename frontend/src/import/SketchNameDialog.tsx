import { useState } from "react";

// Save to list: the New part (drawn on the empty canvas) gets a name and waits in the import list.
export function SketchNameDialog({ taken, onSave, onCancel }: {
  /** names waiting in the import list already (lower case) */
  taken: Set<string>;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const n = name.trim().replace(/[\\/:*?"<>|]/g, "_");
  const dup = !!n && taken.has(n.toLowerCase());
  return (
    <div className="dlg-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <form className="dlg sketch-dlg" role="dialog" aria-modal="true" aria-labelledby="sk-title"
        onSubmit={(e) => { e.preventDefault(); if (n) onSave(n); }}
        onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}>
        <header className="dlg-head">
          <div className="dlg-title">
            <h2 id="sk-title">Save to the import list</h2>
            <p>The part waits in the list to be finished and processed</p>
          </div>
        </header>
        <div className="sketch-body">
          <label htmlFor="sk-name">Part name</label>
          <input id="sk-name" className={`field${dup ? " is-required" : ""}`} value={name} autoFocus spellCheck={false}
            placeholder="1234-56-78_P1_2" onChange={(e) => setName(e.target.value)} />
          {dup && <p className="sketch-warn">A part named <b>{n}</b> is already waiting in the list.</p>}
          {n !== name.trim() && n && <p className="sketch-note">Saved as {n} (no \ / : * ? " &lt; &gt; | in names)</p>}
        </div>
        <footer className="dlg-foot">
          <span className="proc-missing" />
          <button type="button" className="btn btn-plain" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn btn-save" disabled={!n}>{dup ? "Add anyway" : "Add to the list"}</button>
        </footer>
      </form>
    </div>
  );
}
