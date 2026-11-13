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
    if (!editable(c)) { setMsg({ text: c.bc ? "This outline has break cuts: change its leads in Break cut" : "A common cut block's leads are not changed here", bad: true }); return; }
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
export function TypeDialog({ value, onOk, onCancel, types, icon = toolLeadInOut }: {
  value: LeadType; onOk: (t: LeadType) => void; onCancel: () => void;
  /** only these (Break cut: the types with a gap) */
  types?: LeadType[];
  icon?: string;
}) {
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
          <span className="dlg-icon" aria-hidden="true"><img src={icon} alt="" width={30} height={30} /></span>
          <div className="dlg-title"><h2 id="li-dlg-title">Lead in / out type</h2><p>Lead-in green, lead-out red, gap blue, angles orange (in) and purple (out)</p></div>
        </header>
        <div className="li-dlg-body lead-pick" role="radiogroup" aria-label="Lead in / out type">
          {LEAD_TYPES.filter((x) => !types || types.includes(x.id)).map((x) => (
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

// what the boxes must keep off: the drawing's lines as points every 2 units
const segPts = (a: V, b: V): V[] => {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2));
  return Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n] as V);
};
const arcPts = (c: V, r: number, a0: number, a1: number): V[] => {
  const n = Math.max(2, Math.ceil((Math.abs(a1 - a0) * Math.PI * r) / 360));
  return Array.from({ length: n + 1 }, (_, i) => at(c, dirOf(a0 + ((a1 - a0) * i) / n), r));
};
/** a wedge: its arc and its inside */
const wedgePts = (c: V, a0: number, a1: number, r: number): V[] => [...arcPts(c, r, a0, a1), ...arcPts(c, r * 0.6, a0, a1)];
const dotPts = (p: V): V[] => arcPts(p, 7, 0, 360);

/** a value box wanted near `at`, out from it towards `dir` (screen degrees) first */
interface Want { k: keyof LeadSpec; at: V; dir: number; color: string; unit: string; label: string; min?: number; max?: number }

/**
 * Where the boxes go: each in turn tries places round its point, nearest its own direction first and
 * then further round and further out, and takes the first that is clear of every line and of the boxes
 * already placed (none clear: the one with least on it). hw / hh: half a box, in drawing units.
 */
function placeBoxes(wants: Want[], obs: V[], hw: number, hh: number): V[] {
  const m = 3, placed: V[] = [];
  const clampP = (p: V): V => [Math.max(hw + 2, Math.min(W - hw - 2, p[0])), Math.max(hh + 2, Math.min(H - hh - 2, p[1]))];
  const turns = [0, 15, -15, 30, -30, 45, -45, 65, -65, 90, -90, 120, -120, 150, -150, 180];
  return wants.map((w) => {
    const cands: { p: V; s: number }[] = [];
    for (const da of turns) for (const dd of [0, 8, 18, 30, 46]) {
      const d = dirOf(w.dir + da);
      // out far enough that the box's own edge is clear of the point
      const l = Math.abs(d[0]) * hw + Math.abs(d[1]) * hh + 5 + dd;
      cands.push({ p: clampP(at(w.at, d, l)), s: Math.abs(da) / 15 + dd / 9 });
    }
    cands.sort((x, y) => x.s - y.s);
    let best = cands[0].p, worst = Infinity;
    for (const { p } of cands) {
      let bad = 0;
      for (const o of obs) if (Math.abs(o[0] - p[0]) < hw + m && Math.abs(o[1] - p[1]) < hh + m) bad++;
      for (const q of placed) if (Math.abs(q[0] - p[0]) < 2 * hw + m && Math.abs(q[1] - p[1]) < 2 * hh + m) bad += 1000;
      if (bad < worst) { worst = bad; best = p; if (!bad) break; }
    }
    placed.push(best);
    return best;
  });
}

/**
 * The lead type drawn big, with its values in boxes beside it (lead-in, lead-out, angles, gap, radius:
 * as the type uses them), never on its lines. Not to scale: the lines show the directions, the boxes
 * the sizes.
 */
export function LeadEditor({ type, spec, onChange, gapLocked = false }: {
  type: LeadType; spec: LeadSpec; onChange: (s: LeadSpec) => void;
  /** the gap is set another way (Break cut: by its balloons): its box grayed out */
  gapLocked?: boolean;
}) {
  const set = (k: keyof LeadSpec, v: number) => onChange({ ...spec, [k]: v });
  // the drawing's width on screen: a box is a fixed size in pixels, so its size in drawing units
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [px, setPx] = useState(340);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(() => { if (el.clientWidth) setPx(el.clientWidth); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  const ln = (a: V, b: V, color: string, w = 4) => <path d={`M${a[0]} ${a[1]}L${b[0]} ${b[1]}`} stroke={color} strokeWidth={w} strokeLinecap="round" fill="none" />;
  const dot = (p: V, color: string) => <circle cx={p[0]} cy={p[1]} r={6} fill="#fff" stroke={color} strokeWidth={3} />;
  const clampA = (a: number) => Math.max(1, Math.min(179, a || 90));
  const LIN = 80, LOUT = 62;
  const GAPL = "Gap (mm): + runs past the start, − stops short";
  const LINL = "Lead-in (mm)", LOUTL = "Lead-out (mm)", AINL = "Lead-in angle from the edge (°)", AOUTL = "Lead-out angle from the edge (°)";
  let drawing: ReactNode;
  // the boxes, in the order they are placed (the angles first: they belong by their wedges)
  let wants: Want[] = [];
  let obs: V[] = [];
  const mid = (a: V, b: V): V => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const deg = (d: V) => (Math.atan2(d[1], d[0]) * 180) / Math.PI;

  if (type === "cornerGap") {
    // the part up left, its corner C: in line from the right (as Corner, in line); the cut came down the
    // right edge and stops the gap short of C (or runs on past it), then leaves at its angle to the scrap
    const C: V = [150, 122], G = 34;
    const aOut = clampA(spec.aOut);
    const stop = spec.gap <= 0;
    const E: V = stop ? [C[0], C[1] - G] : [C[0] - G, C[1]];
    const tDeg = stop ? 90 : 180;                       // the way the cut goes at E (screen)
    const oDeg = stop ? 90 - aOut : 180 - aOut;         // turned towards the scrap
    const dIn: V = [1, 0], dOut = dirOf(oDeg);
    const PI = at(C, dIn, spec.lin > 0 ? LIN : 0), PO = at(E, dOut, spec.lout > 0 ? LOUT : 0);
    drawing = (<>
      <rect x={14} y={18} width={C[0] - 14} height={C[1] - 18} fill="rgba(27,42,48,.09)" />
      <Wedge c={E} a0={oDeg} a1={tDeg} r={34} color={AOUT} />
      <path d={`M14 ${C[1]}H${C[0]}V18`} stroke="var(--ink, #1b2a30)" strokeWidth={5} fill="none" />
      <path d={`M${C[0]} ${C[1]}L${E[0]} ${E[1]}`} stroke={GAP} strokeWidth={6} strokeLinecap="round" opacity={stop ? 0.55 : 1} strokeDasharray={stop ? "5 5" : undefined} />
      {spec.lout > 0 && ln(E, PO, OUT)}
      {spec.lin > 0 && ln(PI, C, IN)}
      {dot(PI, IN)}
    </>);
    obs = [...segPts([14, C[1]], C), ...segPts(C, [C[0], 18]), ...segPts(C, E), ...segPts(E, PO), ...segPts(PI, C), ...dotPts(PI), ...wedgePts(E, oDeg, tDeg, 34)];
    wants = [
      { k: "aOut", at: at(E, dirOf((oDeg + tDeg) / 2), 34), dir: (oDeg + tDeg) / 2, color: AOUT, unit: "°", label: AOUTL, min: 1, max: 179 },
      { k: "lin", at: mid(C, PI), dir: 90, color: IN, unit: "mm", label: LINL },
      { k: "lout", at: PO, dir: oDeg, color: OUT, unit: "mm", label: LOUTL },
      // the gap's box in the part, beside the gap
      { k: "gap", at: mid(C, E), dir: stop ? 180 : -90, color: GAP, unit: "mm", label: GAPL, min: -999 },
    ];
  } else if (type === "corner" || type === "cornerAngle") {
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
    obs = [...segPts([14, C[1]], C), ...segPts(C, [C[0], 18]), ...segPts(C, PO), ...segPts(PI, C), ...dotPts(PI),
      ...(angled ? [...wedgePts(C, -90, -90 + aIn, 46), ...wedgePts(C, 180 - aOut, 180, 42)] : [])];
    const bIn = -90 + aIn / 2, bOut = 180 - aOut / 2;
    wants = [
      ...(angled ? [
        { k: "aIn", at: at(C, dirOf(bIn), 46), dir: bIn, color: AIN, unit: "°", label: AINL, min: 1, max: 179 },
        { k: "aOut", at: at(C, dirOf(bOut), 42), dir: bOut, color: AOUT, unit: "°", label: AOUTL, min: 1, max: 179 },
      ] as Want[] : []),
      { k: "lin", at: angled ? PI : mid(C, PI), dir: angled ? deg(dIn) : -90, color: IN, unit: "mm", label: LINL },
      { k: "lout", at: PO, dir: deg(dOut), color: OUT, unit: "mm", label: LOUTL },
    ];
  } else {
    // a straight edge, the part below: the cut comes round from the left to P, runs on by the gap to E,
    // then leaves; the leads are on the scrap side (above). A negative gap (the cut stops short, before
    // P): P further right, E well left of it, the leads shorter, so the two leads do not cross.
    const y = 150;
    const usesGap = type !== "perp";
    const stop = usesGap && spec.gap < 0;
    const P: V = [stop ? 206 : 128, y];
    // the gap always drawn (not to scale): solid when it runs past the start, dashed when it stops short
    const g = !usesGap ? 0 : stop ? (type === "perpGap" ? -84 : -110) : 30;
    const E: V = [P[0] + (type === "perp" ? 10 : g), y];   // 90° leads side by side
    const angled = type === "angled";
    const aIn = angled ? clampA(spec.aIn) : 90, aOut = angled ? clampA(spec.aOut) : 90;
    const dIn = dirOf(180 + aIn), dOut = dirOf(-aOut);   // from P: back along the edge turned up by the angle
    const R = stop ? 42 : 50;
    const LI = stop && angled ? 50 : LIN, LO = stop ? (angled ? 40 : 50) : LOUT;
    const PI = at(P, dIn, spec.lin > 0 ? LI : 0), PO = at(E, dOut, spec.lout > 0 ? LO : 0);
    const rIn = stop ? 34 : 46, rOut = stop ? 30 : 42;
    drawing = (<>
      <rect x={14} y={y} width={W - 28} height={H - y - 8} fill="rgba(27,42,48,.09)" />
      <path d={`M14 ${y}H${W - 14}`} stroke="var(--ink, #1b2a30)" strokeWidth={5} fill="none" />
      {usesGap && <path d={`M${P[0]} ${y}H${E[0]}`} stroke={GAP} strokeWidth={6} strokeLinecap="round" opacity={stop ? 0.55 : 1} strokeDasharray={stop ? "5 5" : undefined} />}
      {angled && <Wedge c={P} a0={180 + aIn} a1={180} r={rIn} color={AIN} />}
      {angled && <Wedge c={E} a0={0} a1={-aOut} r={rOut} color={AOUT} />}
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
    obs = [...segPts([14, y], [W - 14, y])];
    if (type === "arc") obs.push(...arcPts([P[0], y - R], R, 90, 180), ...arcPts([E[0], y - R], R, 0, 90), ...dotPts([P[0] - R, y - R]), ...segPts([P[0], y], [P[0], y - R]));
    else obs.push(...segPts(E, PO), ...segPts(PI, P), ...dotPts(PI));
    if (angled) obs.push(...wedgePts(P, 180 + aIn, 180, rIn), ...wedgePts(E, -aOut, 0, rOut));
    // each lead's box on its outer side, away from the other lead
    const inSide = stop ? 0 : 180, outSide = stop ? 180 : 0;
    const gapWant: Want[] = usesGap ? [{ k: "gap", at: mid(P, E), dir: 90, color: GAP, unit: "mm", label: GAPL, min: -999 }] : [];
    if (type === "arc") {
      wants = [{ k: "radius", at: [P[0] - R * 0.3, y - R * 0.7], dir: -90 + (stop ? 40 : -40), color: IN, unit: "mm", label: "Arc radius (mm)" }, ...gapWant];
    } else if (!angled) {
      wants = [
        { k: "lin", at: mid(P, PI), dir: inSide, color: IN, unit: "mm", label: LINL },
        { k: "lout", at: mid(E, PO), dir: outSide, color: OUT, unit: "mm", label: LOUTL },
        ...gapWant,
      ];
    } else {
      const bIn = 180 + aIn / 2, bOut = -aOut / 2;
      wants = [
        { k: "aIn", at: at(P, dirOf(bIn), rIn), dir: stop ? 0 : bIn, color: AIN, unit: "°", label: AINL, min: 1, max: 179 },
        { k: "aOut", at: at(E, dirOf(bOut), rOut), dir: stop ? 180 : bOut, color: AOUT, unit: "°", label: AOUTL, min: 1, max: 179 },
        { k: "lin", at: PI, dir: stop ? -45 : deg(dIn), color: IN, unit: "mm", label: LINL },
        { k: "lout", at: PO, dir: stop ? -135 : deg(dOut), color: OUT, unit: "mm", label: LOUTL },
        ...gapWant,
      ];
    }
  }
  // a box is about 66 × 30 px on screen
  const sc = W / Math.max(200, px);
  const spots = placeBoxes(wants, obs, 33 * sc, 15 * sc);
  const order: (keyof LeadSpec)[] = ["lin", "lout", "gap", "radius", "aIn", "aOut"];
  const boxes = wants.map((w, i) => ({ w, p: spots[i] })).sort((a, b) => order.indexOf(a.w.k) - order.indexOf(b.w.k)).map(({ w, p }) => (
    // a negative gap (the cut stops short: a bridge is left) shows light red
    <label key={w.k} className={`li-val${w.k === "gap" && spec.gap < 0 ? " is-neg" : ""}${w.k === "gap" && gapLocked ? " is-locked" : ""}`}
      style={{ left: `${(p[0] / W) * 100}%`, top: `${(p[1] / H) * 100}%`, borderColor: w.color }} title={w.k === "gap" && gapLocked ? "Gap: set by the balloons 1 and 2" : w.label}>
      <NumInput value={spec[w.k]} min={w.min ?? 0} placeholder="0" aria-label={w.label} className="li-num" disabled={w.k === "gap" && gapLocked}
        onCommit={(n) => set(w.k, Math.min(w.max ?? 999, n))} />
      <span>{w.unit}</span>
    </label>
  ));
  return (
    <div className="li-editor" ref={setEl}>
      <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true">{drawing}</svg>
      {boxes}
    </div>
  );
}
