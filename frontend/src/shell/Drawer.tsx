import { ServerLoad } from "./ServerLoad";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, materialKey, type PartFacets, type SavedRemnant } from "../api/api";
import { DEFAULT_SORT, type DateMode, type JobFilter, type PartFilter, type PartSummary, type SortOrder } from "../api/types";
import { SortControl, loadSort, saveSort } from "../components/SortControl";
import { DateLine, PanelHead, SizeLine } from "../components/FilterFields";
import { IconHome, IconImport, IconLibrary, IconNewJob, IconRemnant, IconSearch } from "../components/Icons";
import { RemnantsPanel, type RemnantFilter } from "./RemnantsPanel";
import { PartThumb, sizeLabel } from "../components/PartThumb";
import { JobsPanel } from "./JobsPanel";
import type { MachineList } from "../job/machine";
import { PartHistoryDialog } from "../components/PartHistoryDialog";
import { PartPropertiesDialog } from "../components/PartPropertiesDialog";
import { useListSelection } from "../components/useListSelection";
import { Combobox } from "../components/Combobox";
import { usePickLists } from "../components/pickLists";
import { editPart, exportPart } from "../import/partFile";
import { ImportPanel, type ImportPanelProps } from "./ImportPanel";
import { ExtractPanel, type ExtractPanelProps } from "./ExtractPanel";

export type DrawerMode = "parts" | "jobs" | "remnants" | "import" | "extract";

/** MIME type used when dragging parts from the drawer into a job. */
export const PARTS_MIME = "application/x-gnezdo-parts";

interface Props {
  mode: DrawerMode | null;                 // null = closed (only the rail shows)
  onMode: (m: DrawerMode | null) => void;
  targetJob: { id: string; title: string } | null; // job tab that is open now
  onAddToJob: (parts: PartSummary[]) => void;
  onJobSearch: (filter: JobFilter) => void;   // results open on the main screen
  onRemnantSearch: (filter: RemnantFilter) => void;   // results open on the main screen
  /** the remnant picked on the Remnants screen; a remnant imported / changed in the panel */
  remnant?: { selected: SavedRemnant | null; onChanged: (name: string) => void };
  /** the machines, for the Machine filter of Job search */
  machines?: MachineList;
  homeActive: boolean;
  onHome: () => void;
  /** New job: its pop-up (name and machine) */
  onNewJob: () => void;
  importPanel: ImportPanelProps;
  extractPanel: ExtractPanelProps;
  /** Show the number of pieces from the file name (import rule). */
  showQty: boolean;
}

// Left side: a rail that opens a docked panel for finding imported parts
// (to drag into a job), searching jobs, or importing new drawings.
export function Drawer({ mode, onMode, targetJob, onAddToJob, onJobSearch, onRemnantSearch, remnant, homeActive, onHome, onNewJob, importPanel, extractPanel, showQty, machines }: Props) {
  const waiting = importPanel.items.filter((i) => !i.processed).length;
  const toggle = (m: DrawerMode) => onMode(mode === m ? null : m);
  return (
    <aside className={`drawer${mode ? " is-open" : ""}`}>
      <div className="drawer-rail" role="tablist" aria-label="Side panels">
        <button className={`rail-btn${homeActive ? " is-on" : ""}`} onClick={onHome} title="Home"
          aria-current={homeActive ? "page" : undefined}>
          <IconHome /><span>Home</span>
        </button>
        <button role="tab" aria-selected={mode === "import"} className={`rail-btn${mode === "import" ? " is-on" : ""}`}
          onClick={() => toggle("import")} title="Import 2D: DXF, DWG or SVG drawings (and flat patterns from the 3D Extractor) into the parts library">
          <IconImport /><span>Import 2D</span>
          {waiting > 0 && <span className="rail-count" title={`${waiting} waiting to be processed`}>{waiting}</span>}
        </button>
        <button role="tab" aria-selected={mode === "extract"} className={`rail-btn${mode === "extract" ? " is-on" : ""}`}
          onClick={() => toggle("extract")} title="3D Extractor: flat patterns out of STEP parts and assemblies, sent to Import 2D">
          <Icon3d /><span>3D Extractor</span>
          {extractPanel.parts.length > 0 && <span className="rail-count is-3d">{extractPanel.parts.filter((x) => x.kind !== "hardware").length}</span>}
        </button>
        <button className="rail-btn" onClick={onNewJob} title="New job">
          <IconNewJob /><span>New job</span>
        </button>
        <button role="tab" aria-selected={mode === "parts"} className={`rail-btn${mode === "parts" ? " is-on" : ""}`}
          onClick={() => toggle("parts")} title="Imported parts">
          <IconLibrary /><span>Parts</span>
        </button>
        <button role="tab" aria-selected={mode === "jobs"} className={`rail-btn${mode === "jobs" ? " is-on" : ""}`}
          onClick={() => toggle("jobs")} title="Job search">
          <IconSearch /><span>Jobs</span>
        </button>
        <button role="tab" aria-selected={mode === "remnants"} className={`rail-btn${mode === "remnants" ? " is-on" : ""}`}
          onClick={() => toggle("remnants")} title="Remnant search">
          <IconRemnant /><span>Remnants</span>
        </button>
        <ServerLoad />
      </div>
      {mode && (
        <div className="drawer-panel">
          {mode === "parts" && <PartsPanel targetJob={targetJob} onAddToJob={onAddToJob} showQty={showQty} onClose={() => onMode(null)} />}
          {mode === "jobs" && <JobsPanel onSearch={onJobSearch} onClose={() => onMode(null)} machines={machines} />}
          {mode === "remnants" && <RemnantsPanel onSearch={onRemnantSearch} onClose={() => onMode(null)} selected={remnant?.selected ?? null} onChanged={remnant?.onChanged ?? (() => {})} />}
          {mode === "import" && <ImportPanel {...importPanel} onClose={() => onMode(null)} />}
          {mode === "extract" && <ExtractPanel {...extractPanel} onClose={() => onMode(null)} />}
        </div>
      )}
    </aside>
  );
}

/** A sheet metal part in 3D with an arrow out of it (3D Extractor). */
const Icon3d = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
    <path d="M2.5 14.5l6-3 9.5 3.2-6 3.1z" /><path d="M8.5 11.5V5.5l9.5 3.2v6" /><path d="M14 21h7.5M19 18.5l2.5 2.5-2.5 2.5" />
  </svg>
);

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

function PartsPanel({ targetJob, onAddToJob, showQty, onClose }: Pick<Props, "targetJob" | "onAddToJob" | "showQty"> & { onClose: () => void }) {
  const [d, setD] = useState<Draft>(EMPTY_DRAFT);
  const [applied, setApplied] = useState<PartFilter>(toFilter(EMPTY_DRAFT));
  const [more, setMore] = useState(false);   // extended filters open
  const [facets, setFacets] = useState<PartFacets>({ materials: [], thicknesses: [] });
  const [parts, setParts] = useState<PartSummary[] | null>(null);
  const [history, setHistory] = useState<PartSummary | null>(null);   // part whose versions are shown
  const [editing, setEditing] = useState<PartSummary | null>(null);   // part whose properties are shown
  const [menu, setMenu] = useState<{ x: number; y: number; part: PartSummary } | null>(null);
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
  const projectList = usePickLists("");

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
  // click: this part only; Ctrl+click: add / remove one; Shift+click: a range (as in Explorer)
  const { selected, setSelected, click } = useListSelection(shown.map((p) => p.id));
  const chosen = shown.filter((p) => selected.has(p.id));

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
        {/* the saved projects, narrowed as you type; any text still searches as typed */}
        <Combobox value={d.project} onChange={(project) => set({ project })} options={projectList.projects}
          placeholder="Project" ariaLabel="Project" newHint="searched as typed" />

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
            // click selects the part for "Add to job" (Ctrl / Shift: more); right click opens a menu with Properties
            onClick: (e: React.MouseEvent) => click(p.id, e),
            onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, part: p }); },
            "aria-pressed": on,
            title: `${p.name}\n${p.project}, ${materialKey(p.material, p.thicknessMm)}\nClick: select · Ctrl+click: add or remove · Shift+click: a range · right click: properties · drag into a job`,
          };
          return (
            <li key={p.id}>
              {view === "grid" ? (
                <button className={`part-card${on ? " is-selected" : ""}`} {...common}>
                  <PartThumb part={p} size={58} />
                  <span className="part-name">{p.name}</span>
                  <span className="part-meta">{sizeLabel(p)}{showQty && <b>{p.qty}×</b>}</span>
                </button>
              ) : (
                <button className={`part-row${on ? " is-selected" : ""}`} {...common}>
                  <PartThumb part={p} size={34} />
                  <span className="pr-name">{p.name}</span>
                  <span className="pr-qty">{showQty && `${p.qty}×`}</span>
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

      {menu && (
        <PartMenu x={menu.x} y={menu.y} part={menu.part} onClose={() => setMenu(null)}
          onProperties={() => setEditing(menu.part)} onVersions={() => setHistory(menu.part)} />
      )}
      {editing && (
        <PartPropertiesDialog part={editing} onClose={() => setEditing(null)}
          onSaved={(now) => setParts((list) => list?.map((x) => (x.id === now.id ? now : x)) ?? list)}
          onDeleted={(id) => {
            setParts((list) => list?.filter((x) => x.id !== id) ?? list);
            setSelected((s) => { const n = new Set(s); n.delete(id); return n; });
          }}
          onVersions={(p) => { setEditing(null); setHistory(p); }} />
      )}
      {history && (
        <PartHistoryDialog part={history} onClose={() => setHistory(null)}
          onRestored={(now) => { setParts((list) => list?.map((x) => (x.id === now.id ? now : x)) ?? list); setHistory(now); }} />
      )}

      <div className="drawer-foot">
        {targetJob ? (
          <button className="btn btn-primary" disabled={!chosen.length} onClick={() => { onAddToJob(chosen); setSelected(new Set()); }}>
            Add {chosen.length || ""} to {targetJob.title}
          </button>
        ) : (
          <p className="hint">Right click a part for its properties. Open a job, then drag parts into it.</p>
        )}
      </div>
    </>
  );
}


/** Right-click menu on a part in the search results. */
function PartMenu({ x, y, part, onClose, onProperties, onVersions }: {
  x: number; y: number; part: PartSummary; onClose: () => void; onProperties: () => void; onVersions: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const close = (e: Event) => { if (!(e.target instanceof Node && ref.current?.contains(e.target))) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("mousedown", close);
    window.addEventListener("wheel", onClose, { passive: true });
    window.addEventListener("resize", onClose);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("wheel", onClose);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);
  const pick = (f: () => void) => () => { onClose(); f(); };
  // Export with the part's dimensions and aid lines (kept for next time)
  const [withAids, setWithAidsState] = useState(() => { try { return localStorage.getItem("gnezdo.exportAids") === "1"; } catch { return false; } });
  const setWithAids = (v: boolean) => { setWithAidsState(v); try { localStorage.setItem("gnezdo.exportAids", v ? "1" : "0"); } catch { /* this session */ } };
  // keep the menu on screen
  const left = Math.min(x, window.innerWidth - 240), top = Math.min(y, window.innerHeight - 250);
  return (
    <div ref={ref} className="ctx-menu" role="menu" style={{ left, top }} onContextMenu={(e) => e.preventDefault()}>
      <div className="ctx-title">{part.name}</div>
      <button role="menuitem" onClick={pick(onProperties)}>Properties…</button>
      <button role="menuitem" onClick={pick(onVersions)} disabled={part.revision < 2}
        title={part.revision < 2 ? "Only one version so far" : undefined}>Versions{part.revision > 1 ? ` (${part.revision})` : ""}…</button>
      <div className="ctx-sep" role="separator" />
      <button role="menuitem" onClick={pick(() => editPart(part))} title="Open the part on the importer canvas to change it or measure it">Edit</button>
      <button role="menuitem" onClick={pick(() => void exportPart(part, "dxf", withAids))}>Export DXF</button>
      <button role="menuitem" onClick={pick(() => void exportPart(part, "svg", withAids))}>Export SVG</button>
      <label className="ctx-check" title="Export the part's dimensions and aid lines too (layers DIM and AID); they are never cut">
        <input type="checkbox" checked={withAids} onChange={(e) => setWithAids(e.target.checked)} /> With dimensions and aid lines
      </label>
    </div>
  );
}
