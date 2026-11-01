import { useEffect, useMemo, useRef, useState } from "react";
import type { JobPart } from "../api/types";
import { IconClose } from "./Icons";
import {
  NEST_MODE_LABEL, hms, isFinished, partColor, sheetProblems, sheetStats,
  type NestMode, type NestedSheet, type Solution,
} from "../job/nest";
import type { Machine, Origin } from "../job/machine";
import type { StockSheet } from "../job/stock";
import { SheetPropertiesDialog } from "./SheetPropertiesDialog";

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
  /** The job's machine (gaps, 0,0) and stock (a sheet's size as added), for a sheet's properties. */
  machine: Machine;
  stock: StockSheet[];
  /** A sheet changed by hand: only that sheet. */
  onEditSheet: (solId: string, sheet: number, patch: Partial<NestedSheet>) => void;
  /** Re-nest this sheet: its parts on it alone. */
  onRenestSheet: (solId: string, sheet: number) => void;
  /** "solId:index" of the sheet being nested again */
  renesting: string | null;
}

type PartRef = { path: string; areaMm2: number; name: string; no?: number };

const MODE_SHORT: Record<NestMode, string> = { fast: "FAST", thorough: "THOROUGH", custom: "CUSTOM" };

const transformOf = (p: { x: number; y: number; angle: number; mirror: boolean }) =>
  `translate(${p.x} ${p.y}) rotate(${p.angle})${p.mirror ? " scale(-1 1)" : ""}`;

/** A nested sheet drawn to scale, every part in its own colour. */
export function SheetSvg({ sheet, parts, titles }: { sheet: NestedSheet; parts: Map<string, PartRef>; titles?: boolean }) {
  return (
    <svg className="sheet-svg" viewBox={`-4 -4 ${sheet.lengthMm + 8} ${sheet.widthMm + 8}`} preserveAspectRatio="xMidYMid meet">
      {sheet.outline?.length
        ? <path className="sheet-plate" fillRule="evenodd" d={sheet.outline.map((lp) => lp.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join("") + "Z").join("")} />
        : <rect className="sheet-plate" x={0} y={0} width={sheet.lengthMm} height={sheet.widthMm} />}
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

export function NestPage({ parts, solutions, selected, onSelect, onAdd, onStop, onRemove, onToggleLock, machine, stock, onEditSheet, onRenestSheet, renesting }: Props) {
  const [props, setProps] = useState<number | null>(null);   // nested sheet shown in Sheet properties
  const byId = useMemo(() => new Map<string, PartRef>(parts.map((jp) =>
    [jp.part.id, { path: jp.part.path, areaMm2: jp.part.areaMm2, name: jp.part.name, no: jp.no }])), [parts]);
  const sol = solutions.find((s) => s.id === selected.sol) ?? solutions[solutions.length - 1];
  // a running solution shows its best layout so far
  const sheets = sol?.run?.result?.sheets ?? sol?.run?.best?.sheets ?? [];
  const liveSheets = !!sol && !sol.run?.result && sheets.length > 0;
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
              : <p><b>Solution {sol.no} is running.</b> Its sheets show here as soon as it has a first layout.</p>}
          </div>
        )}
        {sheets.map((sh, i) => (
          <article key={i} data-sheet={i} className={`nest-card${i === sheetNo ? " is-on" : ""}`}
            onClick={() => onSelect({ sol: sol!.id, sheet: i })}>
            <header>
              <span className="nest-card-title">Solution {sol!.no} <span className="slash">/</span> Sheet {i + 1}</span>
              <button type="button" className="sheet-info" title={finished ? "Sheet properties: change this sheet only" : "Sheet info"} aria-label={`Properties of sheet ${i + 1}`}
                onClick={(e) => { e.stopPropagation(); onSelect({ sol: sol!.id, sheet: i }); if (finished) setProps(i); }}>i</button>
              <span className="nest-card-sheet" title="Material, thickness × length × width (mm)">{sh.material} {sh.thicknessMm}x{sh.lengthMm}x{sh.widthMm}</span>
              {liveSheets && <span className="nest-live-tag">best so far</span>}
              {(sh.cutNumber ?? 1) > 1 && <span className="nest-cut-tag" title="This layout is cut this many times">×{sh.cutNumber}</span>}
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
            {finished && (() => {
              const bad = sheetProblems(sh, byId, sol!.origin ?? machine.origin).outside;
              const busy = renesting === `${sol!.id}:${i}`;
              return bad > 0 || busy ? (
                <div className="nest-card-warn" role="alert" onClick={(e) => e.stopPropagation()}>
                  {busy ? <span>Nesting this sheet again…</span>
                    : <span>{bad} {bad === 1 ? "part reaches" : "parts reach"} past the trims or the edge</span>}
                  <button type="button" className="sol-btn" disabled={busy || sol!.locked.includes(i)} onClick={() => onRenestSheet(sol!.id, i)}
                    title={sol!.locked.includes(i) ? "Unlock the sheet first" : "Nest this sheet's parts again on it alone; the other sheets stay"}>Re-nest this sheet</button>
                </div>
              ) : null;
            })()}
            <div className="nest-card-body"><SheetSvg sheet={sh} parts={byId} titles /></div>
          </article>
        ))}
      </div>

      <aside className="nest-side">
        <SolutionsPanel solutions={solutions} current={sol?.id ?? null} sheetNo={sheetNo}
          onSelect={onSelect} onAdd={onAdd} onStop={onStop} onRemove={onRemove}>
          {sol && sheets.length > 0 && <InfoTabs sol={sol} sheets={sheets} sheetNo={sheetNo} parts={byId} jobParts={parts} />}
        </SolutionsPanel>
      </aside>

      {props !== null && sol && sheets[props] && (
        <SheetPropertiesDialog nested index={props} machine={machine}
          sheet={nestedAsStock(sheets[props], stock.find((s) => s.id === sheets[props].sheetId), machine)}
          onSave={(s) => onEditSheet(sol.id, props, {
            lengthMm: s.lengthMm, widthMm: s.widthMm, trims: s.trims, partGapMm: s.partGapMm, kerfMm: s.kerfMm, cutNumber: Math.max(1, s.qty || 1),
          })}
          onClose={() => setProps(null)} />
      )}
      {full !== null && sol && sheets[full] && (
        <FullView sol={sol} index={full} sheets={sheets} parts={byId} edit={editable(full)}
          onIndex={(i) => { setFull(i); onSelect({ sol: sol.id, sheet: i }); }} onClose={() => setFull(null)} />
      )}
    </div>
  );
}

function SolutionsPanel({ solutions, current, sheetNo, onSelect, onAdd, onStop, onRemove, children }: {
  children?: React.ReactNode;
  solutions: Solution[]; current: string | null; sheetNo: number;
  onSelect: (s: NestSelection) => void; onAdd: (m: NestMode) => void; onStop: (id: string) => void;
  onRemove: (id: string) => void;
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
          <button type="button" className="stock-add-btn sol-add" onClick={(e) => { e.stopPropagation(); setMenu((m) => !m); }}
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
          const best = s.run?.best?.sheets.length || (s.run?.groups ?? []).reduce((a, g) => a + (g.sheets ?? 0), 0);
          const on = s.id === current;
          const failed = s.error ?? s.run?.error;
          const skipped = s.run?.result?.skipped.length ?? 0;
          if (live) {
            // running: name and time, mode and minutes, best sheet count, VIEW and STOP AND KEEP
            return (
              <div key={s.id} data-sol={s.id} className={`sol-live${on ? " is-on" : ""}`}>
                <div className="sol-live-row">
                  <span className="sol-title">Solution {s.no}</span>
                  <span className="sol-progress">{s.run?.state === "queued" ? "Waiting" : "In progress"}<b>{hms((Date.now() - s.startedAt) / 1000)}</b></span>
                </div>
                <div className="sol-live-row">
                  <span className="sol-badge">{MODE_SHORT[s.mode]}</span>
                  {s.mode === "custom" && s.custom && <span className="sol-badge">{s.custom.minutes === null ? "∞" : `${s.custom.minutes} min`}</span>}
                </div>
                <div className="sol-live-best">{best ? `${best} ${best === 1 ? "sheet" : "sheets"}` : "no layout yet"}</div>
                <div className="sol-live-row is-end">
                  <button type="button" className="sol-btn" disabled={!s.run?.best?.sheets.length}
                    onClick={() => onSelect({ sol: s.id, sheet: 0 })} title="Show the best layout so far">VIEW</button>
                  <button type="button" className="btn btn-save sol-stop" disabled={!s.run || s.run.stopAsked} onClick={() => onStop(s.id)}
                    title="End it now and keep the best layout found so far">{s.run?.stopAsked ? "STOPPING…" : "STOP AND KEEP"}</button>
                </div>
              </div>
            );
          }
          // finished: name and mode in one box, remove beside it, the sheets as a tree below
          return (
            <div key={s.id} data-sol={s.id} className="sol">
              <div className="sol-row">
                <button type="button" className={`sol-box${on ? " is-on" : ""}`} onClick={() => onSelect({ sol: s.id, sheet: 0 })}
                  title={failed ? failed : `${sheets.length} ${sheets.length === 1 ? "sheet" : "sheets"} · ${hms(s.run?.seconds ?? 0)}${s.run?.state === "stopped" ? " · stopped" : ""}`}>
                  <span className="sol-title">Solution {s.no}</span>
                  <span className={`sol-badge${failed || s.outdated ? " is-error" : ""}`}
                    title={s.outdated ? "Nested for a machine of another technology: nest the job again" : undefined}>
                    {failed ? "FAILED" : s.outdated ? "OUT OF DATE" : MODE_SHORT[s.mode]}</span>
                </button>
                <button type="button" className="sol-x" onClick={() => onRemove(s.id)} title={`Remove solution ${s.no}`} aria-label={`Remove solution ${s.no}`}>
                  <IconClose size={16} />
                </button>
              </div>
              {failed && on && <p className="sol-err">{failed}</p>}
              {skipped > 0 && on && <p className="sol-err">{skipped} {skipped === 1 ? "part" : "parts"} not nested: {s.run!.result!.skipped[0].reason}</p>}
              {on && sheets.length > 0 && (
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
      {children}
    </section>
  );
}

const kg = (n: number) => n.toFixed(1);

type Tab = "solution" | "nest" | "parts";

/** Below the solutions, in the same tile: the whole solution, the chosen sheet, the parts on it. */
function InfoTabs({ sol, sheets, sheetNo, parts, jobParts }: {
  sol: Solution; sheets: NestedSheet[]; sheetNo: number; parts: Map<string, PartRef>; jobParts: JobPart[];
}) {
  const [tab, setTab] = useState<Tab>("solution");
  const sheet = sheets[sheetNo];
  const origin = sol.origin ?? "top-left";
  const tabs: [Tab, string][] = [["solution", "Solution info"], ["nest", "Nest info"], ["parts", "Parts info"]];
  return (
    <div className="info-tabs">
      <div className="info-tab-bar" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "is-on" : ""} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      <div className="info-head">
        {tab === "solution"
          ? <><b>Solution {sol.no}</b><span>{NEST_MODE_LABEL[sol.mode]} · {sheets.length} {sheets.length === 1 ? "sheet" : "sheets"}{sol.run?.result ? ` · ${hms(sol.run.seconds)}` : " · best so far"}</span></>
          : <><b>Solution {sol.no} <span className="slash">/</span> Sheet {sheetNo + 1}</b>
              <span>{sheet.material} · {sheet.thicknessMm} mm · {sheet.lengthMm} × {sheet.widthMm} · {sheet.parts.length} parts</span></>}
      </div>
      <div className="info-body">
        {tab === "solution" && <SolutionInfo sheets={sheets} parts={parts} jobParts={jobParts} origin={origin} />}
        {tab === "nest" && <NestInfo sheet={sheet} parts={parts} origin={origin} />}
        {tab === "parts" && <PartsInfo sheet={sheet} parts={parts} />}
      </div>
    </div>
  );
}

const pct = (n: number) => `${n.toFixed(1)} %`;

function SolutionInfo({ sheets, parts, jobParts, origin }: {
  sheets: NestedSheet[]; parts: Map<string, PartRef>; jobParts: JobPart[]; origin: Origin;
}) {
  const data = useMemo(() => {
    // per material and thickness: sheets by size, weights, efficiency
    const groups = new Map<string, { label: string; sizes: Map<string, number>; sheets: number; sheetKg: number; partsKg: number;
      remnantKg: number; usedKg: number; cutM: number; pierces: number; pieces: number }>();
    for (const sh of sheets) {
      const st = sheetStats(sh, parts, origin);
      const key = `${sh.material}|${sh.thicknessMm}`;
      const g = groups.get(key) ?? { label: `${sh.material} ${sh.thicknessMm} mm`, sizes: new Map(), sheets: 0, sheetKg: 0, partsKg: 0, remnantKg: 0, usedKg: 0, cutM: 0, pierces: 0, pieces: 0 };
      const size = `${sh.lengthMm} × ${sh.widthMm}`;
      g.sizes.set(size, (g.sizes.get(size) ?? 0) + (sh.cutNumber ?? 1));
      // a layout cut n times counts n times
      const n = sh.cutNumber ?? 1;
      g.sheets += n; g.sheetKg += n * st.sheetKg; g.partsKg += n * st.partsKg; g.remnantKg += n * st.remnantKg;
      g.usedKg += n * (st.sheetKg - st.remnantKg); g.cutM += n * st.cutM; g.pierces += n * st.pierces; g.pieces += n * st.pieces;
      groups.set(key, g);
    }
    const list = [...groups.values()];
    const sum = (f: (g: typeof list[number]) => number) => list.reduce((a, g) => a + f(g), 0);
    const nested = sheets.reduce((a, sh) => a + sh.parts.length, 0);
    const required = jobParts.reduce((a, jp) => a + jp.qty, 0);
    return { list, nested, required, sheetKg: sum((g) => g.sheetKg), partsKg: sum((g) => g.partsKg), remnantKg: sum((g) => g.remnantKg),
      usedKg: sum((g) => g.usedKg), cutM: sum((g) => g.cutM), pierces: sum((g) => g.pierces) };
  }, [sheets, parts, jobParts, origin]);
  const eff = (partsKg: number, usedKg: number) => (usedKg > 0 ? (100 * partsKg) / usedKg : 0);
  return (
    <>
      <table className="info-table">
        <thead><tr><th>Material</th><th className="num">Sheets</th><th className="num" title="Nesting efficiency: weight of the parts / weight of the sheets used (the remnant strips not counted)">Eff.</th><th className="num" title="Weight of the sheets">Sheet kg</th><th className="num" title="Weight of the parts">Part kg</th></tr></thead>
        <tbody>
          {data.list.map((g) => (
            <tr key={g.label}>
              <td><b>{g.label}</b>{[...g.sizes].map(([size, n]) => <div key={size} className="info-sub">{n} × {size}</div>)}</td>
              <td className="num">{g.sheets}</td>
              <td className="num">{pct(eff(g.partsKg, g.usedKg))}</td>
              <td className="num">{kg(g.sheetKg)}</td>
              <td className="num">{kg(g.partsKg)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function NestInfo({ sheet, parts, origin }: { sheet: NestedSheet; parts: Map<string, PartRef>; origin: Origin }) {
  const st = useMemo(() => sheetStats(sheet, parts, origin), [sheet, parts, origin]);
  const used = st.sheetKg - st.remnantKg;
  const rows: [string, string, string?][] = [
    ["Efficiency (%)", (used > 0 ? (100 * st.partsKg) / used : 0).toFixed(1), "Weight of the parts / weight of the sheet without the remnant strip"],
    ["Cut Area XY (mm)", `${Math.round(st.cutX)} x ${Math.round(st.cutY)}`, "From the origin corner to the farthest part"],
    ["Sheet (kg)", kg(st.sheetKg)],
    ["Part weight (kg)", kg(st.partsKg)],
    ["Scrap (kg)", kg(st.scrapKg), "Inside the cut area, between the parts"],
    ["Remnant (kg)", kg(st.remnantKg), "The strip after the cut area, the sheet's full width"],
    ["Remnant (%)", st.remnantPct.toFixed(0)],
    ["Unused (kg)", kg(st.unusedKg), "Beside the cut area, outside the remnant strip"],
    ["Unused (%)", st.unusedPct.toFixed(0)],
    ["Cutting Number", String(sheet.cutNumber ?? 1), "How many times this layout is cut (Sheet properties of the sheet)"],
    ["Time Rapid", "—", "Needs the technology tables"],
    ["Time Cutting", "—", "Needs the technology tables"],
    ["Time Total", "—", "Needs the technology tables"],
  ];
  return (
    <dl className="sheet-stats-list">
      {rows.map(([k, v, hint]) => (
        <div key={k} title={hint}><dt>{k}</dt><dd className={v === "—" ? "is-na" : ""}>{v}</dd></div>
      ))}
    </dl>
  );
}

function PartsInfo({ sheet, parts }: { sheet: NestedSheet; parts: Map<string, PartRef> }) {
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of sheet.parts) m.set(p.partId, (m.get(p.partId) ?? 0) + 1);
    return [...m].map(([id, n]) => ({ id, n, part: parts.get(id) })).sort((a, b) => (a.part?.no ?? 0) - (b.part?.no ?? 0));
  }, [sheet, parts]);
  return (
    <table className="info-table">
      <thead><tr><th>ID</th><th>Part</th><th className="num">Qty</th></tr></thead>
      <tbody>
        {counts.map(({ id, n, part }) => (
          <tr key={id}>
            <td className="info-id"><span className="part-swatch" style={{ background: partColor(part?.no).fill, borderColor: partColor(part?.no).stroke }} />{part?.no ?? ""}</td>
            <td className="info-name" title={part?.name}>{part?.name ?? id}</td>
            <td className="num"><b>{n}</b></td>
          </tr>
        ))}
      </tbody>
      <tfoot><tr><td /><td>Total</td><td className="num"><b>{sheet.parts.length}</b></td></tr></tfoot>
    </table>
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

/** A nested sheet in the shape Sheet properties edits; RESET goes back to its stock sheet as added. */
function nestedAsStock(sh: NestedSheet, from: StockSheet | undefined, m: Machine): StockSheet {
  return {
    id: sh.sheetId, source: from?.source ?? "parts", material: sh.material, thicknessMm: sh.thicknessMm,
    lengthMm: sh.lengthMm, widthMm: sh.widthMm, qty: sh.cutNumber ?? 1, unlimited: false,
    trims: sh.trims ?? from?.trims ?? { ...m.trims }, partGapMm: sh.partGapMm ?? from?.partGapMm ?? m.partGapMm,
    kerfMm: sh.kerfMm ?? from?.kerfMm, outline: sh.outline, fileName: from?.fileName,
    original: { lengthMm: from?.lengthMm ?? sh.lengthMm, widthMm: from?.widthMm ?? sh.widthMm, outline: from?.outline ?? sh.outline },
  };
}
