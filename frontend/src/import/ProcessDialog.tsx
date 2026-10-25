import { useEffect, useMemo, useRef, useState } from "react";
import { api, type PartFacets } from "../api/api";
import { checkGeometry, pathOf, roleOf, type Drawing } from "./geometry";
import { ROTATIONS, type Rotation } from "./rules";
import { IMPORT_TOOLS } from "./ImportTools";
import { loopPoints } from "./toPart";

/** What the dialog saves. */
export interface ProcessValues {
  name: string;
  project: string;
  description: string;
  material: string;
  thicknessMm: string;
  rotations: Rotation[];
  mirror: boolean;
}

interface Props {
  drawing: Drawing;
  initial: ProcessValues;
  /** Mirror is not allowed for this part (it has open cut lines and the rule says so). */
  mirrorBlocked: boolean;
  onCancel: () => void;
  onSave: (v: ProcessValues, replace: boolean) => Promise<void>;
}

type Exists = { state: "checking" } | { state: "new" } | { state: "exists"; modifiedAt: string } | { state: "unknown" };

// Pop-up of the Process tool: the part as it will be saved, its name, project,
// description, material and nesting rules. The frame is green for a new part and
// red when a part with the same project and name is already in the database.
export function ProcessDialog({ drawing, initial, mirrorBlocked, onCancel, onSave }: Props) {
  const [v, setV] = useState<ProcessValues>({ ...initial, mirror: initial.mirror && !mirrorBlocked });
  const [editing, setEditing] = useState({ name: false, project: false, description: false });
  const [exists, setExists] = useState<Exists>({ state: "checking" });
  const [facets, setFacets] = useState<PartFacets>({ materials: [], thicknesses: [] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<ProcessValues>) => setV((x) => ({ ...x, ...patch }));

  useEffect(() => { api.partFacets().then(setFacets).catch(() => undefined); }, []);

  // Is this part (project + name) already in the database? Checked again as they are edited.
  useEffect(() => {
    if (!v.name.trim()) { setExists({ state: "unknown" }); return; }
    setExists({ state: "checking" });
    let alive = true;
    const t = setTimeout(() => {
      api.existingParts([{ name: v.name, project: v.project }]).then(
        (hits) => alive && setExists(hits.length ? { state: "exists", modifiedAt: hits[0].modifiedAt } : { state: "new" }),
        () => alive && setExists({ state: "unknown" }),
      );
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [v.name, v.project]);

  // Escape cancels.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !saving) onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, saving]);

  // X × Y of the part (outside contour), whole millimetres: "899 × 785 mm"
  const size = useMemo(() => {
    const r = checkGeometry(drawing.entities);
    const b = r.contours.find((c) => c.outer)?.box ?? r.box;
    return `${Math.round(b.maxX - b.minX)} × ${Math.round(b.maxY - b.minY)} mm`;
  }, [drawing]);

  const thicknesses = [...new Set(facets.thicknesses
    .filter((t) => !v.material || t.material.toLowerCase() === v.material.toLowerCase())
    .map((t) => t.thicknessMm))].sort((a, b) => a - b);

  const missing = [!v.name.trim() && "name", !v.material.trim() && "material", !(Number(v.thicknessMm) > 0) && "thickness"].filter(Boolean);
  const canSave = missing.length === 0 && !saving && exists.state !== "checking";

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try { await onSave(v, exists.state === "exists"); }
    catch (e) { setError((e as Error).message); setSaving(false); }
  };

  return (
    <div className="dlg-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onCancel(); }}>
      <form className="dlg proc" role="dialog" aria-modal="true" aria-labelledby="proc-title"
        onSubmit={(e) => { e.preventDefault(); save(); }}>
        <header className="dlg-head">
          <span className="dlg-icon" aria-hidden="true">{IMPORT_TOOLS.find((t) => t.id === "process")?.icon}</span>
          <div className="dlg-title">
            <h2 id="proc-title">Process part</h2>
            <p>{drawing.fileName}</p>
          </div>
          <button type="button" className="icon-btn dlg-close" onClick={onCancel} disabled={saving} aria-label="Close" title="Close (Esc)">×</button>
        </header>

        <div className="proc-body">
          <figure className={`proc-image is-${exists.state}`}>
            <div className="proc-frame"><Preview drawing={drawing} /></div>
            <div className="proc-size" title="Width × height of the part">{size}</div>
            <figcaption>
              <span className="proc-status">
                {exists.state === "checking" && "Checking the database…"}
                {exists.state === "new" && "New part"}
                {exists.state === "exists" && "Already in the database"}
                {exists.state === "unknown" && (v.name.trim() ? "Could not check the database" : "Enter a part name")}
              </span>
              {exists.state === "exists" && <small>Same project and name. Saving replaces the part in the database.</small>}
              {exists.state === "new" && <small>No part with this project and name yet.</small>}
            </figcaption>
          </figure>

          <div className="proc-form">
            <LockedField label="Part name" hint="From the file name, without extension" value={v.name}
              editing={editing.name} onEdit={() => setEditing((x) => ({ ...x, name: true }))}
              onChange={(name) => set({ name })} />
            <LockedField label="Project" hint="e.g. N26-0246" value={v.project}
              editing={editing.project} onEdit={() => setEditing((x) => ({ ...x, project: true }))}
              onChange={(project) => set({ project })} />
            <LockedField label="Description" hint="Optional" value={v.description}
              editing={editing.description} onEdit={() => setEditing((x) => ({ ...x, description: true }))}
              onChange={(description) => set({ description })} />

            <div className="proc-group">
              <span className="proc-label">Material and thickness</span>
              <div className="filter-pair">
                <input className="field" list="proc-materials" value={v.material} placeholder="Material" aria-label="Material"
                  onChange={(e) => set({ material: e.target.value })} />
                <datalist id="proc-materials">{facets.materials.map((m) => <option key={m} value={m} />)}</datalist>
                <span className="proc-thk">
                  <input className="field" list="proc-thicknesses" type="number" min="0" step="0.1" value={v.thicknessMm}
                    placeholder="Thickness" aria-label="Thickness in mm" onChange={(e) => set({ thicknessMm: e.target.value })} />
                  <span className="proc-unit">mm</span>
                </span>
                <datalist id="proc-thicknesses">{thicknesses.map((t) => <option key={t} value={t} />)}</datalist>
              </div>
            </div>

            <div className="proc-group">
              <span className="proc-label">Rotations and mirror</span>
              <div className="proc-chips" role="group" aria-label="Rotations">
                {ROTATIONS.map((r) => (
                  <label key={r} className="chk chk-box">
                    <input type="checkbox" checked={v.rotations.includes(r)}
                      onChange={(e) => set({
                        rotations: e.target.checked ? ROTATIONS.filter((x) => x === r || v.rotations.includes(x)) : v.rotations.filter((x) => x !== r),
                      })} />
                    {r}°
                  </label>
                ))}
                <label className={`chk chk-box${mirrorBlocked ? " is-blocked" : ""}`}
                  title={mirrorBlocked ? "Parts with open cut lines are not mirrored (Rules → Import rules)" : undefined}>
                  <input type="checkbox" checked={v.mirror} disabled={mirrorBlocked} onChange={(e) => set({ mirror: e.target.checked })} />
                  Mirror
                </label>
              </div>
              {mirrorBlocked && <small className="proc-note">No mirror: the part has open cut lines.</small>}
            </div>
          </div>
        </div>

        {error && <p className="proc-error" role="alert">Not saved: {error}</p>}

        <footer className="dlg-foot">
          <span className="proc-missing">{missing.length > 0 && `Enter ${missing.join(", ")} to save.`}</span>
          <button type="button" className="btn btn-plain" onClick={onCancel} disabled={saving}>Cancel</button>
          <button type="submit" className={`btn ${exists.state === "exists" ? "btn-replace" : "btn-save"}`} disabled={!canSave}>
            {saving ? "Saving…" : exists.state === "exists" ? "Replace" : "Save"}
          </button>
        </footer>
      </form>
    </div>
  );
}

function LockedField({ label, hint, value, editing, onEdit, onChange }: {
  label: string; hint: string; value: string; editing: boolean; onEdit: () => void; onChange: (v: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);
  return (
    <label className={`proc-group proc-locked${editing ? " is-editing" : ""}`}>
      <span className="proc-label">{label}</span>
      <span className="proc-input-wrap">
        <input ref={ref} className="field" value={value} placeholder={hint} readOnly={!editing}
          onChange={(e) => onChange(e.target.value)} onDoubleClick={onEdit}
          title={editing ? undefined : `${hint}. Click the pencil to change.`} />
        <button type="button" className="proc-edit" onClick={onEdit} aria-label={`Edit ${label.toLowerCase()}`} aria-pressed={editing}
          title={`Edit ${label.toLowerCase()}`}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13.5 6.5 4 4" />
          </svg>
        </button>
      </span>
    </label>
  );
}

/** The part with its processed colours: cutting green, tracing purple, open cut dark blue. */
function Preview({ drawing }: { drawing: Drawing }) {
  // Material is filled: closed cutting contours, even-odd so windows and holes stay open.
  const { box, fill } = useMemo(() => {
    const report = checkGeometry(drawing.entities);
    const byId = new Map(drawing.entities.map((e) => [e.id, e]));
    const fill = report.contours.filter((c) => c.closed)
      .map((c) => loopPoints(c, byId).map((p, i) => `${i ? "L" : "M"}${+p.x.toFixed(3)} ${+p.y.toFixed(3)}`).join("") + "Z")
      .join(" ");
    return { box: report.box, fill };
  }, [drawing]);
  const w = box.maxX - box.minX, h = box.maxY - box.minY, pad = Math.max(w, h) * 0.06 + 1;
  return (
    <svg className="is-processed proc-svg" viewBox={`${box.minX - pad} ${-box.maxY - pad} ${w + 2 * pad} ${h + 2 * pad}`}
      preserveAspectRatio="xMidYMid meet" aria-label={`Part ${drawing.fileName}`}>
      <g transform="scale(1 -1)">
        {fill && <path className="proc-fill" d={fill} fillRule="evenodd" />}
        {drawing.entities.map((e) => (
          <path key={e.id} d={pathOf(e)} vectorEffect="non-scaling-stroke" className={`ent role-${roleOf(e)}`} />
        ))}
      </g>
    </svg>
  );
}
