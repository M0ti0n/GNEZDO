import { useEffect, useMemo, useState } from "react";
import { api, materialKey, type PartFacets } from "../api/api";
import { DEFAULT_SORT, type DateMode, type JobFilter, type PartFilter, type PartSummary, type SortOrder } from "../api/types";
import { SortControl, loadSort, saveSort } from "../components/SortControl";
import { DateLine, PanelHead, SizeLine } from "../components/FilterFields";
import { IconHome, IconImport, IconLibrary, IconSearch } from "../components/Icons";
import { PartThumb, sizeLabel } from "../components/PartThumb";
import { JobsPanel } from "./JobsPanel";
import { ImportPanel, type ImportPanelProps } from "./ImportPanel";

export type DrawerMode = "parts" | "jobs" | "import";

/** MIME type used when dragging parts from the drawer into a job. */
export const PARTS_MIME = "application/x-gnezdo-parts";

interface Props {
  mode: DrawerMode | null;                 // null = closed (only the rail shows)
  onMode: (m: DrawerMode | null) => void;
  targetJob: { id: string; title: string } | null; // job tab that is open now
  onAddToJob: (parts: PartSummary[]) => void;
  onJobSearch: (filter: JobFilter) => void;   // results open on the main screen
  homeActive: boolean;
  onHome: () => void;
  importPanel: ImportPanelProps;
}

// Left side: a rail that opens a docked panel for finding imported parts
// (to drag into a job), searching jobs, or importing new drawings.
export function Drawer({ mode, onMode, targetJob, onAddToJob, onJobSearch, homeActive, onHome, importPanel }: Props) {
  const toggle = (m: DrawerMode) => onMode(mode === m ? null : m);
  return (
    <aside className={`drawer${mode ? " is-open" : ""}`}>
      <div className="drawer-rail" role="tablist" aria-label="Side panels">
        <button className={`rail-btn${homeActive ? " is-on" : ""}`} onClick={onHome} title="Home"
          aria-current={homeActive ? "page" : undefined}>
          <IconHome /><span>Home</span>
        </button>
        <button role="tab" aria-selected={mode === "parts"} className={`rail-btn${mode === "parts" ? " is-on" : ""}`}
          onClick={() => toggle("parts")} title="Imported parts">
          <IconLibrary /><span>Parts</span>
        </button>
        <button role="tab" aria-selected={mode === "jobs"} className={`rail-btn${mode === "jobs" ? " is-on" : ""}`}
          onClick={() => toggle("jobs")} title="Job search">
          <IconSearch /><span>Jobs</span>
        </button>
        <button role="tab" aria-selected={mode === "import"} className={`rail-btn${mode === "import" ? " is-on" : ""}`}
          onClick={() => toggle("import")} title="Import DXF and DWG files">
          <IconImport /><span>Import</span>
          {importPanel.items.length > 0 && <span className="rail-count">{importPanel.items.length}</span>}
        </button>
      </div>
      {mode && (
        <div className="drawer-panel">
          {mode === "parts" && <PartsPanel targetJob={targetJob} onAddToJob={onAddToJob} onClose={() => onMode(null)} />}
          {mode === "jobs" && <JobsPanel onSearch={onJobSearch} onClose={() => onMode(null)} />}
          {mode === "import" && <ImportPanel {...importPanel} onClose={() => onMode(null)} />}
        </div>
      )}
    </aside>
  );
}

/* ------------------------------------------------------------------ */

/** What is typed in the filter panel. Date and size filters only count when ticked. */
interface Draft {
  name: string; material: string; thicknessMm: string; project: string; description: string;
  createdOn: boolean; created: { mode: DateMode; date: string };
  modifiedOn: boolean; modified: { mode: DateMode; date: string };
  xOn: boolean; xMin: string; xMax: string;
  yOn: boolean; yMin: string; yMax: string;
  engraved: boolean;
}

type PartView = "grid" | "list";
const VIEW_KEY = "gnezdo.partView";
const loadView = (): PartView => {
  try { return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid"; } catch { return "grid"; }
};

const EMPTY_DRAFT: Draft = {
  name: "", material: "", thicknessMm: "", project: "", description: "",
  createdOn: false, created: { mode: "on", date: "" },
  modifiedOn: false, modified: { mode: "on", date: "" },
  xOn: false, xMin: "", xMax: "",
  yOn: false, yMin: "", yMax: "",
  engraved: false,
};

const numOrUndef = (v: string) => (v.trim() === "" ? undefined : Number(v));
const textOrUndef = (v: string) => (v.trim() === "" ? undefined : v.trim());

/** Turn the panel contents into the search request. Empty text fields are ignored. */
function toFilter(d: Draft): PartFilter {
  return {
    name: textOrUndef(d.name),
    material: textOrUndef(d.material),
    thicknessMm: numOrUndef(d.thicknessMm),
    project: textOrUndef(d.project),
    description: textOrUndef(d.description),
    created: d.createdOn && d.created.date ? d.created : undefined,
    modified: d.modifiedOn && d.modified.date ? d.modified : undefined,
    xMin: d.xOn ? numOrUndef(d.xMin) : undefined,
    xMax: d.xOn ? numOrUndef(d.xMax) : undefined,
    yMin: d.yOn ? numOrUndef(d.yMin) : undefined,
    yMax: d.yOn ? numOrUndef(d.yMax) : undefined,
    engraved: d.engraved || undefined,
  };
}

const sameFilter = (a: PartFilter, b: PartFilter) => JSON.stringify(a) === JSON.stringify(b);

function PartsPanel({ targetJob, onAddToJob, onClose }: Pick<Props, "targetJob" | "onAddToJob"> & { onClose: () => void }) {
  const [d, setD] = useState<Draft>(EMPTY_DRAFT);
  const [applied, setApplied] = useState<PartFilter>(toFilter(EMPTY_DRAFT));
  const [more, setMore] = useState(false);   // extended filters open
  const [facets, setFacets] = useState<PartFacets>({ materials: [], thicknesses: [] });
  const [parts, setParts] = useState<PartSummary[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [run, setRun] = useState(0);          // bumps on every Search press
  const [view, setView] = useState<PartView>(loadView);
  const [sort, setSort] = useState<SortOrder>(() => loadSort("parts", DEFAULT_SORT));
  const pickSort = (s: SortOrder) => { setSort(s); saveSort("parts", s); };
  const pickView = (v: PartView) => { setView(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* private mode */ } };

  useEffect(() => { api.partFacets().then(setFacets); }, []);
  useEffect(() => {
    let alive = true;
    setParts(null);
    api.searchParts(applied, sort).then((p) => alive && setParts(p));
    return () => { alive = false; };
  }, [applied, run, sort]);

  const search = () => { setApplied(toFilter(d)); setRun((n) => n + 1); setSelected(new Set()); };
  const reset = () => { setD(EMPTY_DRAFT); setApplied(toFilter(EMPTY_DRAFT)); setRun((n) => n + 1); setSelected(new Set()); };
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));

  // Thickness list follows the chosen material.
  const thicknesses = useMemo(
    () => [...new Set(facets.thicknesses
      .filter((t) => !d.material || t.material === d.material)
      .map((t) => t.thicknessMm))].sort((a, b) => a - b),
    [facets, d.material]);

  const draftFilter = toFilter(d);
  const dirty = !sameFilter(draftFilter, applied);
  const active = Object.values(applied).filter((v) => v !== undefined).length;
  // filters hidden under "More" that are switched on, so the button can say so
  const hiddenActive = [d.description.trim() !== "", d.xOn, d.yOn, d.engraved].filter(Boolean).length;
  const shown = parts ?? [];
  const chosen = shown.filter((p) => selected.has(p.id));
  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n;
  });

  const onDragStart = (e: React.DragEvent, p: PartSummary) => {
    const dragged = selected.has(p.id) ? chosen : [p];
    e.dataTransfer.setData(PARTS_MIME, JSON.stringify(dragged));
    e.dataTransfer.setData("text/plain", dragged.map((d) => d.name).join("\n"));
    e.dataTransfer.effectAllowed = "copy";
    const ghost = document.getElementById("drag-ghost");
    if (ghost) {
      ghost.textContent = dragged.length === 1 ? dragged[0].name : `${dragged.length} parts`;
      e.dataTransfer.setDragImage(ghost, 12, 12);
    }
  };

  return (
    <>
      <PanelHead title="Imported parts" onClose={onClose}>
        <button className={`btn btn-search${dirty ? " is-dirty" : ""}`} onClick={search} title="Search with these filters (Enter)">
          <IconSearch size={17} />Search
        </button>
      </PanelHead>

      <form className="filters" onSubmit={(e) => { e.preventDefault(); search(); }}>
        <input className="field" type="search" value={d.name} placeholder="Name"
          aria-label="Name" onChange={(e) => set({ name: e.target.value })} />
        <div className="filter-pair">
          <select className="field" value={d.material} aria-label="Material"
            onChange={(e) => set({ material: e.target.value, thicknessMm: "" })}>
            <option value="">Material</option>
            {facets.materials.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select className="field" value={d.thicknessMm} aria-label="Thickness"
            onChange={(e) => set({ thicknessMm: e.target.value })}>
            <option value="">Thickness</option>
            {thicknesses.map((t) => <option key={t} value={t}>{t} mm</option>)}
          </select>
        </div>
        <input className="field" type="search" value={d.project} placeholder="Project"
          aria-label="Project" onChange={(e) => set({ project: e.target.value })} />

        <DateLine label="Created" on={d.createdOn} value={d.created}
          onToggle={(v) => set({ createdOn: v })}
          onChange={(v) => set({ created: v, createdOn: v.date ? true : d.createdOn })} />
        <DateLine label="Modified" on={d.modifiedOn} value={d.modified}
          onToggle={(v) => set({ modifiedOn: v })}
          onChange={(v) => set({ modified: v, modifiedOn: v.date ? true : d.modifiedOn })} />

        <button type="button" className={`more-btn${more ? " is-open" : ""}`} aria-expanded={more} onClick={() => setMore((v) => !v)}
          title={more ? "Hide more filters" : "Description, size, engraved"}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d={more ? "M2 6.5 5 3.5 8 6.5" : "M2 3.5 5 6.5 8 3.5"} fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
          {more ? "Fewer filters" : "More filters"}{hiddenActive > 0 && <span className="badge">{hiddenActive}</span>}
        </button>

        {more && (
          <div className="more-filters">
            <input className="field" type="search" value={d.description} placeholder="Description"
              aria-label="Description" onChange={(e) => set({ description: e.target.value })} />
            <SizeLine label="Size X" on={d.xOn} min={d.xMin} max={d.xMax}
              onToggle={(v) => set({ xOn: v })}
              onChange={(min, max) => set({ xMin: min, xMax: max, xOn: min !== "" || max !== "" ? true : d.xOn })} />
            <SizeLine label="Size Y" on={d.yOn} min={d.yMin} max={d.yMax}
              onToggle={(v) => set({ yOn: v })}
              onChange={(min, max) => set({ yMin: min, yMax: max, yOn: min !== "" || max !== "" ? true : d.yOn })} />
            <label className="check-line">
              <input type="checkbox" checked={d.engraved} onChange={(e) => set({ engraved: e.target.checked })} />
              <span className="check-label">Engraved</span>
              <span className="check-note">only parts with engraving</span>
            </label>
          </div>
        )}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>

      <div className="result-bar">
        <span className="view-switch" role="radiogroup" aria-label="Show parts as">
          <button type="button" role="radio" aria-checked={view === "grid"} title="Grid"
            className={view === "grid" ? "is-on" : ""} onClick={() => pickView("grid")}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="5" height="5" /><rect x="9" y="2" width="5" height="5" /><rect x="2" y="9" width="5" height="5" /><rect x="9" y="9" width="5" height="5" /></svg>
          </button>
          <button type="button" role="radio" aria-checked={view === "list"} title="List"
            className={view === "list" ? "is-on" : ""} onClick={() => pickView("list")}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2.5" width="3" height="3" /><path d="M7 4h7" /><rect x="2" y="6.5" width="3" height="3" /><path d="M7 8h7" /><rect x="2" y="10.5" width="3" height="3" /><path d="M7 12h7" /></svg>
          </button>
        </span>
        <span className="result-count">
          {parts ? `${shown.length} parts` : "Searching…"}{chosen.length > 0 && `, ${chosen.length} selected`}
          {dirty && parts && <em className="stale"> · press Search</em>}
        </span>
        <span className="result-actions">
          {(active > 0 || dirty) && <button className="link" onClick={reset}>Reset filters</button>}
          <button className="link" onClick={() => setSelected(new Set(shown.map((p) => p.id)))} disabled={!shown.length}>Select all</button>
          {selected.size > 0 && <button className="link" onClick={() => setSelected(new Set())}>Clear</button>}
        </span>
      </div>

      <div className="sort-bar">
        <SortControl value={sort} onChange={pickSort} />
      </div>

      <ul className={view === "grid" ? "part-grid" : "part-list"}>
        {parts && shown.length === 0 && <li className="state">No parts match these filters.</li>}
        {shown.map((p) => {
          const on = selected.has(p.id);
          const common = {
            draggable: true,
            onDragStart: (e: React.DragEvent) => onDragStart(e, p),
            onDragEnd: (e: React.DragEvent) => { if (e.dataTransfer.dropEffect !== "none") setSelected(new Set()); },
            onClick: () => toggle(p.id),
            "aria-pressed": on,
            title: `${p.name}\n${p.project}, ${materialKey(p.material, p.thicknessMm)}\nDrag into a job`,
          };
          return (
            <li key={p.id}>
              {view === "grid" ? (
                <button className={`part-card${on ? " is-selected" : ""}`} {...common}>
                  <PartThumb part={p} size={58} />
                  <span className="part-name">{p.name}</span>
                  <span className="part-meta">{sizeLabel(p)}<b>{p.qty}×</b></span>
                </button>
              ) : (
                <button className={`part-row${on ? " is-selected" : ""}`} {...common}>
                  <PartThumb part={p} size={34} />
                  <span className="pr-name">{p.name}</span>
                  <span className="pr-qty">{p.qty}×</span>
                  <span className="pr-meta">
                    <span>{p.project}</span>
                    <span>{materialKey(p.material, p.thicknessMm)}</span>
                    <span>{sizeLabel(p)}</span>
                    {p.engraved && <span className="pr-tag">engraved</span>}
                  </span>
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <div className="drawer-foot">
        {targetJob ? (
          <button className="btn btn-primary" disabled={!chosen.length} onClick={() => { onAddToJob(chosen); setSelected(new Set()); }}>
            Add {chosen.length || ""} to {targetJob.title}
          </button>
        ) : (
          <p className="hint">Open a job, then drag parts into it.</p>
        )}
      </div>
    </>
  );
}
