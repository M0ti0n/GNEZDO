import { useEffect, useState } from "react";
import { api } from "../api/api";
import { DEFAULT_SORT, defaultDir, type DateFilter, type JobFilter, type JobStatus, type JobSummary, type SortKey, type SortOrder } from "../api/types";
import { SortArrow, loadSort, saveSort } from "../components/SortControl";
import { fullDate, mm, when } from "../components/format";

const STATUS: Record<JobStatus, string> = { draft: "Draft", nested: "Nested", released: "Released", cut: "Cut" };
const MODE: Record<DateFilter["mode"], string> = { upTo: "up to", on: "on", from: "from" };

const fmtDay = (ymd: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(`${ymd}T12:00:00`));

/** Short description of each active filter, shown above the results. */
function describe(f: JobFilter): string[] {
  const out: string[] = [];
  if (f.name) out.push(`Name: ${f.name}`);
  if (f.material || f.thicknessMm !== undefined)
    out.push(`Material: ${[f.material, f.thicknessMm !== undefined ? mm(f.thicknessMm) : ""].filter(Boolean).join(" ")}`);
  if (f.project) out.push(`Project: ${f.project}`);
  if (f.created) out.push(`Created ${MODE[f.created.mode]} ${fmtDay(f.created.date)}`);
  if (f.modified) out.push(`Modified ${MODE[f.modified.mode]} ${fmtDay(f.modified.date)}`);
  if (f.part) out.push(`Uses part: ${f.part}`);
  return out;
}

// Job search results on the main screen. A row opens the job in its own tab.
export function JobSearchPage({ filter, run, onOpenJob, onShowFilters }: {
  filter: JobFilter | null;          // null = no search yet
  run: number;                       // changes on every Search press
  onOpenJob: (job: JobSummary) => void;
  onShowFilters: () => void;
}) {
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortOrder>(() => loadSort("jobs", DEFAULT_SORT));
  const sortBy = (key: SortKey) => {
    const next: SortOrder = sort.key === key ? { key, dir: sort.dir === "asc" ? "desc" : "asc" } : { key, dir: defaultDir(key) };
    setSort(next);
    saveSort("jobs", next);
  };

  useEffect(() => {
    if (!filter) return;
    let alive = true;
    setJobs(null);
    setError(null);
    api.searchJobs(filter, sort).then(
      (j) => alive && setJobs(j),
      (e: Error) => alive && setError(e.message),
    );
    return () => { alive = false; };
  }, [filter, run, sort]);

  if (!filter) {
    return (
      <div className="search-page">
        <h1>Job search</h1>
        <p className="state">Set filters in the Job search panel on the left and press Search.</p>
        <button className="btn btn-primary" onClick={onShowFilters}>Show job filters</button>
      </div>
    );
  }

  const chips = describe(filter);

  return (
    <div className="search-page">
      <header className="search-head">
        <h1>Job search</h1>
        <span className="job-sum">
          {error ? "" : jobs ? `${jobs.length} ${jobs.length === 1 ? "job" : "jobs"}` : "Searching…"}
        </span>
      </header>
      <div className="chips">
        {chips.length ? chips.map((c) => <span key={c} className="chip">{c}</span>) : <span className="chip chip-all">All jobs</span>}
      </div>

      {error && <p className="state state-error">Could not search jobs: {error}.</p>}
      {jobs && jobs.length === 0 && <p className="state">No jobs match these filters.</p>}

      {jobs && jobs.length > 0 && (
        <section className="job-group results">
          <table className="grid">
            <thead>
              <tr>
                <SortTh k="name" sort={sort} onSort={sortBy}>Job</SortTh>
                <th>Status</th>
                <SortTh k="material" sort={sort} onSort={sortBy}>Material</SortTh>
                <SortTh k="thickness" sort={sort} onSort={sortBy} num>Thickness</SortTh>
                <th className="num">Parts</th>
                <th className="num">Sheets</th>
                <SortTh k="project" sort={sort} onSort={sortBy}>Projects</SortTh>
                <SortTh k="created" sort={sort} onSort={sortBy}>Created</SortTh>
                <SortTh k="modified" sort={sort} onSort={sortBy}>Modified</SortTh>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="row-link" onClick={() => onOpenJob(j)}>
                  <td className="cell-name">
                    <button className="row-open" onClick={(e) => { e.stopPropagation(); onOpenJob(j); }}>{j.name}</button>
                  </td>
                  <td><span className={`status status-${j.status}`}>{STATUS[j.status]}</span></td>
                  <td className="nowrap">{j.material || "–"}</td>
                  <td className="num nowrap">{j.material ? mm(j.thicknessMm) : "–"}</td>
                  <td className="num">{j.partCount}</td>
                  <td className="num">{j.sheetCount || "–"}</td>
                  <td>{j.projects.join(", ") || "–"}</td>
                  <td className="nowrap" title={fullDate(j.createdAt)}>{when(j.createdAt)}</td>
                  <td className="nowrap" title={fullDate(j.modifiedAt)}>{when(j.modifiedAt)}<span className="sub">{j.modifiedBy}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
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
