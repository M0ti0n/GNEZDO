import { useRef, useState } from "react";
import { Combobox } from "../components/Combobox";
import { usePickLists } from "../components/pickLists";
import { PanelHead } from "../components/FilterFields";
import { IMPORT_TOOLS } from "../import/ImportTools";
import { HIDDEN } from "../import/dxf";
import { isDrawingFile, statusOf, type BatchProperties, type ImportItem, type Verdict } from "../import/batch";
import { ROTATIONS, type ImportRules, type Rotation } from "../import/rules";
import { FILLER_TIP } from "../import/filler";

type Mode = "bulk" | "single";

export interface ImportPanelProps {
  items: ImportItem[];
  properties: BatchProperties;
  rules: ImportRules;
  onProperties: (p: BatchProperties) => void;
  /** Files dropped or chosen; single import opens the part straight away. */
  onFiles: (files: File[], openFirst: boolean) => void;
  onCheckLines: () => void;
  /** Saves the green parts; red ones stay in the list. */
  onProcessAll: () => void;
  busy: boolean;
  onOpen: (id: string) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onSamples: () => void;
  openId: string | null;      // part shown in the main area
  /** Properties section expanded (the Properties tool opens it). */
  propsOpen: boolean;
  onPropsOpen: (open: boolean) => void;
}

const ICON: Record<Verdict, string> = {
  reading: "…", failed: "×", dwg: "–", unchecked: "", attention: "!", duplicate: "!", ok: "✓", processed: "✓",
};
const TITLE: Record<Verdict, string> = {
  reading: "Reading the file",
  failed: "Could not be read",
  dwg: "DWG files are read on the server (not built yet)",
  unchecked: "Not checked yet: press Check lines",
  attention: "Needs attention: mark open lines as tracing or open cut",
  duplicate: "Already in the database (same project and name): open it and press Process to replace it",
  ok: "Only closed contours: ready to process",
  processed: "Processed",
};

/** One line for the collapsed Properties: "N26-0246 · S355 6 mm · 90°, 45° · mirror · filler". */
const summary = (p: BatchProperties) => [
  p.project.trim(),
  [p.material.trim(), p.thicknessMm && `${p.thicknessMm} mm`].filter(Boolean).join(" "),
  p.rotations.length ? p.rotations.map((r) => `${r}°`).join(", ") : "no rotation",
  p.mirror ? "mirror" : "",
  p.filler ? "filler" : "",
].filter(Boolean).join(" · ");

const toggle = (list: Rotation[], r: Rotation, on: boolean) =>
  on ? ROTATIONS.filter((x) => x === r || list.includes(x)) : list.filter((x) => x !== r);

const icon = (id: string) => IMPORT_TOOLS.find((t) => t.id === id)?.icon;

export function ImportPanel(p: ImportPanelProps & { onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("bulk");
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const lists = usePickLists(p.properties.material);
  // a project typed but not saved: parts can only be saved under saved projects
  const projectMissing = lists.projectsLoaded && !lists.projectKnown(p.properties.project);
  const [projectError, setProjectError] = useState<string | null>(null);

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
  const propsSet = p.properties.material.trim() !== "" && Number(p.properties.thicknessMm) > 0;
  const duplicates = count("duplicate");
  const toCheck = attention + duplicates;
  const canProcess = toProcess > 0 && !p.busy;
  const processHint = !ready.length ? ""
    : toProcess === 0 && unchecked ? "Press Check lines first"
    : toProcess === 0 ? (toCheck ? "Double-click the red parts to open them and process them one by one" : "")
    : !propsSet ? "Set material and thickness, then Process all"
    : projectMissing ? "Save the project first, then Process all"
    : toCheck ? `Process all saves the ${toProcess} green; the red stay in the list` : "";
  const [needProps, setNeedProps] = useState(false);
  const processAll = () => {
    if (!propsSet || projectMissing) {
      setNeedProps(true);
      p.onPropsOpen(true);
      const field = projectMissing ? "Project" : p.properties.material.trim() ? "Thickness in mm" : "Material";
      setTimeout(() => document.querySelector<HTMLInputElement>(`.imp-props input[aria-label="${field}"]`)?.focus(), 0);
      return;
    }
    setNeedProps(false);
    p.onProcessAll();
  };

  const setProp = (patch: Partial<BatchProperties>) => p.onProperties({ ...p.properties, ...patch });

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

        <section className={`imp-props${p.propsOpen ? " is-open" : ""}`} aria-label="Properties">
          <button type="button" className="imp-props-head" aria-expanded={p.propsOpen} onClick={() => p.onPropsOpen(!p.propsOpen)}
            title={p.propsOpen ? "Collapse to make room for the list" : "Show the properties"}>
            <span className="imp-props-icon">{icon("properties")}</span>
            <span className="imp-props-title">Properties</span>
            {!p.propsOpen && <span className="imp-props-sum">{summary(p.properties) || "not set"}</span>}
            <svg className="imp-props-caret" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>

          {p.propsOpen && (
            <div className="imp-props-body">
              <Combobox className={needProps && projectMissing ? "is-required" : undefined}
                value={p.properties.project} onChange={(project) => setProp({ project })}
                options={lists.projects} placeholder="Project" ariaLabel="Project" newHint="a new project"
                onCreate={async (code) => { await lists.createProject(code); setProp({ project: code }); }} createLabel="Save new project" />
              {projectMissing && (
                <p className="imp-props-warn">
                  Project {p.properties.project.trim()} is not saved yet.{" "}
                  <button type="button" className="link" onClick={() => lists.createProject(p.properties.project.trim()).then(
                    () => { setNeedProps(false); setProjectError(null); }, (e: Error) => setProjectError(e.message))}>Save project</button>
                  {projectError && <span className="t-bad"> {projectError}</span>}
                </p>
              )}
              <input className="field" value={p.properties.description} placeholder="Description (optional)" aria-label="Description"
                onChange={(e) => setProp({ description: e.target.value })} />
              <div className="filter-pair">
                <Combobox className={needProps && !p.properties.material.trim() ? "is-required" : undefined}
                  value={p.properties.material}
                  // a new material empties the thickness, so both are always chosen together
                  onChange={(material) => setProp({ material, thicknessMm: material === p.properties.material ? p.properties.thicknessMm : "" })}
                  options={lists.materials} placeholder="Material" ariaLabel="Material" newHint="a new material" />
                <Combobox className={needProps && p.properties.thicknessMm === "" ? "is-required" : undefined}
                  value={p.properties.thicknessMm} onChange={(t) => setProp({ thicknessMm: t.replace(",", ".").replace(/[^\d.]/g, "") })}
                  options={lists.thicknesses} placeholder="Thickness" ariaLabel="Thickness in mm" suffix="mm" numeric newHint="a new thickness" />
              </div>
              {p.properties.material.trim() !== "" && p.properties.thicknessMm === "" && (
                <p className="imp-props-warn">Choose the thickness for {p.properties.material.trim()}.</p>
              )}

              <div className="imp-rules" role="group" aria-label="Nesting rules">
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
                  <label className="chk chk-filler" title={FILLER_TIP}>
                    <input type="checkbox" checked={p.properties.filler} onChange={(e) => setProp({ filler: e.target.checked })} />
                    Filler
                  </label>
                  {p.properties.mirror && p.rules.mirrorWithoutOpenCut && <span className="imp-rules-note">no mirror with open cut</span>}
                </div>
              </div>
              <p className="imp-props-foot">Used for every part in the list. Kept for the next import; defaults in Rules → Import rules.</p>
            </div>
          )}
        </section>
      </div>

      <div className="imp-actions">
        <button className="btn imp-btn" onClick={p.onCheckLines} disabled={!ready.length}
          title="Check every part: closed contours turn green, parts with open lines turn red">
          <span className="imp-btn-icon">{icon("checkLines")}</span>Check lines
        </button>
        <button className="btn imp-btn imp-btn-go" onClick={processAll} disabled={!canProcess}
          title={processHint || `Save the ${toProcess} green ${toProcess === 1 ? "part" : "parts"} to the database`}>
          <span className="imp-btn-icon">{icon("process")}</span>{p.busy ? "Saving…" : "Process all"}
          {toProcess > 0 && !p.busy && <span className="imp-btn-count">{toProcess}</span>}
        </button>
      </div>
      {(p.items.length > 0) && (
        <div className="result-bar">
          <span className="result-count">
            {p.items.length} {p.items.length === 1 ? "file" : "files"}
            {count("ok", "processed") > 0 && <> · <span className="t-ok">{count("ok", "processed")} ready</span></>}
            {toCheck > 0 && <> · <span className="t-bad">{toCheck} to check</span></>}
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
            st.verdict === "duplicate" && "already in the database: double-click, then process to replace",
            st.splines > 0 && `${st.splines} ${st.splines === 1 ? "spline" : "splines"}`,
            item.declaredUnits && `file says ${item.declaredUnits}, read as mm`,
            item.ignored?.[HIDDEN] && `${item.ignored[HIDDEN]} on hidden layers left out`,
            item.error,
          ].filter(Boolean) as string[];
          return (
            <li key={item.id} className={`imp-row v-${st.verdict}${p.openId === item.id ? " is-open" : ""}`}>
              <button className="imp-main" disabled={item.state !== "ready"}
                // double click opens the part (a stray click does not open tabs); Enter does the same from the keyboard
                onDoubleClick={() => p.onOpen(item.id)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); p.onOpen(item.id); } }}
                title={item.state === "ready" ? `${TITLE[st.verdict]} · double-click to open` : TITLE[st.verdict]}>
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
