import { useEffect, useState } from "react";
import { IconClose } from "./Icons";
import { TECHNOLOGIES, type MachineList } from "../job/machine";

// New job: its name and the machine it is nested for (gaps, 0,0 and cutting area come from it).
export function NewJobDialog({ defaultName, machines, onCreate, onCancel }: {
  defaultName: string; machines: MachineList; onCreate: (name: string, machineId: string) => void; onCancel: () => void;
}) {
  const [name, setName] = useState(defaultName);
  const [machine, setMachine] = useState(machines.defaultId);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  const ok = name.trim().length > 0;
  return (
    <div className="dlg-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <form className="dlg nj-dlg" role="dialog" aria-modal="true" aria-labelledby="nj-title"
        onSubmit={(e) => { e.preventDefault(); if (ok) onCreate(name.trim(), machine); }}>
        <header className="dlg-head">
          <span className="dlg-icon nj-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="1.5" /><path d="M12 9v6M9 12h6" /></svg>
          </span>
          <div className="dlg-title"><h2 id="nj-title">New job</h2><p>The machine decides the gaps, the 0,0 corner and the largest sheet.</p></div>
          <button type="button" className="icon-btn dlg-close" onClick={onCancel} aria-label="Close" title="Close (Esc)"><IconClose size={16} /></button>
        </header>
        <div className="nj-body">
          <label className="proc-group">
            <span className="proc-label">Job name</span>
            <input className="field" value={name} autoFocus onFocus={(e) => e.target.select()} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="proc-group">
            <span className="proc-label">Machine</span>
            <div className="nj-machines" role="radiogroup" aria-label="Machine">
              {machines.list.map((m) => (
                <button key={m.id} type="button" role="radio" aria-checked={machine === m.id}
                  className={`nj-machine${machine === m.id ? " is-on" : ""}`} onClick={() => setMachine(m.id)}>
                  <b>{m.name}</b>
                  <span>{TECHNOLOGIES.find((t) => t.id === m.technology)?.label} · {m.cutLengthMm} × {m.cutWidthMm} mm</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <footer className="dlg-foot">
          <span className="proc-missing">Machines: GNEZDO menu → Settings → Machines.</span>
          <button type="button" className="btn btn-plain" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn btn-save" disabled={!ok}>Create job</button>
        </footer>
      </form>
    </div>
  );
}
