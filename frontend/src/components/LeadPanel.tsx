import { useEffect, useMemo, useState, type ReactNode } from "react";
import { diag } from "../job/diag";
import { leadValues, liveContours, type LeadSpec } from "../job/cutPath";
import { contourAt, editLead, editable, leadCtx, leadOf, type LeadOp } from "../job/leadEdit";
import { LEAD_TYPES, type LeadType } from "../job/leads";
import type { Machine } from "../job/machine";
import type { NestedSheet } from "../job/nest";
import type { CutMode } from "./ManualNest";
import { LeadIcon } from "./LeadIcon";
import { NumInput } from "./NumInput";
import toolLeadInOut from "../shell/jobtools/tool-leadInOut.png";

// Process -> Lead in / out (after Fab's layout): click a lead (or its contour) on the open sheet to
// pick it. MOVE: the first click picks a lead, the second puts it at the nearest point of the same
// contour (a sharp corner within 3 mm: on the corner). LEAD IN / OUT TYPE picks the type; its values
// are set in the drawing below (not to scale: the lines show the directions, the gap always drawn);
// APPLY puts them on the picked lead. RESET: the automatic cut's type and the
// Technology row's values; DELETE (red): no leads (0 / 0, pierced on the contour). The toggle: only
// this part, or every copy of it on the sheet.

type PartRef = { path: string };

export function useLeadInOut({ index, single, sheets, parts, machine, onCut }: {
  index: number;
  /** one sheet open (the tool works there) */
  single: boolean;
  sheets: NestedSheet[];
  parts: Map<string, PartRef>;
  machine: Machine;
  onCut: (index: number, cut: NonNullable<NestedSheet["cut"]>) => void;
}): { panel: ReactNode; cut: CutMode } {
  const sheet = sheets[index] as NestedSheet | undefined;
  const paths = useMemo(() => new Map([...parts].map(([id, r]) => [id, r.path])), [parts]);
  const ctx = sheet ? leadCtx(sheet, paths, machine) : null;
  const live = useMemo(() => new Set(sheet ? liveContours(sheet) : []), [sheet]);
  const [all, setAll] = useState(false);
  const [move, setMove] = useState(false);
  /** MOVE: a lead picked, the next click places it */
  const [armed, setArmed] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ type: LeadType; spec: LeadSpec } | null>(null);
  const [picking, setPicking] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);

  const selC = sel !== null ? sheet?.cut?.contours[sel] : undefined;
  const selOk = !!selC && live.has(selC) && editable(selC);
  useEffect(() => { setSel(null); setArmed(false); setMsg(null); }, [index]);
  useEffect(() => { if (sel !== null && !selOk) { setSel(null); setArmed(false); } }, [sel, selOk]);
  // the picked lead's type and values in the drawing (again after every change)
  useEffect(() => { setDraft(selOk && ctx ? leadOf(ctx, selC!) : null); }, [selC, selOk]);   // eslint-disable-line react-hooks/exhaustive-deps

  const kind = selC?.kind === "outer" ? "outer" : "inner";
  const run = (op: LeadOp, what: string) => {
    if (!ctx || sel === null) return false;
    const r = editLead(ctx, sel, op, all, live);
    if (typeof r === "string") { setMsg({ text: r[0].toUpperCase() + r.slice(1), bad: true }); return false; }
    onCut(index, r.cut);
    diag("process", `Lead in / out ${op.op} on sheet ${index + 1}`, { contours: r.n, all });
    setMsg({ text: `${what}${r.n > 1 ? ` (${r.n} contours)` : ""}${r.note ? `: ${r.note}` : ""}` });
    return true;
  };

  const point = (x: number, y: number) => {
    if (!sheet?.cut) return;
    if (move && armed && sel !== null) {
      if (run({ op: "move", to: [x, y] }, "Lead moved")) setArmed(false);
      return;
    }
    const k = contourAt(sheet.cut, live, [x, y], 25);
    const c = k >= 0 ? sheet.cut.contours[k] : undefined;
    if (!c) { setSel(null); setArmed(false); setMsg({ text: "Click a lead, or the outline or hole it is on", bad: true }); return; }
    if (!editable(c)) { setMsg({ text: "A common cut block's leads are not changed here", bad: true }); return; }
    setSel(k); setArmed(move); setMsg(null);
  };

  const noCut = !sheet?.cut || !live.size;
  const can = single && !noCut;
  const typeLabel = draft ? LEAD_TYPES.find((t) => t.id === draft.type)?.label : undefined;
  const changed = !!draft && !!selC && ctx && JSON.stringify(draft) !== JSON.stringify(leadOf(ctx, selC));

  const panel = (
    <aside className="mn-parts ac li" aria-label="Lead in / out">
      <header className="sol-head ac-head"><span className="itool-box ac-icon-sm" aria-hidden="true"><img src={toolLeadInOut} alt="" draggable={false} /></span><h2>Lead in / out</h2></header>
      <div className="ac-body">
        <div className="li-top">
          <span className="cols-toggle li-scope" role="radiogroup" aria-label="Change">
            <button type="button" role="radio" aria-checked={!all} className={!all ? "is-on" : ""} onClick={() => setAll(false)}
              title="This part only: the lead of the picked part changes">
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="3" y="3" width="10" height="10" /></svg>
            </button>
            <button type="button" role="radio" aria-checked={all} className={all ? "is-on" : ""} onClick={() => setAll(true)}
              title="Every copy of the part on this sheet: the same contour of each gets the same change">
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                <rect x="1.5" y="1.5" width="5.5" height="5.5" /><rect x="9" y="1.5" width="5.5" height="5.5" />
                <rect x="1.5" y="9" width="5.5" height="5.5" /><rect x="9" y="9" width="5.5" height="5.5" />
              </svg>
            </button>
          </span>
          <span className="li-scope-label">{all ? "All copies" : "This part"}</span>
          <button type="button" className={`btn btn-plain li-move${move ? " is-on" : ""}`} aria-pressed={move} disabled={!can}
            title="Move: click a lead, then click where on its contour it goes (the nearest point; a sharp corner within 3 mm: the corner)"
            onClick={() => { setMove(!move); setArmed(!move && sel !== null); setMsg(null); }}>Move</button>
        </div>
        <button type="button" className="btn btn-plain li-type" disabled={!draft} onClick={() => setPicking(true)}
          title="Pick the lead in / out type (the types of Settings → Machines → Leads & cutting)">
          <span>Lead in / out type</span>{typeLabel && <b>{typeLabel}</b>}
        </button>
        <div className="li-draw" aria-label="Lead in / out values">
          {draft ? <LeadEditor type={draft.type} spec={draft.spec} onChange={(spec) => setDraft({ ...draft, spec })} />
            : <p className="ac-empty">{!single ? "Open a sheet (VIEW / EDIT) to change its leads." : noCut ? "Process the sheet first (Auto cut)." : "Click a lead on the sheet to pick it."}</p>}
        </div>
        <div className="ac-pickbar li-bar">
          <button type="button" className="btn btn-plain li-reset" disabled={!selOk}
            title="Back to the automatic cut's type and the Technology row's values (where the lead is now)"
            onClick={() => run({ op: "reset" }, "Lead reset")}>Reset</button>
          <button type="button" className={`btn btn-plain li-apply${changed ? " is-on" : ""}`} disabled={!selOk || !draft}
            title={all ? "Put this type and these values on the picked lead and the same lead of every copy of the part" : "Put this type and these values on the picked lead"}
            onClick={() => draft && run({ op: "set", type: draft.type, spec: draft.spec }, "Lead changed")}>Apply</button>
        </div>
        <div className="ac-pickbar li-bar">
          <button type="button" className="btn btn-plain li-del" disabled={!selOk}
            title="No lead-in and no lead-out (0 / 0): pierced right on the contour"
            onClick={() => run({ op: "delete" }, "Leads deleted")}>Delete</button>
          <span className="li-spacer" />
        </div>
        <p className="rule-help ac-help">{kind === "outer" && selOk ? "Outline" : selOk ? "Hole" : ""}{selOk ? " picked. " : ""}Lengths in mm, angles in degrees; gap: + runs past the start, − stops short of it.</p>
        {msg && <p className={`tech-msg ac-msg${msg.bad ? " is-bad" : ""}`} role="status">{msg.text}</p>}
      </div>
      {picking && draft && ctx && (
        <TypeDialog value={draft.type} onCancel={() => setPicking(false)}
          onOk={(type) => {
            setPicking(false);
            if (type === draft.type) return;
            // the picked lead's own values when it has this type, else the Technology row's for it
            const own = selC && leadOf(ctx, selC);
            setDraft({ type, spec: own && own.type === type ? own.spec : leadValues(kind, ctx.row, type) });
          }} />
      )}
    </aside>
  );

  return {
    panel,
    cut: {
      picking: false, picked: [], onPick: () => { /* parts are not picked here */ }, panel,
      ...(can ? { onPoint: point, cursor: move && armed ? "crosshair" : "pointer" } : {}),
      ...(selOk ? { highlight: new Set([selC!]) } : {}),
      hint: !can ? (noCut ? "Process the sheet first (Auto cut), then change its leads here." : "Open a sheet to change its leads.")
        : move ? (armed ? "MOVE: click where on the contour the lead goes." : "MOVE: click the lead to move.")
        : selOk ? "Set the type and values on the right, then APPLY. Or click another lead." : "Click a lead (or the outline or hole it is on) to pick it.",
    },
  };
}

/** The lead types to pick from (OK / Cancel). */
function TypeDialog({ value, onOk, onCancel }: { value: LeadType; onOk: (t: LeadType) => void; onCancel: () => void }) {
  const [t, setT] = useState(value);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="dlg-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="dlg li-dlg" role="dialog" aria-modal="true" aria-labelledby="li-dlg-title">
        <header className="dlg-head">
          <span className="dlg-icon" aria-hidden="true"><img src={toolLeadInOut} alt="" width={30} height={30} /></span>
          <div className="dlg-title"><h2 id="li-dlg-title">Lead in / out type</h2><p>Lead-in green, lead-out red, gap blue, angles orange (in) and purple (out)</p></div>
        </header>
        <div className="li-dlg-body lead-pick" role="radiogroup" aria-label="Lead in / out type">
          {LEAD_TYPES.map((x) => (
            <button key={x.id} type="button" role="radio" aria-checked={t === x.id} className={`lead-card${t === x.id ? " is-on" : ""}`}
              onClick={() => setT(x.id)} onDoubleClick={() => onOk(x.id)} title={x.cornerOnly ? `${x.settings} · sharp corners only` : x.settings}>
              <LeadIcon type={x.id} />
              <b>{x.label}</b>
              <small>{x.cornerOnly ? "Sharp corners only" : x.settings}</small>
            </button>
          ))}
        </div>
        <footer className="dlg-foot">
          <span className="proc-missing" />
          <button type="button" className="btn btn-plain" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn-save" onClick={() => onOk(t)} autoFocus>OK</button>
        </footer>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ the drawing with its values

const IN = "#22a046", OUT = "#e0352b", GAP = "#1e8db5", AIN = "#f08a24", AOUT = "#9b59b6";
const W = 300, H = 220;
type V = [number, number];
const at = (p: V, d: V, l: number): V => [p[0] + d[0] * l, p[1] + d[1] * l];
const dirOf = (deg: number): V => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
/** a filled angle between two directions (screen degrees, y down) */
function Wedge({ c, a0, a1, r, color }: { c: V; a0: number; a1: number; r: number; color: string }) {
  const p0 = at(c, dirOf(a0), r), p1 = at(c, dirOf(a1), r);
  const sweep = ((a1 - a0) % 360 + 360) % 360 < 180 ? 1 : 0;
  const arc = `M${p0[0]} ${p0[1]}A${r} ${r} 0 0 ${sweep} ${p1[0]} ${p1[1]}`;
  return (<g>
    <path d={`M${c[0]} ${c[1]}L${p0[0]} ${p0[1]}A${r} ${r} 0 0 ${sweep} ${p1[0]} ${p1[1]}Z`} fill={color} opacity={0.2} />
    <path d={arc} stroke={color} strokeWidth={2.6} fill="none" strokeLinecap="round" />
  </g>);
}

/**
 * The lead type drawn big, with its values in boxes on it (lead-in, lead-out, angles, gap, radius: as
 * the type uses them). Not to scale: the lines show the directions, the boxes the sizes.
 */
function LeadEditor({ type, spec, onChange }: { type: LeadType; spec: LeadSpec; onChange: (s: LeadSpec) => void }) {
  const set = (k: keyof LeadSpec, v: number) => onChange({ ...spec, [k]: v });
  const ln = (a: V, b: V, color: string, w = 4) => <path d={`M${a[0]} ${a[1]}L${b[0]} ${b[1]}`} stroke={color} strokeWidth={w} strokeLinecap="round" fill="none" />;
  const dot = (p: V, color: string) => <circle cx={p[0]} cy={p[1]} r={6} fill="#fff" stroke={color} strokeWidth={3} />;
  // a value box: kept inside the drawing
  const box = (k: keyof LeadSpec, p: V, color: string, unit: string, label: string, min = 0, max = 999) => {
    const x = Math.max(40, Math.min(W - 40, p[0])), y = Math.max(16, Math.min(H - 16, p[1]));
    return (
      <label key={k} className="li-val" style={{ left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%`, borderColor: color }} title={label}>
        <NumInput value={spec[k]} min={min} placeholder="0" aria-label={label} className="li-num"
          onCommit={(n) => set(k, Math.min(max, n))} />
        <span>{unit}</span>
      </label>
    );
  };
  const clampA = (a: number) => Math.max(1, Math.min(179, a || 90));
  const LIN = 80, LOUT = 62;
  let drawing: ReactNode, boxes: ReactNode[] = [];

  if (type === "corner" || type === "cornerAngle") {
    // the part up left, its corner C; lead-in from the right / at its angle from the edge going up,
    // lead-out down / at its angle from the edge going left
    const C: V = [150, 122];
    const angled = type === "cornerAngle";
    const aIn = angled ? clampA(spec.aIn) : 90, aOut = angled ? clampA(spec.aOut) : 90;
    const dIn = dirOf(-90 + aIn), dOut = dirOf(180 - aOut);
    const PI = at(C, dIn, spec.lin > 0 ? LIN : 0), PO = at(C, dOut, spec.lout > 0 ? LOUT : 0);
    drawing = (<>
      <rect x={14} y={18} width={C[0] - 14} height={C[1] - 18} fill="rgba(27,42,48,.09)" />
      {angled && <Wedge c={C} a0={-90} a1={-90 + aIn} r={46} color={AIN} />}
      {angled && <Wedge c={C} a0={180 - aOut} a1={180} r={42} color={AOUT} />}
      <path d={`M${C[0]} ${C[1]}V${H - 6}M${C[0]} ${C[1]}H${W - 6}`} stroke="var(--ink, #1b2a30)" strokeWidth={1.4} strokeDasharray="4 4" opacity={0.35} fill="none" />
      <path d={`M14 ${C[1]}H${C[0]}V18`} stroke="var(--ink, #1b2a30)" strokeWidth={5} fill="none" />
      {spec.lout > 0 && ln(C, PO, OUT)}
      {spec.lin > 0 && ln(PI, C, IN)}
      {dot(PI, IN)}
    </>);
    boxes = [
      box("lin", at(C, dIn, 120), IN, "mm", "Lead-in (mm)"),
      box("lout", at(C, dOut, 102), OUT, "mm", "Lead-out (mm)"),
      ...(angled ? [box("aIn", at(C, dirOf(-90 + aIn / 2), 66), AIN, "°", "Lead-in angle from the edge (°)", 1, 179),
        box("aOut", at(C, dirOf(180 - aOut / 2), 66), AOUT, "°", "Lead-out angle from the edge (°)", 1, 179)] : []),
    ];
  } else {
    // a straight edge, the part below: the cut comes round from the left to P, runs on by the gap to E,
    // then leaves; the leads are on the scrap side (above)
    const y = 150, P: V = [128, y];
    const usesGap = type !== "perp";
    // the gap always drawn (not to scale): solid when it runs past the start, dashed when it stops short
    const g = usesGap ? (spec.gap < 0 ? -30 : 30) : 0;
    const E: V = [P[0] + (type === "perp" ? 10 : g), y];   // 90° leads side by side
    const angled = type === "angled";
    const aIn = angled ? clampA(spec.aIn) : 90, aOut = angled ? clampA(spec.aOut) : 90;
    const dIn = dirOf(180 + aIn), dOut = dirOf(-aOut);   // from P: back along the edge turned up by the angle
    const R = 50;
    const PI = at(P, dIn, spec.lin > 0 ? LIN : 0), PO = at(E, dOut, spec.lout > 0 ? LOUT : 0);
    drawing = (<>
      <rect x={14} y={y} width={W - 28} height={H - y - 8} fill="rgba(27,42,48,.09)" />
      <path d={`M14 ${y}H${W - 14}`} stroke="var(--ink, #1b2a30)" strokeWidth={5} fill="none" />
      {usesGap && <path d={`M${P[0]} ${y}H${E[0]}`} stroke={GAP} strokeWidth={6} strokeLinecap="round" opacity={g < 0 ? 0.55 : 1} strokeDasharray={g < 0 ? "5 5" : undefined} />}
      {angled && <Wedge c={P} a0={180 + aIn} a1={180} r={46} color={AIN} />}
      {angled && <Wedge c={E} a0={0} a1={-aOut} r={42} color={AOUT} />}
      {type === "arc" ? (<>
        <path d={`M${P[0]} ${y}V${y - R}H${P[0] - R}`} stroke={IN} strokeWidth={1.4} strokeDasharray="3 3" fill="none" opacity={0.6} />
        <path d={`M${P[0] - R} ${y - R}A${R} ${R} 0 0 0 ${P[0]} ${y}`} stroke={IN} strokeWidth={4} fill="none" strokeLinecap="round" />
        <path d={`M${E[0]} ${y}A${R} ${R} 0 0 0 ${E[0] + R} ${y - R}`} stroke={OUT} strokeWidth={4} fill="none" strokeLinecap="round" />
        {dot([P[0] - R, y - R], IN)}
      </>) : (<>
        {spec.lout > 0 && ln(E, PO, OUT)}
        {spec.lin > 0 && ln(PI, P, IN)}
        {dot(PI, IN)}
      </>)}
    </>);
    // straight up (90°): the two boxes beside their lines, else beyond the lines' ends
    const side = !angled;
    boxes = type === "arc" ? [
      box("radius", [P[0] - R - 6, y - R - 30], IN, "mm", "Arc radius (mm)"),
      box("gap", [(P[0] + E[0]) / 2, y + 34], GAP, "mm", "Gap (mm): + runs past the start, − stops short", -999),
    ] : [
      box("lin", side ? [P[0] - 46, P[1] - 50] : at(P, dIn, 120), IN, "mm", "Lead-in (mm)"),
      box("lout", side ? [E[0] + 46, E[1] - 31] : at(E, dOut, 102), OUT, "mm", "Lead-out (mm)"),
      ...(usesGap ? [box("gap", [(P[0] + E[0]) / 2, y + 34], GAP, "mm", "Gap (mm): + runs past the start, − stops short", -999)] : []),
      ...(angled ? [box("aIn", at(P, dirOf(180 + aIn / 2), 66), AIN, "°", "Lead-in angle from the edge (°)", 1, 179),
        box("aOut", at(E, dirOf(-aOut / 2), 62), AOUT, "°", "Lead-out angle from the edge (°)", 1, 179)] : []),
    ];
  }
  return (
    <div className="li-editor">
      <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true">{drawing}</svg>
      {boxes}
    </div>
  );
}
