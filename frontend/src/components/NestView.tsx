import { useEffect, useMemo, useRef, useState } from "react";
import type { JobPart } from "../api/types";
import { IconClose } from "./Icons";
import {
  NEST_MODE_LABEL, hms, isFinished, partColor, sheetStats,
  type NestMode, type NestedSheet, type Solution,
} from "../job/nest";

// The nest screen of a job (after Fab's layout): the chosen solution's sheets, four to a screen
// (scroll for more), each with [i], VIEW (EDIT once unlocked) and a lock; on the right the
// SOLUTIONS panel (every nesting run of this job, one after another) and the chosen sheet's info.

export interface NestSelection { sol: string | null; sheet: number }

interface Props {
  parts: JobPart[];
  solutions: Solution[];
  selected: NestSelection;
  onSelect: (s: NestSelection) => void;
  onAdd: (mode: NestMode) => void;
  onStop: (solId: string) => void;
  onRemove: (solId: string) => void;
  onToggleLock: (solId: string, sheet: number) => void;
  onSave: (solId: string) => void;
}

type PartRef = { path: string; areaMm2: number; name: string; no?: number };

const MODE_SHORT: Record<NestMode, string> = { fast: "FAST", thorough: "THOROUGH", custom: "CUSTOM" };

const transformOf = (p: { x: number; y: number; angle: number; mirror: boolean }) =>
  `translate(${p.x} ${p.y}) rotate(${p.angle})${p.mirror ? " scale(-1 1)" : ""}`;

/** A nested sheet drawn to scale, every part in its own colour. */
export function SheetSvg({ sheet, parts, titles }: { sheet: NestedSheet; parts: Map<string, PartRef>; titles?: boolean }) {
  return (
    <svg className="sheet-svg" viewBox={`-4 -4 ${sheet.lengthMm + 8} ${sheet.widthMm + 8}`} preserveAspectRatio="xMidYMid meet">
      <rect className="sheet-plate" x={0} y={0} width={sheet.lengthMm} height={sheet.widthMm} />
      {sheet.parts.map((p, i) => {
        const part = parts.get(p.partId);
        if (!part) return null;
        const c = partColor(part.no);
        return (
          <path key={i} className="sheet-part" d={part.path} transform={transformOf(p)} fillRule="evenodd"
            style={{ fill: c.fill, stroke: c.stroke }}>
            {titles && <title>{part.name}</title>}
          </path>
        );
      })}
    </svg>
  );
}

const Lock = ({ open }: { open: boolean }) => (
  <svg viewBox="0 0 40 40" width="30" height="30" aria-hidden="true">
    <path d={open ? "M21 18V11a7.5 7.5 0 0 1 15 0v4" : "M8.5 18V11a7.5 7.5 0 0 1 15 0v7"} fill="none" stroke="currentColor" strokeWidth="4" />
    <rect x="3" y="17" width="26" height="21" rx="3" fill="currentColor" />
    <rect x="14.5" y="23" width="3" height="9" rx="1.5" fill="#fff" />
  </svg>
);

export function NestPage({ parts, solutions, selected, onSelect, onAdd, onStop, onRemove, onToggleLock, onSave }: Props) {
  const byId = useMemo(() => new Map<string, PartRef>(parts.map((jp) =>
    [jp.part.id, { path: jp.part.path, areaMm2: jp.part.areaMm2, name: jp.part.name, no: jp.no }])), [parts]);
  const sol = solutions.find((s) => s.id === selected.sol) ?? solutions[solutions.length - 1];
  const sheets = sol?.run?.result?.sheets ?? [];
  const sheetNo = Math.min(selected.sheet, Math.max(0, sheets.length - 1));
  const [full, setFull] = useState<number | null>(null);
  const grid = useRef<HTMLDivElement>(null);

  // the chosen sheet scrolls into view (chosen from the SOLUTIONS panel)
  useEffect(() => {
    grid.current?.querySelector<HTMLElement>(`[data-sheet="${sheetNo}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [sheetNo, sol?.id]);

  const finished = sol && isFinished(sol.run) && !sol.error;
  const editable = (i: number) => !!finished && !sol!.locked.includes(i);

  return (
    <div className="nest-page">
      <div className="nest-grid" ref={grid} aria-label="Sheets">
        {!sol && (
          <div className="nest-empty">
            <p><b>No solution yet.</b></p>
            <p>Press Fast, Thorough or Custom (Automatic nest), or Add New Solution on the right.</p>
          </div>
        )}
        {sol && !sheets.length && (
          <div className="nest-empty">
            {sol.error || sol.run?.error ? <p className="nest-err">Solution {sol.no}: {sol.error ?? sol.run?.error}</p>
              : isFinished(sol.run) ? <p>Solution {sol.no} has no sheets.</p>
              : <p><b>Solution {sol.no} is running.</b> Its sheets show here when it finishes, or press Stop and keep.</p>}
          </div>
        )}
        {sheets.map((sh, i) => (
          <article key={i} data-sheet={i} className={`nest-card${i === sheetNo ? " is-on" : ""}`}
            onClick={() => onSelect({ sol: sol!.id, sheet: i })}>
            <header>
              <span className="nest-card-title">Solution {sol!.no} <span className="slash">/</span> Sheet {i + 1}</span>
              <button type="button" className="nest-i" title="Sheet info" aria-label={`Info on sheet ${i + 1}`}
                onClick={(e) => { e.stopPropagation(); onSelect({ sol: sol!.id, sheet: i }); }}>i</button>
              <span className="nest-card-gap" />
              <button type="button" className="nest-view" onClick={(e) => { e.stopPropagation(); onSelect({ sol: sol!.id, sheet: i }); setFull(i); }}
                title={editable(i) ? "Full screen, to change the sheet by hand" : "Full screen"}>{editable(i) ? "EDIT" : "VIEW"}</button>
              <button type="button" className={`nest-lock${sol!.locked.includes(i) ? " is-locked" : ""}`}
                disabled={!finished}
                title={sol!.locked.includes(i) ? "Locked: kept as it is. Click to unlock (then EDIT)" : "Unlocked: can be changed. Click to lock"}
                aria-pressed={sol!.locked.includes(i)}
                onClick={(e) => { e.stopPropagation(); onToggleLock(sol!.id, i); }}>
                <Lock open={!sol!.locked.includes(i)} />
              </button>
            </header>
            <div className="nest-card-body"><SheetSvg sheet={sh} parts={byId} titles /></div>
          </article>
        ))}
      </div>

      <aside className="nest-side">
        <SolutionsPanel solutions={solutions} current={sol?.id ?? null} sheetNo={sheetNo}
          onSelect={onSelect} onAdd={onAdd} onStop={onStop} onRemove={onRemove} onSave={onSave} />
        {sol && sheets[sheetNo] && <SheetInfo solNo={sol.no} sheetNo={sheetNo} sheet={sheets[sheetNo]} parts={byId} />}
      </aside>

      {full !== null && sol && sheets[full] && (
        <FullView sol={sol} index={full} sheets={sheets} parts={byId} edit={editable(full)}
          onIndex={(i) => { setFull(i); onSelect({ sol: sol.id, sheet: i }); }} onClose={() => setFull(null)} />
      )}
    </div>
  );
}

function SolutionsPanel({ solutions, current, sheetNo, onSelect, onAdd, onStop, onRemove, onSave }: {
  solutions: Solution[]; current: string | null; sheetNo: number;
  onSelect: (s: NestSelection) => void; onAdd: (m: NestMode) => void; onStop: (id: string) => void;
  onRemove: (id: string) => void; onSave: (id: string) => void;
}) {
  const [menu, setMenu] = useState(false);
  const [, tick] = useState(0);
  const running = solutions.some((s) => !isFinished(s.run) && !s.error);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [running]);
  // the chosen solution, or one that has just started, stays in view
  const list = useRef<HTMLDivElement>(null);
  const liveId = solutions.find((s) => !isFinished(s.run) && !s.error)?.id;
  useEffect(() => {
    const id = liveId ?? current;
    list.current?.querySelector<HTMLElement>(`[data-sol="${id}"]`)?.scrollIntoView({ block: "nearest" });
  }, [liveId, current]);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);

  return (
    <section className="sol-panel" aria-label="Solutions">
      <header className="sol-head">
        <h2>Solutions</h2>
        <span className="sol-add-wrap">
          <button type="button" className="sol-add" onClick={(e) => { e.stopPropagation(); setMenu((m) => !m); }}
            disabled={running} title={running ? "A solution is running; the next one starts after it" : "Nest the job again, another way"}>Add New Solution</button>
          {menu && (
            <span className="sol-menu" role="menu">
              {(["fast", "thorough", "custom"] as NestMode[]).map((m) => (
                <button key={m} type="button" role="menuitem" onClick={() => { setMenu(false); onAdd(m); }}>
                  {NEST_MODE_LABEL[m]}{m === "custom" ? "…" : ""}
                </button>
              ))}
            </span>
          )}
        </span>
      </header>
      <div className="sol-list" ref={list}>
        {!solutions.length && <p className="sol-none">None yet.</p>}
        {solutions.map((s) => {
          const live = !isFinished(s.run) && !s.error;
          const sheets = s.run?.result?.sheets ?? [];
          const best = (s.run?.groups ?? []).reduce((a, g) => a + (g.sheets ?? 0), 0);
          const on = s.id === current;
          const failed = s.error ?? s.run?.error;
          return (
            <div key={s.id} data-sol={s.id} className={`sol${on ? " is-on" : ""}${live ? " is-live" : ""}`}>
              <div className="sol-row">
                <button type="button" className="sol-name" onClick={() => onSelect({ sol: s.id, sheet: 0 })}>
                  SOLUTION {s.no}
                </button>
                {live ? (
                  <span className="sol-progress">{s.run?.state === "queued" ? "WAITING" : "IN PROGRESS"} <b>{hms((Date.now() - s.startedAt) / 1000)}</b></span>
                ) : (
                  <span className="sol-badge">{MODE_SHORT[s.mode]}</span>
                )}
                {!live && sheets.length > 0 && (
                  <button type="button" className={`sol-save${s.saved ? " is-saved" : ""}`} onClick={() => onSave(s.id)}
                    title={s.saved ? "This is the solution kept for the job" : "Keep this solution for the job"}>{s.saved ? "SAVED" : "SAVE"}</button>
                )}
                {!live && (
                  <button type="button" className="sol-x" onClick={() => onRemove(s.id)} title={`Remove solution ${s.no}`} aria-label={`Remove solution ${s.no}`}>
                    <IconClose size={16} />
                  </button>
                )}
              </div>
              {live && (
                <div className="sol-live">
                  <span className="sol-badge">{MODE_SHORT[s.mode]}</span>
                  {s.mode === "custom" && s.custom && <span className="sol-badge">{s.custom.minutes === null ? "∞" : `${s.custom.minutes}min`}</span>}
                  <span className="sol-best">{best ? `${best} ${best === 1 ? "sheet" : "sheets"}` : "no layout yet"}</span>
                  <span className="sol-live-gap" />
                  <button type="button" className="sol-stop" disabled={!s.run || s.run.stopAsked} onClick={() => onStop(s.id)}
                    title="End it now and keep the best layout found so far">{s.run?.stopAsked ? "STOPPING…" : "STOP AND KEEP"}</button>
                </div>
              )}
              {!live && failed && <p className="sol-err">{failed}</p>}
              {!live && !failed && (
                <p className="sol-sum">
                  {sheets.length} {sheets.length === 1 ? "sheet" : "sheets"} · {hms(s.run?.seconds ?? 0)}
                  {s.run?.state === "stopped" ? " · stopped" : ""}
                  {(s.run?.result?.skipped.length ?? 0) > 0 && <span className="sol-warn"> · {s.run!.result!.skipped.length} not nested</span>}
                </p>
              )}
              {on && !live && sheets.length > 0 && (
                <ol className="sol-tree">
                  {sheets.map((_, i) => (
                    <li key={i}>
                      <button type="button" className={i === sheetNo ? "is-on" : ""} onClick={() => onSelect({ sol: s.id, sheet: i })}>
                        Sheet {i + 1}
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

const kg = (n: number) => n.toFixed(1);

function SheetInfo({ solNo, sheetNo, sheet, parts }: { solNo: number; sheetNo: number; sheet: NestedSheet; parts: Map<string, PartRef> }) {
  const [tab, setTab] = useState<"nest" | "parts">("nest");
  const st = useMemo(() => sheetStats(sheet, parts), [sheet, parts]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of sheet.parts) m.set(p.partId, (m.get(p.partId) ?? 0) + 1);
    return [...m].map(([id, n]) => ({ id, n, part: parts.get(id) })).sort((a, b) => (a.part?.no ?? 0) - (b.part?.no ?? 0));
  }, [sheet, parts]);
  const rows: [string, string, string?][] = [
    ["Cut Area XY (mm)", `${Math.round(st.cutX)} x ${Math.round(st.cutY)}`, "From the sheet's corner to the farthest part"],
    ["Sheet (kg)", kg(st.sheetKg)],
    ["Part weight (kg)", kg(st.partsKg)],
    ["Scrap (kg)", kg(st.scrapKg), "Inside the cut area, between the parts"],
    ["Remnant (kg)", kg(st.remnantKg), "The strip after the cut area, the sheet's full width"],
    ["Remnant (%)", st.remnantPct.toFixed(0)],
    ["Unused (kg)", kg(st.unusedKg), "Beside the cut area, outside the remnant strip"],
    ["Unused (%)", st.unusedPct.toFixed(0)],
    ["Cut length (m)", st.cutM.toFixed(1)],
    ["Pierces", String(st.pierces)],
    ["Cutting Number", "1", "How many times this sheet is cut"],
    ["Time Rapid", "—", "Needs the technology tables"],
    ["Time Cutting", "—", "Needs the technology tables"],
    ["Time Total", "—", "Needs the technology tables"],
  ];
  return (
    <section className="sheet-stats" aria-label={`Solution ${solNo}, sheet ${sheetNo + 1}`}>
      <header>
        <b>Solution {solNo} <span className="slash">/</span> Sheet {sheetNo + 1}</b>
        <span className="sheet-stats-line">
          <span>{sheet.material}</span><span>{sheet.thicknessMm}mm</span><span>{sheet.lengthMm}x{sheet.widthMm}</span><span>{st.pieces} Parts</span>
        </span>
      </header>
      <div className="sheet-stats-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "nest"} className={tab === "nest" ? "is-on" : ""} onClick={() => setTab("nest")}>Nest info</button>
        <button type="button" role="tab" aria-selected={tab === "parts"} className={tab === "parts" ? "is-on" : ""} onClick={() => setTab("parts")}>Part info</button>
      </div>
      {tab === "nest" ? (
        <dl className="sheet-stats-list">
          {rows.map(([k, v, hint]) => (
            <div key={k} title={hint}><dt>{k}</dt><dd className={v === "—" ? "is-na" : ""}>{v}</dd></div>
          ))}
        </dl>
      ) : (
        <ul className="sheet-parts">
          {counts.map(({ id, n, part }) => (
            <li key={id}>
              <span className="part-swatch" style={{ background: partColor(part?.no).fill, borderColor: partColor(part?.no).stroke }} />
              <span className="sheet-parts-no">{part?.no ?? ""}</span>
              <span className="sheet-parts-name">{part?.name ?? id}</span>
              <b>{n}</b>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FullView({ sol, index, sheets, parts, edit, onIndex, onClose }: {
  sol: Solution; index: number; sheets: NestedSheet[]; parts: Map<string, PartRef>; edit: boolean;
  onIndex: (i: number) => void; onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && index < sheets.length - 1) onIndex(index + 1);
      if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, sheets.length, onClose, onIndex]);
  const sh = sheets[index];
  return (
    <div className="full-view" role="dialog" aria-modal="true" aria-label={`Solution ${sol.no}, sheet ${index + 1}`}>
      <header>
        <b>Solution {sol.no} <span className="slash">/</span> Sheet {index + 1} of {sheets.length}</b>
        <span>{sh.material} {sh.thicknessMm} mm · {sh.lengthMm} × {sh.widthMm} · {sh.parts.length} parts</span>
        {edit && <span className="full-edit">EDIT · the manual nest tools for changing a sheet come next</span>}
        <span className="nest-card-gap" />
        <button type="button" className="full-nav" disabled={index === 0} onClick={() => onIndex(index - 1)} aria-label="Previous sheet">‹</button>
        <button type="button" className="full-nav" disabled={index === sheets.length - 1} onClick={() => onIndex(index + 1)} aria-label="Next sheet">›</button>
        <button type="button" className="icon-btn dlg-close" onClick={onClose} aria-label="Close" title="Close (Esc)"><IconClose size={16} /></button>
      </header>
      <div className="full-body"><SheetSvg sheet={sh} parts={parts} titles /></div>
    </div>
  );
}
