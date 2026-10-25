import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ImportToolStrip, IMPORT_TOOLS } from "../import/ImportTools";
import { ROTATIONS, type Rotation } from "../import/rules";
import { FILLER_TIP } from "../import/filler";
import { alignAt, diagnoseEnds, eraseAt, extendAt, trimAt, type EditResult, type EndIssue } from "../import/edit";
import type { BatchProperties } from "../import/batch";
import {
  endsOf,
  boxOf, checkGeometry, pathOf, pointsAlong, roleOf, union,
  type Box, type CheckId, type Drawing, type Entity, type Pt, type Role,
} from "../import/geometry";

type NestRules = { rotations: Rotation[]; mirror: boolean; filler: boolean };

/** Screen = (x * s + tx, -y * s + ty): s pixels per mm, y flipped (CAD y points up). */
interface View { s: number; tx: number; ty: number }

const PANEL_W = 350;   // geometry check panel, kept clear when fitting
const MARGIN = 48;

/** Tools that mark lines by clicking them, and the role they give. */
const MARKING: Record<string, { role: Role; hint: string }> = {
  trace: { role: "trace", hint: "Click a line, or drag a window, to mark tracing. Again to unmark. Right drag moves the drawing." },
  openCut: { role: "openCut", hint: "Click a line, or drag a window, to mark open cut. Again to unmark. Right drag moves the drawing." },
};

/** Tools that change lines by clicking them (AutoCAD quick mode); Shift swaps trim and extend. */
/** Pixels within which a point snaps to the end of a line. */
const SNAP_PX = 12;
const LINE_HINT = "Click the start point, then the end point; the line goes on from there. Ends of lines snap (green square). Esc or right click finishes.";

const EDITING: Record<string, { hint: string }> = {
  trim: { hint: "Click the piece of a line to cut off (all lines are cutting edges). Shift+click extends. Ctrl+Z undoes." },
  extend: { hint: "Click a line near the end to lengthen it to the next line. Shift+click trims. Ctrl+Z undoes." },
  erase: { hint: "Click a line, arc or circle to erase it. Ctrl+Z undoes." },
  alignH: { hint: "Click a straight line: the whole part turns counter-clockwise until that line is horizontal." },
  alignV: { hint: "Click a straight line: the whole part turns counter-clockwise until that line is vertical." },
};

interface Props {
  drawing: Drawing;
  processed: boolean;
  properties?: BatchProperties;
  /** Rotations, mirror and filler this part gets (or got, when processed). */
  nestRules?: NestRules;
  /** A change to the lines, recorded in the tab's history under this name. Clears "processed". */
  onEdit: (drawing: Drawing, label: string) => void;
  /** Set after Undo / Redo: what was undone or redone (a new object each time). */
  undone?: { text: string } | null;
  /** Process tool on a part without problems: opens the save pop-up. */
  onProcess: () => void;
  /** Properties tool: opens the part's properties. */
  onProperties: () => void;
  /** Nesting rules changed here: they are the list's Properties. */
  onNestRules?: (r: NestRules) => void;
  /** Mirror is not allowed for this part (open cut lines and the rule says so). */
  mirrorBlocked?: boolean;
}

export function ImportPage({ drawing, processed, properties, nestRules, onEdit, undone, onProcess, onProperties, onNestRules, mirrorBlocked = false }: Props) {
  const report = useMemo(() => checkGeometry(drawing.entities), [drawing]);
  const [tool, setTool] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; bad?: boolean } | null>(null);
  const [selected, setSelected] = useState<CheckId | null>(null);

  const host = useRef<HTMLDivElement>(null);

  // Every change to the lines is one step in the tab's history (Undo / Redo in the green bar).
  const commit = (next: Drawing, label: string) => onEdit(next, label);

  // After an undo or redo: drop the hover preview and say what happened.
  const undoneAtMount = useRef(undone);   // an older undo from before this tab was shown again: not news
  useEffect(() => {
    if (!undone || undone === undoneAtMount.current) return;
    setPreview(null);
    setMessage({ text: undone.text });
  }, [undone]);

  // Line tool: start point, then each next point; points snap to the ends of lines.
  const [lineStart, setLineStart] = useState<Pt | null>(null);
  const [cursor, setCursor] = useState<{ p: Pt; snapped: boolean } | null>(null);
  const lineSeq = useRef(0);
  const ends = useMemo(() => drawing.entities.flatMap((e) => {
    const en = endsOf(e);
    return en ? [en[0], en[1]] : [];
  }), [drawing]);
  const snapAt = (clientX: number, clientY: number, v: View): { p: Pt; snapped: boolean } => {
    const p = toModel(clientX, clientY, v);
    let best: Pt | null = null, bestD = SNAP_PX / v.s;
    for (const q of ends) { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d <= bestD) { best = q; bestD = d; } }
    return best ? { p: { ...best }, snapped: true } : { p, snapped: false };
  };
  const finishLine = () => {
    if (lineStart) setMessage({ text: "Line finished" });
    setLineStart(null);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && tool === "line") finishLine(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Trim / Extend: what a click would do, shown while hovering.
  const [preview, setPreview] = useState<(EditResult & { ok: true }) | null>(null);
  const editAt = (id: string, p: Pt, shift: boolean): EditResult => {
    if (tool === "erase") return eraseAt(drawing.entities, id);
    if (tool === "alignH" || tool === "alignV") return alignAt(drawing.entities, id, tool === "alignH" ? "h" : "v");
    const extend = (tool === "extend") !== shift;   // Shift swaps trim and extend
    return extend ? extendAt(drawing.entities, id, p) : trimAt(drawing.entities, id, p);
  };
  const lineUnder = (clientX: number, clientY: number) =>
    (document.elementsFromPoint(clientX, clientY).find((el) => el instanceof SVGElement && el.dataset.id) as SVGElement | undefined)?.dataset.id;
  const toModel = (clientX: number, clientY: number, v: View): Pt => {
    const r = host.current!.getBoundingClientRect();
    return { x: (clientX - r.left - v.tx) / v.s, y: -(clientY - r.top - v.ty) / v.s };
  };
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useCallback((b: Box) => {
    if (!size.w) return;
    const w = Math.max(size.w - PANEL_W - 2 * MARGIN, 80), h = Math.max(size.h - 2 * MARGIN, 80);
    const bw = Math.max(b.maxX - b.minX, 1), bh = Math.max(b.maxY - b.minY, 1);
    const s = Math.min(w / bw, h / bh);
    setView({
      s,
      tx: MARGIN + (w - bw * s) / 2 - b.minX * s,
      ty: MARGIN + (h - bh * s) / 2 + b.maxY * s,
    });
  }, [size.w, size.h]);

  const fitAll = useCallback(() => fit(report.box), [fit, report.box]);
  useEffect(() => { if (!view) fitAll(); }, [view, fitAll]);

  // Wheel zooms around the cursor (non-passive so the page does not scroll).
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const k = Math.pow(1.0015, -e.deltaY);
      setView((v) => v && { s: v.s * k, tx: mx - (mx - v.tx) * k, ty: my - (my - v.ty) * k });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Right and middle buttons always pan; the left button pans too unless a marking tool is on.
  // With Trace / Open cut the left button clicks a line or drags a selection box:
  //   left to right = window (lines fully inside), right to left = crossing (lines touched).
  const drag = useRef<{ x: number; y: number } | null>(null);
  const press = useRef<{ x: number; y: number; button: number } | null>(null);
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const local = (e: React.PointerEvent) => {
    const r = host.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
    if ((e.target as Element).closest(".gcheck, .canvas-ui")) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    if (e.button === 0 && tool && MARKING[tool]) {
      const p = local(e);
      setBox({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      return;
    }
    drag.current = { x: e.clientX, y: e.clientY };
    press.current = { x: e.clientX, y: e.clientY, button: e.button };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (box) { const p = local(e); setBox((b) => b && { ...b, x1: p.x, y1: p.y }); return; }
    const d = drag.current;
    if (!d) {
      if (tool === "line" && view) { setCursor(snapAt(e.clientX, e.clientY, view)); return; }
      // hover with Trim / Extend: preview the result
      if (tool && EDITING[tool] && view) {
        const id = lineUnder(e.clientX, e.clientY);
        const r = id ? editAt(id, toModel(e.clientX, e.clientY, view), e.shiftKey) : null;
        setPreview(r && r.ok ? r : null);
        if (r && !r.ok) setMessage({ text: r.message, bad: true }); else if (message?.bad) setMessage(null);
      }
      return;
    }
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    drag.current = { x: e.clientX, y: e.clientY };
    setView((v) => v && { ...v, tx: v.tx + dx, ty: v.ty + dy });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    drag.current = null;
    const pr = press.current;
    press.current = null;
    const isClick = !!pr && Math.hypot(e.clientX - pr.x, e.clientY - pr.y) <= 4;
    if (isClick && tool === "line" && view) {
      if (pr!.button === 2) { finishLine(); return; }        // right click ends the line
      if (pr!.button !== 0) return;
      const at = snapAt(e.clientX, e.clientY, view);
      if (!lineStart) { setLineStart(at.p); setMessage({ text: "Now click the end point" }); return; }
      if (Math.hypot(at.p.x - lineStart.x, at.p.y - lineStart.y) < 1e-6) return;
      const line: Entity = { id: `ln${Date.now().toString(36)}${++lineSeq.current}`, kind: "line", a: lineStart, b: at.p, role: "cut" };
      commit({ ...drawing, entities: [...drawing.entities, line] }, "Line");
      setSelected(null);
      setLineStart(at.p);                                    // go on from the end, like AutoCAD
      setMessage({ text: `Line ${fmtMm(Math.hypot(at.p.x - lineStart.x, at.p.y - lineStart.y))} added. Next point, or Esc to finish` });
      return;
    }
    if (pr && pr.button === 0 && tool && EDITING[tool] && view && isClick) {
      const id = lineUnder(e.clientX, e.clientY);
      if (!id) return;
      const r = editAt(id, toModel(e.clientX, e.clientY, view), e.shiftKey);
      if (r.ok) {
        commit({ ...drawing, entities: r.entities }, IMPORT_TOOLS.find((t) => t.id === tool)?.label ?? "Edit");
        setSelected(null);
        setPreview(null);
        if (tool === "alignH" || tool === "alignV") setView(null);   // the part turned: fit it again
      }
      setMessage({ text: r.message, bad: !r.ok });
      return;
    }
    const b = box;
    setBox(null);
    const mark = tool ? MARKING[tool] : undefined;
    if (!b || !mark || !view) return;
    if (Math.hypot(b.x1 - b.x0, b.y1 - b.y0) > 4) { markBox(b, mark.role, view); return; }
    // a click: the line under the pointer
    const hit = document.elementsFromPoint(e.clientX, e.clientY).find((el) => el instanceof SVGElement && el.dataset.id);
    const id = (hit as SVGElement | undefined)?.dataset.id;
    if (id) markLine(id, mark.role);
  };

  // Lines in a selection box get the role; when they all have it already, they go back to cutting.
  const markBox = (b: { x0: number; y0: number; x1: number; y1: number }, role: Role, v: View) => {
    const toMm = (x: number, y: number): Pt => ({ x: (x - v.tx) / v.s, y: -(y - v.ty) / v.s });
    const a = toMm(Math.min(b.x0, b.x1), Math.max(b.y0, b.y1)), c = toMm(Math.max(b.x0, b.x1), Math.min(b.y0, b.y1));
    const rect = { minX: a.x, minY: a.y, maxX: c.x, maxY: c.y };
    const crossing = b.x1 < b.x0;
    const ids = new Set(drawing.entities.filter((e) => {
      const pts = pointsAlong(e);
      return crossing ? touchesRect(pts, rect) : pts.every((p) => inRect(p, rect));
    }).map((e) => e.id));
    if (!ids.size) { setMessage({ text: crossing ? "No line touches the box" : "No line is fully inside the box" }); return; }
    const all = drawing.entities.filter((e) => ids.has(e.id)).every((e) => roleOf(e) === role);
    const next = all ? "cut" : role;
    commit({ ...drawing, entities: drawing.entities.map((e) => (ids.has(e.id) ? { ...e, role: next } : e)) },
      `${next === "cut" ? "Unmark" : "Mark"} ${role === "trace" ? "tracing" : "open cut"}`);
    setSelected(null);
    setMessage({ text: `${ids.size} ${ids.size === 1 ? "line" : "lines"} → ${ROLE_LABEL[next].toLowerCase()}` });
  };

  // Marks the clicked line; clicking a marked line again makes it a cutting line again.
  const markLine = (id: string, role: Role) => {
    const line = drawing.entities.find((e) => e.id === id);
    if (!line) return;
    const next = roleOf(line) === role ? "cut" : role;
    commit({ ...drawing, entities: drawing.entities.map((e) => (e.id === id ? { ...e, role: next } : e)) },
      `${next === "cut" ? "Unmark" : "Mark"} ${role === "trace" ? "tracing" : "open cut"}`);
    setSelected(null);
    setMessage({ text: next === "cut" ? "1 line unmarked (cutting)" : `1 line → ${ROLE_LABEL[next].toLowerCase()}` });
  };

  const onTool = (id: string) => {
    if (id === "properties") { setTool(null); setMessage(null); onProperties(); return; }
    if (id === "process") {
      setTool(null);
      if (problems) setMessage({ text: "Fix the red problems before processing", bad: true });
      else { setMessage(null); onProcess(); }
      return;
    }
    setMessage(null);
    setPreview(null);
    setLineStart(null);
    setCursor(null);
    setTool((t) => (t === id ? null : id));
  };

  const check = report.checks.find((c) => c.id === selected) ?? null;
  const flagged = useMemo(() => new Set(report.checks.flatMap((c) => c.entityIds)), [report]);
  const highlighted = useMemo(() => new Set(check?.entityIds ?? []), [check]);

  const choose = (id: CheckId) => {
    const c = report.checks.find((x) => x.id === id)!;
    if (c.count === 0 || selected === id) { setSelected(null); fitAll(); return; }
    setSelected(id);
    // zoom to what the check found
    const b = drawing.entities.filter((e) => c.entityIds.includes(e.id)).map(boxOf).reduce(union);
    const pad = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.35 + 5;
    fit({ minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad });
  };

  const toScreen = (p: Pt, v: View) => ({ x: p.x * v.s + v.tx, y: -p.y * v.s + v.ty });
  // Open contours block processing; splines only warn (they will be converted).
  const problems = report.checks.filter((c) => c.count > 0 && c.id !== "splines").length;

  // Loose ends of open contours, sorted into "line past a corner", "gap" and "loose end", with fixes.
  const issues = useMemo(() => diagnoseEnds(drawing.entities,
    report.checks.filter((c) => c.id === "insideOpen" || c.id === "outsideOpen").flatMap((c) => c.points)), [drawing, report]);
  const [hoverIssue, setHoverIssue] = useState<number | null>(null);
  const [checkOpen, setCheckOpen] = useState(true);
  const fixIssue = (i: EndIssue) => {
    const r = i.fix?.(drawing.entities);
    if (!r) return;
    if (r.ok) { commit({ ...drawing, entities: r.entities }, "Fix loose end"); setSelected(null); }
    setMessage({ text: r.message, bad: !r.ok });
  };
  const SMALL_MM = 1;
  const small = issues.filter((i) => i.fix && i.size <= SMALL_MM);
  // fixes one at a time, re-checking in between, so each fix sees the result of the one before
  const fixSmall = () => {
    let ents = drawing.entities;
    let n = 0;
    for (let round = 0; round < 50; round++) {
      const r = checkGeometry(ents);
      const next = diagnoseEnds(ents, r.checks.filter((c) => c.id === "insideOpen" || c.id === "outsideOpen").flatMap((c) => c.points))
        .find((i) => i.fix && i.size <= SMALL_MM);
      if (!next) break;
      const res = next.fix!(ents);
      if (!res.ok) break;
      ents = res.entities;
      n++;
    }
    if (n) { commit({ ...drawing, entities: ents }, "Fix all under 1 mm"); setSelected(null); }
    setMessage({ text: n ? `Fixed ${n} ${n === 1 ? "end" : "ends"} under ${SMALL_MM} mm` : "Nothing small to fix" });
  };
  const toolLabel = IMPORT_TOOLS.find((t) => t.id === tool)?.label;
  const hint = message?.text ?? (tool ? MARKING[tool]?.hint ?? EDITING[tool]?.hint ?? (tool === "line" ? LINE_HINT : "not built yet") : null);
  const bw = report.box.maxX - report.box.minX, bh = report.box.maxY - report.box.minY;

  // Grid follows the drawing: 10 mm dots, 100 mm when zoomed far out.
  const grid = view ? (view.s * 10 >= 8 ? view.s * 10 : view.s * 100) : 20;

  return (
    <div className="import">
      <ImportToolStrip active={tool} onTool={onTool} />
      <div
        ref={host}
        className={`canvas${tool && (MARKING[tool] || EDITING[tool] || tool === "line") ? " is-marking" : ""}`}
        onPointerLeave={() => { setPreview(null); setCursor(null); }}
        style={view ? { backgroundSize: `${grid}px ${grid}px`, backgroundPosition: `${view.tx % grid}px ${view.ty % grid}px` } : undefined}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
        onDoubleClick={(e) => { if (!(e.target as Element).closest(".gcheck, .canvas-ui")) { setSelected(null); fitAll(); } }}
      >
        {view && (
          <svg className={`drawing${processed ? " is-processed" : ""}`} width={size.w} height={size.h} aria-label={`Drawing ${drawing.fileName}`}>
            <g transform={`matrix(${view.s} 0 0 ${-view.s} ${view.tx} ${view.ty})`}>
              {drawing.entities.map((e) => (
                <path key={e.id} d={pathOf(e)} vectorEffect="non-scaling-stroke"
                  className={`ent role-${roleOf(e)}${flagged.has(e.id) ? " is-flagged" : ""}${highlighted.has(e.id) ? " is-hl" : ""}${e.kind === "spline" ? " is-spline" : ""}`} />
              ))}
              {/* wide invisible strokes so thin lines are easy to click */}
              {preview?.removed.map((e) => <path key={`rm-${e.id}`} d={pathOf(e)} vectorEffect="non-scaling-stroke" className="pv-remove" />)}
              {preview?.added.map((e) => <path key={`ad-${e.id}`} d={pathOf(e)} vectorEffect="non-scaling-stroke" className="pv-add" />)}
              {tool && (MARKING[tool] || EDITING[tool]) && drawing.entities.map((e) => (
                <path key={`hit-${e.id}`} data-id={e.id} d={pathOf(e)} vectorEffect="non-scaling-stroke" className="ent-hit" />
              ))}
            </g>
            {issues.map((iss, i) => {
              const s = toScreen(iss.at, view);
              return (
                <g key={`iss-${i}`} className={`end-mark is-${iss.kind}${hoverIssue === i ? " is-hover" : ""}${tool ? " is-passive" : ""}`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => fixIssue(iss)}
                  onMouseEnter={() => setHoverIssue(i)} onMouseLeave={() => setHoverIssue(null)}>
                  <title>{`${iss.label}${iss.size ? ` · ${fmtMm(iss.size)}` : ""}${iss.fix ? " · click to fix" : ""}`}</title>
                  <circle cx={s.x} cy={s.y} r={hoverIssue === i ? 11 : 8} />
                  <text x={s.x} y={s.y + 4} textAnchor="middle">{iss.kind === "overshoot" ? "✂" : iss.kind === "gap" ? "↔" : "?"}</text>
                </g>
              );
            })}
            {tool === "line" && cursor && (() => {
              const c = toScreen(cursor.p, view);
              const s0 = lineStart && toScreen(lineStart, view);
              const len = lineStart ? Math.hypot(cursor.p.x - lineStart.x, cursor.p.y - lineStart.y) : 0;
              return (
                <g className="line-draw" pointerEvents="none">
                  {s0 && <line x1={s0.x} y1={s0.y} x2={c.x} y2={c.y} className="line-rubber" />}
                  {s0 && <circle cx={s0.x} cy={s0.y} r={3.5} className="line-start" />}
                  {cursor.snapped
                    ? <rect x={c.x - 7} y={c.y - 7} width={14} height={14} className="snap-mark" />
                    : <path d={`M${c.x - 8} ${c.y}H${c.x + 8}M${c.x} ${c.y - 8}V${c.y + 8}`} className="line-cross" />}
                  {s0 && len > 0 && <text x={c.x + 12} y={c.y - 10} className="line-len">{fmtMm(len)}</text>}
                </g>
              );
            })()}
            {box && (
              <rect className={`sel-box${box.x1 < box.x0 ? " is-crossing" : ""}`}
                x={Math.min(box.x0, box.x1)} y={Math.min(box.y0, box.y1)}
                width={Math.abs(box.x1 - box.x0)} height={Math.abs(box.y1 - box.y0)} />
            )}
          </svg>
        )}

        <aside className={`gcheck${checkOpen ? "" : " is-closed"}`} aria-label="Geometry check">
          <header className="gc-head">
            <span className="gc-head-icon" aria-hidden="true">{IMPORT_TOOLS.find((t) => t.id === "checkLines")?.icon}</span>
            <h2>Geometry check</h2>
            <span className={`gc-pill ${problems ? "is-bad" : "is-ok"}`}>
              {problems ? `${problems} to fix` : processed ? "Processed" : "Ready"}
            </span>
            <button type="button" className="gc-toggle" onClick={() => setCheckOpen((o) => !o)}
              aria-expanded={checkOpen} title={checkOpen ? "Collapse" : "Expand"}>
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </header>
          {checkOpen && <div className="gc-body">
          <ul className="gc-checks">
            {report.checks.map((c) => (
              <li key={c.id}>
                <button className={`gc-row ${!c.count ? "is-ok" : c.id === "splines" ? "is-warn" : "is-bad"}${selected === c.id ? " is-on" : ""}`}
                  onClick={() => choose(c.id)} disabled={c.count === 0}
                  title={!c.count ? "No problems" : c.id === "splines" ? "Splines will be converted to lines and arcs. Show on the drawing" : "Show on the drawing"}>
                  <span className="gc-mark" aria-hidden="true">{c.count ? "!" : "✓"}</span>
                  <span className="gc-label">{c.label}</span>
                  {c.count > 0 && <span className="gc-count">{c.count}</span>}
                </button>
              </li>
            ))}
          </ul>
          {issues.length > 0 && (
            <div className="gc-ends">
              <h3 className="gc-sec">Loose ends</h3>
              <ul>
                {issues.map((iss, i) => (
                  <li key={i} className={`gc-end is-${iss.kind}${hoverIssue === i ? " is-hover" : ""}`}
                    onMouseEnter={() => setHoverIssue(i)} onMouseLeave={() => setHoverIssue(null)}>
                    <span className="gc-end-icon" aria-hidden="true">{iss.kind === "overshoot" ? "✂" : iss.kind === "gap" ? "↔" : "?"}</span>
                    <span className="gc-end-label">{iss.label}{iss.size > 0 && <small> {fmtMm(iss.size)}</small>}</span>
                    {iss.fix
                      ? <button type="button" className="gc-fix" onClick={() => fixIssue(iss)}
                          title={iss.kind === "overshoot" ? "Trim the piece past the corner" : "Close the gap"}>{iss.kind === "overshoot" ? "Trim" : "Close"}</button>
                      : <small className="gc-end-note">check by hand</small>}
                  </li>
                ))}
              </ul>
              {small.length > 0 && (
                <button type="button" className="btn gc-fix-all" onClick={fixSmall}>Fix all under {SMALL_MM} mm ({small.length})</button>
              )}
            </div>
          )}
          <p className={`gc-sum ${problems ? "is-bad" : "is-ok"}`}>
            {problems ? `Fix ${problems === 1 ? "this" : "these"} before processing.`
              : processed ? "Processed." : "All contours are closed: ready to process."}
          </p>
          <h3 className="gc-sec">Lines</h3>
          <ul className="legend" aria-label="Line colours">
            <li><i className="sw sw-cut" />Cutting</li>
            <li><i className="sw sw-trace" />Tracing</li>
            <li><i className="sw sw-open" />Open cut</li>
            <li><i className="sw sw-bad" />Open contour</li>
          </ul>
          <h3 className="gc-sec">Part</h3>
          <dl className="gc-facts">
            <dt>Material</dt><dd>{properties?.material ? `${properties.material}${properties.thicknessMm ? ` ${properties.thicknessMm} mm` : ""}` : "–"}</dd>
            <dt>Size</dt><dd>{fmt(bw)} × {fmt(bh)} mm</dd>
          </dl>
          {nestRules && onNestRules && (
            <>
              <h3 className="gc-sec">Nesting rules</h3>
              <div className="proc-chips gc-chips" role="group" aria-label="Nesting rules">
                {ROTATIONS.map((r) => (
                  <label key={r} className="chk chk-box">
                    <input type="checkbox" checked={nestRules.rotations.includes(r)}
                      onChange={(e) => onNestRules({
                        ...nestRules,
                        rotations: e.target.checked ? ROTATIONS.filter((x) => x === r || nestRules.rotations.includes(x)) : nestRules.rotations.filter((x) => x !== r),
                      })} />
                    {r}°
                  </label>
                ))}
                <label className={`chk chk-box${mirrorBlocked ? " is-blocked" : ""}`}
                  title={mirrorBlocked ? "Parts with open cut lines are not mirrored (Rules → Import rules)" : undefined}>
                  <input type="checkbox" checked={nestRules.mirror && !mirrorBlocked} disabled={mirrorBlocked}
                    onChange={(e) => onNestRules({ ...nestRules, mirror: e.target.checked })} />
                  Mirror
                </label>
                <label className="chk chk-box chk-filler" title={FILLER_TIP}>
                  <input type="checkbox" checked={nestRules.filler} onChange={(e) => onNestRules({ ...nestRules, filler: e.target.checked })} />
                  Filler
                </label>
              </div>
              <p className="gc-note">{mirrorBlocked ? "No mirror: this part has open cut lines. " : ""}Same as Properties: applies to every part in the list.</p>
            </>
          )}
          </div>}
        </aside>

        <div className="canvas-ui">
          {hint && (
            <span className={`tool-hint${message?.bad ? " is-bad" : ""}`}>
              {!message && toolLabel && <b>{toolLabel} · </b>}{hint}
            </span>
          )}
          <button className="btn btn-fit" onClick={() => { setSelected(null); fitAll(); }} title="Show the whole part (double-click)">Fit</button>
        </div>
      </div>
    </div>
  );
}

type Rect = { minX: number; minY: number; maxX: number; maxY: number };
const inRect = (p: Pt, r: Rect) => p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY;

/** Does a polyline touch the rectangle: a point inside, or a segment crossing one of its edges? */
function touchesRect(pts: Pt[], r: Rect): boolean {
  if (pts.some((p) => inRect(p, r))) return true;
  const edges: [Pt, Pt][] = [
    [{ x: r.minX, y: r.minY }, { x: r.maxX, y: r.minY }], [{ x: r.maxX, y: r.minY }, { x: r.maxX, y: r.maxY }],
    [{ x: r.maxX, y: r.maxY }, { x: r.minX, y: r.maxY }], [{ x: r.minX, y: r.maxY }, { x: r.minX, y: r.minY }],
  ];
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const meet = (p1: Pt, p2: Pt, q1: Pt, q2: Pt) =>
    cross(p1, p2, q1) * cross(p1, p2, q2) <= 0 && cross(q1, q2, p1) * cross(q1, q2, p2) <= 0;
  return pts.slice(1).some((p, i) => edges.some(([a, b]) => meet(pts[i], p, a, b)));
}

const ROLE_LABEL: Record<Role, string> = { cut: "Cutting", trace: "Tracing", openCut: "Open cut" };

const fmtMm = (n: number) => `${n < 10 ? n.toFixed(2) : n.toFixed(1)} mm`;

const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString("en-GB");
