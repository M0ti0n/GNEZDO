import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ImportToolStrip, IMPORT_TOOLS } from "../import/ImportTools";
import type { BatchProperties } from "../import/batch";
import {
  boxOf, chainOf, checkGeometry, pathOf, roleOf, union,
  type Box, type CheckId, type Drawing, type Pt, type Role,
} from "../import/geometry";

/** Screen = (x * s + tx, -y * s + ty): s pixels per mm, y flipped (CAD y points up). */
interface View { s: number; tx: number; ty: number }

const PANEL_W = 330;   // geometry check panel, kept clear when fitting
const MARGIN = 48;

/** Tools that mark lines by clicking them, and the role they give. */
const MARKING: Record<string, { role: Role; hint: string }> = {
  trace: { role: "trace", hint: "Click a line to mark it as tracing (engraving). Click again to make it a cutting line." },
  openCut: { role: "openCut", hint: "Click a line to mark it as open cut. Click again to make it a cutting line." },
};

interface Props {
  drawing: Drawing;
  processed: boolean;
  properties?: BatchProperties;
  /** Rotations and mirror this part gets (or got, when processed). */
  nestRules?: { rotations: number[]; mirror: boolean };
  /** Any change to the lines clears "processed": the part has to be processed again. */
  onChange: (drawing: Drawing, processed: boolean) => void;
  /** Process tool on a part without problems: opens the save pop-up. */
  onProcess: () => void;
  /** Properties tool: opens the part's properties. */
  onProperties: () => void;
}

export function ImportPage({ drawing, processed, properties, nestRules, onChange, onProcess, onProperties }: Props) {
  const report = useMemo(() => checkGeometry(drawing.entities), [drawing]);
  const [tool, setTool] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; bad?: boolean } | null>(null);
  const [selected, setSelected] = useState<CheckId | null>(null);

  const host = useRef<HTMLDivElement>(null);
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

  // Drag with the left or middle button pans.
  // A press that hardly moves is a click on a line (for the marking tools).
  const drag = useRef<{ x: number; y: number } | null>(null);
  const press = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    if ((e.target as Element).closest(".gcheck, .canvas-ui")) return;
    drag.current = { x: e.clientX, y: e.clientY };
    press.current = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    drag.current = { x: e.clientX, y: e.clientY };
    setView((v) => v && { ...v, tx: v.tx + dx, ty: v.ty + dy });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    drag.current = null;
    const p = press.current;
    press.current = null;
    const mark = tool ? MARKING[tool] : undefined;
    if (!p || !mark || Math.hypot(e.clientX - p.x, e.clientY - p.y) > 4) return;
    const hit = document.elementsFromPoint(e.clientX, e.clientY).find((el) => el instanceof SVGElement && el.dataset.id);
    const id = (hit as SVGElement | undefined)?.dataset.id;
    if (id) markChain(id, mark.role);
  };

  // Marks the whole chain the clicked line belongs to; clicking a marked chain again makes it cutting.
  const markChain = (id: string, role: Role) => {
    const chain = new Set(chainOf(drawing.entities, id));
    const all = drawing.entities.filter((e) => chain.has(e.id)).every((e) => roleOf(e) === role);
    const next = all ? "cut" : role;
    onChange({ ...drawing, entities: drawing.entities.map((e) => (chain.has(e.id) ? { ...e, role: next } : e)) }, false);
    setSelected(null);
    setMessage({ text: `${chain.size} ${chain.size === 1 ? "line" : "lines"} → ${ROLE_LABEL[next].toLowerCase()}` });
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
  const toolLabel = IMPORT_TOOLS.find((t) => t.id === tool)?.label;
  const hint = message?.text ?? (tool ? MARKING[tool]?.hint ?? "not built yet" : null);
  const bw = report.box.maxX - report.box.minX, bh = report.box.maxY - report.box.minY;

  // Grid follows the drawing: 10 mm dots, 100 mm when zoomed far out.
  const grid = view ? (view.s * 10 >= 8 ? view.s * 10 : view.s * 100) : 20;

  return (
    <div className="import">
      <ImportToolStrip active={tool} onTool={onTool} />
      <div
        ref={host}
        className={`canvas${tool && MARKING[tool] ? " is-marking" : ""}`}
        style={view ? { backgroundSize: `${grid}px ${grid}px`, backgroundPosition: `${view.tx % grid}px ${view.ty % grid}px` } : undefined}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
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
              {tool && MARKING[tool] && drawing.entities.map((e) => (
                <path key={`hit-${e.id}`} data-id={e.id} d={pathOf(e)} vectorEffect="non-scaling-stroke" className="ent-hit" />
              ))}
            </g>
            {report.checks.flatMap((c) => c.points.map((p, i) => {
              const s = toScreen(p, view);
              return <circle key={`${c.id}-${i}`} cx={s.x} cy={s.y} r={c.id === selected ? 9 : 6} className="open-end" />;
            }))}
          </svg>
        )}

        <aside className="gcheck" aria-label="Geometry check">
          <h2>Geometry check</h2>
          <ul>
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
          <p className={`gc-sum ${problems ? "is-bad" : "is-ok"}`}>
            {problems ? `${problems} ${problems === 1 ? "problem" : "problems"} to fix before processing`
              : processed ? "Processed" : "Ready to process"}
          </p>
          <ul className="legend" aria-label="Line colours">
            <li><i className="sw sw-cut" />Cutting</li>
            <li><i className="sw sw-trace" />Tracing</li>
            <li><i className="sw sw-open" />Open cut</li>
            <li><i className="sw sw-bad" />Open contour</li>
          </ul>
          <dl className="gc-facts">
            <dt>Material</dt><dd>{properties?.material ? `${properties.material}${properties.thicknessMm ? ` ${properties.thicknessMm} mm` : ""}` : "–"}</dd>
            <dt>Size</dt><dd>{fmt(bw)} × {fmt(bh)} mm</dd>
            <dt>Contours</dt><dd>{report.contours.length}</dd>
            <dt>Tracing</dt><dd>{report.traceCount} {report.traceCount === 1 ? "line" : "lines"}</dd>
            <dt>Open cut</dt><dd>{report.openCutCount} {report.openCutCount === 1 ? "line" : "lines"}</dd>
            <dt>Status</dt><dd className={processed ? "st-done" : undefined}>{processed ? "Processed" : "Not processed"}</dd>
            {nestRules && <>
              <dt>Rotations</dt><dd>{nestRules.rotations.length ? nestRules.rotations.map((r) => `${r}°`).join(", ") : "none"}</dd>
              <dt>Mirror</dt><dd>{nestRules.mirror ? "yes" : "no"}</dd>
            </>}
          </dl>
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

const ROLE_LABEL: Record<Role, string> = { cut: "Cutting", trace: "Tracing", openCut: "Open cut" };

const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString("en-GB");
