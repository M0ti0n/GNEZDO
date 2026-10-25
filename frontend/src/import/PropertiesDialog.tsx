import { useEffect, useMemo, useState } from "react";
import { Combobox } from "../components/Combobox";
import { usePickLists } from "../components/pickLists";
import type { PartProps } from "./batch";
import { checkGeometry, type Drawing } from "./geometry";
import { IMPORT_TOOLS } from "./ImportTools";
import { Preview } from "./ProcessDialog";
import { ROTATIONS } from "./rules";

interface Props {
  drawing: Drawing;
  initial: PartProps;
  /** The part has its own properties already (otherwise it uses the list's). */
  own: boolean;
  /** Mirror is not allowed for this part (open cut lines, see Rules). */
  mirrorBlocked: boolean;
  onCancel: () => void;
  onApply: (p: PartProps) => void;
  /** Back to the list's properties. */
  onReset: () => void;
}

// Properties tool: project, description, material, thickness, rotations and mirror of one part.
// What is applied here also becomes the starting point for the next parts.
export function PropertiesDialog({ drawing, initial, own, mirrorBlocked, onCancel, onApply, onReset }: Props) {
  const [v, setV] = useState<PartProps>(initial);
  const set = (patch: Partial<PartProps>) => setV((x) => ({ ...x, ...patch }));
  const lists = usePickLists(v.material);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const size = useMemo(() => {
    const r = checkGeometry(drawing.entities);
    const b = r.contours.find((c) => c.outer)?.box ?? r.box;
    return `${Math.round(b.maxX - b.minX)} × ${Math.round(b.maxY - b.minY)} mm`;
  }, [drawing]);

  const thicknessOk = v.thicknessMm === "" || Number(v.thicknessMm) > 0;

  return (
    <div className="dlg-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <form className="dlg proc props-dlg" role="dialog" aria-modal="true" aria-labelledby="props-title"
        onSubmit={(e) => { e.preventDefault(); if (thicknessOk) onApply({ ...v, mirror: v.mirror && !mirrorBlocked }); }}>
        <header className="dlg-head">
          <span className="dlg-icon dlg-icon-wide" aria-hidden="true">{IMPORT_TOOLS.find((t) => t.id === "properties")?.icon}</span>
          <div className="dlg-title">
            <h2 id="props-title">Properties</h2>
            <p>{drawing.fileName}</p>
          </div>
          <button type="button" className="icon-btn dlg-close" onClick={onCancel} aria-label="Close" title="Close (Esc)">×</button>
        </header>

        <div className="proc-body">
          <figure className="proc-image is-props">
            <div className="proc-frame"><Preview drawing={drawing} /></div>
            <div className="proc-size">{size}</div>
            <figcaption>
              <span className={`proc-status${own ? " is-own" : ""}`}>{own ? "Own properties" : "List properties"}</span>
              <small>{own ? "Set for this part with Properties." : "Same as Properties for all parts in the Import panel."}</small>
            </figcaption>
          </figure>

          <div className="proc-form">
            <div className="proc-group">
              <span className="proc-label">Project</span>
              <Combobox value={v.project} onChange={(project) => set({ project })} options={lists.projects}
                placeholder="e.g. N26-0246" ariaLabel="Project" newHint="a new project" />
            </div>
            <label className="proc-group">
              <span className="proc-label">Description</span>
              <input className="field" value={v.description} placeholder="Optional description of the part"
                onChange={(e) => set({ description: e.target.value })} />
            </label>
            <div className="proc-group">
              <span className="proc-label">Material and thickness</span>
              <div className="filter-pair">
                <Combobox value={v.material} onChange={(material) => set({ material })} options={lists.materials}
                  placeholder="Material" ariaLabel="Material" newHint="a new material" />
                <Combobox value={v.thicknessMm} onChange={(t) => set({ thicknessMm: t.replace(",", ".").replace(/[^\d.]/g, "") })}
                  options={lists.thicknesses} placeholder="Thickness" ariaLabel="Thickness in mm" suffix="mm" numeric newHint="a new thickness" />
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
                  <input type="checkbox" checked={v.mirror && !mirrorBlocked} disabled={mirrorBlocked} onChange={(e) => set({ mirror: e.target.checked })} />
                  Mirror
                </label>
              </div>
              <small className="proc-note">
                {mirrorBlocked ? "No mirror: the part has open cut lines. " : ""}Defaults come from Rules → Import rules.
              </small>
            </div>
          </div>
        </div>

        <footer className="dlg-foot">
          <span className="proc-missing">Applies to this part. The next parts start from these values.</span>
          {own && <button type="button" className="btn btn-plain" onClick={onReset} title="Use the Properties for all parts again">Use list properties</button>}
          <button type="button" className="btn btn-plain" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn btn-save" disabled={!thicknessOk}>Apply</button>
        </footer>
      </form>
    </div>
  );
}
