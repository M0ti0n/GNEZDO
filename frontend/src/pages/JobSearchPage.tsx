import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { api } from "../api/api";
import {
  DEFAULT_SORT, defaultDir,
  type DateFilter, type JobFilter, type JobPart, type JobStatus, type JobSummary, type PartSummary, type SortKey, type SortOrder,
} from "../api/types";
import { SortArrow, loadSort, saveSort } from "../components/SortControl";
import { SheetSvg } from "../components/NestView";
import { solutionsFromSaved, type NestedSheet } from "../job/nest";
import { machineOf, type MachineList } from "../job/machine";
import { fullDate, mm, when } from "../components/format";

const STATUS: Record<JobStatus, string> = { draft: "Draft", nested: "Nested", released: "Released", cut: "Cut" };
const MODE: Record<DateFilter["mode"], string> = { upTo: "up to", on: "on", from: "from" };

const fmtDay = (ymd: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(`${ymd}T12:00:00`));

/** Short description of each active filter, shown above the results. */
function describe(f: JobFilter, machines?: MachineList): string[] {
  const out: string[] = [];
  if (f.name) out.push(`Name: ${f.name}`);
  if (f.machine) {
    const id = f.machine.split(",").find(Boolean);
    out.push(`Machine: ${machines?.list.find((m) => m.id === id)?.name ?? id}`);
  }
  if (f.material || f.thicknessMm !== undefined)
    out.push(`Material: ${[f.material, f.thicknessMm !== undefined ? mm(f.thicknessMm) : ""].filter(Boolean).join(" ")}`);
  if (f.project) out.push(`Project: ${f.project}`);
  if (f.created) out.push(`Created ${MODE[f.created.mode]} ${fmtDay(f.created.date)}`);
  if (f.modified) out.push(`Modified ${MODE[f.modified.mode]} ${fmtDay(f.modified.date)}`);
  if (f.part) out.push(`Uses part: ${f.part}`);
  return out;
}

/* ---- columns of the result list -------------------------------------------------- */

type ColId = "status" | "machine" | "material" | "thickness" | "parts" | "sheets" | "projects" | "created" | "modified" | "modifiedBy";

interface Col {
  id: ColId;
  label: string;
  sort?: SortKey;
  num?: boolean;
  cell: (j: JobSummary, machines: MachineList) => ReactNode;
}

/**
 * Several values in one cell (materials, thicknesses, projects): small bubbles in at most two rows,
 * the column kept narrow; what doesn't fit is cut off and the whole list is in the tooltip.
 * One value: plain text, cut with "…" when too long.
 */
function Multi({ items, kind }: { items: string[]; kind: "mat" | "thk" | "proj" }) {
  if (!items.length) return <>–</>;
  const all = items.join(", ");
  if (items.length === 1) return <span className={`cell-clip clip-${kind}`} title={all}>{items[0]}</span>;
  return (
    <span className={`bubbles bubbles-2 clip-${kind}`} title={all}>
      {items.map((v) => <span key={v} className={`bubble bubble-sm bubble-${kind}`}>{v}</span>)}
    </span>
  );
}

const COLUMNS: Col[] = [
  { id: "status", label: "Status", cell: (j) => <span className={`status status-${j.status}`}>{STATUS[j.status]}</span> },
  // a job saved without a machine uses the default one
  { id: "machine", label: "Machine", cell: (j, m) => machineOf(m, j.machine || undefined).name },
  {
    id: "material", label: "Material", sort: "material",
    cell: (j) => <Multi items={j.materials} kind="mat" />,
  },
  {
    id: "thickness", label: "Thickness", sort: "thickness", num: true,
    cell: (j) => <Multi items={j.thicknesses.map((t) => mm(t))} kind="thk" />,
  },
  { id: "parts", label: "Parts", num: true, cell: (j) => j.partCount },
  { id: "sheets", label: "Sheets", num: true, cell: (j) => j.sheetCount || "–" },
  { id: "projects", label: "Projects", sort: "project", cell: (j) => <Multi items={j.projects} kind="proj" /> },
  { id: "created", label: "Created", sort: "created", cell: (j) => <span title={fullDate(j.createdAt)}>{when(j.createdAt)}</span> },
  { id: "modified", label: "Modified", sort: "modified", cell: (j) => <span title={fullDate(j.modifiedAt)}>{when(j.modifiedAt)}</span> },
  { id: "modifiedBy", label: "Modified by", cell: (j) => j.modifiedBy },
];

const DEFAULT_COLS: ColId[] = ["status", "machine", "material", "thickness", "parts", "projects", "modified"];
const COLS_KEY = "gnezdo.jobColumns";

function loadCols(): ColId[] {
  try {
    const v = JSON.parse(localStorage.getItem(COLS_KEY) ?? "null");
    if (Array.isArray(v)) return v.filter((c): c is ColId => COLUMNS.some((k) => k.id === c));
  } catch { /* no storage */ }
  return DEFAULT_COLS;
}

/* ---- page -------------------------------------------------------------------------- */

// Job search on the main screen: result list on the left, preview of the selected job
// on the right. Enter or double-click opens the job in its own tab.
/** A sheet's parts sent to a job: each part and how many pieces the sheet holds (times its cut number). */
export interface SheetParts { from: string; items: { part: PartSummary; qty: number }[] }

export function JobSearchPage({ filter, run, onOpenJob, onShowFilters, openJobs = [], onSendSheet, machines }: {
  /** the machines (names for the Machine column) */
  machines: MachineList;
  filter: JobFilter | null;          // null = no search yet
  run: number;                       // changes on every Search press
  onOpenJob: (job: JobSummary) => void;
  onShowFilters: () => void;
  /** jobs open in tabs: a selected sheet's parts can be sent to one of them */
  openJobs?: { id: string; title: string }[];
  onSendSheet?: (jobId: string, title: string, sheet: SheetParts) => void;
}) {
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortOrder>(() => loadSort("jobs", DEFAULT_SORT));
  const [cols, setCols] = useState<ColId[]>(loadCols);
  const listRef = useRef<HTMLDivElement>(null);

  const sortBy = (key: SortKey) => {
    const next: SortOrder = sort.key === key ? { key, dir: sort.dir === "asc" ? "desc" : "asc" } : { key, dir: defaultDir(key) };
    setSort(next);
    saveSort("jobs", next);
  };
  const toggleCol = (id: ColId) => {
    const next = cols.includes(id) ? cols.filter((c) => c !== id) : COLUMNS.map((c) => c.id).filter((c) => c === id || cols.includes(c));
    setCols(next);
    try { localStorage.setItem(COLS_KEY, JSON.stringify(next)); } catch { /* no storage */ }
  };
  const shownCols = COLUMNS.filter((c) => cols.includes(c.id));

  useEffect(() => {
    if (!filter) return;
    let alive = true;
    setJobs(null);
    setError(null);
    api.searchJobs(filter, sort).then(
      (j) => {
        if (!alive) return;
        setJobs(j);
        // keep the selection if the job is still in the list, else select the first one
        setSelectedId((cur) => (cur && j.some((x) => x.id === cur) ? cur : j[0]?.id ?? null));
      },
      (e: Error) => alive && setError(e.message),
    );
    return () => { alive = false; };
  }, [filter, run, sort]);

  const selected = useMemo(() => jobs?.find((j) => j.id === selectedId) ?? null, [jobs, selectedId]);

  // keep the selected row visible when moving with the keyboard
  useEffect(() => {
    listRef.current?.querySelector(".is-selected")?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  const onKey = (e: React.KeyboardEvent) => {
    if (!jobs?.length) return;
    const i = jobs.findIndex((j) => j.id === selectedId);
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedId(jobs[Math.min(jobs.length - 1, i + 1)].id); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSelectedId(jobs[Math.max(0, i - 1)].id); }
    else if (e.key === "Enter" && selected) { e.preventDefault(); onOpenJob(selected); }
  };

  if (!filter) {
    return (
      <div className="search-page job-browser-page">
        <header className="page-strip"><h1>Job search</h1></header>
        <div className="search-empty">
          <p className="state">Set filters in the Job search panel on the left and press Search.</p>
          <button className="btn btn-primary" onClick={onShowFilters}>Show job filters</button>
        </div>
      </div>
    );
  }

  const chips = describe(filter, machines);

  return (
    <div className="search-page job-browser-page">
      <header className="search-head page-strip">
        <h1>Job search</h1>
        <span className="job-sum">
          {error ? "" : jobs ? `${jobs.length} ${jobs.length === 1 ? "job" : "jobs"}` : "Searching…"}
        </span>
        <div className="chips">
          {chips.length ? chips.map((c) => <span key={c} className="chip">{c}</span>) : <span className="chip chip-all">All jobs</span>}
        </div>
      </header>

      <div className="job-browser">
        {/* ---- search list ---- */}
        <section className="pane list-pane" aria-label="Search results">
          <div className="pane-head">
            <h2>Results</h2>
            <ColumnMenu cols={cols} onToggle={toggleCol} />
          </div>
          {error && <p className="state state-error">Could not search jobs: {error}.</p>}
          {jobs && jobs.length === 0 && <p className="state">No jobs match these filters.</p>}
          {jobs && jobs.length > 0 && (
            <div className="pane-scroll" ref={listRef} tabIndex={0} onKeyDown={onKey}
              aria-label="Job list: arrow keys select, Enter opens">
              <table className="grid job-list">
                <thead>
                  <tr>
                    <SortTh k="name" sort={sort} onSort={sortBy}>Job</SortTh>
                    {shownCols.map((c) => c.sort
                      ? <SortTh key={c.id} k={c.sort} sort={sort} onSort={sortBy} num={c.num}>{c.label}</SortTh>
                      : <th key={c.id} className={c.num ? "num" : undefined}>{c.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr key={j.id} className={`row-link${j.id === selectedId ? " is-selected" : ""}`}
                      aria-selected={j.id === selectedId}
                      onClick={() => setSelectedId(j.id)} onDoubleClick={() => onOpenJob(j)}>
                      <td className="cell-name nowrap">{j.name}</td>
                      {shownCols.map((c) => <td key={c.id} className={`${c.num ? "num " : ""}nowrap cell-${c.id}`}>{c.cell(j, machines)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ---- selected job preview ---- */}
        <section className="pane preview-pane" aria-label="Selected job">
          {selected ? <JobPreview job={selected} onOpen={() => onOpenJob(selected)}
            targets={openJobs.filter((j) => j.id !== selected.id)} onSend={onSendSheet} />
            : <p className="state">{jobs?.length ? "Select a job to see it here." : ""}</p>}
        </section>
      </div>
    </div>
  );
}

/* ---- preview ----------------------------------------------------------------------- */

// sheets in the preview: 2 x 2 grid, or one sheet per row (bigger); remembered in this browser
const GRID_KEY = "gnezdo.jobPreview.cols";
function loadGrid(): 1 | 2 {
  try { return localStorage.getItem(GRID_KEY) === "1" ? 1 : 2; } catch { return 2; }
}

function ColsToggle({ cols, onChange }: { cols: 1 | 2; onChange: (c: 1 | 2) => void }) {
  return (
    <span className="cols-toggle" role="radiogroup" aria-label="Sheets shown">
      <button type="button" role="radio" aria-checked={cols === 2} className={cols === 2 ? "is-on" : ""}
        title="Sheets in a 2 × 2 grid" onClick={() => onChange(2)}>
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <rect x="1.5" y="1.5" width="5.5" height="5.5" /><rect x="9" y="1.5" width="5.5" height="5.5" />
          <rect x="1.5" y="9" width="5.5" height="5.5" /><rect x="9" y="9" width="5.5" height="5.5" />
        </svg>
      </button>
      <button type="button" role="radio" aria-checked={cols === 1} className={cols === 1 ? "is-on" : ""}
        title="One sheet at a time" onClick={() => onChange(1)}>
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="1.5" y="1.5" width="13" height="13" /></svg>
      </button>
    </span>
  );
}

function JobPreview({ job, onOpen, targets, onSend }: {
  job: JobSummary; onOpen: () => void;
  targets: { id: string; title: string }[];
  onSend?: (jobId: string, title: string, sheet: SheetParts) => void;
}) {
  // a sheet picked (click a tile): its parts can be sent to an open job
  const [picked, setPicked] = useState<number | null>(null);
  const [menu, setMenu] = useState(false);
  const [parts, setParts] = useState<JobPart[] | null>(null);
  const [sheets, setSheets] = useState<NestedSheet[] | null>(null);   // the saved nest's shown solution
  const [mats, setMats] = useState<Set<string>>(new Set());       // pink buttons switched on
  const [thks, setThks] = useState<Set<number>>(new Set());       // purple buttons switched on
  const [cols, setColsState] = useState<1 | 2>(loadGrid);
  const setCols = (c: 1 | 2) => { setColsState(c); try { localStorage.setItem(GRID_KEY, String(c)); } catch { /* not kept */ } };

  useEffect(() => { setPicked(null); setMenu(false); }, [job.id]);
  useEffect(() => {
    let alive = true;
    setParts(null);
    setMats(new Set());
    setThks(new Set());
    setSheets(null);
    api.jobParts(job.id).then((p) => alive && setParts(p), () => alive && setParts([]));
    api.job(job.id).then((d) => {
      if (!alive) return;
      const sols = solutionsFromSaved(d?.nest ?? null);
      const sol = sols?.list.find((x) => x.id === sols.sel.sol) ?? sols?.list.at(-1);
      setSheets(sol?.run?.result?.sheets ?? []);
    }, () => alive && setSheets([]));
    return () => { alive = false; };
  }, [job.id]);

  const materials = useMemo(() => [...new Set((parts ?? []).map((p) => p.part.material))].sort(), [parts]);
  const thicknesses = useMemo(() => [...new Set((parts ?? []).map((p) => p.part.thicknessMm))].sort((a, b) => a - b), [parts]);
  const shown = (parts ?? []).filter((p) =>
    (mats.size === 0 || mats.has(p.part.material)) && (thks.size === 0 || thks.has(p.part.thicknessMm)));

  const byId = useMemo(() => new Map((parts ?? []).map((jp) =>
    [jp.part.id, { path: jp.part.path, areaMm2: jp.part.areaMm2, name: jp.part.name, no: jp.no }])), [parts]);
  // the material / thickness buttons pick the sheets too
  const shownSheets = (sheets ?? []).map((sh, i) => ({ sh, i })).filter(({ sh }) =>
    (mats.size === 0 || mats.has(sh.material)) && (thks.size === 0 || thks.has(sh.thicknessMm)));

  const flip = <T,>(set: Set<T>, v: T) => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); return n; };

  // the picked sheet's parts: pieces on the sheet times how many times it is cut
  const sheetParts = (i: number): SheetParts | null => {
    const sh = sheets?.[i];
    if (!sh || !parts) return null;
    const count = new Map<string, number>();
    for (const p of sh.parts) count.set(p.partId, (count.get(p.partId) ?? 0) + (sh.cutNumber ?? 1));
    const items = [...count].flatMap(([id, qty]) => { const jp = parts.find((x) => x.part.id === id); return jp ? [{ part: jp.part, qty }] : []; });
    return { from: `sheet ${i + 1} of ${job.name}`, items };
  };
  const pickedParts = picked !== null ? sheetParts(picked) : null;
  const pieces = pickedParts?.items.reduce((n, x) => n + x.qty, 0) ?? 0;

  return (
    <>
      <div className="pane-head preview-head">
        <h2 title={job.name}>{job.name}</h2>
        <span className={`status status-${job.status}`}>{STATUS[job.status]}</span>
        {job.sheetCount > 0 && <ColsToggle cols={cols} onChange={setCols} />}
        {onSend && pickedParts && (
          <span className="send-sheet">
            <button type="button" className="btn btn-plain" disabled={!targets.length} aria-expanded={menu}
              title={targets.length ? `Add the parts of sheet ${picked! + 1} (${pieces} pieces) to an open job` : "Open the job to add them to first (in a tab)"}
              onClick={() => setMenu((m) => !m)}>Send to ▾</button>
            {menu && (
              <ul className="send-sheet-menu" role="menu">
                {targets.map((t) => (
                  <li key={t.id}><button type="button" role="menuitem" onClick={() => { setMenu(false); onSend(t.id, t.title, pickedParts); }}>{t.title}</button></li>
                ))}
              </ul>
            )}
          </span>
        )}
        <button className="btn btn-primary" onClick={onOpen}>Open job</button>
      </div>

      {/* sheets */}
      <div className="sheets-area">
        {job.sheetCount > 0 && (sheets === null || !parts) && <p className="sheets-empty">Loading the nest…</p>}
        {job.sheetCount > 0 && sheets && parts && sheets.length > 0 && (
          <ul className={`sheet-tiles${cols === 1 ? " is-single" : ""}`} aria-label={`${sheets.length} sheets`}>
            {shownSheets.map(({ sh, i }) => (
              <li key={i} className={`sheet-tile has-nest${picked === i ? " is-picked" : ""}`} aria-selected={picked === i}
                title={`Sheet ${i + 1}: ${sh.material} ${mm(sh.thicknessMm)}, ${sh.lengthMm} × ${sh.widthMm}. Click to pick it (its parts can then be sent to an open job)`}
                onClick={() => { setPicked((p) => (p === i ? null : i)); setMenu(false); }}>
                <SheetSvg sheet={sh} parts={byId} titles />
                <span className="sheet-no">Sheet {i + 1}{(sh.cutNumber ?? 1) > 1 ? ` ×${sh.cutNumber}` : ""}</span>
              </li>
            ))}
            {shownSheets.length === 0 && <li className="sheets-empty">No sheet of this material / thickness</li>}
          </ul>
        )}
        {(job.sheetCount === 0 || (sheets && sheets.length === 0)) && <p className="sheets-empty">Not nested yet</p>}
      </div>

      {/* materials and thicknesses used in the job */}
      <div className="mt-buttons" role="group" aria-label="Show parts by material and thickness">
        <span className="mt-group">
          {materials.map((m) => (
            <button key={m} type="button" className={`mt-btn mt-mat${mats.has(m) ? " is-on" : ""}`}
              aria-pressed={mats.has(m)} onClick={() => setMats((s) => flip(s, m))}>{m}</button>
          ))}
        </span>
        <span className="mt-group">
          {thicknesses.map((t) => (
            <button key={t} type="button" className={`mt-btn mt-thk${thks.has(t) ? " is-on" : ""}`}
              aria-pressed={thks.has(t)} onClick={() => setThks((s) => flip(s, t))}>{mm(t)}</button>
          ))}
        </span>
      </div>

      {/* part list */}
      <div className="pane-scroll part-list-area">
        {!parts && <p className="state">Loading parts…</p>}
        {parts && parts.length === 0 && <p className="state">This job has no parts yet.</p>}
        {parts && parts.length > 0 && (
          <table className="grid preview-parts">
            <thead>
              <tr>
                <th>Project / part</th><th>Material</th><th className="num">Thickness</th><th className="num">Qty</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(({ part, qty }) => (
                <tr key={part.id}>
                  <td className="pp-name" title={`${part.project} / ${part.name}`}>
                    <span className="pp-project">{part.project}</span>
                    <span className="pp-sep">/</span>
                    {part.name}
                  </td>
                  <td className="nowrap">{part.material}</td>
                  <td className="num nowrap">{mm(part.thicknessMm)}</td>
                  <td className="num">{qty}×</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>{shown.length} of {parts.length} part types</td>
                <td className="num">{shown.reduce((n, p) => n + p.qty, 0)}×</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </>
  );
}

/* ---- small pieces ------------------------------------------------------------------ */

function ColumnMenu({ cols, onToggle }: { cols: ColId[]; onToggle: (id: ColId) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div className="col-menu" ref={ref}>
      <button type="button" className="btn btn-quiet" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2h3v10H2zM5.5 2h3v10h-3zM9 2h3v10H9z" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>
        Columns
      </button>
      {open && (
        <div className="menu col-menu-list" role="group" aria-label="Shown columns">
          <label className="menu-check is-fixed"><input type="checkbox" checked disabled /> Job</label>
          {COLUMNS.map((c) => (
            <label key={c.id} className="menu-check">
              <input type="checkbox" checked={cols.includes(c.id)} onChange={() => onToggle(c.id)} /> {c.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/** Column header that sorts the results; click again to reverse. */
function SortTh({ k, sort, onSort, num, children }: {
  k: SortKey; sort: SortOrder; onSort: (k: SortKey) => void; num?: boolean; children: string;
}) {
  const on = sort.key === k;
  return (
    <th className={num ? "num" : undefined} aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className={`th-sort${on ? " is-on" : ""}`} onClick={() => onSort(k)}
        title={`Sort by ${children.toLowerCase()}`}>
        {children}
        <span className="th-arrow">{on ? <SortArrow dir={sort.dir} /> : null}</span>
      </button>
    </th>
  );
}
