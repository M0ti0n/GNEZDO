import { useEffect, useMemo, useState } from "react";
import { api, type SavedRemnant } from "../api/api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { NumInput } from "../components/NumInput";
import { matchRemnant, type RemnantFilter } from "../shell/RemnantsPanel";

// The remnant store (left rail -> Remnants): the saved remnants as cards in a grid, with EDIT and
// DELETE (after Fab's layout). Saved in Process -> Remnant -> SAVE.

function RemnantPicture({ r }: { r: SavedRemnant }) {
  const w = Math.max(1, r.widthMm), h = Math.max(1, r.heightMm), pad = Math.max(w, h) * 0.04;
  const loop = (l: number[][]) => l.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join("") + "Z";
  return (
    <svg className="rb-pic" viewBox={`${-pad} ${-pad} ${w + 2 * pad} ${h + 2 * pad}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <path d={[r.outline, ...(r.holes ?? [])].map(loop).join("")} fillRule="evenodd" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Edit a saved remnant, or name a new one (Import remnant). */
export function RemnantDialog({ title = "Edit remnant", r, names, fresh = false, onSave, onCancel }: {
  title?: string; r: SavedRemnant; names: Set<string>;
  /** a new remnant (Import): no saved remnant may have its name, not even the one it came with */
  fresh?: boolean;
  onSave: (r: SavedRemnant) => void; onCancel: () => void;
}) {
  const [x, setX] = useState(r);
  const clash = (fresh || x.name.trim() !== r.name) && names.has(x.name.trim());
  const ok = x.name.trim() !== "" && !clash && x.material.trim() !== "" && x.thicknessMm > 0;
  return (
    <div className="dlg-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="dlg rb-dlg" role="dialog" aria-modal="true" aria-labelledby="rb-title">
        <header className="dlg-head"><div className="dlg-title"><h2 id="rb-title">{title}</h2></div></header>
        <form className="rb-form" onSubmit={(e) => { e.preventDefault(); if (ok) onSave({ ...x, name: x.name.trim(), material: x.material.trim() }); }}>
          <label className="mc-field"><span>Name</span><input className="field" value={x.name} autoFocus onChange={(e) => setX({ ...x, name: e.target.value })} /></label>
          {clash && <p className="tech-msg is-bad">A remnant of this name is saved already.</p>}
          <div className="mc-row">
            <label className="mc-field"><span>Material</span><input className="field" value={x.material} onChange={(e) => setX({ ...x, material: e.target.value })} /></label>
            <label className="mc-field"><span>Thickness (mm)</span><NumInput value={x.thicknessMm} min={0.1} aria-label="Thickness (mm)" onCommit={(n) => setX({ ...x, thicknessMm: n })} /></label>
            <label className="mc-field"><span>Pieces</span><NumInput value={x.qty ?? 1} min={1} aria-label="Pieces" onCommit={(n) => setX({ ...x, qty: Math.max(1, Math.round(n)) })} /></label>
          </div>
          <label className="mc-field"><span>Note</span>
            <textarea className="field rb-note" rows={3} value={x.note ?? ""} placeholder="Protective foil on top, badly scratched …" onChange={(e) => setX({ ...x, note: e.target.value })} /></label>
          <p className="rule-help">{x.widthMm} × {x.heightMm} mm, {(x.areaMm2 / 1e6).toFixed(2)} m² · {x.file ? `imported from ${x.file}` : `from ${x.job}, sheet ${x.sheet}`}{x.projects?.length ? ` · ${x.projects.join(", ")}` : ""}</p>
          <footer className="dlg-foot">
            <span className="proc-missing" />
            <button type="button" className="btn btn-plain" onClick={onCancel}>Cancel</button>
            <button type="submit" className="btn btn-save" disabled={!ok}>Save</button>
          </footer>
        </form>
      </div>
    </div>
  );
}

const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString() : "");

/** The remnants read last (while GNEZDO is open). */
let keptRemnants: SavedRemnant[] | null = null;

export function RemnantsPage({ filter, run, onShowFilters, selected, onSelect, onFresh }: {
  filter: RemnantFilter | null; run: number; onShowFilters: () => void;
  /** the remnant picked (its details show in the Remnant search panel) */
  selected: string | null; onSelect: (r: SavedRemnant | null) => void;
  /** the picked remnant as loaded again (changed, or null: gone) */
  onFresh: (r: SavedRemnant | null) => void;
}) {
  // back on this screen: the remnants read last show at once while they are read again
  const [all, setAll] = useState<SavedRemnant[] | null>(keptRemnants);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<SavedRemnant | null>(null);
  const [del, setDel] = useState<SavedRemnant | null>(null);
  const load = () => api.remnants().then((l) => { keptRemnants = l; setAll(l); setError(null); }, (e: Error) => setError(e.message));
  useEffect(() => { void load(); }, [run]);
  // the picked remnant as it is now (changed or deleted)
  useEffect(() => { if (all && selected) onFresh(all.find((r) => r.name === selected) ?? null); }, [all]);   // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => (all ?? []).filter((r) => matchRemnant(r, filter ?? {}))
    .sort((a, b) => a.material.localeCompare(b.material) || a.thicknessMm - b.thicknessMm || b.areaMm2 - a.areaMm2), [all, filter]);
  const names = useMemo(() => new Set((all ?? []).map((r) => r.name)), [all]);

  const save = async (r: SavedRemnant, old: SavedRemnant) => {
    try {
      await api.saveRemnants([r]);
      if (r.name !== old.name) await api.deleteRemnants([old.name]);
      setEdit(null);
      await load();
    } catch (e) { setError((e as Error).message); }
  };
  const remove = async (r: SavedRemnant) => {
    try { await api.deleteRemnants([r.name]); setDel(null); await load(); } catch (e) { setError((e as Error).message); }
  };

  return (
    <div className="search-page rb-page">
      <header className="search-head page-strip">
        <h1>Remnants</h1>
        <span className="job-sum">{all ? `${shown.length} of ${all.length}` : error ? "" : "Loading…"}</span>
        {!filter && <button className="link" onClick={onShowFilters}>Filters</button>}
      </header>
      {error && <p className="state state-error">Could not load the remnants: {error}.</p>}
      {all && !all.length && <p className="state">No remnants saved yet. Save them in a job: Process → Remnant → SAVE.</p>}
      {all && all.length > 0 && !shown.length && <p className="state">No remnants match these filters.</p>}
      <div className="rb-grid pane-scroll">
        {shown.map((r) => (
          <article key={r.name} className={`rb-card${selected === r.name ? " is-sel" : ""}`} onClick={() => onSelect(r)} title={`Saved ${day(r.savedAt)}${r.savedBy ? ` by ${r.savedBy}` : ""}${r.modifiedAt ? ` · changed ${day(r.modifiedAt)}` : ""}`}>
            <header className="rb-head">
              <b className="rb-name">{r.name}</b>
              <button type="button" className="btn btn-plain rb-edit" onClick={(e) => { e.stopPropagation(); setEdit(r); }}>Edit</button>
              <button type="button" className="btn btn-plain rb-del" onClick={(e) => { e.stopPropagation(); setDel(r); }}>Delete</button>
            </header>
            <div className="rb-frame"><RemnantPicture r={r} />{(r.qty ?? 1) > 1 && <span className="rb-qty">×{r.qty}</span>}</div>
            <div className="rb-size">{r.widthMm}×{r.heightMm}</div>
            <footer className="rb-foot"><span>{r.material}</span>{r.note && <span className="rb-has-note" title={r.note}>✎</span>}<span>{r.thicknessMm} mm</span></footer>
          </article>
        ))}
      </div>
      {edit && <RemnantDialog r={edit} names={names} onCancel={() => setEdit(null)} onSave={(r) => void save(r, edit)} />}
      {del && (
        <ConfirmDialog title="Delete remnant?" confirmLabel="Delete" onCancel={() => setDel(null)} onConfirm={() => void remove(del)}>
          {del.name} ({del.widthMm} × {del.heightMm} mm, {del.material} {del.thicknessMm} mm) goes out of the remnant store.
        </ConfirmDialog>
      )}
    </div>
  );
}
