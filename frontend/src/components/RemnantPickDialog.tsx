import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { api, type SavedRemnant } from "../api/api";
import { RemnantPicture } from "../pages/RemnantsPage";
import { sameStock } from "../job/stock";
import { IconClose } from "./Icons";

// Stock -> Add from Remnant (and Manual nest -> Add sheet -> ADD FROM REMNANT): the saved remnants
// (Remnants) to pick from, as cards like the Remnants screen. At first only those of the job's
// materials and thicknesses; the ones in the stock already are marked and cannot be picked twice.

export function RemnantPickDialog({ pairs, taken, multi = true, fits, onPick, onClose }: {
  /** the job's materials and thicknesses: shown first (the filter is on) */
  pairs: { material: string; thicknessMm: number }[];
  /** names of the remnants in the stock already */
  taken: Set<string>;
  /** several at once (Stock), or one (Add sheet) */
  multi?: boolean;
  /** does it fit the machine (as it lies, or turned) */
  fits: (r: SavedRemnant) => boolean;
  onPick: (rs: SavedRemnant[]) => void;
  onClose: () => void;
}) {
  const [all, setAll] = useState<SavedRemnant[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jobOnly, setJobOnly] = useState(pairs.length > 0);
  const [text, setText] = useState("");
  const [sel, setSel] = useState<string[]>([]);
  useEffect(() => { api.remnants().then(setAll, (e: Error) => setError(e.message)); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const shown = useMemo(() => {
    const t = text.trim().toLowerCase();
    return (all ?? [])
      .filter((r) => !jobOnly || pairs.some((p) => sameStock(p, r)))
      .filter((r) => !t || [r.name, r.material, r.note ?? "", r.file ?? "", r.job].some((v) => v.toLowerCase().includes(t)))
      .sort((a, b) => a.material.localeCompare(b.material) || a.thicknessMm - b.thicknessMm || b.areaMm2 - a.areaMm2);
  }, [all, jobOnly, pairs, text]);
  const can = (r: SavedRemnant) => !taken.has(r.name) && fits(r);
  const toggle = (r: SavedRemnant) => {
    if (!can(r)) return;
    setSel((s) => (s.includes(r.name) ? s.filter((n) => n !== r.name) : multi ? [...s, r.name] : [r.name]));
  };
  const picked = (all ?? []).filter((r) => sel.includes(r.name));

  return createPortal(
    <div className="dlg-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dlg rpk-dlg" role="dialog" aria-modal="true" aria-labelledby="rpk-title">
        <header className="dlg-head">
          <div className="dlg-title">
            <h2 id="rpk-title">Add from remnants</h2>
            <p>{multi ? "Pick one or more saved remnants: each goes into the stock with its pieces." : "Pick the saved remnant for the new sheet."}</p>
          </div>
          <button type="button" className="dlg-close" onClick={onClose} aria-label="Close"><IconClose size={18} /></button>
        </header>
        <div className="rpk-filters">
          <input className="field" type="search" value={text} placeholder="Name, material, note …" aria-label="Search the remnants" onChange={(e) => setText(e.target.value)} />
          <label className="chk" title="Only remnants of a material and thickness of the job's part list">
            <input type="checkbox" checked={jobOnly} disabled={!pairs.length} onChange={(e) => setJobOnly(e.target.checked)} /> Job materials only
          </label>
          <span className="job-sum">{all ? `${shown.length} of ${all.length}` : error ? "" : "Loading…"}</span>
        </div>
        {error && <p className="state state-error">Could not load the remnants: {error}.</p>}
        {all && !all.length && <p className="state">No remnants saved yet. Save them in a job (Process → Remnant → SAVE) or in Import 2D (Geometry check → Save as remnant).</p>}
        {all && all.length > 0 && !shown.length && <p className="state">{jobOnly ? "No remnants of the job's materials and thicknesses: turn off Job materials only to see all." : "No remnants match."}</p>}
        <div className="rb-grid rpk-grid">
          {shown.map((r) => {
            const inStock = taken.has(r.name), big = !fits(r);
            return (
              <article key={r.name} className={`rb-card${sel.includes(r.name) ? " is-sel" : ""}${!can(r) ? " is-off" : ""}`}
                onClick={() => toggle(r)} onDoubleClick={() => { if (can(r)) onPick([r]); }}
                title={inStock ? "In the stock already" : big ? "Bigger than the machine can cut" : r.note || undefined}>
                <header className="rb-head">
                  <b className="rb-name">{r.name}</b>
                  {inStock && <span className="rpk-tag">In stock</span>}
                  {!inStock && big && <span className="rpk-tag is-bad">Too big</span>}
                </header>
                <div className="rb-frame"><RemnantPicture r={r} />{(r.qty ?? 1) > 1 && <span className="rb-qty">×{r.qty}</span>}</div>
                <div className="rb-size">{r.widthMm}×{r.heightMm}</div>
                <footer className="rb-foot"><span>{r.material}</span>{r.note && <span className="rb-has-note" title={r.note}>✎</span>}<span>{r.thicknessMm} mm</span></footer>
              </article>
            );
          })}
        </div>
        <footer className="dlg-foot">
          <span className="proc-missing">{picked.length ? picked.map((r) => r.name).join(", ") : ""}</span>
          <button type="button" className="btn btn-plain" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-save" disabled={!picked.length} onClick={() => onPick(picked)}>
            {multi && picked.length > 1 ? `Add ${picked.length}` : "Add"}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
