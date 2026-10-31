import { useEffect, useState } from "react";
import { IconClose } from "./Icons";
import { api, type PartDetail } from "../api/api";
import type { PartSummary } from "../api/types";
import { ROTATIONS, type Rotation } from "../import/rules";
import { FILLER_TIP } from "../import/filler";
import { Combobox } from "./Combobox";
import { fullDate, when } from "./format";
import { PartThumb } from "./PartThumb";
import { usePickLists } from "./pickLists";

interface Props {
  part: PartSummary;
  onClose: () => void;
  /** After a save: the part as it is now. */
  onSaved: (p: PartSummary) => void;
  onDeleted: (id: string) => void;
  /** Opens the part's versions. */
  onVersions: (p: PartSummary) => void;
}

interface Form {
  name: string; project: string; description: string; material: string; thicknessMm: string;
  rotations: Rotation[]; mirror: boolean; filler: boolean;
}

// Properties of a saved part (Parts search -> click a part): change them, see versions, or delete.
// Every save keeps the version before it, so a wrong change can be undone with Restore.
export function PartPropertiesDialog({ part, onClose, onSaved, onDeleted, onVersions }: Props) {
  const [detail, setDetail] = useState<PartDetail | null>(null);
  const [f, setF] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const lists = usePickLists(f?.material ?? "");
  const set = (patch: Partial<Form>) => setF((x) => (x ? { ...x, ...patch } : x));

  useEffect(() => {
    api.part(part.id).then((d) => {
      setDetail(d);
      setF({
        name: d.part.name, project: d.part.project, description: d.part.description, material: d.part.material,
        thicknessMm: String(d.part.thicknessMm), rotations: ROTATIONS.filter((r) => d.rotations.includes(r)), mirror: d.mirror, filler: d.filler,
      });
    }, (e: Error) => setError(e.message));
  }, [part.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) (confirmDelete ? setConfirmDelete(false) : onClose()); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy, confirmDelete]);

  const p = detail?.part ?? part;
  const changed = !!(f && detail) && (
    f.name.trim() !== detail.part.name || f.project.trim() !== detail.part.project || f.description.trim() !== detail.part.description ||
    f.material.trim() !== detail.part.material || Number(f.thicknessMm) !== detail.part.thicknessMm || f.mirror !== detail.mirror || f.filler !== detail.filler ||
    f.rotations.join() !== ROTATIONS.filter((r) => detail.rotations.includes(r)).join());
  const projectMissing = !!f && lists.projectsLoaded && !lists.projectKnown(f.project);
  const missing = f ? [!f.name.trim() && "name", !f.material.trim() && "material", !(Number(f.thicknessMm) > 0) && "thickness",
    projectMissing && "a saved project"].filter(Boolean) : [];

  const save = async () => {
    if (!f || !changed || missing.length || busy) return;
    setBusy(true);
    setError(null);
    try {
      const d = await api.updatePart(part.id, {
        name: f.name, project: f.project, description: f.description, material: f.material,
        thicknessMm: Number(f.thicknessMm), rotations: f.rotations, mirror: f.mirror, filler: f.filler,
      });
      onSaved(d.part);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try { await api.deletePart(part.id); onDeleted(part.id); onClose(); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  };

  return (
    <div className="dlg-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <form className="dlg proc pp-dlg" role="dialog" aria-modal="true" aria-labelledby="pp-title"
        onSubmit={(e) => { e.preventDefault(); save(); }}>
        <header className="dlg-head">
          <span className="dlg-icon pp-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="3" width="13" height="18" rx="1.5" /><path d="M7.5 8h6M7.5 12h6M7.5 16h3.5" /><path d="m15 19 5-5-2-2-5 5v2z" />
            </svg>
          </span>
          <div className="dlg-title">
            <h2 id="pp-title">Part properties</h2>
            <p>{p.name}{p.project ? ` · ${p.project}` : ""}</p>
          </div>
          <button type="button" className="icon-btn dlg-close" onClick={onClose} disabled={busy} aria-label="Close" title="Close (Esc)"><IconClose size={16} /></button>
        </header>

        <div className="proc-body">
          <figure className="proc-image pp-image">
            <div className="pp-thumb"><PartThumb part={p} size={260} /></div>
            <div className="proc-size">{Math.round(p.w)} × {Math.round(p.h)} mm</div>
            <dl className="pp-facts">
              <dt>Version</dt>
              <dd>{p.revision}{p.revision > 1 && <> · <button type="button" className="link" onClick={() => onVersions(p)}>see versions</button></>}</dd>
              <dt>Saved</dt><dd title={fullDate(p.modifiedAt)}>{when(p.modifiedAt)}</dd>
              <dt>Area</dt><dd>{(p.areaMm2 / 1e6).toLocaleString("en-GB", { maximumFractionDigits: 3 })} m²</dd>
              {detail?.sourceFile && <><dt>File</dt><dd className="pp-file">{detail.sourceFile}</dd></>}
            </dl>
          </figure>

          {!f ? <p className="state">{error ?? "Loading…"}</p> : (
            <div className="proc-form">
              <label className="proc-group">
                <span className="proc-label">Part name</span>
                <input className="field" value={f.name} onChange={(e) => set({ name: e.target.value })} />
              </label>
              <div className="proc-group">
                <span className="proc-label">Project</span>
                <Combobox className={projectMissing ? "is-required" : undefined} value={f.project} onChange={(project) => set({ project })}
                  options={lists.projects} placeholder="e.g. N26-0246" ariaLabel="Project" newHint="a new project"
                  onCreate={async (code) => { await lists.createProject(code); set({ project: code }); }} createLabel="Save new project" />
              </div>
              <label className="proc-group">
                <span className="proc-label">Description</span>
                <input className="field" value={f.description} placeholder="Optional" onChange={(e) => set({ description: e.target.value })} />
              </label>
              <div className="proc-group">
                <span className="proc-label">Material and thickness</span>
                <div className="filter-pair">
                  <Combobox value={f.material}
                    // a new material empties the thickness, so both are always chosen together
                    onChange={(material) => set({ material, thicknessMm: material === f.material ? f.thicknessMm : "" })}
                    options={lists.materials} placeholder="Material" ariaLabel="Material" newHint="a new material" />
                  <Combobox value={f.thicknessMm} onChange={(t) => set({ thicknessMm: t.replace(",", ".").replace(/[^\d.]/g, "") })}
                    options={lists.thicknesses} placeholder="Thickness" ariaLabel="Thickness in mm" suffix="mm" numeric newHint="a new thickness" />
                </div>
              </div>
              <div className="proc-group">
                <span className="proc-label">Nesting rules</span>
                <div className="proc-chips" role="group" aria-label="Rotations">
                  {ROTATIONS.map((r) => (
                    <label key={r} className="chk chk-box">
                      <input type="checkbox" checked={f.rotations.includes(r)}
                        onChange={(e) => set({ rotations: e.target.checked ? ROTATIONS.filter((x) => x === r || f.rotations.includes(x)) : f.rotations.filter((x) => x !== r) })} />
                      {r}°
                    </label>
                  ))}
                  <label className="chk chk-box">
                    <input type="checkbox" checked={f.mirror} onChange={(e) => set({ mirror: e.target.checked })} />
                    Mirror
                  </label>
                  <label className="chk chk-box chk-filler" title={FILLER_TIP}>
                    <input type="checkbox" checked={f.filler} onChange={(e) => set({ filler: e.target.checked })} />
                    Filler
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>

        {error && f && <p className="proc-error" role="alert">Not saved: {error}</p>}

        <footer className="dlg-foot">
          {confirmDelete ? (
            <>
              <span className="pp-confirm">Delete <b>{p.name}</b>? It disappears from searches; jobs that use it keep it.</span>
              <button type="button" className="btn btn-plain" onClick={() => setConfirmDelete(false)} disabled={busy}>Keep</button>
              <button type="button" className="btn btn-replace" onClick={remove} disabled={busy}>{busy ? "Deleting…" : "Delete"}</button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-danger-plain" onClick={() => setConfirmDelete(true)} disabled={!detail || busy}>Delete part</button>
              <span className="proc-missing">
                {missing.length ? `Enter ${missing.join(", ")} to save.` : changed ? "The version before is kept and can be restored." : ""}
              </span>
              <button type="button" className="btn btn-plain" onClick={onClose} disabled={busy}>Cancel</button>
              <button type="submit" className="btn btn-save" disabled={!changed || missing.length > 0 || busy}>{busy ? "Saving…" : "Save"}</button>
            </>
          )}
        </footer>
      </form>
    </div>
  );
}
