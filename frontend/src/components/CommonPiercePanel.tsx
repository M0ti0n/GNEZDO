import { useEffect, useMemo, useState, type ReactNode } from "react";
import { autoPoint, commonPierce, DEFAULT_COMMON_PIERCE, piercable, piercesOf, removePierce, type CommonPierceOptions } from "../job/commonPierce";
import { liveContours, type CutContour } from "../job/cutPath";
import { diag } from "../job/diag";
import type { Pt } from "../job/manualGeom";
import type { NestedSheet } from "../job/nest";
import { NumInput } from "./NumInput";
import type { CutMode } from "./ManualNest";
import toolCommonPierce from "../shell/jobtools/tool-commonPierce.png";

// Process -> Common pierce: one pierce hole in the scrap for several parts' outlines (job/commonPierce.ts).
//  SELECT (on / off): click parts, then JOIN: the pierce point in the middle between their lead-ins.
//  PLACE (on / off): click a point in the scrap: every outline whose lead-in starts within the radius joins.
//  MOVE: click a pierce point (CP), then where it goes. DELETE (on / off): click a pierce point: its
//  outlines back to their own leads.
// Each part keeps its own lead-in next to the outline (the minimum lead-in); an arc from the pierce
// point runs into it. The lead-out: length and angle, set here.

type PartRef = { path: string; name?: string };
type Mode = "select" | "place" | "move" | "delete" | null;

const KEY = "gnezdo.commonPierce";
const load = (): CommonPierceOptions => {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? "null"); return v ? { ...DEFAULT_COMMON_PIERCE, ...v } : DEFAULT_COMMON_PIERCE; }
  catch { return DEFAULT_COMMON_PIERCE; }
};

export function useCommonPierce({ index, single, sheets, parts, onCut }: {
  index: number;
  single: boolean;
  sheets: NestedSheet[];
  parts: Map<string, PartRef>;
  onCut: (index: number, cut: NonNullable<NestedSheet["cut"]>) => void;
}): { panel: ReactNode; cut: CutMode } {
  const sheet = sheets[index] as NestedSheet | undefined;
  const live = useMemo(() => new Set<CutContour>(sheet ? liveContours(sheet) : []), [sheet]);
  const [opt, setOptState] = useState<CommonPierceOptions>(load);
  const setOpt = (p: Partial<CommonPierceOptions>) => setOptState((o) => {
    const n = { ...o, ...p };
    try { localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* not kept */ }
    return n;
  });
  const [mode, setMode] = useState<Mode>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [moving, setMoving] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  useEffect(() => { setPicked([]); setMode(null); setMoving(null); setMsg(null); }, [index]);
  useEffect(() => {
    if (!mode && !moving) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setMode(null); setMoving(null); setMsg(null); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [mode, moving]);

  const cutPath = sheet?.cut;
  const outlines = useMemo(() => (cutPath?.contours ?? []).map((c, k) => ({ c, k })).filter(({ c }) => live.has(c) && (piercable(c) || !!c.cp)), [cutPath, live]);
  const can = single && !!cutPath && outlines.length > 1;
  const groups = useMemo(() => piercesOf(cutPath, live), [cutPath, live]);
  const nameOf = (part: number) => { const p = sheet?.parts[part]; return (p && parts.get(p.partId)?.name) || `Part ${part + 1}`; };

  const apply = (r: ReturnType<typeof commonPierce>, what: string) => {
    if (typeof r === "string") { setMsg({ text: r, bad: true }); return false; }
    onCut(index, r.cut);
    diag("process", `Common pierce: ${what} on sheet ${index + 1}`, { joined: r.joined, left: r.left.length, ...opt });
    setMsg({ text: `${what}: ${r.joined} outlines from one pierce${r.left.length ? `. Not joined: ${r.left.join("; ")}` : ""}`, bad: false });
    return true;
  };

  const join = () => {
    if (!cutPath) return;
    const ks = outlines.filter(({ c }) => picked.includes(c.part)).map(({ k }) => k);
    if (ks.length < 2) { setMsg({ text: "Select two or more parts first (SELECT, then click them)", bad: true }); return; }
    const p = autoPoint(cutPath, ks, opt);
    if (!p) return;
    if (apply(commonPierce(cutPath, live, p, ks, opt, nameOf), "Joined")) { setPicked([]); setMode(null); }
  };

  const nearGroup = (p: Pt, reach: number) => groups.reduce<{ id: string; d: number } | null>((best, g) => {
    const d = Math.hypot(g.at[0] - p[0], g.at[1] - p[1]);
    return d <= reach && (!best || d < best.d) ? { id: g.id, d } : best;
  }, null);

  const point = (x: number, y: number, scale: number) => {
    if (!cutPath) return;
    const p: Pt = [x, y];
    const reach = Math.max(1.5, 14 / scale);
    if (moving) {
      const g = groups.find((q) => q.id === moving);
      if (g && apply(commonPierce(cutPath, live, p, g.ks, opt, nameOf, g.id), "Moved")) setMoving(null);
      return;
    }
    if (mode === "place") { apply(commonPierce(cutPath, live, p, null, opt, nameOf), "Placed"); return; }
    if (mode === "move") {
      const g = nearGroup(p, reach);
      if (!g) { setMsg({ text: "MOVE: click a pierce point (CP)", bad: true }); return; }
      setMoving(g.id);
      setMsg({ text: "Picked: click where the pierce point goes" });
      return;
    }
    if (mode === "delete") {
      const g = nearGroup(p, reach);
      if (!g) { setMsg({ text: "DELETE: click a pierce point (CP)", bad: true }); return; }
      onCut(index, removePierce(cutPath, g.id));
      setMsg({ text: "Common pierce deleted: the outlines have their own leads again" });
    }
  };

  const toggle = (m: Exclude<Mode, null>) => { setMode(mode === m ? null : m); setMoving(null); setMsg(null); };
  const MODES: { id: Exclude<Mode, null>; label: string; title: string }[] = [
    { id: "select", label: "Select", title: "On: click parts to select them (again: out), then JOIN: one pierce point in the middle between their lead-ins" },
    { id: "place", label: "Place", title: "On: click a point in the scrap: every outline whose lead-in starts within the radius starts from it" },
    { id: "move", label: "Move", title: "Click a pierce point (CP), then where it goes: its outlines follow" },
    { id: "delete", label: "Delete", title: "On: click a pierce point (CP): its outlines get their own leads back" },
  ];

  const panel = (
    <aside className="mn-parts ac il cpi" aria-label="Common pierce">
      <header className="sol-head ac-head"><span className="itool-box ac-icon-sm" aria-hidden="true"><img src={toolCommonPierce} alt="" draggable={false} /></span><h2>Common pierce</h2></header>
      <div className="ac-body">
        <div className="mj-modes">
          {MODES.map((m) => (
            <button key={m.id} type="button" className={`rm-btn mj-mode${mode === m.id ? " is-on" : ""}`} aria-pressed={mode === m.id}
              disabled={!can} title={m.title} onClick={() => toggle(m.id)}>{m.label}</button>
          ))}
        </div>
        {mode === "select" && (
          <div className="ac-pickbar">
            <button type="button" className="btn btn-primary" disabled={picked.length < 2} onClick={join}
              title="One pierce point for the selected parts, in the middle between their lead-ins">Join {picked.length ? `(${picked.length})` : ""}</button>
            <button type="button" className="btn btn-plain" disabled={!picked.length} onClick={() => setPicked([])}>Clear</button>
          </div>
        )}
        <label className="il-row" title="An outline joins a pierce point when its lead-in (the part kept) starts this close to it">
          <span>Radius</span>
          <span className="il-num"><NumInput value={opt.radius} min={0.5} aria-label="Radius (mm)" onCommit={(n) => setOpt({ radius: n })} /><small>mm</small></span>
        </label>
        <label className="il-row" title="Each part keeps this much of its own lead-in next to the outline (all of it when shorter); the arc from the pierce point runs into it">
          <span>Lead-in kept</span>
          <span className="il-num"><NumInput value={opt.minLead} min={0} aria-label="Lead-in kept (mm)" onCommit={(n) => setOpt({ minLead: n })} /><small>mm</small></span>
        </label>
        <label className="il-row" title="The lead-out of the joined outlines: its length">
          <span>Lead-out</span>
          <span className="il-num"><NumInput value={opt.outLen} min={0} aria-label="Lead-out length (mm)" onCommit={(n) => setOpt({ outLen: n })} /><small>mm</small></span>
        </label>
        <label className="il-row" title="The lead-out's angle to the outline, to the scrap side: 90° square to it, 0° on along it">
          <span>Lead-out angle</span>
          <span className="il-num"><NumInput value={opt.outAngle} min={0} aria-label="Lead-out angle (degrees)" onCommit={(n) => setOpt({ outAngle: Math.min(180, n) })} /><small>°</small></span>
        </label>
        <p className="rule-help ac-help">One pierce hole in the scrap for several parts' outlines: the first pierces it, the others start in it with a quick pierce. Each part keeps its own lead-in next to the outline; an arc from the pierce point runs into it (it must stay in the scrap). The values here are for the next JOIN, PLACE or MOVE. Holes keep their own pierces.</p>
        {msg && <p className={`tech-msg ac-msg${msg.bad ? " is-bad" : ""}`} role="status">{msg.text}</p>}
      </div>
    </aside>
  );

  const balloons = groups.map((g) => ({ at: g.at, label: "CP", neg: false, sel: moving === g.id, title: `Common pierce: ${g.ks.length} outlines` }));
  return {
    panel,
    cut: {
      picking: can && mode === "select", picked, noNumbers: true, panel,
      onPick: (i) => setPicked((l) => (l.includes(i) ? l.filter((x) => x !== i) : [...l, i])),
      ...(can && (mode === "place" || mode === "move" || mode === "delete" || moving) ? { onPoint: point, cursor: "crosshair" } : {}),
      ...(balloons.length ? { balloons } : {}),
      hint: !can ? (single ? "Process the sheet first (Auto cut), then join outlines to a common pierce here." : "Open a sheet to put in common pierces.")
        : moving ? "MOVE: click where the pierce point goes (Esc: leave it)."
        : mode === "select" ? "SELECT: click parts (again: out), then JOIN."
        : mode === "place" ? "PLACE: click a point in the scrap between parts (Esc: off)."
        : mode === "move" ? "MOVE: click a pierce point (CP)."
        : mode === "delete" ? "DELETE: click a pierce point (CP) (Esc: off)."
        : "Choose a mode.",
    },
  };
}
