import { useEffect, useMemo, useState, type ReactNode } from "react";
import { balloonsOf, editBreak, leadNear, piecesOf, startOf, type BreakOp } from "../job/breakCut";
import { leadValues, liveContours, type BreakStart, type CutContour, type LeadSpec } from "../job/cutPath";
import { diag } from "../job/diag";
import { leadCtx } from "../job/leadEdit";
import { GAP_TYPES, LEAD_TYPES, type LeadType } from "../job/leads";
import type { Machine } from "../job/machine";
import { pickContour } from "../job/manualCut";
import { resetPart } from "../job/microJoint";
import type { Pt } from "../job/manualGeom";
import type { NestedSheet } from "../job/nest";
import { LeadEditor, TypeDialog } from "./LeadPanel";
import type { CutMode } from "./ManualNest";
import toolBreakCut from "../shell/jobtools/tool-breakCut.png";

// Process -> Break cut (after Fab's layout, like Lead in / out): an outline cut so the part stays held
// in the sheet. A break is a lead pair with a negative gap (the cut stops that far short).
//  ADD NEW: APPLY puts a balloon on the pointer (BC: the gap from the drawing), dropped on an outline;
//    with Manual gap distance selection two balloons (1: where the cut stops, 2: where it starts again).
//    Keep the original lead in / out: the outline is then cut in pieces, else the break takes its place.
//  MODIFY EXISTING: click a lead or a balloon (its type and values come into the drawing), APPLY puts
//    the drawing's on it. MOVE: click a balloon, then where it goes on its outline.
//  RESET: the Technology row's values; DELETE: the break out (its outline closes again).

type PartRef = { path: string };
type Sel = { k: number; si: number };

export function useBreakCut({ index, single, sheets, parts, machine, onCut }: {
  index: number;
  single: boolean;
  sheets: NestedSheet[];
  parts: Map<string, PartRef>;
  machine: Machine;
  onCut: (index: number, cut: NonNullable<NestedSheet["cut"]>) => void;
}): { panel: ReactNode; cut: CutMode } {
  const sheet = sheets[index] as NestedSheet | undefined;
  const paths = useMemo(() => new Map([...parts].map(([id, r]) => [id, r.path])), [parts]);
  const ctx = sheet ? leadCtx(sheet, paths, machine) : null;
  const live = useMemo(() => new Set<CutContour>(sheet ? liveContours(sheet) : []), [sheet]);
  const outlines = useMemo(() => new Set([...live].filter((c) => c.kind === "outer" && !c.parts && !c.common && !c.inline)), [live]);
  const fresh = (): { type: LeadType; spec: LeadSpec } => {
    const v = leadValues("outer", ctx?.row ?? null, "perpGap");
    return { type: "perpGap", spec: { ...v, gap: v.gap < 0 ? v.gap : -5 } };
  };
  const [all, setAll] = useState(false);
  const [move, setMove] = useState(false);
  const [mode, setMode] = useState<"modify" | "add">("add");
  const [keepOrig, setKeepOrig] = useState(false);
  const [manual, setManual] = useState(false);
  const [draft, setDraft] = useState(fresh);
  const [picking, setPicking] = useState(false);
  const [sel, setSel] = useState<Sel | null>(null);
  /** APPLY pressed: the balloon(s) on the pointer (ADD NEW), or the next lead clicked gets the drawing's (MODIFY) */
  const [armed, setArmed] = useState<null | { what: "add"; p1?: Pt; k?: number } | { what: "modify" }>(null);
  /** MOVE: the balloon picked, placed by the next click */
  const [moving, setMoving] = useState<null | { k: number; si: number; which: "at" | "p1" }>(null);
  const [hover, setHover] = useState<Pt | null>(null);
  /** RESET (on / off): the next part clicked loses its breaks and micro joints, its leads the automatic cut's */
  const [resetOn, setResetOn] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  useEffect(() => { setSel(null); setArmed(null); setMoving(null); setMsg(null); }, [index]);
  useEffect(() => { setArmed(null); setMoving(null); }, [mode, move, manual]);
  useEffect(() => { if (resetOn) { setArmed(null); setMoving(null); setMove(false); } }, [resetOn]);
  useEffect(() => { if (armed || move) setResetOn(false); }, [armed, move]);
  useEffect(() => {
    if (!armed && !moving && !resetOn) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setArmed(null); setMoving(null); setResetOn(false); setMsg({ text: resetOn ? "Reset off" : "Nothing placed" }); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [armed, moving, resetOn]);

  const cutPath = sheet?.cut;
  const can = single && !!cutPath && outlines.size > 0;
  const selStart: BreakStart | null = sel && ctx && cutPath && cutPath.contours[sel.k] ? startOf(ctx, cutPath, sel.k, sel.si) : null;

  const run = (k: number, op: BreakOp, done: string) => {
    if (!ctx) return false;
    const r = editBreak(ctx, k, op, all, live);
    if (typeof r === "string") { setMsg({ text: r, bad: true }); return false; }
    onCut(index, r.cut);
    diag("process", `Break cut ${op.op} on sheet ${index + 1}`, { outlines: r.n, all });
    setMsg({ text: `${done}${r.n > 1 ? ` (${r.n} outlines)` : ""}` });
    return true;
  };

  /** the lead / balloon clicked: picked, its values in the drawing */
  const pick = (s: Sel) => {
    if (!ctx || !cutPath) return;
    const st = startOf(ctx, cutPath, s.k, s.si);
    if (!st) return;
    setSel(s);
    setMode("modify");
    setDraft({ type: st.type, spec: st.spec });
    setManual(st.tag === "manual");
    setMsg(null);
  };

  const point = (x: number, y: number, scale: number) => {
    if (!cutPath || !ctx) return;
    const p: Pt = [x, y];
    const reach = Math.max(1, 12 / scale);
    if (resetOn) {
      const parts = new Set([...live].filter((c) => (c.kind === "outer" || c.kind === "inner") && !c.parts && !c.common && !c.inline));
      const k = pickContour(cutPath, parts, p, reach);
      if (k < 0) { setMsg({ text: "RESET: click a part", bad: true }); return; }
      const r = resetPart(ctx, k, all, live);
      if (typeof r === "string") { setMsg({ text: r, bad: true }); return; }
      onCut(index, r.cut);
      diag("process", `Break cut reset on sheet ${index + 1}`, { parts: r.n, all });
      setMsg({ text: `Part reset${r.n > 1 ? ` (${r.n} parts)` : ""}` });
      setSel(null);
      return;
    }
    if (moving) {
      if (run(moving.k, { op: "move", si: moving.si, which: moving.which, to: p }, "Balloon moved")) { setMoving(null); setSel(null); }
      return;
    }
    if (move) {
      // MOVE: only the balloons of added breaks
      const b = balloonsOf(cutPath, live).reduce<{ b: ReturnType<typeof balloonsOf>[number]; d: number } | null>((best, x) => {
        const d = Math.hypot(x.at[0] - p[0], x.at[1] - p[1]);
        return d <= reach && (!best || d < best.d) ? { b: x, d } : best;
      }, null);
      if (!b) { setMsg({ text: "MOVE: click a balloon (BC, 1 or 2)", bad: true }); return; }
      setMoving({ k: b.b.k, si: b.b.si, which: b.b.which });
      setSel({ k: b.b.k, si: b.b.si });
      setMsg({ text: `Balloon ${b.b.label} picked: click where it goes on its outline` });
      return;
    }
    if (armed?.what === "add") {
      const k = pickContour(cutPath, outlines, p, reach);
      if (k < 0) { setMsg({ text: "Drop it on a part's outline", bad: true }); return; }
      if (manual && !armed.p1) { setArmed({ what: "add", p1: p, k }); setMsg({ text: "Balloon 1 placed: now balloon 2, after it in the cut direction" }); return; }
      if (manual && armed.k !== undefined && !piecesOf(cutPath, armed.k).includes(k)) { setMsg({ text: "Balloon 2 goes on the same outline as balloon 1", bad: true }); return; }
      const start: BreakStart = manual
        ? { at: p, p1: armed.p1, type: draft.type, spec: draft.spec, tag: "manual" }
        : { at: p, type: draft.type, spec: draft.spec, tag: "bc" };
      if (run(manual ? armed.k! : k, { op: "add", start, keepOrig }, "Break cut added")) setArmed(null);
      else if (manual) setArmed({ what: "add" });
      return;
    }
    const hit = leadNear(cutPath, live, p, reach);
    if (armed?.what === "modify") {
      if (!hit) { setMsg({ text: "Click a lead (its pierce point) or a balloon", bad: true }); return; }
      if (run(hit.k, { op: "set", si: hit.si, type: draft.type, spec: draft.spec }, "Lead changed")) setArmed(null);
      return;
    }
    if (!hit) { setSel(null); setMsg({ text: "Click a lead (its pierce point) or a balloon to pick it", bad: true }); return; }
    pick(hit);
  };

  const apply = () => {
    setMsg(null);
    if (mode === "add") { setArmed({ what: "add" }); setSel(null); return; }
    if (sel) { run(sel.k, { op: "set", si: sel.si, type: draft.type, spec: draft.spec }, "Lead changed"); return; }
    setArmed({ what: "modify" });
  };

  const typeLabel = LEAD_TYPES.find((t) => t.id === draft.type)?.label;
  // a pair's balloons lean away from each other
  const all0 = cutPath ? balloonsOf(cutPath, live) : [];
  const sideOf = (b: (typeof all0)[number]) => {
    const mate = all0.find((x) => x !== b && x.k === b.k && x.si === b.si);
    return mate ? (b.at[0] >= mate.at[0] ? 1 : -1) : 1;
  };
  const balloons = all0.map((b) => ({ at: b.at, label: b.label, neg: b.neg, title: b.title, side: sideOf(b), sel: !!sel && sel.k === b.k && sel.si === b.si }));
  const neg = manual || draft.spec.gap < 0;
  const floating = armed?.what === "add" && hover
    ? (manual ? (armed.p1 ? [{ at: armed.p1, label: "1", neg, side: armed.p1[0] >= hover[0] ? 1 : -1 }, { at: hover, label: "2", neg, float: true, side: armed.p1[0] >= hover[0] ? -1 : 1 }]
      : [{ at: hover, label: "1", neg, float: true, side: -1 }, { at: hover, label: "2", neg, float: true, side: 1 }])
      : [{ at: hover, label: "BC", neg, float: true }])
    : [];

  const panel = (
    <aside className="mn-parts ac li bc" aria-label="Break cut">
      <header className="sol-head ac-head"><span className="itool-box ac-icon-sm" aria-hidden="true"><img src={toolBreakCut} alt="" draggable={false} /></span><h2>Break cut</h2></header>
      <div className="ac-body">
        <div className="li-top">
          <span className="cols-toggle li-scope" role="radiogroup" aria-label="Change">
            <button type="button" role="radio" aria-checked={!all} className={!all ? "is-on" : ""} onClick={() => setAll(false)} title="This part only">
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="3" y="3" width="10" height="10" /></svg>
            </button>
            <button type="button" role="radio" aria-checked={all} className={all ? "is-on" : ""} onClick={() => setAll(true)} title="Every copy of the part on this sheet: the same place of each">
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                <rect x="1.5" y="1.5" width="5.5" height="5.5" /><rect x="9" y="1.5" width="5.5" height="5.5" />
                <rect x="1.5" y="9" width="5.5" height="5.5" /><rect x="9" y="9" width="5.5" height="5.5" />
              </svg>
            </button>
          </span>
          <span className="li-scope-label">{all ? "All copies" : "This part"}</span>
          <button type="button" className={`btn btn-plain li-move${move ? " is-on" : ""}`} aria-pressed={move} disabled={!can}
            title="Move: click a balloon, then where it goes on its outline (balloon 2 always after balloon 1 in the cut direction)"
            onClick={() => { setMove(!move); setMsg(null); }}>Move</button>
        </div>
        <div className="seg bc-modes" role="radiogroup" aria-label="Break cut mode">
          <button type="button" role="radio" aria-checked={mode === "modify"} className={mode === "modify" ? "is-on" : ""} onClick={() => setMode("modify")}
            title="Change a lead that is there: the outline's own, or an added break">Modify existing</button>
          <button type="button" role="radio" aria-checked={mode === "add"} className={mode === "add" ? "is-on" : ""} onClick={() => { setMode("add"); setSel(null); }}
            title="Add a break where its balloon is dropped">Add new</button>
        </div>
        <label className={`chk${mode !== "add" ? " is-off" : ""}`} title="On: the outline keeps its lead and is cut in pieces (a pierce each). Off: the break takes the original lead's place">
          <input type="checkbox" checked={keepOrig} disabled={mode !== "add"} onChange={(e) => setKeepOrig(e.target.checked)} /> Keep the original lead in / out</label>
        <button type="button" className="btn btn-plain li-type" onClick={() => setPicking(true)} title="The lead in / out types with a gap">
          <span>Lead in / out type</span>{typeLabel && <b>{typeLabel}</b>}
        </button>
        <div className="li-draw" aria-label="Lead in / out and gap">
          <LeadEditor type={draft.type} spec={draft.spec} onChange={(spec) => setDraft({ ...draft, spec })} gapLocked={manual} />
        </div>
        <label className="chk" title="On: the gap is set by two balloons (1: where the cut stops, 2: where it starts again); the gap box is not used">
          <input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} /> Manual gap distance selection</label>
        <div className="ac-pickbar li-bar">
          <button type="button" className={`btn btn-plain li-reset${resetOn ? " is-on" : ""}`} aria-pressed={resetOn} disabled={!can}
            title="On: click a part: its break cuts and micro joints out, its leads the automatic cut's (this part or all copies)"
            onClick={() => { setResetOn(!resetOn); setMsg(null); }}>Reset</button>
          <button type="button" className={`btn btn-plain li-apply${armed ? " is-on" : ""}`} disabled={!can}
            title={mode === "add" ? "A balloon on the pointer: click an outline to drop it" : sel ? "Put this type and these values on the picked lead" : "Then click the lead or balloon to change"}
            onClick={apply}>Apply</button>
        </div>
        <div className="ac-pickbar li-bar">
          <button type="button" className="btn btn-plain li-del" disabled={!sel || !selStart || selStart.tag === "orig"}
            title="The picked break out: its outline closes again"
            onClick={() => { if (sel && run(sel.k, { op: "delete", si: sel.si }, "Break cut deleted")) setSel(null); }}>Delete</button>
          <span className="li-spacer" />
        </div>
        <p className="rule-help ac-help">A break is a lead with a negative gap: the cut stops that far short and leaves a bridge (light red). Break cuts go on part outlines.</p>
        {msg && <p className={`tech-msg ac-msg${msg.bad ? " is-bad" : ""}`} role="status">{msg.text}</p>}
      </div>
      {picking && (
        <TypeDialog value={draft.type} types={GAP_TYPES} icon={toolBreakCut} onCancel={() => setPicking(false)}
          onOk={(type) => {
            setPicking(false);
            if (type === draft.type) return;
            const v = leadValues("outer", ctx?.row ?? null, type);
            setDraft({ type, spec: { ...v, gap: draft.spec.gap } });
          }} />
      )}
    </aside>
  );

  return {
    panel,
    cut: {
      picking: false, picked: [], onPick: () => { /* leads are picked here */ }, panel,
      ...(can ? { onPoint: point, cursor: armed || moving || resetOn ? "crosshair" : "pointer" } : {}),
      ...(can && (armed || moving) ? { onHover: (x: number, y: number) => setHover([x, y]) } : {}),
      ...(balloons.length || floating.length ? { balloons: [...balloons, ...floating] } : {}),
      ...(sel && cutPath ? { glow: { all: new Set(piecesOf(cutPath, sel.k).map((i) => cutPath.contours[i])) } } : {}),
      hint: !can ? (single ? "Process the sheet first (Auto cut), then add break cuts here." : "Open a sheet to add break cuts.")
        : resetOn ? "RESET: click a part: its breaks and micro joints out, its leads the automatic cut's (Esc: off)."
        : moving ? "MOVE: click where the balloon goes on its outline (Esc: leave it)."
        : move ? "MOVE: click a balloon."
        : armed?.what === "add" ? (manual ? (armed.p1 ? "Click where the cut starts again (balloon 2), after balloon 1 in the cut direction." : "Click where the cut stops (balloon 1) on an outline.") : "Click an outline to drop the break (BC) there (Esc: cancel).")
        : armed?.what === "modify" ? "Click the lead or balloon to change."
        : "Pick a lead or a balloon to see it; or ADD NEW and APPLY to place a break.",
    },
  };
}
