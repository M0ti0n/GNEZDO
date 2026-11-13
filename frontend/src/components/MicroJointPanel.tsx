import { useEffect, useMemo, useState, type ReactNode } from "react";
import { balloonsOf, editBreak, mapPoint, piecesOf } from "../job/breakCut";
import { liveContours, type CutContour } from "../job/cutPath";
import { diag } from "../job/diag";
import { leadCtx } from "../job/leadEdit";
import type { Machine, Origin } from "../job/machine";
import { pickContour } from "../job/manualCut";
import type { Pt } from "../job/manualGeom";
import { autoJoints, deleteJoint, jointsOf, mjDefault, mjSpec, OPPOSITE, resetPart, type AutoMode } from "../job/microJoint";
import type { NestedSheet } from "../job/nest";
import { NumInput } from "./NumInput";
import type { CutMode } from "./ManualNest";
import toolMicroJoint from "../shell/jobtools/tool-microJoint.png";

// Process -> Micro joint (laid out like Break cut): small uncut places along a contour, with no lead-in
// or lead-out; their length from the Technology row (Micro joint: Length), changed here.
//  MANUAL (on / off): click a contour (an outline or a hole) to put a joint there (MJ1, MJ2 … balloons).
//  CORNERS / SIDES: click a contour: joints on its corners / side middles towards the sheet's four
//    corners / sides (three when the original lead in / out is kept).
//  OPPOSITE SIDES X (top, bottom) / Y (left, right), OPPOSITE CORNERS X (towards 0,0 and across) / Y
//    (the other two): two joints, the cut starting at one of them (the original lead goes).
//  A balloon clicked: picked (its length in the box, changed there); MOVE: a balloon, then where it goes.
//  RESET (on / off): click a part: its joints and breaks out, its leads the automatic cut's. DELETE: the
//    picked joint out.

type PartRef = { path: string };
type Mode = "manual" | AutoMode | "reset" | null;

const MODES: { id: Exclude<Mode, null | "reset">; label: string; title: string }[] = [
  { id: "manual", label: "Manual", title: "On: click a contour (an outline or a hole) to put a micro joint there; off: click it again" },
  { id: "corners", label: "Corners", title: "Click a contour: micro joints on its sharp corners towards the sheet's corners (on a round corner: its point that way). 4, or 3 with the original lead kept" },
  { id: "sides", label: "Sides", title: "Click a contour: micro joints on the middles of its sides towards the sheet's sides. 4, or 3 with the original lead kept" },
  { id: "oppSidesX", label: "Opposite sides X", title: "Click a contour: two micro joints, on the middles of its top and bottom sides (along X); the cut starts at one of them (the original lead goes)" },
  { id: "oppSidesY", label: "Opposite sides Y", title: "Click a contour: two micro joints, on the middles of its left and right sides (along Y); the cut starts at one of them (the original lead goes)" },
  { id: "oppCornersX", label: "Opposite corners X", title: "Click a contour: two micro joints, on its corner towards the machine's 0,0 corner and the one across; the cut starts at one of them (the original lead goes)" },
  { id: "oppCornersY", label: "Opposite corners Y", title: "Click a contour: two micro joints, on its other two corners (not towards 0,0); the cut starts at one of them (the original lead goes)" },
];

export function useMicroJoint({ index, single, sheets, parts, machine, origin, onCut }: {
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
  const ctx = sheet ? leadCtx(sheet, paths, machine) : null;
  const live = useMemo(() => new Set<CutContour>(sheet ? liveContours(sheet) : []), [sheet]);
  const usable = useMemo(() => new Set([...live].filter((c) => (c.kind === "outer" || c.kind === "inner") && !c.parts && !c.common)), [live]);
  const [all, setAll] = useState(false);
  const [move, setMove] = useState(false);
  const [keepOrig, setKeepOrig] = useState(false);
  const [mode, setMode] = useState<Mode>(null);
  const [length, setLength] = useState<number | null>(null);   // null: the Technology row's
  const [sel, setSel] = useState<{ k: number; si: number } | null>(null);
  const [moving, setMoving] = useState<{ k: number; si: number } | null>(null);
  const [hover, setHover] = useState<Pt | null>(null);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  useEffect(() => { setSel(null); setMoving(null); setMsg(null); }, [index]);
  useEffect(() => { setMoving(null); }, [mode, move]);
  useEffect(() => {
    if (!mode && !move && !moving) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setMode(null); setMove(false); setMoving(null); setMsg(null); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [mode, move, moving]);

  const cutPath = sheet?.cut;
  const can = single && !!cutPath && usable.size > 0;
  const def = mjDefault(ctx);
  const selJoint = sel && ctx && cutPath?.contours[sel.k] ? jointsOf(ctx, cutPath, sel.k).find((j) => j.si === sel.si) : undefined;
  const shown = selJoint ? -selJoint.s.spec.gap : length ?? def;
  const opposite = !!mode && (OPPOSITE as string[]).includes(mode);

  const done = (r: { cut: NonNullable<NestedSheet["cut"]>; n: number } | string, what: string, unit = "contours") => {
    if (typeof r === "string") { setMsg({ text: r, bad: true }); return false; }
    onCut(index, r.cut);
    diag("process", `Micro joint: ${what} on sheet ${index + 1}`, { n: r.n, all });
    setMsg({ text: `${what}${r.n > 1 ? ` (${r.n} ${unit})` : ""}` });
    return true;
  };

  const balloonAt = (p: Pt, reach: number) => cutPath ? balloonsOf(cutPath, live, "mj").reduce<{ k: number; si: number; d: number } | null>((best, b) => {
    const d = Math.hypot(b.at[0] - p[0], b.at[1] - p[1]);
    return d <= reach && (!best || d < best.d) ? { k: b.k, si: b.si, d } : best;
  }, null) : null;

  const point = (x: number, y: number, scale: number) => {
    if (!cutPath || !ctx) return;
    const p: Pt = [x, y];
    const reach = Math.max(1, 12 / scale);
    const len = length ?? def;
    if (moving) {
      if (done(editBreak(ctx, moving.k, { op: "move", si: moving.si, which: "at", to: p }, all, live), "Micro joint moved", "outlines")) { setMoving(null); setSel(null); }
      return;
    }
    if (move) {
      const b = balloonAt(p, reach);
      if (!b) { setMsg({ text: "MOVE: click a micro joint's balloon", bad: true }); return; }
      setMoving({ k: b.k, si: b.si });
      setSel({ k: b.k, si: b.si });
      setMsg({ text: "Picked: click where it goes on its contour" });
      return;
    }
    if (mode === "reset") {
      const k = pickContour(cutPath, usable, p, reach);
      if (k < 0) { setMsg({ text: "RESET: click a part", bad: true }); return; }
      done(resetPart(ctx, k, all, live), "Part reset", "parts");
      setSel(null);
      return;
    }
    if (mode === "manual") {
      const k = pickContour(cutPath, usable, p, reach);
      if (k < 0) { setMsg({ text: "Click on a contour (an outline or a hole)", bad: true }); return; }
      const kind = cutPath.contours[k].kind === "inner" ? "inner" : "outer";
      done(editBreak(ctx, k, { op: "add", start: { at: p, type: "perpGap", spec: mjSpec(ctx, kind, len), tag: "mj" }, keepOrig }, all, live), "Micro joint added");
      return;
    }
    if (mode) {
      const k = pickContour(cutPath, usable, p, reach);
      if (k < 0) { setMsg({ text: "Click a contour (an outline or a hole)", bad: true }); return; }
      done(autoJoints(ctx, k, mode, keepOrig, len, origin, all, live), "Micro joints placed");
      setSel(null);
      return;
    }
    // no mode: a balloon picked (its length into the box)
    const b = balloonAt(p, reach);
    setSel(b ? { k: b.k, si: b.si } : null);
    setMsg(b ? null : { text: "Click a micro joint's balloon to pick it, or choose a mode" });
  };

  /** the length box: the picked joint's (changed at once), else the next joints' */
  const setLen = (n: number) => {
    const v = Math.max(0.1, n);
    if (sel && ctx && cutPath && selJoint) {
      const kind = cutPath.contours[sel.k].kind === "inner" ? "inner" : "outer";
      done(editBreak(ctx, sel.k, { op: "set", si: sel.si, type: "perpGap", spec: mjSpec(ctx, kind, v) }, all, live), "Length changed");
      return;
    }
    setLength(v === def ? null : v);
  };

  const toggle = (m: Exclude<Mode, null>) => { setMode(mode === m ? null : m); setMove(false); setSel(null); setMsg(null); };

  const balloons = cutPath ? balloonsOf(cutPath, live, "mj").map((b) => ({ at: b.at, label: b.label, neg: false, mj: true, title: b.title, sel: !!sel && sel.k === b.k && sel.si === b.si })) : [];
  const floating = mode === "manual" && hover ? [{ at: hover, label: "MJ", neg: false, mj: true, float: true }] : [];

  const panel = (
    <aside className="mn-parts ac li bc mj" aria-label="Micro joint">
      <header className="sol-head ac-head"><span className="itool-box ac-icon-sm" aria-hidden="true"><img src={toolMicroJoint} alt="" draggable={false} /></span><h2>Micro joint</h2></header>
      <div className="ac-body">
        <div className="li-top">
          <span className="cols-toggle li-scope" role="radiogroup" aria-label="Change">
            <button type="button" role="radio" aria-checked={!all} className={!all ? "is-on" : ""} onClick={() => setAll(false)} title="This part only">
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="3" y="3" width="10" height="10" /></svg>
            </button>
            <button type="button" role="radio" aria-checked={all} className={all ? "is-on" : ""} onClick={() => setAll(true)} title="Every copy of the part on this sheet">
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                <rect x="1.5" y="1.5" width="5.5" height="5.5" /><rect x="9" y="1.5" width="5.5" height="5.5" />
                <rect x="1.5" y="9" width="5.5" height="5.5" /><rect x="9" y="9" width="5.5" height="5.5" />
              </svg>
            </button>
          </span>
          <span className="li-scope-label">{all ? "All copies" : "This part"}</span>
          <button type="button" className={`btn btn-plain li-move${move ? " is-on" : ""}`} aria-pressed={move} disabled={!can}
            title="Move: click a micro joint's balloon, then where it goes on its contour"
            onClick={() => { setMove(!move); setMode(null); setMsg(null); }}>Move</button>
        </div>
        <label className={`chk${opposite ? " is-off" : ""}`} title="On: the contour keeps its lead and the joints are added (Corners, Sides: 3). Off: the cut starts at a joint (Corners, Sides: 4). The opposite modes always take the lead's place">
          <input type="checkbox" checked={keepOrig && !opposite} disabled={opposite} onChange={(e) => setKeepOrig(e.target.checked)} /> Keep the original lead in / out</label>
        <div className="mj-len">
          <span>{selJoint ? `Length of the picked joint` : "Micro joint length"}</span>
          <label className="li-val mj-val" title={selJoint ? "This joint's length (changed at once)" : `The next joints' length (the Technology table: ${def} mm)`}>
            <NumInput value={+shown.toFixed(3)} min={0.1} aria-label="Micro joint length (mm)" className="li-num" onCommit={setLen} /><span>mm</span>
          </label>
        </div>
        <div className="mj-modes">
          {MODES.map((m) => (
            <button key={m.id} type="button" className={`btn btn-plain mj-mode${mode === m.id ? " is-on" : ""}${m.id === "manual" ? " is-wide" : ""}`} aria-pressed={mode === m.id}
              disabled={!can} title={m.title} onClick={() => toggle(m.id)}>{m.label}</button>
          ))}
        </div>
        <div className="ac-pickbar li-bar">
          <button type="button" className={`btn btn-plain li-reset${mode === "reset" ? " is-on" : ""}`} aria-pressed={mode === "reset"} disabled={!can}
            title="On: click a part: its micro joints and break cuts out, its leads the automatic cut's (this part or all copies)"
            onClick={() => toggle("reset")}>Reset</button>
          <button type="button" className="btn btn-plain li-del" disabled={!selJoint}
            title="The picked micro joint out"
            onClick={() => {
              if (!sel || !ctx) return;
              if (done(deleteJoint(ctx, sel.k, sel.si, all, live, (a, b, q) => mapPoint(ctx, a, b, q, !!cutPath?.mirrored)), "Micro joint deleted")) setSel(null);
            }}>Delete</button>
        </div>
        <p className="rule-help ac-help">A micro joint is a short place not cut, with no lead-in or lead-out: the cut stops before it and starts again after it (Technology table: Micro joint length and restart). Outlines and holes. Hover over a balloon for its length.</p>
        {msg && <p className={`tech-msg ac-msg${msg.bad ? " is-bad" : ""}`} role="status">{msg.text}</p>}
      </div>
    </aside>
  );

  const label = MODES.find((m) => m.id === mode)?.label.toUpperCase();
  return {
    panel,
    cut: {
      picking: false, picked: [], onPick: () => { /* picked here */ }, panel,
      ...(can ? { onPoint: point, cursor: mode || moving ? "crosshair" : "pointer" } : {}),
      ...(can && (mode === "manual" || moving) ? { onHover: (x: number, y: number) => setHover([x, y]) } : {}),
      ...(balloons.length || floating.length ? { balloons: [...balloons, ...floating] } : {}),
      ...(sel && cutPath ? { glow: { all: new Set(piecesOf(cutPath, sel.k).map((i) => cutPath.contours[i])) } } : {}),
      hint: !can ? (single ? "Process the sheet first (Auto cut), then add micro joints here." : "Open a sheet to add micro joints.")
        : moving ? "MOVE: click where the micro joint goes on its contour (Esc: leave it)."
        : move ? "MOVE: click a micro joint's balloon."
        : mode === "reset" ? "RESET: click a part (Esc: off)."
        : mode === "manual" ? "MANUAL: click a contour where a micro joint goes (Esc: off)."
        : mode ? `${label}: click a contour (Esc: off).`
        : "Choose a mode, or click a balloon to pick its micro joint.",
    },
  };
}
