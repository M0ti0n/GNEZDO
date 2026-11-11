import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { JobPart } from "../api/types";
import { CUT_RULES, liveContours, processSheet, type CutRule, type CutWhat } from "../job/cutPath";
import { diag } from "../job/diag";
import { machineCan, type Machine, type Origin } from "../job/machine";
import { partColor, type NestedSheet } from "../job/nest";
import { ConfirmDialog } from "./ConfirmDialog";
import type { CutMode } from "./ManualNest";
import toolAutoCut from "../shell/jobtools/tool-autoCut.png";

// Process -> Auto cut (after Fab's layout): the sheet with the AUTO CUT panel on the right. Select
// mode: every sheet, the shown sheet, or parts picked one by one (all of them / only their tracing /
// only their holes) in the order clicked; PROCESS works the cut path out. Picked parts are faded with a
// glow; processed parts lose their fill and show their cut and trace lines with the leads.

export type SelectMode = "multi" | "sheet" | "parts" | "trace" | "internal";

const MODES: { id: SelectMode; label: string; hint: string }[] = [
  { id: "multi", label: "Multi sheet", hint: "Every sheet of the solution (asks to save the job first if it was never saved)" },
  { id: "sheet", label: "Selected sheet", hint: "Only the sheet shown" },
  { id: "parts", label: "Selected parts", hint: "SELECT, then click the parts in the order to cut them" },
  { id: "trace", label: "Trace", hint: "Only the tracing of the picked parts, in the order picked" },
  { id: "internal", label: "Cut internal", hint: "Only the holes of the picked parts, in the order picked" },
];

const RULE_KEY = "gnezdo.cutRule";
const loadRule = (): CutRule => { try { const r = localStorage.getItem(RULE_KEY); return CUT_RULES.some((x) => x.id === r) ? (r as CutRule) : "bottomTop"; } catch { return "bottomTop"; } };

type PartRef = { path: string; areaMm2: number; name: string; no?: number };

/** A gear outline with a hole (for the PROCESS button: two gears in mesh). */
function gear(cx: number, cy: number, r: number, teeth: number, phase: number, hole: number): string {
  const pts: string[] = [];
  const tip = r, root = r * 0.74;
  for (let k = 0; k < teeth * 4; k++) {
    const a = phase + (k / (teeth * 4)) * 2 * Math.PI;
    const rr = k % 4 === 0 || k % 4 === 1 ? tip : root;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(2)} ${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  const h = `M${cx + hole} ${cy}a${hole} ${hole} 0 1 0 ${-2 * hole} 0a${hole} ${hole} 0 1 0 ${2 * hole} 0Z`;
  return `M${pts.join("L")}Z${h}`;
}
const GEAR_BIG = gear(14, 18, 12.5, 10, 0, 4);
const GEAR_SMALL = gear(30.5, 9.5, 8.5, 7, Math.PI / 7, 2.8);

/**
 * The AUTO CUT panel and what it does: shown beside the sheets (several sheets: the shown one is the
 * selected card; parts are picked in the one-sheet view) or beside one sheet. `cut` goes to that sheet's
 * view (ManualNest) for the picking and the look of picked parts.
 */
export function useAutoCut({ index, single, sheets, jobParts, parts, machine, origin, onCut, needsSave, onSave }: {
  /** the sheet shown or selected */
  index: number;
  /** one sheet shown (parts can be picked) */
  single: boolean;
  sheets: NestedSheet[]; jobParts: JobPart[]; parts: Map<string, PartRef>;
  machine: Machine; origin: Origin;
  /** a sheet's new cut path */
  onCut: (index: number, cut: NestedSheet["cut"]) => void;
  /** the job was never saved: Multi sheet saves it first */
  needsSave: boolean;
  onSave: () => Promise<boolean>;
}): { panel: ReactNode; cut: CutMode } {
  const sheet = sheets[index] ?? { parts: [] } as unknown as NestedSheet;
  const [mode, setMode] = useState<SelectMode>("multi");
  const [rule, setRuleState] = useState<CutRule>(loadRule);
  const setRule = (r: CutRule) => { setRuleState(r); try { localStorage.setItem(RULE_KEY, r); } catch { /* not kept */ } };
  const [skipTrace, setSkipTrace] = useState(false);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const [noTrace, setNoTrace] = useState<Set<number>>(new Set());
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [askSave, setAskSave] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  /** the row chosen in the list (part index), moved by Up / Down */
  const [rowSel, setRowSel] = useState<number | null>(null);
  const byPart = useMemo(() => new Map(jobParts.map((jp) => [jp.part.id, jp])), [jobParts]);
  const paths = useMemo(() => new Map([...parts].map(([id, r]) => [id, r.path])), [parts]);
  const picks = mode === "parts" || mode === "trace" || mode === "internal";
  // another sheet or mode: a fresh pick
  useEffect(() => { setPicked([]); setPicking(false); setNoTrace(new Set()); }, [index, mode]);
  useEffect(() => { if (!picks || !single) setPicking(false); }, [picks, single]);

  const nameOf = (i: number) => { const p = sheet.parts[i]; return p ? byPart.get(p.partId)?.part.name ?? parts.get(p.partId)?.name ?? p.partId : "?"; };
  const pick = (i: number) => setPicked((l) => (l.includes(i) ? l.filter((x) => x !== i) : [...l, i]));
  const move = (from: number, to: number) => setPicked((l) => {
    if (to < 0 || to >= l.length || from === to) return l;
    const n = l.slice();
    const [x] = n.splice(from, 1);
    n.splice(to, 0, x);
    return n;
  });

  const run = async (saved = false) => {
    if (busy) return;
    if (mode === "multi" && needsSave && !saved) { setAskSave(true); return; }
    if (picks && !picked.length) { setMsg({ text: "Pick the parts first: SELECT, then click them in the order to cut them", bad: true }); return; }
    if (mode === "trace" && !machineCan(machine, "trace")) { setMsg({ text: `${machine.name} does not trace (Settings → Machines → What it cuts)`, bad: true }); return; }
    setBusy(true);
    setMsg(null);
    try {
      const what: CutWhat = mode === "trace" ? "trace" : mode === "internal" ? "internal" : "all";
      const list = mode === "multi" ? sheets.map((_, i) => i) : [index];
      let contours = 0, metres = 0;
      for (const i of list) {
        const sh = sheets[i];
        const cut = await processSheet({
          sheet: sh, paths, machine, origin, rule, what,
          parts: picks ? picked : null, ordered: picks,
          traceOf: (k) => (picks ? !noTrace.has(k) : !skipTrace),
        });
        onCut(i, cut);
        const live = liveContours({ ...sh, cut });
        contours += live.length;
        metres += live.reduce((s, c) => s + c.pts.reduce((a, p, k) => (k ? a + Math.hypot(p[0] - c.pts[k - 1][0], p[1] - c.pts[k - 1][1]) : 0), 0), 0) / 1000;
      }
      diag("process", `Auto cut: ${mode}, ${rule}`, { sheets: list.length, contours });
      setMsg({ text: `${list.length > 1 ? `${list.length} sheets` : `Sheet ${index + 1}`}: ${contours} contours, ${metres.toFixed(1)} m of cut` });
      if (picks) { setPicked([]); setPicking(false); }
    } catch (e) {
      setMsg({ text: `Not processed: ${(e as Error).message}`, bad: true });
    } finally {
      setBusy(false);
    }
  };

  const canTrace = machineCan(machine, "trace");
  const partNo = (i: number) => { const p = sheet.parts[i]; return p ? byPart.get(p.partId)?.no : undefined; };
  const panel = (
    <aside className="mn-parts ac" aria-label="Auto cut">
      <header className="sol-head ac-head"><span className="itool-box ac-icon-sm" aria-hidden="true"><img src={toolAutoCut} alt="" draggable={false} /></span><h2>Auto cut</h2></header>
      <div className="ac-body">
        <div className="ac-top">
          <div className="ac-main">
            <label className="ac-field"><span>Select mode</span>
              <select className="field" value={mode} title={MODES.find((m) => m.id === mode)?.hint}
                onChange={(e) => { setMode(e.target.value as SelectMode); setMsg(null); }}>
                {MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </label>
            <button type="button" className="btn btn-primary ac-process" disabled={busy} onClick={() => void run()}>
              <svg viewBox="0 0 40 32" width="30" height="24" aria-hidden="true">
                <path d={GEAR_BIG} fill="currentColor" fillRule="evenodd" />
                <path d={GEAR_SMALL} fill="currentColor" fillRule="evenodd" />
              </svg>
              {busy ? "Working…" : "Process"}
            </button>
          </div>
        </div>
        {!picks && (<>
          <label className="ac-field"><span>Path generation rule</span>
            <select className="field" value={rule} title={CUT_RULES.find((r) => r.id === rule)?.hint} onChange={(e) => setRule(e.target.value as CutRule)}>
              {CUT_RULES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </label>
          <label className="chk" title={canTrace ? undefined : `${machine.name} does not trace`}>
            <input type="checkbox" checked={skipTrace || !canTrace} disabled={!canTrace} onChange={(e) => setSkipTrace(e.target.checked)} /> Skip trace lines</label>
          <p className="rule-help ac-help">Always: tracing, holes, then the outline; parts in another part&apos;s hole first.{" "}
            {machine.cutOrder?.bigLast === false ? "" : "Big parts last (Machine → Cut order). "}Then {CUT_RULES.find((r) => r.id === rule)?.label.toLowerCase()}.</p>
        </>)}
        {picks && (<>
          <div className="ac-pickbar">
            <button type="button" className={`btn btn-plain${picking ? " is-on" : ""}`} aria-pressed={picking} disabled={!single} onClick={() => setPicking((v) => !v)}
              title={single ? "On: click a part on the sheet to pick it, click it again to take it out" : "Open a sheet (VIEW / EDIT) to pick its parts"}>Select</button>
            <button type="button" className="btn btn-plain ac-clear" disabled={!picked.length} onClick={() => { setPicked([]); setNoTrace(new Set()); setRowSel(null); }}>Clear all</button>
          </div>
          <div className="ac-list pane-scroll">
            <div className="ac-table">
              <div className={`ac-headrow${mode === "parts" ? " has-trace" : ""}`}><span /><span>Part</span>{mode === "parts" && <span>Trace</span>}</div>
              {picked.map((i, k) => {
                const no = partNo(i);
                const c = no !== undefined ? partColor(no) : null;
                return (
                  <div key={k} className={`ac-row${mode === "parts" ? " has-trace" : ""}`}>
                    {/* the place in the cut order: stays where it is when the parts are dragged */}
                    <span className="ac-no" style={c ? { color: c.stroke, borderColor: c.stroke } : undefined}>{k + 1}</span>
                    <span className={`ac-name${rowSel === i ? " is-sel" : ""}${dragFrom === k ? " is-drag" : ""}`} draggable title={nameOf(i)}
                      onClick={() => setRowSel(i)}
                      onDragStart={(e) => { setDragFrom(k); setRowSel(i); e.dataTransfer.effectAllowed = "move"; }}
                      onDragOver={(e) => { e.preventDefault(); if (dragFrom !== null && dragFrom !== k) { move(dragFrom, k); setDragFrom(k); } }}
                      onDragEnd={() => setDragFrom(null)}>{nameOf(i)}</span>
                    {mode === "parts" && (
                      <input type="checkbox" className="ac-trace" checked={canTrace && !noTrace.has(i)} disabled={!canTrace} aria-label={`Trace ${nameOf(i)}`}
                        title={canTrace ? "Cut its tracing too" : `${machine.name} does not trace`}
                        onChange={() => setNoTrace((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; })} />
                    )}
                  </div>
                );
              })}
              {!picked.length && <p className="ac-empty">{!single ? `Open a sheet (VIEW / EDIT) to pick its parts. Sheet ${index + 1} is selected.` : picking ? "Click the parts on the sheet in the order to cut them." : "Press SELECT, then click the parts on the sheet."}</p>}
            </div>
          </div>
          <div className="ac-pickbar">
            <button type="button" className="btn btn-plain" disabled={rowSel === null || picked.indexOf(rowSel) <= 0}
              onClick={() => rowSel !== null && move(picked.indexOf(rowSel), picked.indexOf(rowSel) - 1)} title="The part chosen in the list one place earlier">▲ Up</button>
            <button type="button" className="btn btn-plain" disabled={rowSel === null || picked.indexOf(rowSel) < 0 || picked.indexOf(rowSel) === picked.length - 1}
              onClick={() => rowSel !== null && move(picked.indexOf(rowSel), picked.indexOf(rowSel) + 1)} title="The part chosen in the list one place later">▼ Down</button>
          </div>
        </>)}
        {msg && <p className={`tech-msg ac-msg${msg.bad ? " is-bad" : ""}`} role="status">{msg.text}</p>}
      </div>
    </aside>
  );


  const dialog = askSave && (
    <ConfirmDialog title="Save the job first?" confirmLabel="Save and process" onCancel={() => setAskSave(false)}
      onConfirm={() => { setAskSave(false); void onSave().then((ok) => { if (ok) void run(true); }); }}>
      Multi sheet processes every sheet of the solution: the job is saved first, so the cut paths are kept with it.
    </ConfirmDialog>
  );
  return {
    panel: <>{panel}{dialog}</>,
    cut: {
      picking, picked, onPick: pick, panel: <>{panel}{dialog}</>,
      hint: picking ? "Click parts in the order to cut them (click again: out). Drag them in the list to change the order."
        : picks ? "Press SELECT on the right, then click the parts." : "Pick the select mode and the rule on the right, then PROCESS.",
    },
  };
}
