import { useEffect, useRef, useState } from "react";
import { api, type PartFacets } from "../api/api";
import { PanelHead } from "../components/FilterFields";
import { IMPORT_TOOLS } from "../import/ImportTools";
import { isDrawingFile, statusOf, type BatchProperties, type ImportItem, type Verdict } from "../import/batch";
import { ROTATIONS, type ImportRules, type Rotation } from "../import/rules";

type Mode = "bulk" | "single";

export interface ImportPanelProps {
  items: ImportItem[];
  properties: BatchProperties;
  rules: ImportRules;
  onProperties: (p: BatchProperties) => void;
  /** Files dropped or chosen; single import opens the part straight away. */
  onFiles: (files: File[], openFirst: boolean) => void;
  onCheckLines: () => void;
  onProcessAll: () => void;
  onOpen: (id: string) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onSamples: () => void;
  openId: string | null;      // part shown in the main area
}

const ICON: Record<Verdict, string> = {
  reading: "…", failed: "×", dwg: "–", unchecked: "", attention: "!", ok: "✓", processed: "✓",
};
const TITLE: Record<Verdict, string> = {
  reading: "Reading the file",
  failed: "Could not be read",
  dwg: "DWG files are read on the server (not built yet)",
  unchecked: "Not checked yet: press Check lines",
  attention: "Needs attention: mark open lines as tracing or open cut",
  ok: "Only closed contours: ready to process",
  processed: "Processed",
};

const toggle = (list: Rotation[], r: Rotation, on: boolean) =>
  on ? ROTATIONS.filter((x) => x === r || list.includes(x)) : list.filter((x) => x !== r);

const icon = (id: string) => IMPORT_TOOLS.find((t) => t.id === id)?.icon;

export function ImportPanel(p: ImportPanelProps & { onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("bulk");
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [facets, setFacets] = useState<PartFacets>({ materials: [], thicknesses: [] });
  useEffect(() => { api.partFacets().then(setFacets); }, []);

  const take = (list: FileList | null) => {
    const files = [...(list ?? [])].filter(isDrawingFile);
    if (!files.length) return;
    p.onFiles(mode === "single" ? files.slice(0, 1) : files, mode === "single");
  };

  const statuses = p.items.map((i) => ({ item: i, st: statusOf(i) }));
  const count = (...v: Verdict[]) => statuses.filter((s) => v.includes(s.st.verdict)).length;
  const ready = p.items.filter((i) => i.state === "ready");
  const unchecked = count("unchecked");
  const attention = count("attention");
  const toProcess = count("ok");
  const propsSet = p.properties.material.trim() !== "" && p.properties.thicknessMm !== "";
  const canProcess = toProcess > 0 && unchecked === 0 && attention === 0 && propsSet;
  const processHint = !ready.length ? "" : unchecked ? "Check lines first"
    : attention ? `${attention} ${attention === 1 ? "part needs" : "parts need"} attention`
    : !propsSet ? "Set material and thickness first"
    : toProcess ? "" : "All parts are processed";

  const setProp = (patch: Partial<BatchProperties>) => p.onProperties({ ...p.properties, ...patch });
  const thicknesses = [...new Set(facets.thicknesses
    .filter((t) => !p.properties.material || t.material === p.properties.material)
    .map((t) => t.thicknessMm))].sort((a, b) => a - b);

  return (
    <>
      <PanelHead title="Import" onClose={p.onClose} />

      <div className="imp-body">
        <div className="seg" role="tablist" aria-label="Import mode">
          {(["bulk", "single"] as const).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? "is-on" : ""} onClick={() => setMode(m)}>
              {m === "bulk" ? "Bulk import" : "Single import"}
            </button>
          ))}
        </div>

        <div
          className={`dropzone${over ? " is-over" : ""}`}
          role="button" tabIndex={0}
          onClick={() => input.current?.click()}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
          onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files); }}
        >
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5" /><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
          </svg>
          <b>{mode === "bulk" ? "Drop DXF or DWG files here" : "Drop one DXF or DWG file here"}</b>
          <span>or click to choose {mode === "bulk" ? "files" : "a file"}</span>
          <input ref={input} type="file" hidden multiple={mode === "bulk"} accept=".dxf,.dwg"
            onChange={(e) => { take(e.target.files); e.target.value = ""; }} />
        </div>
        {mode === "single" && <p className="imp-note">The part opens on the main screen as soon as it is read.</p>}

        <section className="imp-props" aria-label="Properties for all parts">
          <h3><span className="imp-props-icon">{icon("properties")}</span>Properties for all parts</h3>
          <div className="filter-pair">
            <input className="field" list="imp-materials" value={p.properties.material} placeholder="Material"
              aria-label="Material" onChange={(e) => setProp({ material: e.target.value })} />
            <datalist id="imp-materials">{facets.materials.map((m) => <option key={m} value={m} />)}</datalist>
            <input className="field" list="imp-thicknesses" type="number" min="0" step="0.1" value={p.properties.thicknessMm}
              placeholder="Thickness mm" aria-label="Thickness in mm" onChange={(e) => setProp({ thicknessMm: e.target.value })} />
            <datalist id="imp-thicknesses">{thicknesses.map((t) => <option key={t} value={t} />)}</datalist>
          </div>
          <input className="field" value={p.properties.project} placeholder="Project" aria-label="Project"
            onChange={(e) => setProp({ project: e.target.value })} />

          <div className="imp-rules" role="group" aria-label="Rules">
            <span className="imp-rules-title">Rules</span>
            <div className="imp-rules-row" role="group" aria-label="Rotations">
              <span className="imp-rules-label">Rotations</span>
              {ROTATIONS.map((r) => (
                <label key={r} className="chk">
                  <input type="checkbox" checked={p.properties.rotations.includes(r)}
                    onChange={(e) => setProp({ rotations: toggle(p.properties.rotations, r, e.target.checked) })} />
                  {r}°
                </label>
              ))}
            </div>
            <div className="imp-rules-row">
              <span className="imp-rules-label" />
              <label className="chk">
                <input type="checkbox" checked={p.properties.mirror} onChange={(e) => setProp({ mirror: e.target.checked })} />
                Mirror
              </label>
              {p.properties.mirror && p.rules.mirrorWithoutOpenCut && <span className="imp-rules-note">not for parts with open cut</span>}
            </div>
          </div>
        </section>
      </div>

      <div className="imp-actions">
        <button className="btn imp-btn" onClick={p.onCheckLines} disabled={!ready.length}
          title="Check every part: closed contours turn green, parts with open lines turn red">
          <span className="imp-btn-icon">{icon("checkLines")}</span>Check lines
        </button>
        <button className="btn imp-btn imp-btn-go" onClick={p.onProcessAll} disabled={!canProcess}
          title={processHint || `Process ${toProcess} ${toProcess === 1 ? "part" : "parts"}`}>
          <span className="imp-btn-icon">{icon("process")}</span>Process all
        </button>
      </div>
      {(p.items.length > 0) && (
        <div className="result-bar">
          <span className="result-count">
            {p.items.length} {p.items.length === 1 ? "file" : "files"}
            {count("ok", "processed") > 0 && <> · <span className="t-ok">{count("ok", "processed")} ready</span></>}
            {attention > 0 && <> · <span className="t-bad">{attention} to check</span></>}
          </span>
          <span className="result-actions"><button className="link" onClick={p.onClear}>Clear list</button></span>
        </div>
      )}
      {processHint && p.items.length > 0 && <p className="imp-hint">{processHint}</p>}

      <ul className="imp-list" aria-label="Imported files">
        {p.items.length === 0 && (
          <li className="imp-empty">
            No files yet.<br />
            <button className="link" onClick={p.onSamples}>Try it with two sample drawings</button>
          </li>
        )}
        {statuses.map(({ item, st }) => {
          const notes = [
            st.verdict === "attention" && st.problems.join(" · "),
            st.splines > 0 && `${st.splines} ${st.splines === 1 ? "spline" : "splines"}`,
            item.declaredUnits && `file says ${item.declaredUnits}, read as mm`,
            item.error,
          ].filter(Boolean) as string[];
          return (
            <li key={item.id} className={`imp-row v-${st.verdict}${p.openId === item.id ? " is-open" : ""}`}>
              <button className="imp-main" onClick={() => p.onOpen(item.id)} disabled={item.state !== "ready"}
                title={TITLE[st.verdict]}>
                <span className="imp-status" aria-label={TITLE[st.verdict]}>{ICON[st.verdict]}</span>
                <span className="imp-name">{item.name}</span>
                {notes.length > 0 && <span className="imp-notes">{notes.join(" · ")}</span>}
              </button>
              <button className="icon-btn imp-remove" onClick={() => p.onRemove(item.id)} aria-label={`Remove ${item.name}`} title="Remove from list">×</button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
