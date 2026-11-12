import { useEffect, useMemo, useRef, useState } from "react";
import { api, type SavedRemnant } from "../api/api";
import type { DateMode } from "../api/types";
import { DateLine, EMPTY_DATE, PanelHead, SizeLine, dateFilterOf, type DateDraft } from "../components/FilterFields";
import { IconImport, IconSearch } from "../components/Icons";
import { RemnantDialog } from "../pages/RemnantsPage";
import { remnantFromFile } from "../job/remnantImport";
import { densityOf } from "../job/nest";

/** What Remnant search looks for (empty: everything). Sizes: the remnant's box [mm]. */
export interface RemnantFilter {
  job?: string; material?: string; thicknessMm?: number; project?: string;
  created?: { mode: DateMode; date: string }; modified?: { mode: DateMode; date: string };
  xMin?: number; xMax?: number; yMin?: number; yMax?: number;
}

interface Draft {
  job: string; material: string; thicknessMm: string; project: string;
  created: DateDraft; modified: DateDraft;
  xOn: boolean; xMin: string; xMax: string; yOn: boolean; yMin: string; yMax: string;
}

const EMPTY: Draft = { job: "", material: "", thicknessMm: "", project: "", created: EMPTY_DATE, modified: EMPTY_DATE, xOn: false, xMin: "", xMax: "", yOn: false, yMin: "", yMax: "" };
const text = (v: string) => (v.trim() === "" ? undefined : v.trim());
const num = (v: string) => (v.trim() === "" ? undefined : Number(v));

function toFilter(d: Draft): RemnantFilter {
  return {
    job: text(d.job), material: text(d.material), thicknessMm: num(d.thicknessMm), project: text(d.project),
    created: dateFilterOf(d.created), modified: dateFilterOf(d.modified),
    xMin: d.xOn ? num(d.xMin) : undefined, xMax: d.xOn ? num(d.xMax) : undefined,
    yMin: d.yOn ? num(d.yMin) : undefined, yMax: d.yOn ? num(d.yMax) : undefined,
  };
}

const day = (iso?: string) => (iso ?? "").slice(0, 10);
const dateOk = (iso: string | undefined, f?: { mode: DateMode; date: string }) => {
  if (!f) return true;
  const d = day(iso);
  if (!d) return false;
  return f.mode === "on" ? d === f.date : f.mode === "upTo" ? d <= f.date : d >= f.date;
};
const has = (v: string | undefined, q: string | undefined) => !q || (v ?? "").toLowerCase().includes(q.toLowerCase());

/** The remnants that match (sizes either way round: a remnant can be turned). */
export function matchRemnant(r: SavedRemnant, f: RemnantFilter): boolean {
  if (!has(r.job, f.job) && !has(r.name, f.job)) return false;
  if (f.material && r.material.trim().toLowerCase() !== f.material.trim().toLowerCase()) return false;
  if (f.thicknessMm !== undefined && Math.abs(r.thicknessMm - f.thicknessMm) > 1e-6) return false;
  if (f.project && !(r.projects ?? []).some((p) => has(p, f.project))) return false;
  if (!dateOk(r.savedAt, f.created) || !dateOk(r.modifiedAt ?? r.savedAt, f.modified)) return false;
  const inX = (v: number) => (f.xMin === undefined || v >= f.xMin) && (f.xMax === undefined || v <= f.xMax);
  const inY = (v: number) => (f.yMin === undefined || v >= f.yMin) && (f.yMax === undefined || v <= f.yMax);
  return (inX(r.widthMm) && inY(r.heightMm)) || (inX(r.heightMm) && inY(r.widthMm));
}

// Remnant search (left rail): filters for the saved remnants; Search (or Enter) shows them on the main screen.
/** "3 days ago" */
export function ago(iso?: string): string {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  const u: [number, string][] = [[365 * 86400, "year"], [30 * 86400, "month"], [7 * 86400, "week"], [86400, "day"], [3600, "hour"], [60, "minute"]];
  for (const [n, w] of u) if (s >= n) { const k = Math.floor(s / n); return `${k} ${w}${k === 1 ? "" : "s"} ago`; }
  return "just now";
}
const when = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "numeric", year: "numeric" }) : "—");

export function RemnantsPanel({ onSearch, onClose, selected, onChanged }: {
  onSearch: (f: RemnantFilter) => void; onClose: () => void;
  /** the remnant picked on the main screen */
  selected: SavedRemnant | null;
  /** a remnant was imported or changed here (its name: pick it) */
  onChanged: (name: string) => void;
}) {
  const [d, setD] = useState<Draft>(EMPTY);
  const [lastSearched, setLastSearched] = useState<string | null>(null);
  const [all, setAll] = useState<SavedRemnant[]>([]);
  useEffect(() => { api.remnants().then(setAll, () => setAll([])); }, [selected]);
  const file = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState<SavedRemnant | null>(null);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [note, setNote] = useState("");
  useEffect(() => { setNote(selected?.note ?? ""); }, [selected?.name, selected?.note]);
  const names = useMemo(() => new Set(all.map((r) => r.name)), [all]);

  const readFile = async (f: File) => {
    setMsg(null);
    try {
      const g = await remnantFromFile(f);
      const base = f.name.replace(/\.(dxf|dwg|svg)$/i, "").replace(/[^\w.-]+/g, "_");
      let name = `REM_${base}`;
      for (let k = 2; names.has(name); k++) name = `REM_${base}_${k}`;
      setImporting({ name, material: all[0]?.material ?? "", thicknessMm: all[0]?.thicknessMm ?? 1, job: "", sheet: 0, qty: 1, file: f.name, ...g });
    } catch (e) { setMsg({ text: (e as Error).message, bad: true }); }
  };
  const saveImported = async (r: SavedRemnant) => {
    try { await api.saveRemnants([r]); setImporting(null); setMsg({ text: `${r.name} imported` }); onChanged(r.name); }
    catch (e) { setMsg({ text: `Not saved: ${(e as Error).message}`, bad: true }); }
  };
  const saveNote = async () => {
    if (!selected) return;
    try { await api.saveRemnants([{ ...selected, note: note.trim() || undefined }]); onChanged(selected.name); setMsg({ text: "Note saved" }); }
    catch (e) { setMsg({ text: `Not saved: ${(e as Error).message}`, bad: true }); }
  };
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const materials = useMemo(() => [...new Set(all.map((r) => r.material).filter(Boolean))].sort(), [all]);
  const thicknesses = useMemo(() => [...new Set(all.filter((r) => !d.material || r.material === d.material).map((r) => r.thicknessMm))].sort((a, b) => a - b), [all, d.material]);

  const filter = toFilter(d);
  const key = JSON.stringify(filter);
  const dirty = lastSearched !== null && key !== lastSearched;
  const search = () => { setLastSearched(key); onSearch(filter); };
  const reset = () => { setD(EMPTY); const f = toFilter(EMPTY); setLastSearched(JSON.stringify(f)); onSearch(f); };
  const active = Object.values(filter).filter((v) => v !== undefined).length;

  return (
    <>
      <PanelHead title="Remnant search" onClose={onClose}>
        <button className={`btn btn-search${dirty ? " is-dirty" : ""}`} onClick={search} title="Show matching remnants (Enter)">
          <IconSearch size={17} />Search
        </button>
      </PanelHead>
      <form className="filters" onSubmit={(e) => { e.preventDefault(); search(); }}>
        <input className="field" type="search" value={d.job} placeholder="Job name" aria-label="Job name"
          title="Remnants from this job (or with this in their name)" onChange={(e) => set({ job: e.target.value })} />
        <div className="filter-pair">
          <select className="field" value={d.material} aria-label="Material" onChange={(e) => set({ material: e.target.value, thicknessMm: "" })}>
            <option value="">Material</option>
            {materials.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select className="field" value={d.thicknessMm} aria-label="Thickness" onChange={(e) => set({ thicknessMm: e.target.value })}>
            <option value="">Thickness</option>
            {thicknesses.map((t) => <option key={t} value={t}>{t} mm</option>)}
          </select>
        </div>
        <input className="field" type="search" value={d.project} placeholder="Project" aria-label="Project"
          title="Remnants from sheets with parts of this project" onChange={(e) => set({ project: e.target.value })} />
        <DateLine label="Created" on={d.created.on} value={d.created}
          onToggle={(on) => set({ created: { ...d.created, on } })}
          onChange={(v) => set({ created: { ...v, on: v.date ? true : d.created.on } })} />
        <DateLine label="Modified" on={d.modified.on} value={d.modified}
          onToggle={(on) => set({ modified: { ...d.modified, on } })}
          onChange={(v) => set({ modified: { ...v, on: v.date ? true : d.modified.on } })} />
        <SizeLine label="Size X" on={d.xOn} min={d.xMin} max={d.xMax} onToggle={(v) => set({ xOn: v })}
          onChange={(min, max) => set({ xMin: min, xMax: max, xOn: min !== "" || max !== "" ? true : d.xOn })} />
        <SizeLine label="Size Y" on={d.yOn} min={d.yMin} max={d.yMax} onToggle={(v) => set({ yOn: v })}
          onChange={(min, max) => set({ yMin: min, yMax: max, yOn: min !== "" || max !== "" ? true : d.yOn })} />
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
      <div className="result-bar">
        <span className="result-count">
          {lastSearched === null ? "Results open on the main screen" : dirty ? <em className="stale">Filters changed · press Search</em> : "Results on the main screen"}
        </span>
        <span className="result-actions">{(active > 0 || dirty) && <button className="link" onClick={reset}>Reset filters</button>}</span>
      </div>
      <div className="rs-import">
        <button type="button" className="btn btn-plain" onClick={() => file.current?.click()} title="A remnant drawn in a DXF or SVG file (DWG: save it as DXF first)">
          <IconImport size={18} />Import remnant
        </button>
        <span className="rs-types">DXF · SVG · DWG</span>
        <input ref={file} type="file" accept=".dxf,.dwg,.svg" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void readFile(f); }} />
      </div>
      {msg && <p className={`tech-msg rs-msg${msg.bad ? " is-bad" : ""}`} role="status">{msg.text}</p>}
      {selected ? (
        <section className="rs-info" aria-label="Remnant details">
          <h3>{selected.name}</h3>
          <dl>
            <dt>Size</dt><dd>{selected.widthMm} × {selected.heightMm} mm · {(selected.areaMm2 / 1e6).toFixed(2)} m²</dd>
            <dt>Material</dt><dd>{selected.material} {selected.thicknessMm} mm · {((selected.areaMm2 * selected.thicknessMm * densityOf(selected.material)) / 1e6).toFixed(1)} kg{(selected.qty ?? 1) > 1 ? ` · ${selected.qty} pieces` : ""}</dd>
            <dt>Created</dt><dd>{when(selected.savedAt)} <span className="rs-ago">{ago(selected.savedAt)}</span>{selected.savedBy ? ` · ${selected.savedBy}` : ""}</dd>
            {selected.modifiedAt && <><dt>Modified</dt><dd>{when(selected.modifiedAt)} <span className="rs-ago">{ago(selected.modifiedAt)}</span>{selected.modifiedBy ? ` · ${selected.modifiedBy}` : ""}</dd></>}
            <dt>From</dt><dd>{selected.file ? `Imported: ${selected.file}` : `${selected.job}, sheet ${selected.sheet}`}</dd>
            {!!selected.projects?.length && <><dt>Projects</dt><dd>{selected.projects.join(", ")}</dd></>}
          </dl>
          <label className="rs-note"><span>Note</span>
            <textarea className="field" rows={4} value={note} placeholder="Protective foil on top, badly scratched …" onChange={(e) => setNote(e.target.value)} />
          </label>
          <button type="button" className="btn btn-plain rs-save" disabled={note.trim() === (selected.note ?? "")} onClick={() => void saveNote()}>Save note</button>
        </section>
      ) : (
        <p className="panel-hint"><b>Size X / Y</b> is the remnant's box; a remnant turned round matches too.<br />Click a remnant to see its details here.</p>
      )}
      {importing && <RemnantDialog title="Import remnant" fresh r={importing} names={names} onCancel={() => setImporting(null)} onSave={(r) => void saveImported(r)} />}
    </>
  );
}
