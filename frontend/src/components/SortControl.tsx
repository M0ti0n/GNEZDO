import { defaultDir, type SortKey, type SortOrder } from "../api/types";

export const SORT_LABEL: Record<SortKey, string> = {
  name: "Name",
  created: "Date created",
  modified: "Date modified",
  material: "Material",
  thickness: "Thickness",
  project: "Project",
};

/** Sort list + ascending/descending button (for lists without column headers). */
export function SortControl({ value, onChange }: { value: SortOrder; onChange: (s: SortOrder) => void }) {
  const asc = value.dir === "asc";
  return (
    <span className="sort-control">
      <label>
        <span>Sort</span>
        <select className="field" value={value.key} aria-label="Sort by"
          onChange={(e) => { const key = e.target.value as SortKey; onChange({ key, dir: defaultDir(key) }); }}>
          {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
        </select>
      </label>
      <button type="button" className="sort-dir" onClick={() => onChange({ ...value, dir: asc ? "desc" : "asc" })}
        title={asc ? "Ascending; click for descending" : "Descending; click for ascending"}
        aria-label={asc ? "Sorted ascending" : "Sorted descending"}>
        <SortArrow dir={value.dir} />
      </button>
    </span>
  );
}

export function SortArrow({ dir }: { dir: SortOrder["dir"] }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      {dir === "asc"
        ? <path d="M7 12V2M3 6l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        : <path d="M7 2v10M3 8l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

const KEY = (list: string) => `gnezdo.sort.${list}`;

export function loadSort(list: string, fallback: SortOrder): SortOrder {
  try {
    const v = JSON.parse(localStorage.getItem(KEY(list)) ?? "null");
    if (v && v.key in SORT_LABEL && (v.dir === "asc" || v.dir === "desc")) return v;
  } catch { /* no storage */ }
  return fallback;
}

export function saveSort(list: string, s: SortOrder) {
  try { localStorage.setItem(KEY(list), JSON.stringify(s)); } catch { /* no storage */ }
}
