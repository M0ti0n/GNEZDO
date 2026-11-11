import { useEffect, useMemo, useState } from "react";
import type { JobPart } from "../api/types";
import { CUT_RULES, liveContours, processSheet, type CutRule, type CutWhat } from "../job/cutPath";
import { diag } from "../job/diag";
import { machineCan, type Machine, type Origin } from "../job/machine";
import { countsOf, type NestedSheet, type Solution } from "../job/nest";
import { ConfirmDialog } from "./ConfirmDialog";
import { ManualNest } from "./ManualNest";
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

export function CutView({ sol, index, sheets, jobParts, parts, machine, origin, onIndex, onClose, onInfo, locked, onToggleLock, onCut, needsSave, onSave }: {
  sol: Solution; index: number; sheets: NestedSheet[]; jobParts: JobPart[]; parts: Map<string, PartRef>;
  machine: Machine; origin: Origin;
  onIndex: (i: number) => void; onClose: () => void; onInfo: (i: number) => void;
  locked: boolean; onToggleLock: () => void;
  /** a sheet's new cut path */
  onCut: (index: number, cut: NestedSheet["cut"]) => void;
  /** the job was never saved: Multi sheet saves it first */
  needsSave: boolean;
  onSave: () => Promise<boolean>;
}) {
  const sheet = sheets[index];
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
  const byPart = useMemo(() => new Map(jobParts.map((jp) => [jp.part.id, jp])), [jobParts]);
  const paths = useMemo(() => new Map([...parts].map(([id, r]) => [id, r.path])), [parts]);
  const picks = mode === "parts" || mode === "trace" || mode === "internal";
  // another sheet or mode: a fresh pick
  useEffect(() => { setPicked([]); setPicking(false); setNoTrace(new Set()); }, [index, mode]);
  useEffect(() => { if (!picks) setPicking(false); }, [picks]);

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

  const panel = (
    <aside className="mn-parts ac" aria-label="Auto cut">
      <div className="ac-top">
        <div className="ac-tool"><img src={toolAutoCut} alt="" draggable={false} /><span>Auto cut</span></div>
        <div className="ac-main">
          <select className="field ac-mode" value={mode} aria-label="Select mode" title={MODES.find((m) => m.id === mode)?.hint}
            onChange={(e) => { setMode(e.target.value as SelectMode); setMsg(null); }}>
            {MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          <button type="button" className="ac-process" disabled={busy} onClick={() => void run()}>
            <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
              <path d="M16 1l3 9 8-5-4 8 9 3-9 3 4 8-8-5-3 9-3-9-8 5 4-8-9-3 9-3-4-8 8 5z" fill="currentColor" />
            </svg>
            {busy ? "Working…" : "Process"}
          </button>
        </div>
      </div>
      {!picks && (
        <div className="ac-opts">
          <select className="field" value={rule} aria-label="Path generation rule" title={CUT_RULES.find((r) => r.id === rule)?.hint} onChange={(e) => setRule(e.target.value as CutRule)}>
            {CUT_RULES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
          <label className="chk ac-skip"><input type="checkbox" checked={skipTrace} disabled={!machineCan(machine, "trace")} onChange={(e) => setSkipTrace(e.target.checked)} /> Skip trace lines</label>
          <p className="ac-help">Always: tracing, holes, then the outline; parts in another part's hole first.{" "}
            {machine.cutOrder?.bigLast === false ? "" : "Big parts last (Machine → Cut order). "}Then {CUT_RULES.find((r) => r.id === rule)?.label.toLowerCase()}.</p>
        </div>
      )}
      {picks && (<>
        <div className="ac-pickbar">
          <button type="button" className={`btn btn-plain${picking ? " is-on" : ""}`} aria-pressed={picking} onClick={() => setPicking((v) => !v)}
            title="On: click a part to pick it, click it again to take it out">Select</button>
          <button type="button" className="btn btn-plain" disabled={!picked.length} onClick={() => { setPicked([]); setNoTrace(new Set()); }}>Clear all</button>
        </div>
        <div className="ac-list">
          <span className="ac-side">Cut order · 1 on top</span>
          <ol className="ac-rows pane-scroll">
            {picked.map((i, k) => (
              <li key={i} className={`ac-row${dragFrom === k ? " is-drag" : ""}`} draggable
                onDragStart={(e) => { setDragFrom(k); e.dataTransfer.effectAllowed = "move"; }}
                onDragOver={(e) => { e.preventDefault(); if (dragFrom !== null && dragFrom !== k) { move(dragFrom, k); setDragFrom(k); } }}
                onDragEnd={() => setDragFrom(null)}>
                <span className="ac-no">{k + 1}</span>
                <span className="ac-name" title={nameOf(i)}>{nameOf(i)}</span>
                <button type="button" className="ac-mv" disabled={k === 0} onClick={() => move(k, k - 1)} aria-label="Earlier">▲</button>
                <button type="button" className="ac-mv" disabled={k === picked.length - 1} onClick={() => move(k, k + 1)} aria-label="Later">▼</button>
                {mode === "parts" && (
                  <input type="checkbox" className="ac-trace" checked={machineCan(machine, "trace") && !noTrace.has(i)} disabled={!machineCan(machine, "trace")} aria-label={`Trace ${nameOf(i)}`}
                    title="Cut its tracing too" onChange={() => setNoTrace((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; })} />
                )}
              </li>
            ))}
            {!picked.length && <li className="ac-empty">{picking ? "Click the parts in the order to cut them." : "Press SELECT, then click parts."}</li>}
          </ol>
          {mode === "parts" && <span className="ac-side is-right">Trace</span>}
        </div>
      </>)}
      {msg && <p className={`tech-msg ac-msg${msg.bad ? " is-bad" : ""}`} role="status">{msg.text}</p>}
    </aside>
  );

  return (<>
    <ManualNest sol={sol} index={index} sheets={sheets} jobParts={jobParts} parts={parts} edit={false}
      origin={origin} counts={countsOf(sheets)} onIndex={onIndex} onClose={onClose} onChange={() => { /* nothing moves here */ }}
      onInfo={onInfo} locked={locked} onToggleLock={onToggleLock}
      cut={{
        picking, picked, onPick: pick, panel,
        hint: picking ? "Click parts in the order to cut them (click again: out). Drag them in the list to change the order."
          : picks ? "Press SELECT on the right, then click the parts." : "Pick the select mode and the rule on the right, then PROCESS.",
      }} />
    {askSave && (
      <ConfirmDialog title="Save the job first?" confirmLabel="Save and process" onCancel={() => setAskSave(false)}
        onConfirm={() => { setAskSave(false); void onSave().then((ok) => { if (ok) void run(true); }); }}>
        Multi sheet processes every sheet of the solution: the job is saved first, so the cut paths are kept with it.
      </ConfirmDialog>
    )}
  </>);
}
