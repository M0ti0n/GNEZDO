import { useEffect, useMemo, useState, type ReactNode } from "react";
import { liveContours, originPoint, viaOf, type CutContour } from "../job/cutPath";
import { diag } from "../job/diag";
import type { Origin } from "../job/machine";
import type { Pt } from "../job/manualGeom";
import { cannotGo, clearVias, deleteViaPoint, pierceAt, rapidAt, routeRapid } from "../job/movement";
import type { NestedSheet } from "../job/nest";
import { ConfirmDialog } from "./ConfirmDialog";
import type { CutMode } from "./ManualNest";
import toolMovement from "../shell/jobtools/tool-movement.png";
import mvSingle from "../shell/jobtools/mv-single.svg";
import mvMulti from "../shell/jobtools/mv-multi.svg";
import mvDelete from "../shell/jobtools/mv-delete.svg";

// Process -> Movement (after Fab's drawing): SINGLE POINT: click a rapid move, then the point it
// should go through (done). MULTI POINT: click a rapid move, then its points one by one, and close on
// a lead-in. Closing on another contour's lead-in changes the cut order (from an outline: another part;
// from a hole or open cut: another hole or open cut of the same part). DELETE POINT (on / off): a
// click on a point takes it out. The modes stay on until switched off.

type Mode = "single" | "multi" | "delete";
type PartRef = { path: string; name?: string };

const MODES: { id: Mode; label: string; icon: string; hint: string }[] = [
  { id: "single", label: "Single point", icon: mvSingle, hint: "Click a rapid move, then the point it should go through" },
  { id: "multi", label: "Multi point", icon: mvMulti, hint: "Click a rapid move, then its points one by one; close on a lead-in" },
  { id: "delete", label: "Delete point", icon: mvDelete, hint: "On: click a point to take it out of its rapid move" },
];

export function useMovement({ index, single, sheets, parts, origin, onCut }: {
  index: number;
  /** one sheet open (the tool works there) */
  single: boolean;
  sheets: NestedSheet[];
  parts: Map<string, PartRef>;
  origin: Origin;
  onCut: (index: number, cut: NonNullable<NestedSheet["cut"]>) => void;
}): { panel: ReactNode; cut: CutMode } {
  const sheet = sheets[index] as NestedSheet | undefined;
  const live = useMemo(() => new Set<CutContour>(sheet ? liveContours(sheet) : []), [sheet]);
  const from = useMemo<Pt>(() => (sheet ? originPoint(sheet, origin) : [0, 0]), [sheet, origin]);
  const [mode, setMode] = useState<Mode | null>(null);
  /** the rapid being changed: the contour it goes into, the points placed so far, as it was drawn */
  const [sel, setSel] = useState<{ k: number; pts: Pt[]; was: Pt[] } | null>(null);
  const [hover, setHover] = useState<Pt | null>(null);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [askClear, setAskClear] = useState(false);
  useEffect(() => { setSel(null); setMsg(null); }, [index, mode]);
  useEffect(() => { if (!single) setMode(null); }, [single]);
  // Escape: the rapid being changed is left as it was
  useEffect(() => {
    if (!sel) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setSel(null); setMsg({ text: "Left as it was" }); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [sel]);

  const cutPath = sheet?.cut;
  const can = single && !!cutPath && live.size > 0;
  const nameOf = (part: number) => { const p = sheet?.parts[part]; return (p && parts.get(p.partId)?.name) ?? `Part ${part + 1}`; };
  // rapids that go through points now
  const vias = useMemo(() => { const l = [...live]; return l.filter((c, i) => viaOf(c, l[i - 1]).length).length; }, [live]);

  const finish = (t: number, pts: Pt[]) => {
    if (!cutPath || !sel) return;
    const r = routeRapid(cutPath, live, sel.k, t, pts, nameOf);
    if (typeof r === "string") { setMsg({ text: r, bad: true }); return; }
    onCut(index, r);
    diag("process", `Movement on sheet ${index + 1}`, { points: pts.length, reordered: t !== sel.k });
    setMsg({ text: t !== sel.k ? "Rapid move changed: the cut order changed with it" : pts.length ? `Rapid move through ${pts.length} ${pts.length === 1 ? "point" : "points"}` : "Rapid move straight again" });
    setSel(null);
  };

  const point = (x: number, y: number, scale: number) => {
    if (!cutPath || !mode) return;
    const p: Pt = [x, y];
    const reach = Math.max(1, 10 / scale);
    if (mode === "delete") {
      const r = deleteViaPoint(cutPath, live, p, reach);
      if (!r) { setMsg({ text: "Click on a point of a rapid move (a blue dot)", bad: true }); return; }
      onCut(index, r);
      setMsg({ text: "Point taken out" });
      return;
    }
    if (!sel) {
      const r = rapidAt(cutPath, live, from, p, reach);
      if (!r) { setMsg({ text: "Click on a rapid move (dashed)", bad: true }); return; }
      setSel({ k: r.k, pts: [], was: r.pts });
      setMsg(null);
      return;
    }
    // a lead-in (it snaps there): the way ends there
    const t = pierceAt(cutPath, live, p, reach);
    if (t >= 0) { finish(t, sel.pts); return; }
    if (mode === "single") { finish(sel.k, [p]); return; }
    setSel({ ...sel, pts: [...sel.pts, p] });
  };

  // the lead-ins the rapid being changed may go to: ringed
  const targets = useMemo(() => {
    if (!cutPath || !sel) return [];
    return cutPath.contours.flatMap((c, i) => (live.has(c) && !cannotGo(cutPath, live, sel.k, i) ? [c.leadIn[0] ?? c.pts[0]] : []));
  }, [cutPath, live, sel]);

  const panel = (
    <aside className="mn-parts ac mv" aria-label="Movement">
      <header className="sol-head ac-head"><span className="itool-box ac-icon-sm" aria-hidden="true"><img src={toolMovement} alt="" draggable={false} /></span><h2>Movement</h2></header>
      <div className="ac-body">
        <div className="ac-field"><span>Mode</span></div>
        <div className="rm-tools mv-modes" role="group" aria-label="Movement mode">
          {MODES.map((m) => (
            <button key={m.id} type="button" className={`rm-btn mv-btn${m.id === "delete" ? " is-del" : ""}${mode === m.id ? " is-on" : ""}`} aria-pressed={mode === m.id}
              disabled={!can} title={can ? m.hint : "Open a processed sheet (VIEW / EDIT)"} onClick={() => setMode(mode === m.id ? null : m.id)}>
              <img src={m.icon} alt="" draggable={false} /><span>{m.label}</span>
            </button>
          ))}
        </div>
        <p className="rule-help ac-help">
          {!mode ? "Pick a mode." : mode === "delete" ? "Click a point (blue dot) to take it out; the rapid then goes straight past it."
            : !sel ? "Click the rapid move (dashed) to change."
            : mode === "single" ? "Click the point it should go through, or another lead-in (it is cut next)."
            : `${sel.pts.length} ${sel.pts.length === 1 ? "point" : "points"} placed: place more, then click a lead-in to close (Esc: leave it as it was).`}
        </p>
        <p className="rule-help ac-help">From an outline the rapid can go to another part (cut next, whole); from a hole or open cut only to another hole or open cut of the same part. Points stay while the contours before and after them stay the same.</p>
        <button type="button" className="btn btn-plain pp-btn" disabled={!vias} onClick={() => setAskClear(true)}
          title="Every rapid move on this sheet straight again">Straight rapids ({vias})</button>
        {msg && <p className={`tech-msg ac-msg${msg.bad ? " is-bad" : ""}`} role="status">{msg.text}</p>}
      </div>
      {askClear && cutPath && (
        <ConfirmDialog title="Straight rapids?" confirmLabel="Straighten" onCancel={() => setAskClear(false)}
          onConfirm={() => { setAskClear(false); onCut(index, clearVias(cutPath)); setMsg({ text: `Sheet ${index + 1}: rapid moves straight again` }); }}>
          Sheet {index + 1}: the points of every rapid move go ({vias} {vias === 1 ? "move" : "moves"}). The cut order stays.
        </ConfirmDialog>
      )}
    </aside>
  );

  const draft = sel ? [sel.was[0], ...sel.pts, ...(hover ? [hover] : [])] : undefined;
  return {
    panel,
    cut: {
      picking: false, picked: [], onPick: () => { /* nothing picked */ }, panel,
      ...(can && mode ? { onPoint: point, cursor: mode === "delete" ? "pointer" : "crosshair" } : {}),
      ...(can && sel ? { onHover: (x: number, y: number) => setHover([x, y]) } : {}),
      ...(sel ? { move: { sel: sel.was, targets, ...(draft && draft.length > 1 ? { draft } : {}) } } : {}),
      hint: !can ? (single ? "Process the sheet first (Auto cut), then change its rapid moves here." : "Open a sheet to change its rapid moves.")
        : !mode ? "MOVEMENT: pick a mode on the right."
        : mode === "delete" ? "DELETE POINT: click a point of a rapid move."
        : !sel ? `${mode === "single" ? "SINGLE" : "MULTI"} POINT: click a rapid move.`
        : mode === "single" ? "Click the point to go through, or a ringed lead-in (Esc: cancel)."
        : "Click points, then a ringed lead-in to close (Esc: cancel).",
    },
  };
}
