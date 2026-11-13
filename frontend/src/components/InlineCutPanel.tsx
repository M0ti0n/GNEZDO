import { useEffect, useMemo, useState, type ReactNode } from "react";
import { liveContours, originPoint, processSheet, type CutContour, type CutRule } from "../job/cutPath";
import { diag } from "../job/diag";
import { DEFAULT_INLINE, inlineCut, inlineParts, type InlineOptions, type InlinePierce } from "../job/inlineCut";
import type { Machine, Origin } from "../job/machine";
import type { NestedSheet } from "../job/nest";
import { NumInput } from "./NumInput";
import type { CutMode } from "./ManualNest";
import toolInlineCut from "../shell/jobtools/tool-inlineCut.png";

// Process -> Inline cut (a flying cut, for grids of parts on thin sheet): the parts' contours cut in
// passes across the sheet instead of contour by contour (job/inlineCut.ts). SELECT parts (none: every
// part of the sheet), set the direction, the corridor width, the run-in and the pierce, INLINE CUT.
// RESET: the selected parts (none: all inline ones) back to the automatic cut.

type PartRef = { path: string };

const KEY = "gnezdo.inlineCut";
const load = (): InlineOptions => {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? "null"); return v ? { ...DEFAULT_INLINE, ...v } : DEFAULT_INLINE; }
  catch { return DEFAULT_INLINE; }
};

const PIERCES: { id: InlinePierce; label: string; title: string }[] = [
  { id: "quick", label: "Quick", title: "A quick pierce at each stretch (LVD M98P8037): thin sheet" },
  { id: "pierce", label: "Normal", title: "The full pierce at each stretch (LVD M98P8036): the Technology row's pierce time each time" },
  { id: "none", label: "None", title: "No pierce: only where the start is open already" },
];

export function useInlineCut({ index, single, sheets, parts, machine, origin, onCut }: {
  index: number;
  single: boolean;
  sheets: NestedSheet[];
  parts: Map<string, PartRef>;
  machine: Machine;
  origin: Origin;
  onCut: (index: number, cut: NonNullable<NestedSheet["cut"]>) => void;
}): { panel: ReactNode; cut: CutMode } {
  const sheet = sheets[index] as NestedSheet | undefined;
  const paths = useMemo(() => new Map([...parts].map(([id, r]) => [id, r.path])), [parts]);
  const live = useMemo(() => new Set<CutContour>(sheet ? liveContours(sheet) : []), [sheet]);
  const [opt, setOptState] = useState<InlineOptions>(load);
  const setOpt = (p: Partial<InlineOptions>) => setOptState((o) => {
    const n = { ...o, ...p };
    try { localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* not kept */ }
    return n;
  });
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  useEffect(() => { setPicked([]); setPicking(false); setMsg(null); }, [index]);

  const cutPath = sheet?.cut;
  const can = single && !!cutPath && live.size > 0;
  const inl = useMemo(() => inlineParts(cutPath, live), [cutPath, live]);
  const pick = (i: number) => setPicked((l) => (l.includes(i) ? l.filter((x) => x !== i) : [...l, i]));

  /** these parts (null: every one) back to the automatic cut; the sheet's cut path after it */
  const reprocess = async (sh: NestedSheet, list: number[]) => {
    const rule: CutRule = !sh.cut || sh.cut.rule === "manual" ? "shortest" : sh.cut.rule;
    return processSheet({ sheet: sh, paths, machine, origin, rule, what: "all", parts: list, ordered: false, traceOf: () => true });
  };

  const run = async () => {
    if (!sheet || !cutPath || busy) return;
    setBusy(true); setMsg(null);
    try {
      // parts cut inline already: back to the automatic cut first, then inline again
      const want = picked.length ? picked : null;
      const again = [...inl].filter((k) => !want || want.includes(k));
      let cut = cutPath;
      if (again.length) cut = await reprocess(sheet, again);
      const sh = { ...sheet, cut };
      const r = inlineCut(cut, new Set(liveContours(sh)), want, originPoint(sheet, origin), opt);
      if (typeof r === "string") { setMsg({ text: r, bad: true }); return; }
      onCut(index, r.cut);
      diag("process", `Inline cut on sheet ${index + 1}`, { contours: r.contours, stretches: r.stretches, passes: r.passes, left: r.left, ...opt });
      setMsg({ text: `${r.contours} contours in ${r.stretches} stretches, ${r.passes} passes${r.left ? `; ${r.left} not inline (a stretch wider than the corridor): cut as before` : ""}` });
      setPicked([]); setPicking(false);
    } catch (e) {
      setMsg({ text: `Not done: ${(e as Error).message}`, bad: true });
    } finally { setBusy(false); }
  };

  const reset = async () => {
    if (!sheet || !cutPath || busy) return;
    const list = picked.length ? picked.filter((k) => inl.has(k)) : [...inl];
    if (!list.length) { setMsg({ text: picked.length ? "None of the selected parts is cut inline" : "Nothing is cut inline on this sheet", bad: true }); return; }
    setBusy(true); setMsg(null);
    try {
      onCut(index, await reprocess(sheet, list));
      setMsg({ text: `${list.length} ${list.length === 1 ? "part" : "parts"} back to the automatic cut` });
      setPicked([]); setPicking(false);
    } catch (e) {
      setMsg({ text: `Not done: ${(e as Error).message}`, bad: true });
    } finally { setBusy(false); }
  };

  const panel = (
    <aside className="mn-parts ac il" aria-label="Inline cut">
      <header className="sol-head ac-head"><span className="itool-box ac-icon-sm" aria-hidden="true"><img src={toolInlineCut} alt="" draggable={false} /></span><h2>Inline cut</h2></header>
      <div className="ac-body">
        <div className="ac-pickbar">
          <button type="button" className={`btn btn-plain${picking ? " is-on" : ""}`} aria-pressed={picking} disabled={!can}
            title="On: click parts on the sheet to select them (again: out). None selected: every part of the sheet"
            onClick={() => setPicking(!picking)}>Select</button>
          <button type="button" className="btn btn-plain" disabled={!picked.length} onClick={() => setPicked([])}>Clear</button>
        </div>
        <p className="rule-help il-scope">{picked.length ? `${picked.length} ${picked.length === 1 ? "part" : "parts"} selected` : "None selected: every part of the sheet"}{inl.size ? ` · ${inl.size} ${inl.size === 1 ? "part" : "parts"} cut inline now` : ""}</p>

        <div className="il-row">
          <span>First</span>
          <span className="il-seg" role="radiogroup" aria-label="Passes first">
            {(["x", "y"] as const).map((a) => (
              <button key={a} type="button" role="radio" aria-checked={opt.first === a} className={opt.first === a ? "is-on" : ""}
                title={a === "x" ? "The passes along X first (the horizontal stretches), then along Y" : "The passes along Y first (the vertical stretches), then along X"}
                onClick={() => setOpt({ first: a })}>{a.toUpperCase()} first</button>
            ))}
          </span>
        </div>
        <label className="il-row" title="How far apart across the pass the stretches of one pass may be (they need not lie exactly in line)">
          <span>Corridor width</span>
          <span className="il-num"><NumInput value={opt.width} min={0.1} aria-label="Corridor width (mm)" onCommit={(n) => setOpt({ width: n })} /><small>mm</small></span>
        </label>
        <label className="il-row" title="Outlines: each stretch starts this far before the part's edge, in line with the pass, on the scrap side (none where that would be in a part). Holes: none">
          <span>Run-in, outlines</span>
          <span className="il-num"><NumInput value={opt.runIn} min={0} aria-label="Run-in on outlines (mm)" onCommit={(n) => setOpt({ runIn: n })} /><small>mm</small></span>
        </label>
        <div className="il-row">
          <span>Pierce</span>
          <span className="il-seg" role="radiogroup" aria-label="Pierce at each stretch">
            {PIERCES.map((p) => (
              <button key={p.id} type="button" role="radio" aria-checked={opt.pierce === p.id} className={opt.pierce === p.id ? "is-on" : ""} title={p.title}
                onClick={() => setOpt({ pierce: p.id })}>{p.label}</button>
            ))}
          </span>
        </div>

        <div className="pp-actions">
          <button type="button" className="btn btn-primary pp-btn" disabled={!can || busy} onClick={() => void run()}
            title="The selected parts (none: every part) cut in passes: the stretches along the first axis, then the other">Inline cut</button>
          <button type="button" className="btn btn-plain pp-btn" disabled={!can || busy || !inl.size} onClick={() => void reset()}
            title="The selected parts (none: every part cut inline) back to the automatic cut">Reset</button>
        </div>
        <p className="rule-help ac-help">A flying cut for grids of parts on thin sheet: every part's sides that lie in line are cut in one pass, the head running one way, then back on the next pass (along X, then along Y). The stretches of a pass may lie off the line within the corridor width and turn up to 45° from it (arcs too). A contour with a stretch wider than the corridor is cut as before. Holes are finished before their part. Each stretch is a cut of its own (pierce as chosen: quick by default); outlines start with the run-in on the scrap side, holes on their edge.</p>
        {msg && <p className={`tech-msg ac-msg${msg.bad ? " is-bad" : ""}`} role="status">{msg.text}</p>}
      </div>
    </aside>
  );

  return {
    panel,
    cut: {
      picking: can && picking, picked, onPick: pick, panel, noNumbers: true,
      hint: !can ? (single ? "Process the sheet first (Auto cut), then cut its parts inline here." : "Open a sheet to cut its parts inline.")
        : picking ? "SELECT: click parts (again: out). None selected: every part of the sheet."
        : "INLINE CUT: the selected parts, or every part when none is selected.",
    },
  };
}
