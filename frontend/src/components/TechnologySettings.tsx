import { useRef, useState } from "react";
import { NumInput } from "./NumInput";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  addThickness, cellValue, inRange, newTechnology, techColumnsFor, technologiesCsv, technologiesFromDbf,
  type RowKey, type TechSet,
} from "../job/technology";
import type { Technology } from "../job/machine";

/** A small padlock (open: unlocked). */
const LockIcon = ({ open }: { open: boolean }) => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <rect x="2.5" y="7" width="11" height="8" rx="1.5" fill="currentColor" />
    <path d={open ? "M5 7V4.8a3 3 0 0 1 5.9-.8" : "M5 7V4.8a3 3 0 0 1 6 0V7"} fill="none" stroke="currentColor" strokeWidth="1.8" />
  </svg>
);

/** Settings -> Machines -> Technology: the machine's technologies and their values per thickness.
 *  Locked when opened (against changes by accident, no password): Unlock all, or unlock one row or one
 *  column (its padlock) to change only that; Tab then goes only through what is unlocked. */
export function TechnologySettings({ techs, onChange, machineName, technology }: {
  techs: TechSet[];
  onChange: (t: TechSet[]) => void;
  machineName: string;
  /** the machine's: laser columns only for a laser */
  technology?: Technology;
}) {
  const [selId, setSelId] = useState<string | null>(techs[0]?.id ?? null);
  const tech = techs.find((t) => t.id === selId) ?? techs[0] ?? null;
  const [rowSel, setRowSel] = useState<number | null>(null);
  const [tag, setTag] = useState("");
  const [newThick, setNewThick] = useState("");
  const thick = parseFloat(newThick.replace(",", "."));
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [ask, setAsk] = useState<null | { kind: "delete" } | { kind: "import"; found: TechSet[]; pick: Set<string> }>(null);
  const file = useRef<HTMLInputElement>(null);
  const [locked, setLocked] = useState(true);
  const [openRows, setOpenRows] = useState<Set<number>>(new Set());   // by thickness
  const [openCols, setOpenCols] = useState<Set<RowKey>>(new Set());
  const relock = () => { setOpenRows(new Set()); setOpenCols(new Set()); };
  const flip = <T,>(set: Set<T>, v: T) => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); return n; };
  const canEdit = (thicknessMm: number, k: RowKey) => !locked || openRows.has(thicknessMm) || openCols.has(k);
  const LOCKED = "Locked: Unlock all first";

  const setTech = (patch: Partial<TechSet>) => tech && onChange(techs.map((t) => (t.id === tech.id ? { ...t, ...patch } : t)));
  const setCell = (i: number, k: RowKey, v: number) => tech && setTech({ rows: tech.rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)) });
  const addTag = () => {
    const t = tag.trim();
    if (tech && t && !tech.materials.some((m) => m.toLowerCase() === t.toLowerCase())) setTech({ materials: [...tech.materials, t] });
    setTag("");
  };
  const addNew = () => {
    const t = newTechnology(`Technology ${techs.length + 1}`);
    onChange([...techs, t]); setSelId(t.id); setRowSel(null);
  };
  const addRow = () => {
    if (!tech || !(thick > 0)) return;
    if (tech.rows.some((r) => Math.abs(r.thicknessMm - thick) < 1e-6)) { setMsg({ text: `${thick} mm is already in the table`, bad: true }); return; }
    const next = addThickness(tech, thick);
    const from = [...tech.rows].sort((a, b) => a.thicknessMm - b.thicknessMm).find((r) => r.thicknessMm > thick) ?? tech.rows[tech.rows.length - 1];
    setTech({ rows: next.rows });
    setRowSel(next.rows.findIndex((r) => r.thicknessMm === thick));
    setMsg({ text: from ? `${thick} mm added: a copy of ${from.thicknessMm} mm, change what differs` : `${thick} mm added` });
    setNewThick("");
  };
  const deleteRow = () => {
    if (!tech || rowSel === null) return;
    setTech({ rows: tech.rows.filter((_, j) => j !== rowSel) });
    setRowSel(null);
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const found = technologiesFromDbf(await f.arrayBuffer());
      if (!found.length) { setMsg({ text: "No technologies found in that table", bad: true }); return; }
      setAsk({ kind: "import", found, pick: new Set() });
    } catch (e) { setMsg({ text: `Could not read ${f.name}: ${(e as Error).message}`, bad: true }); }
    finally { if (file.current) file.current.value = ""; }
  };
  const doImport = (found: TechSet[]) => {
    // same name: replaced (keeping its material tags and range), else added
    const byName = new Map(techs.map((t) => [t.name.toLowerCase(), t]));
    const out = [...techs];
    for (const f of found) {
      const old = byName.get(f.name.toLowerCase());
      if (old) out[out.indexOf(old)] = { ...f, id: old.id, materials: old.materials, minMm: old.minMm, maxMm: old.maxMm };
      else out.push(f);
    }
    onChange(out);
    setSelId((out.find((t) => t.name.toLowerCase() === found[0].name.toLowerCase()) ?? out[0]).id);
    setRowSel(null);
    setMsg({ text: `Imported ${found.length} technologies (${found.reduce((n, t) => n + t.rows.length, 0)} rows). Tag the materials and set the thickness range of each one you use.` });
  };
  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob(["﻿" + technologiesCsv(techs, technology)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `${machineName || "machine"} technology.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const groups = techColumnsFor(technology);
  const cols = groups.flatMap((g) => g.cols);
  // the first column of each group after the first: a line between the groups
  const groupStart = new Set(groups.slice(0, -1).map((_, i) => groups.slice(0, i + 1).reduce((n, g) => n + g.cols.length, 0)));
  const gs = (i: number) => (groupStart.has(i) ? "tech-gs" : undefined);
  return (
    <div className="tech">
      <div className="tech-bar">
        <span className="tech-lbl">Technology</span>
        {techs.map((t) => (
          <button key={t.id} type="button" className={`tech-chip${tech?.id === t.id ? " is-on" : ""}`} title={t.materials.length ? `Used for ${t.materials.join(", ")}` : "Used for any material"} onClick={() => { setSelId(t.id); setRowSel(null); setMsg(null); relock(); }}>{t.name}</button>
        ))}
        <button type="button" className="tech-chip is-add" disabled={locked} title={locked ? LOCKED : undefined} onClick={addNew}>+ New</button>
        <span className="tech-grow" />
        <button type="button" className={`btn btn-plain tech-lock${locked ? " is-locked" : ""}`} aria-pressed={!locked}
          title={locked ? "Every value can be changed (no password: only against changes by accident)" : "Nothing can be changed until it is unlocked again"}
          onClick={() => { setLocked(!locked); relock(); }}>
          <LockIcon open={!locked} /> {locked ? "Unlock all" : "Lock all"}
        </button>
        <button type="button" className="btn btn-plain" disabled={locked} onClick={() => file.current?.click()} title={locked ? LOCKED : "A material table (.DBF), e.g. HACO S_MAT.DBF"}>Import table…</button>
        <input ref={file} type="file" accept=".dbf,.DBF" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        <button type="button" className="btn btn-plain" disabled={!techs.length} onClick={exportCsv}>Export CSV</button>
      </div>

      {!tech && <p className="rule-help">No technologies yet. Import the machine's material table, or make a new one.</p>}

      {tech && (<>
        <div className="tech-meta">
          <label className="tech-name"><span>Name</span><input className="field" value={tech.name} readOnly={locked} title={locked ? LOCKED : undefined} onChange={(e) => setTech({ name: e.target.value })} /></label>
          <div className="tech-tags">
            <span>Used for materials</span>
            {tech.materials.map((m) => (
              <span key={m} className="tech-tag">{m}{!locked && <button type="button" aria-label={`Remove ${m}`} onClick={() => setTech({ materials: tech.materials.filter((x) => x !== m) })}>×</button>}</span>
            ))}
            {!locked && <input className="field tech-tag-in" value={tag} placeholder="+ tag" aria-label="Add a material tag"
              onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }} onBlur={addTag} />}
            {!tech.materials.length && <span className="tech-hint">none: any material</span>}
          </div>
          <div className="tech-range">
            <span>Thickness</span>
            <NumInput value={tech.minMm} min={0} readOnly={locked} tabIndex={locked ? -1 : undefined} aria-label="Used from thickness (mm)" onCommit={(n) => setTech({ minMm: n })} />
            <span>–</span>
            <NumInput value={tech.maxMm} min={0} readOnly={locked} tabIndex={locked ? -1 : undefined} aria-label="Used to thickness (mm)" onCommit={(n) => setTech({ maxMm: n })} />
            <span>mm</span>
          </div>
        </div>

        <div className="tech-scroll">
          <table className={`tech-table${locked ? " is-locked" : ""}`}>
            <thead>
              <tr>
                <th />
                {groups.map((g) => <th key={g.group} colSpan={g.cols.length} className="tech-group">{g.group}</th>)}
              </tr>
              <tr>
                <th className="tech-th">Thickness</th>
                {cols.map((c, i) => (
                  <th key={c.key + i} className={[gs(i), locked && openCols.has(c.key) ? "is-open" : ""].filter(Boolean).join(" ") || undefined}>
                    {c.label}<br /><small>{c.unit}</small>
                    {locked && (
                      <button type="button" className={`tech-lk${openCols.has(c.key) ? " is-open" : ""}`} aria-pressed={openCols.has(c.key)}
                        title={openCols.has(c.key) ? "Lock this column" : "Unlock this column only"} aria-label={`${openCols.has(c.key) ? "Lock" : "Unlock"} the column ${c.label}`}
                        onClick={() => setOpenCols(flip(openCols, c.key))}><LockIcon open={openCols.has(c.key)} /></button>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tech.rows.map((r, i) => {
                const used = inRange(tech, r.thicknessMm);
                return (
                  <tr key={`${r.thicknessMm}-${i}`} className={`${rowSel === i ? "is-sel" : ""}${used ? "" : " is-unused"}`}>
                    <th className={`tech-th${locked && openRows.has(r.thicknessMm) ? " is-open" : ""}`} onClick={() => setRowSel(rowSel === i ? null : i)} title={used ? "Click to select the row" : "Outside the thickness range: not used"}>
                      {locked && (
                        <button type="button" className={`tech-lk${openRows.has(r.thicknessMm) ? " is-open" : ""}`} aria-pressed={openRows.has(r.thicknessMm)}
                          title={openRows.has(r.thicknessMm) ? "Lock this row" : "Unlock this row only"} aria-label={`${openRows.has(r.thicknessMm) ? "Lock" : "Unlock"} the row ${r.thicknessMm} mm`}
                          onClick={(e) => { e.stopPropagation(); setOpenRows(flip(openRows, r.thicknessMm)); }}><LockIcon open={openRows.has(r.thicknessMm)} /></button>
                      )}
                      {r.thicknessMm} mm{!used && <small> not used</small>}
                    </th>
                    {cols.map((c, ci) => {
                      const ok = canEdit(r.thicknessMm, c.key);
                      return (
                        <td key={c.key} className={[gs(ci), locked && ok ? "is-open" : ""].filter(Boolean).join(" ") || undefined}>
                          <NumInput className="tech-cell" value={cellValue(r, c)} min={c.min ?? 0} aria-label={`${r.thicknessMm} mm ${c.label} (${c.unit})`}
                            readOnly={!ok} tabIndex={ok ? undefined : -1} title={ok ? undefined : "Locked: unlock its row or column, or Unlock all"}
                            onFocusCapture={() => setRowSel(i)} onCommit={(n) => ok && setCell(i, c.key, c.max !== undefined ? Math.min(c.max, n) : n)} />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="tech-bar tech-foot">
          <span className="tech-add">
            <input className="field" value={newThick} placeholder="mm" inputMode="decimal" aria-label="New thickness (mm)" disabled={locked}
              onChange={(e) => setNewThick(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addRow(); }} />
            <button type="button" className="btn btn-plain" disabled={locked || !(thick > 0)} onClick={addRow} title={locked ? LOCKED : "A copy of the next thicker row"}>+ Thickness</button>
          </span>
          <button type="button" className="btn btn-plain" disabled={locked || rowSel === null} title={locked ? LOCKED : undefined} onClick={deleteRow}>Delete row</button>
          <span className="tech-grow" />
          <button type="button" className="btn btn-danger-plain" disabled={locked} title={locked ? LOCKED : undefined} onClick={() => setAsk({ kind: "delete" })}>Delete technology</button>
        </div>
      </>)}

      {msg && <p className={`tech-msg${msg.bad ? " is-bad" : ""}`} role="status">{msg.text}</p>}
      <p className="rule-help">The table is locked when opened (against changes by accident): <b>Unlock all</b>, or the padlock of one row or one column to change only that one; Tab then goes only through the unlocked values. Click a value to change it; Tab goes to the next one. A new thickness starts as a copy of the next thicker row. Gap: + cuts past the start, − leaves a tab. Angles left empty: 90° (corner at an angle), 45° (angled with gap). Remnant cut: Gap in / Gap out from a sheet edge the cut runs to, + inside the sheet (an uncut bridge), − beyond the edge; To parts left empty: Settings → Stock and remnants → Remnants; the lead type: Leads &amp; cutting.
        {technology === "laser" && <> Laser: a contour whose longer side is up to Middle / Little is cut with the machine's middle / little values (0: not used); Pre-pierce 1 pierces every contour first, then cuts them; Tech program: the machine's technology program number for the row.</>}
        A job's sheet uses the technology tagged with its material whose thickness range has the sheet's thickness.</p>

      {ask?.kind === "delete" && tech && (
        <ConfirmDialog title={`Delete ${tech.name}?`} confirmLabel="Delete" onCancel={() => setAsk(null)}
          onConfirm={() => { const rest = techs.filter((t) => t.id !== tech.id); onChange(rest); setSelId(rest[0]?.id ?? null); setRowSel(null); setAsk(null); }}>
          Its {tech.rows.length} rows go with it.
        </ConfirmDialog>
      )}
      {ask?.kind === "import" && (
        <ConfirmDialog title="Import which technologies?" confirmLabel={`Import ${ask.pick.size || ""}`.trim()} onCancel={() => setAsk(null)}
          onConfirm={() => { if (!ask.pick.size) return; doImport(ask.found.filter((t) => ask.pick.has(t.id))); setAsk(null); }}>
          <span className="tech-pick">
            {ask.found.map((t) => (
              <label key={t.id} className="chk">
                <input type="checkbox" checked={ask.pick.has(t.id)} onChange={(e) => {
                  const pick = new Set(ask.pick); if (e.target.checked) pick.add(t.id); else pick.delete(t.id); setAsk({ ...ask, pick });
                }} />
                <b>{t.name}</b><span className="tech-hint">{t.minMm}–{t.maxMm} mm · {t.rows.length} rows</span>
              </label>
            ))}
          </span>
          Tick the ones this machine uses. One with the same name as one here is replaced (its tags and range are kept).
        </ConfirmDialog>
      )}
    </div>
  );
}
