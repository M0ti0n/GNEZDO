// Settings -> Projects and parts: every saved project, and the parts of the one picked (the jobs each is
// used in: a click opens the job). A project cannot be renamed; it can be deleted only while it has no
// parts (a part moves to another project in its Part properties: right click -> Properties). The
// default project: what an import with an empty project box is saved under.
import { useEffect, useMemo, useState } from "react";
import { api, type ProjectPart, type ProjectRow } from "../api/api";
import type { PartSummary } from "../api/types";
import { loadDefaultProject, saveDefaultProject } from "../job/defaultProject";
import { Combobox } from "./Combobox";
import { ConfirmDialog } from "./ConfirmDialog";
import { DateInput } from "./DateInput";
import { PartHistoryDialog } from "./PartHistoryDialog";
import { PartPropertiesDialog } from "./PartPropertiesDialog";
import { PartThumb } from "./PartThumb";
import { usePickLists } from "./pickLists";

const dmy = (iso: string) => { const d = new Date(iso); return Number.isNaN(+d) ? "" : `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`; };
const day = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const has = (s: string, t: string) => s.toLowerCase().includes(t.trim().toLowerCase());

const Arrow = ({ up }: { up: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {up ? <path d="M12 20V4M6 10l6-6 6 6" /> : <path d="M12 4v16M6 14l6 6 6-6" />}
  </svg>
);

export function ProjectsSettings({ onOpenJob }: { onOpenJob?: (id: string, name: string) => void }) {
  // the toolbar
  const [projectText, setProjectText] = useState("");
  const [partText, setPartText] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [empty, setEmpty] = useState(false);
  // the projects
  const [rows, setRows] = useState<ProjectRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<{ by: "name" | "date"; up: boolean }>({ by: "date", up: false });
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  // the parts of the picked project
  const [parts, setParts] = useState<ProjectPart[] | null>(null);
  const [mat, setMat] = useState("");
  const [thick, setThick] = useState("");
  const [partFilter, setPartFilter] = useState("");
  const [psort, setPsort] = useState<"name" | "created" | "modified">("name");
  const [menu, setMenu] = useState<{ x: number; y: number; part: PartSummary } | null>(null);
  const [editing, setEditing] = useState<PartSummary | null>(null);
  const [history, setHistory] = useState<PartSummary | null>(null);
  // the default project
  const [def, setDef] = useState(loadDefaultProject);
  const lists = usePickLists("");

  // the projects (with part text: the ones with such a part), a moment after typing stops
  useEffect(() => {
    const t = setTimeout(() => {
      api.browseProjects(partText).then((r) => { setRows(r); setError(null); }, (e: Error) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [partText, reload]);
  // the part text goes into the parts' own search too
  useEffect(() => { setPartFilter(partText); }, [partText]);

  useEffect(() => {
    if (!picked) { setParts(null); return; }
    let live = true;
    api.projectParts(picked).then((p) => { if (live) setParts(p); }, (e: Error) => { if (live) { setParts([]); setMsg(e.message); } });
    return () => { live = false; };
  }, [picked, reload]);
  useEffect(() => { setMat(""); setThick(""); }, [picked]);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);

  const shown = useMemo(() => {
    const l = (rows ?? []).filter((r) => (empty || r.partCount > 0)
      && (!projectText.trim() || has(r.code, projectText) || has(r.name, projectText) || has(r.customer ?? "", projectText))
      && (!from || day(r.createdAt) >= from) && (!to || day(r.createdAt) <= to));
    const k = sort.up ? 1 : -1;
    return l.sort((a, b) => k * (sort.by === "name" ? a.code.localeCompare(b.code, undefined, { numeric: true }) : a.createdAt.localeCompare(b.createdAt)));
  }, [rows, empty, projectText, from, to, sort]);
  const pickedRow = rows?.find((r) => r.code === picked) ?? null;
  // only projects without parts can be deleted
  const deletable = shown.filter((r) => r.partCount === 0);
  const toDelete = [...ticked].filter((c) => rows?.some((r) => r.code === c && r.partCount === 0));

  const del = async () => {
    setAsking(false);
    let n = 0;
    const bad: string[] = [];
    for (const c of toDelete) {
      try { await api.deleteProject(c); n++; } catch (e) { bad.push(`${c}: ${(e as Error).message}`); }
    }
    setTicked(new Set());
    if (picked && toDelete.includes(picked)) setPicked(null);
    setMsg(bad.length ? bad.join(" ") : `${n} ${n === 1 ? "project" : "projects"} deleted`);
    setReload((x) => x + 1);
  };

  const pl = useMemo(() => {
    const l = (parts ?? []).filter((x) => (!mat || x.part.material === mat) && (!thick || String(x.part.thicknessMm) === thick) && (!partFilter.trim() || has(x.part.name, partFilter)));
    return l.sort((a, b) => psort === "name" ? a.part.name.localeCompare(b.part.name, undefined, { numeric: true })
      : psort === "created" ? b.part.createdAt.localeCompare(a.part.createdAt) : b.part.modifiedAt.localeCompare(a.part.modifiedAt));
  }, [parts, mat, thick, partFilter, psort]);
  const mats = [...new Set((parts ?? []).map((x) => x.part.material))].sort();
  const thicks = [...new Set((parts ?? []).filter((x) => !mat || x.part.material === mat).map((x) => x.part.thicknessMm))].sort((a, b) => a - b);

  return (
    <div className="pj-main">
      <header className="settings-head">
        <h2>Projects and parts</h2>
        <p>Every saved project and its parts. A project cannot be renamed; it can be deleted while it has no parts. A part moves to another project in its Part properties (right click).</p>
      </header>

      <div className="pj-tools" role="search">
        <label className="pj-f pj-search"><span>Project</span>
          <input className="field" value={projectText} placeholder="Code, name or customer" onChange={(e) => setProjectText(e.target.value)} /></label>
        <label className="pj-f pj-search"><span>Part name</span>
          <input className="field" value={partText} placeholder="Projects with this part" onChange={(e) => setPartText(e.target.value)} /></label>
        <label className="pj-f pj-date"><span>Created from</span><DateInput value={from} onChange={setFrom} aria-label="Created from" /></label>
        <label className="pj-f pj-date"><span>to</span><DateInput value={to} onChange={setTo} aria-label="Created to" /></label>
        <label className="chk pj-empty"><input type="checkbox" checked={empty} onChange={(e) => setEmpty(e.target.checked)} /> Show projects without parts</label>
        <span className="pj-spacer" />
        <button type="button" className="btn pj-del" disabled={!toDelete.length} onClick={() => setAsking(true)}
          title={toDelete.length ? "Delete the ticked projects" : "Tick projects without parts to delete them (Show projects without parts)"}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>
          Delete{toDelete.length ? ` (${toDelete.length})` : ""}
        </button>
      </div>
      <div className="pj-def">
        <span>Default project</span>
        <Combobox value={def} onChange={(v) => { setDef(v); saveDefaultProject(v); }} options={lists.projects} placeholder="none" ariaLabel="Default project"
          newHint="a new project" onCreate={async (code) => { await lists.createProject(code); setDef(code); saveDefaultProject(code); }} createLabel="Save new project" />
        <span className="rule-help">Parts imported with the project box left empty are offered this project (kept in this browser). Empty: they wait for a project.</span>
      </div>
      {(msg || error) && <p className={`tech-msg${error ? " is-bad" : ""}`} role="status">{error ?? msg}</p>}

      <div className="pj-grid">
        <section className="pjt" aria-label="Projects">
          <div className="pjt-head">
            <h3>Projects</h3><span className="n">{rows ? `${shown.length} of ${rows.length}` : "…"}</span>
            <span className="pj-sort">
              <span className="seg2" role="radiogroup" aria-label="Sort projects">
                <button type="button" role="radio" aria-checked={sort.by === "name"} className={sort.by === "name" ? "on" : ""} onClick={() => setSort({ by: "name", up: true })}>Name</button>
                <button type="button" role="radio" aria-checked={sort.by === "date"} className={sort.by === "date" ? "on" : ""} onClick={() => setSort({ by: "date", up: false })}>Date</button>
              </span>
              <button type="button" className="pj-dir" onClick={() => setSort({ ...sort, up: !sort.up })}
                title={sort.by === "name" ? (sort.up ? "A to Z" : "Z to A") : (sort.up ? "Oldest first" : "Newest first")}><Arrow up={sort.up} /></button>
            </span>
          </div>
          <div className="pj-scroll">
            <table className="pjtab">
              <thead><tr>
                <th className="pj-cb"><input type="checkbox" aria-label="Tick every project without parts" disabled={!deletable.length}
                  checked={deletable.length > 0 && deletable.every((r) => ticked.has(r.code))}
                  onChange={(e) => setTicked(e.target.checked ? new Set(deletable.map((r) => r.code)) : new Set())} /></th>
                <th>Project</th><th className="pj-date-c">Date</th>
              </tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.code} className={r.code === picked ? "is-sel" : ""} onClick={() => setPicked(r.code)}>
                    <td className="pj-cb" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={ticked.has(r.code)} disabled={r.partCount > 0} aria-label={`Tick ${r.code}`}
                        title={r.partCount > 0 ? `${r.partCount} ${r.partCount === 1 ? "part" : "parts"} in it: only a project without parts can be deleted` : "Tick to delete"}
                        onChange={(e) => setTicked((s) => { const n = new Set(s); if (e.target.checked) n.add(r.code); else n.delete(r.code); return n; })} />
                    </td>
                    <td className="pname"><b>{r.code}</b><span>{[r.name, r.customer].filter(Boolean).join(" · ") || (r.partCount ? `${r.partCount} ${r.partCount === 1 ? "part" : "parts"}` : "no parts")}</span></td>
                    <td className="pj-date-c">{dmy(r.createdAt)}</td>
                  </tr>
                ))}
                {rows && !shown.length && <tr><td colSpan={3} className="pj-none">{partText.trim() ? `No project has a part called like “${partText.trim()}”.` : "No projects."}</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section className="pjt" aria-label="Parts of the project">
          <div className="pjt-head">
            <h3>{picked ? `Parts of ${picked}` : "Parts"}</h3>
            {pickedRow && <span className="n">{[pickedRow.name, `${pickedRow.partCount} ${pickedRow.partCount === 1 ? "part" : "parts"}`].filter(Boolean).join(" · ")}</span>}
          </div>
          {picked && (
            <div className="pj-ptools">
              <label className="pj-f"><span>Material</span>
                <select className="field" value={mat} onChange={(e) => { setMat(e.target.value); setThick(""); }}><option value="">All</option>{mats.map((m) => <option key={m}>{m}</option>)}</select></label>
              <label className="pj-f"><span>Thickness</span>
                <select className="field" value={thick} onChange={(e) => setThick(e.target.value)}><option value="">All</option>{thicks.map((t) => <option key={t} value={String(t)}>{t} mm</option>)}</select></label>
              <label className="pj-f"><span>Part name</span><input className="field" value={partFilter} placeholder="Search" onChange={(e) => setPartFilter(e.target.value)} /></label>
              <span className="pj-spacer" />
              <span className="seg2" role="radiogroup" aria-label="Sort parts">
                {(["name", "created", "modified"] as const).map((k) => (
                  <button key={k} type="button" role="radio" aria-checked={psort === k} className={psort === k ? "on" : ""} onClick={() => setPsort(k)}>{k[0].toUpperCase() + k.slice(1)}</button>
                ))}
              </span>
            </div>
          )}
          <div className="pj-scroll">
            {!picked ? <p className="pj-none">Click a project to see its parts.</p> : (
              <table className="pjtab">
                <thead><tr><th /><th>Part</th><th>Material</th><th>Created</th><th>Modified</th><th>Used in jobs</th></tr></thead>
                <tbody>
                  {pl.map(({ part, jobs }) => (
                    <tr key={part.id} onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, part }); }}
                      onDoubleClick={() => setEditing(part)} title="Right click: Properties (move it to another project there)">
                      <td className="pj-thumb"><PartThumb part={part} size={40} marks /></td>
                      <td><b>{part.name}</b></td>
                      <td className="pj-nowrap">{part.material} · {part.thicknessMm} mm</td>
                      <td className="pj-nowrap">{dmy(part.createdAt)}</td>
                      <td className="pj-nowrap">{dmy(part.modifiedAt)}</td>
                      <td>{jobs.length ? (<>
                        {jobs.slice(0, 3).map((j) => <button key={j.id} type="button" className="pj-chip" title={`Open job ${j.name}`} onClick={() => onOpenJob?.(j.id, j.name)}>{j.name}</button>)}
                        {jobs.length > 3 && <span className="pj-chip is-more" title={jobs.slice(3).map((j) => j.name).join(", ")}>+{jobs.length - 3}</span>}
                      </>) : <span className="pj-not">not in a job</span>}</td>
                    </tr>
                  ))}
                  {parts && !pl.length && <tr><td colSpan={6} className="pj-none">{parts.length ? "No part matches the filters." : "No parts in this project."}</td></tr>}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>

      {menu && (
        <div className="ctx-menu" role="menu" style={{ position: "fixed", left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <div className="ctx-title">{menu.part.name}</div>
          <button type="button" role="menuitem" onClick={() => { setEditing(menu.part); setMenu(null); }}>Properties…</button>
          <button type="button" role="menuitem" disabled={menu.part.revision < 2} onClick={() => { setHistory(menu.part); setMenu(null); }}>Versions…</button>
        </div>
      )}
      {editing && (
        <PartPropertiesDialog part={editing} onClose={() => setEditing(null)}
          onSaved={() => setReload((x) => x + 1)} onDeleted={() => setReload((x) => x + 1)}
          onVersions={(p) => { setEditing(null); setHistory(p); }} />
      )}
      {history && <PartHistoryDialog part={history} onClose={() => setHistory(null)} onRestored={(now) => { setHistory(now); setReload((x) => x + 1); }} />}
      {asking && (
        <ConfirmDialog title="Delete projects?" confirmLabel="Delete" onCancel={() => setAsking(false)} onConfirm={() => void del()}>
          {toDelete.join(", ")}: {toDelete.length === 1 ? "it has" : "they have"} no parts. Deleted, {toDelete.length === 1 ? "it is" : "they are"} gone from the project lists.
        </ConfirmDialog>
      )}
    </div>
  );
}
