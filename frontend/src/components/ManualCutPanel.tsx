import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CUT_RULES, liveContours, originPoint, partContainers, processSheet, processedParts, rapidsOf, ruleOrder, type CutContour, type CutRule, type SheetCut } from "../job/cutPath";
import { diag } from "../job/diag";
import type { Machine, Origin } from "../job/machine";
import { contourKind, keptEnd, pathReorder, pathSteps, pickContour, pickedPlan, reorderCut, type CutUnit } from "../job/manualCut";
import type { Pt } from "../job/manualGeom";
import { partColor, type NestedSheet } from "../job/nest";
import type { CutMode } from "./ManualNest";
import { GEAR_BIG, GEAR_SMALL, loadRule } from "./CutView";
import toolManualCut from "../shell/jobtools/tool-manualCut.png";

// Process -> Manual cut (after Auto cut's Selected parts), two ways (the toggle on top):
//
// CONTOUR CUT ORDER: SELECT, then click contours of the processed sheet in the order to cut them; the
// list holds them in that order (drag, or Up / Down, to change it). Picked contours glow on the sheet,
// the one chosen in the list glows stronger. PROCESS puts them in the cut path in that order, in the
// places they had (the rest stays where it is).
//
// PATH CUT ORDER: the timeline under the sheet goes along the cut path part by part (the parts turn from
// colored to cut, as in the simulation). Set it at the last part that is cut right, SELECT, click the
// parts to cut next in that order; COMPLETE keeps the path up to the timeline, cuts the picked parts
// next and sorts the rest by the rule of the sheet's last Auto cut (their contours as they are: leads,
// micro joints, break cuts). What is cut as one moves as one (a common cut block, the inline passes, a
// common pierce group); a part in another part's hole still comes before it. UNDO takes the change back.
//
// No Auto cut needed first: SELECT on a sheet without a cut path processes it (Auto cut, Selected sheet,
// the rule picked there last), and parts not processed yet (added or moved since) are processed after the
// rest, so every contour can be picked. A Cut internal path is left as it is (its other parts are left
// out on purpose).
//
// A part shows as its ID in the job part list and its copy on the sheet (12_3: part 12, its third copy),
// the name on hover.

type PartRef = { path: string; name?: string; no?: number };
type Mode = "contour" | "path";

const MODE_KEY = "gnezdo.manualCutMode";
const loadMode = (): Mode => { try { return localStorage.getItem(MODE_KEY) === "contour" ? "contour" : "path"; } catch { return "path"; } };

const WHY: Record<NonNullable<CutUnit["why"]>, string> = { block: "common cut block", inline: "inline cut", pierce: "common pierce" };
const endOf = (c: CutContour): Pt => c.leadOut[c.leadOut.length - 1] ?? c.pts[c.pts.length - 1];

type Hist = { index: number; before: SheetCut; after: SheetCut; pos: number | null }[];
/** What the panel holds, kept while the job's tab is closed (another tab, Parts, Settings): back on the
 *  same sheet with the same cut path, it is all there again (picks, SELECT, the timeline, UNDO). */
interface Kept {
  index: number; cut: SheetCut | undefined;
  picking: boolean; picked: number[]; next: { unit: number; part: number }[]; pos: number | null; hist: Hist;
}
const kept = new Map<string, Kept>();

export function useManualCut({ index, single, sheets, parts, machine, origin, onCut, keepKey }: {
  index: number;
  /** what the panel holds is kept under this (the solution) while the job's tab is closed */
  keepKey: string;
  /** one sheet open (contours can be picked) */
  single: boolean;
  sheets: NestedSheet[];
  parts: Map<string, PartRef>;
  machine: Machine;
  origin: Origin;
  onCut: (index: number, cut: NonNullable<NestedSheet["cut"]>) => void;
}): { panel: ReactNode; cut: CutMode } {
  const sheet = sheets[index] as NestedSheet | undefined;
  const liveList = useMemo(() => (sheet ? liveContours(sheet) : []), [sheet]);
  const live = useMemo(() => new Set(liveList), [liveList]);
  const steps = useMemo(() => pathSteps(liveList), [liveList]);
  const paths = useMemo(() => new Map([...parts].map(([id, r]) => [id, r.path])), [parts]);
  // back from another tab: what was there (only on the same sheet with the same cut path; UNDO always,
  // it checks the cut path itself)
  const back = useRef<Kept | null | undefined>(undefined);
  if (back.current === undefined) {
    const k = kept.get(keepKey);
    back.current = k && k.index === index && k.cut === sheet?.cut ? k : null;
  }
  const b0 = back.current;
  const [mode, setModeState] = useState<Mode>(loadMode);
  const setMode = (m: Mode) => { setModeState(m); try { localStorage.setItem(MODE_KEY, m); } catch { /* not kept */ } };
  const [picking, setPicking] = useState(b0?.picking ?? false);
  /** Contour cut order: indexes in sheet.cut.contours, in the order picked */
  const [picked, setPicked] = useState<number[]>(b0?.picked ?? []);
  const [rowSel, setRowSel] = useState<number | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  /** Path cut order: the units picked (index in steps.units) and the part clicked for each, in that order */
  const [next, setNext] = useState<{ unit: number; part: number }[]>(b0?.next ?? []);
  /** Path cut order: the steps kept (null: the whole path) */
  const [pos, setPos] = useState<number | null>(b0?.pos ?? null);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  /** UNDO: the cut paths before each change made here */
  // (the cut path itself, not its time: Lead in / out, Break cut, Micro joint, Movement, Inline cut and
  // Common pierce change it in place)
  const [hist, setHist] = useState<Hist>(() => kept.get(keepKey)?.hist ?? []);
  /** the cut path made here (the timeline stays where it was put); another one: the whole path again */
  const ours = useRef<{ cut: SheetCut; pos: number | null } | null>(null);
  /** a part lying in another part's hole: that part (it must be cut after it) */
  const container = useMemo(() => (sheet ? partContainers(sheet, paths, steps.units.flatMap((u) => u.parts)) : new Map<number, number>()), [steps, paths]);   // eslint-disable-line react-hooks/exhaustive-deps
  /** the steps as they are (a part moved since processing drops out of them) */
  const sig = useMemo(() => steps.units.map((u) => u.parts.join("+")).join(","), [steps]);
  // another sheet, or the cut path changed (by any tool, processed again, moved parts): a fresh pick
  // the sheet and path the panel's state is for (brought back from another tab: the ones it was kept with)
  const selectAfter = useRef(false);
  const shownFor = useRef<{ index: number; cut: SheetCut | undefined; sig: string } | null>(b0 ? { index, cut: sheet?.cut, sig } : null);
  useEffect(() => {
    const f = shownFor.current;
    if (f && f.index === index && f.cut === sheet?.cut && f.sig === sig) return;
    shownFor.current = { index, cut: sheet?.cut, sig };
    setPicked([]); setRowSel(null); setPicking(false); setNext([]);
    // processed by SELECT just now: picking goes on
    if (selectAfter.current) { selectAfter.current = false; setPicking(true); }
    const o = ours.current;
    setPos(o && o.cut === sheet?.cut ? o.pos : null);
    ours.current = null;
  }, [index, sheet?.cut, sig]);   // eslint-disable-line react-hooks/exhaustive-deps
  // the tool left (another Process tool, or BACK to the sheets): the picks go (switching tabs keeps them)
  useEffect(() => { if (!single) { setPicking(false); setPicked([]); setRowSel(null); setNext([]); } }, [single]);
  useEffect(() => { kept.set(keepKey, { index, cut: sheet?.cut, picking, picked, next, pos, hist }); });

  const cutPath = sheet?.cut;
  const can = single && !!cutPath && live.size > 0;
  /** SELECT works on any open sheet with parts: what is not processed yet is processed first */
  const canSelect = single && !!sheet?.parts.length;
  const [busy, setBusy] = useState(false);
  /** the parts not in the cut path (none processed: all), unless it is a Cut internal path */
  const missing = useMemo(() => {
    if (!sheet || sheet.cut?.internal) return [];
    if (!sheet.cut) return sheet.parts.map((_, i) => i);
    const ok = processedParts(sheet, (id) => paths.get(id));
    return sheet.parts.map((_, i) => i).filter((i) => !ok.has(i));
  }, [sheet, paths]);
  /** SELECT: on (processing what is missing first) or off */
  const toggleSelect = async () => {
    if (picking) { setPicking(false); return; }
    if (!sheet || busy) return;
    if (!missing.length) { setPicking(true); setMsg(null); return; }
    setBusy(true);
    try {
      const all = !sheet.cut || missing.length === sheet.parts.length;
      const r = all ? loadRule() : rule;
      const { leadFit: _f, keptFirst: _k, ...cut } = await processSheet({
        sheet, paths, machine, origin, rule: r, what: "all", parts: all ? null : missing, ordered: false, traceOf: () => true,
      });
      void _f; void _k;
      // Contour cut order: picking goes on; Path cut order: the timeline is moved back first
      selectAfter.current = mode === "contour";
      onCut(index, cut);
      diag("process", `Manual cut: ${all ? "sheet" : `${missing.length} parts`} processed first on sheet ${index + 1}`, { rule: r });
      setMsg({ text: all
        ? `Sheet processed first (Auto cut, ${CUT_RULES.find((x) => x.id === r)?.label.toLowerCase() ?? r}): click its contours in the order to cut them`
        : `${missing.length} ${missing.length === 1 ? "part" : "parts"} not processed yet: processed first, after the rest of the path` });
    } catch (e) {
      setMsg({ text: `Not processed: ${(e as Error).message}`, bad: true });
    } finally { setBusy(false); }
  };
  const n = steps.units.length;
  const at = pos === null ? n : Math.min(pos, n);
  const rule: CutRule = cutPath?.autoRule ?? (cutPath && cutPath.rule !== "manual" ? cutPath.rule : loadRule());
  const ruleLabel = CUT_RULES.find((r) => r.id === rule)?.label ?? rule;
  const nameOf = (part: number) => { const p = sheet?.parts[part]; return (p && parts.get(p.partId)?.name) ?? `Part ${part + 1}`; };
  // a part as its ID in the job part list and which copy of it on the sheet it is: 12_3
  const copyNo = useMemo(() => {
    const seen = new Map<string, number>();
    return (sheet?.parts ?? []).map((p) => { const k = (seen.get(p.partId) ?? 0) + 1; seen.set(p.partId, k); return k; });
  }, [sheet?.parts]);
  const idOf = (part: number) => { const p = sheet?.parts[part]; const no = p ? parts.get(p.partId)?.no : undefined; return `${no ?? "?"}_${copyNo[part] ?? 1}`; };
  const labelOf = (c: CutContour) => (c.parts ? `Block ${c.parts.map(idOf).join(", ")}` : idOf(c.part));
  const fullOf = (c: CutContour) => (c.parts ? c.parts.map((i) => `${idOf(i)} ${nameOf(i)}`).join(", ") : `${idOf(c.part)} ${nameOf(c.part)}`);
  const colorOf = (part: number) => { const p = sheet?.parts[part]; const no = p ? parts.get(p.partId)?.no : undefined; return no !== undefined ? partColor(no) : null; };

  const remember = (before: SheetCut, after: SheetCut, keep: number | null) => {
    setHist((h) => [...h.filter((x) => x.index !== index || x.after === before).slice(-19), { index, before, after, pos }]);
    ours.current = { cut: after, pos: keep };
    onCut(index, after);
  };
  const last = [...hist].reverse().find((h) => h.index === index);
  // only while the path is still the one made here (changed since by another tool: that would be lost)
  const canUndo = !!last && !!cutPath && last.after === cutPath;
  const undo = () => {
    if (!last || !canUndo) return;
    setHist((h) => h.filter((x) => x !== last));
    ours.current = { cut: last.before, pos: last.pos };
    onCut(index, last.before);
    diag("process", `Manual cut undone on sheet ${index + 1}`, {});
    setMsg({ text: "The last change taken back" });
  };

  // ---------------------------------------------------------------- Contour cut order

  /** a contour out of the list (the ones after it move up a place) */
  const drop = (k: number) => { setPicked((l) => l.filter((x) => x !== k)); setRowSel((r) => (r === k ? null : r)); };
  const point = (x: number, y: number, scale: number) => {
    if (!cutPath) return;
    const k = pickContour(cutPath, live, [x, y], Math.max(2, 12 / scale));
    // a picked contour clicked again: out (SELECT on or off); a new one: in (SELECT on)
    if (k >= 0 && picked.includes(k)) { setMsg(null); drop(k); return; }
    if (!picking) return;
    if (k < 0) { setMsg({ text: "Click on a contour (its line or its leads)", bad: true }); return; }
    setMsg(null);
    setPicked((l) => [...l, k]);
  };
  const move = (from: number, to: number) => setPicked((l) => {
    if (to < 0 || to >= l.length || from === to) return l;
    const m = l.slice();
    const [x] = m.splice(from, 1);
    m.splice(to, 0, x);
    return m;
  });
  const apply = () => {
    if (!sheet || !cutPath || !picked.length) return;
    const r = reorderCut(cutPath, picked, (i) => `${idOf(i)} (${nameOf(i)})`);
    if (typeof r === "string") { setMsg({ text: r, bad: true }); return; }
    remember(cutPath, r, null);
    diag("process", `Manual cut on sheet ${index + 1}`, { contours: picked.length });
    setMsg({ text: `${picked.length} ${picked.length === 1 ? "contour" : "contours"} put in the order picked` });
    setPicked([]); setRowSel(null); setPicking(false);
  };

  // ---------------------------------------------------------------- Path cut order

  const toStep = (k: number) => {
    const p = Math.max(0, Math.min(n, k));
    setPos(p >= n ? null : p);
    // a picked part the timeline went past is cut already: out of the list
    setNext((l) => l.filter((x) => x.unit >= p));
    if (p >= n) setPicking(false);
    setMsg(null);
  };
  const pickPart = (i: number) => {
    const j = steps.unitOf.get(i);
    if (j === undefined) { setMsg({ text: `${idOf(i)} (${nameOf(i)}) is not processed: process it first (Auto cut)`, bad: true }); return; }
    if (next.some((x) => x.unit === j)) { setNext((l) => l.filter((x) => x.unit !== j)); setMsg(null); return; }
    if (!picking) { setMsg({ text: at >= n ? "Move the timeline back to the last part cut right, then press SELECT" : "Press SELECT first, then click the parts to cut next" }); return; }
    if (j < at) {
      setMsg({ text: `${idOf(i)} (${nameOf(i)}) is cut already at the timeline (part ${j + 1}): move the timeline back before it to change its place`, bad: true });
      return;
    }
    setMsg(null);
    setNext((l) => [...l, { unit: j, part: i }]);
  };
  const complete = () => {
    if (!sheet || !cutPath || !next.length) return;
    const units = next.map((x) => x.unit);
    const end = keptEnd(steps, at);
    // the rest is sorted from where the head is after the picked parts
    const ks = units.flatMap((j) => steps.units[j].ks.filter((k) => k > end));
    const lastC = ks.length ? steps.list[ks[ks.length - 1]] : steps.list[end];
    const from = lastC ? endOf(lastC) : originPoint(sheet, origin);
    const restUnits = steps.units.filter((_, j) => j >= at && !units.includes(j));
    const rest = ruleOrder(sheet, paths, restUnits.flatMap((u) => u.parts), rule, machine, from, restUnits.filter((u) => u.parts.length > 1).map((u) => u.parts));
    const r = pathReorder(cutPath, steps, at, units, rest, container, (i) => `${idOf(i)} (${nameOf(i)})`);
    if (typeof r === "string") { setMsg({ text: r, bad: true }); return; }
    const keep = at + r.next;
    remember(cutPath, r.cut, keep >= n ? null : keep);
    diag("process", `Path cut order on sheet ${index + 1}`, { kept: at, picked: units.length, rest: restUnits.length, rule });
    const pulled = r.next - units.length;
    setMsg({ text: `${units.length} ${units.length === 1 ? "part" : "parts"} cut after part ${at}${pulled > 0 ? ` (with ${pulled} lying in ${units.length === 1 ? "its holes" : "their holes"} before ${units.length === 1 ? "it" : "them"})` : ""}; `
      + `the other ${restUnits.length - pulled} sorted ${ruleLabel.toLowerCase()} after them` });
    setNext([]); setPicking(false);
  };

  // the path as far as the timeline: as in the simulation
  const end = keptEnd(steps, at);
  const shown = steps.list.slice(0, end + 1);
  const from = sheet ? originPoint(sheet, origin) : ([0, 0] as Pt);
  const simRapids = useMemo(() => rapidsOf(shown, from), [steps, end, from[0], from[1]]);   // eslint-disable-line react-hooks/exhaustive-deps
  const done = useMemo(() => new Set(steps.units.slice(0, at).flatMap((u) => u.parts)), [steps, at]);
  const lastShown = shown[shown.length - 1];
  const lastUnit = at > 0 ? steps.units[at - 1] : undefined;
  const unitLabel = (u: CutUnit, part = u.parts[0]) => `${idOf(part)} ${nameOf(part)}${u.parts.length > 1 ? ` + ${u.parts.length - 1} (${u.why ? WHY[u.why] : "cut together"})` : ""}`;
  // the picked parts with what lies in their holes (cut before them): their places after the timeline
  const plan = useMemo(() => pickedPlan(steps, at, next.map((x) => x.unit), container), [steps, at, next, container]);
  const noOf = (unit: number) => at + plan.indexOf(unit) + 1;
  /** how many units come in right before a picked one (lying in its holes) */
  const kidsOf = (unit: number) => { let k = 0; for (let t = plan.indexOf(unit) - 1; t >= 0 && !next.some((x) => x.unit === plan[t]); t--) k++; return k; };
  const afterNext = plan.length + at;

  const contourPanel = (<>
    <div className="mc-actions">
      <button type="button" className="btn btn-primary ac-process" disabled={!picked.length} onClick={apply}
        title="Put the picked contours in the cut path in this order, in the places they had (the rest stays where it is)">
        <svg viewBox="0 0 40 32" width="30" height="24" aria-hidden="true">
          <path d={GEAR_BIG} fill="currentColor" fillRule="evenodd" />
          <path d={GEAR_SMALL} fill="currentColor" fillRule="evenodd" />
        </svg>
        Process
      </button>
      <button type="button" className="btn btn-plain mc-undo" disabled={!canUndo} onClick={undo} title="Take back the last PROCESS or COMPLETE of this sheet">Undo</button>
    </div>
    <div className="ac-pickbar">
      <button type="button" className={`btn btn-plain${picking ? " is-on" : ""}`} aria-pressed={picking} disabled={!canSelect || busy} onClick={() => void toggleSelect()}
        title={canSelect ? `On: click contours on the sheet in the order to cut them, click one again to take it out${missing.length ? " (what is not processed yet is processed first)" : ""}` : "Open a sheet (VIEW / EDIT) to pick its contours"}>{busy ? "Working…" : "Select"}</button>
      <button type="button" className="btn btn-plain ac-clear" disabled={!picked.length} onClick={() => { setPicked([]); setRowSel(null); setMsg(null); }}>Clear all</button>
    </div>
    <div className="ac-list pane-scroll">
      <div className="ac-table">
        <div className="ac-headrow has-trace"><span /><span>Contour</span><span /></div>
        {picked.map((k, j) => {
          const c = cutPath?.contours[k];
          if (!c) return null;
          const col = !c.parts ? colorOf(c.part) : null;
          return (
            <div key={k} className="ac-row has-trace">
              {/* the place in the cut order: stays where it is when the rows are dragged */}
              <span className="ac-no" style={col ? { color: col.stroke, borderColor: col.stroke } : undefined}>{j + 1}</span>
              <span className={`ac-name mc-name${rowSel === k ? " is-sel" : ""}${dragFrom === j ? " is-drag" : ""}`} draggable title={`${fullOf(c)} · ${contourKind(c)}`}
                onClick={() => setRowSel(rowSel === k ? null : k)}
                onDragStart={(e) => { setDragFrom(j); setRowSel(k); e.dataTransfer.effectAllowed = "move"; }}
                onDragOver={(e) => { e.preventDefault(); if (dragFrom !== null && dragFrom !== j) { move(dragFrom, j); setDragFrom(j); } }}
                onDragEnd={() => setDragFrom(null)}>
                <span className="mc-part">{labelOf(c)}</span><small>{contourKind(c)}</small>
              </span>
              <button type="button" className="mc-del" onClick={() => drop(k)} aria-label={`Take ${labelOf(c)} ${contourKind(c)} out of the list`} title="Take it out of the list">
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
              </button>
            </div>
          );
        })}
        {!picked.length && <p className="ac-empty">{!single ? `Open a sheet (VIEW / EDIT) to pick its contours. Sheet ${index + 1} is selected.`
          : picking ? "Click the contours on the sheet in the order to cut them." : `Press SELECT, then click the contours on the sheet.${!can ? " The sheet is processed first (Auto cut)." : ""}`}</p>}
      </div>
    </div>
    <div className="ac-pickbar">
      {(() => {
        const sel = rowSel !== null ? picked.indexOf(rowSel) : -1;
        return (<>
          <button type="button" className="btn btn-plain" disabled={sel <= 0} onClick={() => move(sel, sel - 1)} title="The contour chosen in the list one place earlier">▲ Up</button>
          <button type="button" className="btn btn-plain" disabled={sel < 0 || sel === picked.length - 1} onClick={() => move(sel, sel + 1)} title="The contour chosen in the list one place later">▼ Down</button>
        </>);
      })()}
    </div>
    <p className="rule-help ac-help">The picked contours swap places among themselves in the cut path; pick every contour to set the whole order. A part&apos;s holes, marking and open cuts must stay before its outline.</p>
  </>);

  const restCount = Math.max(0, n - at - plan.length);
  /** parts on the sheet that are not in the cut path (added or moved since processing) */
  const notIn = useMemo(() => (sheet ? sheet.parts.length - processedParts(sheet).size : 0), [sheet]);
  const pathPanel = (<>
    <div className="pco-kept">
      <span className="pco-swatch" aria-hidden="true" />
      <span><b>Kept as cut:</b> {!can ? "—" : at === 0 ? "nothing (the timeline is at the start)" : at === 1 ? "part 1" : `parts 1–${at}`}</span>
    </div>
    <div className="ac-pickbar">
      <button type="button" className={`btn btn-plain${picking ? " is-on" : ""}`} aria-pressed={picking} disabled={!canSelect || busy || (can && at >= n && !missing.length)} onClick={() => { setMsg(null); void toggleSelect(); }}
        title={!canSelect ? "Open a sheet (VIEW / EDIT)" : !can || missing.length ? "Process what is not processed yet (Auto cut), then click the parts to cut next" : at >= n ? "Move the timeline back to the last part cut right first" : "On: click the parts to cut next, in that order (click one again: out)"}>{busy ? "Working…" : "Select"}</button>
      <button type="button" className="btn btn-plain ac-clear" disabled={!next.length} onClick={() => { setNext([]); setMsg(null); }}>Clear all</button>
    </div>
    <div className="ac-list pane-scroll">
      <div className="ac-table pco-table">
        <div className="ac-headrow has-trace"><span /><span>Next, in this order</span><span /></div>
        {next.map((x) => {
          const u = steps.units[x.unit];
          if (!u) return null;
          const col = colorOf(x.part);
          const also = u.parts.filter((p) => p !== x.part);
          return (
            <div key={x.unit} className="ac-row has-trace">
              <span className="ac-no pco-no">{noOf(x.unit)}</span>
              <span className="ac-name mc-name" title={`${idOf(x.part)} ${nameOf(x.part)} · was part ${x.unit + 1}${also.length ? ` · with ${also.map(idOf).join(", ")}` : ""}`}
                style={col ? { borderColor: col.stroke } : undefined}>
                <span className="mc-part">{idOf(x.part)}</span>
                <small>{also.length ? `+ ${also.length} (${u.why ? WHY[u.why] : "together"})` : kidsOf(x.unit) ? `${kidsOf(x.unit)} in its holes first` : `was ${x.unit + 1}`}</small>
              </span>
              <button type="button" className="mc-del" onClick={() => setNext((l) => l.filter((y) => y.unit !== x.unit))} aria-label={`Take ${idOf(x.part)} out of the list`} title="Take it out of the list">
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
              </button>
            </div>
          );
        })}
        {!next.length && <p className="ac-empty">{!single ? `Open a sheet (VIEW / EDIT) to set its order. Sheet ${index + 1} is selected.`
          : !can ? "Press SELECT: the sheet is processed first (Auto cut), then move the timeline back and pick the parts."
          : at >= n ? "Move the timeline under the sheet back to the last part that is cut right."
          : picking ? `Click the parts on the sheet in the order to cut them, from part ${at + 1} on.` : `Press SELECT, then click the parts to cut after part ${at}.`}</p>}
      </div>
    </div>
    <div className="pco-rest">
      <div className="pco-rest-head"><span>Then the rest</span><span className="pco-rule" title="The order picked under AUTO CUT the last time this sheet was processed">{ruleLabel}</span></div>
      <p>{!can || at >= n ? "Nothing left after the timeline." : `${restCount} ${restCount === 1 ? "part" : "parts"}${next.length ? `, from part ${afterNext + 1} on` : `, from part ${at + 1} on`}, sorted as the last Auto cut of this sheet. Leads, micro joints and break cuts stay as they are.`}</p>
      {can && notIn > 0 && <p className="pco-warn">{notIn} {notIn === 1 ? "part on this sheet is" : "parts on this sheet are"} not processed (added or moved since): not in the cut path yet. {cutPath?.internal ? "(A Cut internal path: left out.)" : `SELECT processes ${notIn === 1 ? "it" : "them"} first, after the rest.`}</p>}
    </div>
    <div className="mc-actions">
      <button type="button" className="btn btn-primary ac-process" disabled={!next.length} onClick={complete}
        title="Keep the path up to the timeline, cut the picked parts next, sort the rest by the last Auto cut's order">
        <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        Complete
      </button>
      <button type="button" className="btn btn-plain mc-undo" disabled={!canUndo} onClick={undo} title="Take back the last COMPLETE or PROCESS of this sheet">Undo</button>
    </div>
    <p className="rule-help ac-help">Parts up to the timeline stay as they are. What is cut as one moves as one: a common cut block, the inline passes, a common pierce group; a part in another part&apos;s hole still comes before it.</p>
  </>);

  const panel = (
    <aside className="mn-parts ac" aria-label="Manual cut">
      <header className="sol-head ac-head"><span className="itool-box ac-icon-sm" aria-hidden="true"><img src={toolManualCut} alt="" draggable={false} /></span><h2>Manual cut</h2></header>
      <div className="ac-body">
        <div className="seg mc-seg" role="group" aria-label="How to set the cut order">
          <button type="button" className={mode === "contour" ? "is-on" : ""} aria-pressed={mode === "contour"} onClick={() => { setMode("contour"); setPicking(false); setMsg(null); }}
            title="Contours picked one by one swap places among themselves">Contour cut order</button>
          <button type="button" className={mode === "path" ? "is-on" : ""} aria-pressed={mode === "path"} onClick={() => { setMode("path"); setPicking(false); setMsg(null); }}
            title="The path kept up to the timeline, the parts picked next, the rest sorted again">Path cut order</button>
        </div>
        {mode === "contour" ? contourPanel : pathPanel}
        {msg && <p className={`tech-msg ac-msg${msg.bad ? " is-bad" : ""}`} role="status">{msg.text}</p>}
      </div>
    </aside>
  );

  if (mode === "path") {
    const timeline = can ? (
      <div className="pco-tl" aria-label="Cut path timeline">
        <div className="pco-tl-head">
          <span className="pco-tl-title">Timeline</span>
          <span className="pco-tl-at">{at === 0 ? "Nothing cut yet: the timeline is at the start"
            : at >= n ? `The whole path: ${n} ${n === 1 ? "part" : "parts"}`
            : `Cut up to part ${at} of ${n} · ${lastUnit ? unitLabel(lastUnit) : ""}`}</span>
          <span className="pco-gap" />
          <button type="button" className="btn btn-plain pco-step" disabled={at <= 0} onClick={() => toStep(at - 1)} aria-label="One part back" title="One part back">
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M10.5 3L5.5 8l5 5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <button type="button" className="btn btn-plain pco-step" disabled={at >= n} onClick={() => toStep(at + 1)} aria-label="One part on" title="One part on">
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M5.5 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>
        <div className={`pco-ticks${n > 150 ? " is-dense" : ""}`} style={{ gridTemplateColumns: `repeat(${Math.max(1, n)}, minmax(0, 1fr))` }}>
          {steps.units.map((u, j) => {
            const col = colorOf(u.parts[0]);
            const pickedHere = next.some((x) => x.unit === j);
            const cls = pickedHere ? " is-picked" : j === at - 1 ? " is-last" : j < at ? " is-cut" : "";
            return <button key={j} type="button" className={`pco-tick${cls}`} style={!cls && col ? { background: col.fill, borderColor: col.stroke } : undefined}
              onClick={() => toStep(j + 1)} aria-label={`Cut up to part ${j + 1}: ${unitLabel(u)}`} title={`${j + 1} · ${unitLabel(u)}`} />;
          })}
        </div>
        <input type="range" className="pco-range" min={0} max={n} step={1} value={at} onChange={(e) => toStep(Number(e.target.value))} aria-label="Cut up to part" />
      </div>
    ) : null;
    const pickedParts = next.map((x) => x.part);
    const also = plan.flatMap((j) => steps.units[j]?.parts.filter((p) => !pickedParts.includes(p)) ?? []);
    return {
      panel,
      cut: {
        // clicks always come here (never a selection: the sheet is look only, as in the simulation)
        picking: can, picked: pickedParts, onPick: pickPart, panel, pickedNos: next.map((x) => noOf(x.unit)),
        ...(also.length ? { pickedAlso: also } : {}),
        ...(timeline ? { below: timeline } : {}),
        ...(can ? { sim: { shown, rapids: simRapids, done, head: lastShown ? endOf(lastShown) : from, ...(at > 0 && at < n && lastShown ? { current: lastShown } : {}) } } : {}),
        ...(can && picking ? { cursor: "pointer" } : {}),
        hint: !can ? (single ? "Process the sheet first (Auto cut), then set its order here." : "Open a sheet to set its cut order.")
          : at >= n && !next.length ? "Move the timeline under the sheet back to the last part that is cut right, then press SELECT and click the parts to cut next."
          : picking ? `Click the parts to cut next, in that order (click one again: out). COMPLETE cuts them after part ${at} and sorts the rest ${ruleLabel.toLowerCase()}.`
          : next.length ? `COMPLETE cuts the ${next.length} picked ${next.length === 1 ? "part" : "parts"} after part ${at} and sorts the rest ${ruleLabel.toLowerCase()}.`
          : "Press SELECT on the right, then click the parts to cut after the timeline.",
      },
    };
  }

  const glowAll = new Set<CutContour>(picked.map((k) => cutPath?.contours[k]).filter((c): c is CutContour => !!c));
  const strong = rowSel !== null ? cutPath?.contours[rowSel] : undefined;
  return {
    panel,
    cut: {
      picking: false, picked: [], onPick: () => { /* contours are picked here, not parts */ }, panel,
      ...(can && (picking || picked.length) ? { onPoint: point, ...(picking ? { cursor: "pointer" } : {}) } : {}),
      ...(glowAll.size ? { glow: { all: glowAll, ...(strong ? { strong } : {}) } } : {}),
      hint: !can ? (single ? "Process the sheet first (Auto cut), then set its order here." : "Open a sheet to set its cut order.")
        : picking ? "Click contours in the order to cut them (click again: out). Drag them in the list to change the order, then PROCESS."
        : picked.length ? "Choose a contour in the list to see it, × or a click on it takes it out; PROCESS puts them in this order." : "Press SELECT on the right, then click the contours.",
    },
  };
}
