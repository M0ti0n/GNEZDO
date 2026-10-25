import { useEffect, useMemo, useState } from "react";
import { api, type PartFacets } from "../api/api";
import type { JobFilter } from "../api/types";
import { DateLine, EMPTY_DATE, PanelHead, dateFilterOf, type DateDraft } from "../components/FilterFields";
import { IconSearch } from "../components/Icons";

/** What is typed in the Job search panel. Dates only count when ticked. */
interface JobDraft {
  name: string;
  material: string;
  thicknessMm: string;
  project: string;
  created: DateDraft;
  modified: DateDraft;
  part: string;
}

const EMPTY: JobDraft = {
  name: "", material: "", thicknessMm: "", project: "",
  created: EMPTY_DATE, modified: EMPTY_DATE, part: "",
};

const text = (v: string) => (v.trim() === "" ? undefined : v.trim());

export function toJobFilter(d: JobDraft): JobFilter {
  return {
    name: text(d.name),
    material: text(d.material),
    thicknessMm: d.thicknessMm === "" ? undefined : Number(d.thicknessMm),
    project: text(d.project),
    created: dateFilterOf(d.created),
    modified: dateFilterOf(d.modified),
    part: text(d.part),
  };
}

// Job search filters. Pressing Search (or Enter) shows the results on the main screen.
export function JobsPanel({ onSearch, onClose }: { onSearch: (f: JobFilter) => void; onClose: () => void }) {
  const [d, setD] = useState<JobDraft>(EMPTY);
  const [lastSearched, setLastSearched] = useState<string | null>(null);
  const [facets, setFacets] = useState<PartFacets>({ materials: [], thicknesses: [] });

  useEffect(() => { api.partFacets().then(setFacets); }, []);

  const set = (patch: Partial<JobDraft>) => setD((x) => ({ ...x, ...patch }));
  const thicknesses = useMemo(
    () => [...new Set(facets.thicknesses
      .filter((t) => !d.material || t.material === d.material)
      .map((t) => t.thicknessMm))].sort((a, b) => a - b),
    [facets, d.material]);

  const filter = toJobFilter(d);
  const key = JSON.stringify(filter);
  const dirty = lastSearched !== null && key !== lastSearched;
  const search = () => { setLastSearched(key); onSearch(filter); };
  const reset = () => { setD(EMPTY); setLastSearched(JSON.stringify(toJobFilter(EMPTY))); onSearch(toJobFilter(EMPTY)); };
  const active = Object.values(filter).filter((v) => v !== undefined).length;

  return (
    <>
      <PanelHead title="Job search" onClose={onClose}>
        <button className={`btn btn-search${dirty ? " is-dirty" : ""}`} onClick={search} title="Show matching jobs (Enter)">
          <IconSearch size={17} />Search
        </button>
      </PanelHead>

      <form className="filters" onSubmit={(e) => { e.preventDefault(); search(); }}>
        <input className="field" type="search" value={d.name} placeholder="Job name"
          aria-label="Job name" onChange={(e) => set({ name: e.target.value })} />
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
          aria-label="Project" title="Jobs that contain parts of this project"
          onChange={(e) => set({ project: e.target.value })} />

        <DateLine label="Created" on={d.created.on} value={d.created}
          onToggle={(on) => set({ created: { ...d.created, on } })}
          onChange={(v) => set({ created: { ...v, on: v.date ? true : d.created.on } })} />
        <DateLine label="Modified" on={d.modified.on} value={d.modified}
          onToggle={(on) => set({ modified: { ...d.modified, on } })}
          onChange={(v) => set({ modified: { ...v, on: v.date ? true : d.modified.on } })} />

        <input className="field" type="search" value={d.part} placeholder="Part name"
          aria-label="Part name" title="Jobs this part is used in"
          onChange={(e) => set({ part: e.target.value })} />
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>

      <div className="result-bar">
        <span className="result-count">
          {lastSearched === null ? "Results open on the main screen" : dirty ? <em className="stale">Filters changed · press Search</em> : "Results on the main screen"}
        </span>
        <span className="result-actions">
          {(active > 0 || dirty) && <button className="link" onClick={reset}>Reset filters</button>}
        </span>
      </div>
      <p className="panel-hint">
        <b>Project</b> finds jobs that contain parts of that project.<br />
        <b>Part name</b> finds every job a part is used in.
      </p>
    </>
  );
}
