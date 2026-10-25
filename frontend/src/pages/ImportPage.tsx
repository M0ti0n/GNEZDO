import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ImportToolStrip, IMPORT_TOOLS } from "../import/ImportTools";
import {
  boxOf, checkGeometry, pathOf, quantityFromName, union,
  type Box, type CheckId, type Drawing, type Pt,
} from "../import/geometry";

/** Screen = (x * s + tx, -y * s + ty): s pixels per mm, y flipped (CAD y points up). */
interface View { s: number; tx: number; ty: number }

const PANEL_W = 330;   // geometry check panel, kept clear when fitting
const MARGIN = 48;

export function ImportPage({ drawing }: { drawing: Drawing }) {
  const report = useMemo(() => checkGeometry(drawing.entities), [drawing]);
  const qty = quantityFromName(drawing.fileName);
  const [tool, setTool] = useState<string | null>(null);
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
  const drag = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    if ((e.target as Element).closest(".gcheck, .canvas-ui")) return;
    drag.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    drag.current = { x: e.clientX, y: e.clientY };
    setView((v) => v && { ...v, tx: v.tx + dx, ty: v.ty + dy });
  };
  const onPointerUp = () => { drag.current = null; };

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
  const problems = report.checks.filter((c) => c.count > 0).length;
  const toolLabel = IMPORT_TOOLS.find((t) => t.id === tool)?.label;
  const bw = report.box.maxX - report.box.minX, bh = report.box.maxY - report.box.minY;

  // Grid follows the drawing: 10 mm dots, 100 mm when zoomed far out.
  const grid = view ? (view.s * 10 >= 8 ? view.s * 10 : view.s * 100) : 20;

  return (
    <div className="import">
      <ImportToolStrip active={tool} onTool={(id) => setTool((t) => (t === id ? null : id))} />
      <div
        ref={host}
        className="canvas"
        style={view ? { backgroundSize: `${grid}px ${grid}px`, backgroundPosition: `${view.tx % grid}px ${view.ty % grid}px` } : undefined}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onDoubleClick={(e) => { if (!(e.target as Element).closest(".gcheck, .canvas-ui")) { setSelected(null); fitAll(); } }}
      >
        {view && (
          <svg className="drawing" width={size.w} height={size.h} aria-label={`Drawing ${drawing.fileName}`}>
            <g transform={`matrix(${view.s} 0 0 ${-view.s} ${view.tx} ${view.ty})`}>
              {drawing.entities.map((e) => (
                <path key={e.id} d={pathOf(e)} vectorEffect="non-scaling-stroke"
                  className={`ent${flagged.has(e.id) ? " is-flagged" : ""}${highlighted.has(e.id) ? " is-hl" : ""}${e.kind === "spline" ? " is-spline" : ""}`} />
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
                <button className={`gc-row ${c.count ? "is-bad" : "is-ok"}${selected === c.id ? " is-on" : ""}`}
                  onClick={() => choose(c.id)} disabled={c.count === 0}
                  title={c.count ? "Show on the drawing" : "No problems"}>
                  <span className="gc-mark" aria-hidden="true">{c.count ? "!" : "✓"}</span>
                  <span className="gc-label">{c.label}</span>
                  {c.count > 0 && <span className="gc-count">{c.count}</span>}
                </button>
              </li>
            ))}
          </ul>
          <p className={`gc-sum ${problems ? "is-bad" : "is-ok"}`}>
            {problems ? `${problems} ${problems === 1 ? "problem" : "problems"} to fix before the part can be saved` : "Ready to save"}
          </p>
          <dl className="gc-facts">
            <dt>Size</dt><dd>{fmt(bw)} × {fmt(bh)} mm</dd>
            <dt>Contours</dt><dd>{report.contours.length}</dd>
            <dt>Quantity</dt><dd>{qty ?? "–"}{qty !== null && <small> from file name</small>}</dd>
          </dl>
        </aside>

        <div className="canvas-ui">
          {toolLabel && <span className="tool-hint"><b>{toolLabel}</b> · not built yet</span>}
          <button className="btn btn-fit" onClick={() => { setSelected(null); fitAll(); }} title="Show the whole part (double-click)">Fit</button>
        </div>
      </div>
    </div>
  );
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString("en-GB");
