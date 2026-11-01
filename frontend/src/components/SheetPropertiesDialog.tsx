import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { IconClose } from "./Icons";
import { Combobox } from "./Combobox";
import { NumInput } from "./NumInput";
import { usePickLists } from "./pickLists";
import {
  fitsMachine, mirrorSheet, rotateSheet, sheetLoops, MACHINE_LIMIT,
  type StockSheet, type Trims,
} from "../job/stock";
import type { Machine, Origin } from "../job/machine";

const SOURCE: Record<string, string> = {
  parts: "From the job part list", default1: "Default 1", default2: "Default 2", default3: "Default 3", remnant: "Remnant", dxf: "From a DXF file",
};

// Properties of a stock sheet (STOCK panel: [i] or double click on its name), laid out like Part
// properties: the sheet's shape with the machine's 0,0, rotate / mirror under it; size, trims (gap from
// each edge to the parts, by the machine's axes), part gap, cut number and cut diameter on the right.
export function SheetPropertiesDialog({ sheet, index, machine, onSave, onClose }: {
  sheet: StockSheet; index: number; machine: Machine; onSave: (s: StockSheet) => void; onClose: () => void;
}) {
  const origin = machine.origin;
  // the machine's gaps are the defaults (RESET, and for a sheet that has none of its own)
  const defaultTrims = () => ({ ...machine.trims });
  const DEFAULT_PART_GAP_MM = machine.partGapMm;
  const [s, setS] = useState<StockSheet>(() => ({ ...sheet, trims: sheet.trims ?? defaultTrims(), partGapMm: sheet.partGapMm ?? DEFAULT_PART_GAP_MM }));
  const lists = usePickLists(s.material);
  const set = (patch: Partial<StockSheet>) => setS((x) => ({ ...x, ...patch }));
  const setTrim = (k: keyof Trims, v: number) => setS((x) => ({ ...x, trims: { ...(x.trims ?? defaultTrims()), [k]: v } }));
  const trims = s.trims ?? defaultTrims();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || (e.target as HTMLElement | null)?.closest("input")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** RESET: size and shape as added, default trims and gap, no cut diameter. */
  const reset = () => setS((x) => ({
    ...x, lengthMm: x.original?.lengthMm ?? x.lengthMm, widthMm: x.original?.widthMm ?? x.widthMm, outline: x.original?.outline,
    trims: defaultTrims(), partGapMm: DEFAULT_PART_GAP_MM, kerfMm: machine.kerfMm || undefined,
  }));

  const tooBig = s.lengthMm > 0 && s.widthMm > 0 && !fitsMachine(s.lengthMm, s.widthMm);
  const changed = JSON.stringify(s) !== JSON.stringify({ ...sheet, trims: sheet.trims ?? defaultTrims(), partGapMm: sheet.partGapMm ?? DEFAULT_PART_GAP_MM });
  const save = () => { onSave(s); onClose(); };

  // on the page itself, not inside the STOCK panel (whose styles would reach it)
  return createPortal(
    <div className="dlg-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="dlg proc pp-dlg sp-dlg" role="dialog" aria-modal="true" aria-labelledby="sp-title" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <header className="dlg-head">
          <span className="dlg-icon sp-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
              <rect x="3" y="5" width="18" height="14" rx="1" /><path d="M7 5v4M11 5v2M15 5v4M19 5v2" />
            </svg>
          </span>
          <div className="dlg-title">
            <h2 id="sp-title">Sheet properties</h2>
            <p>Sheet {index + 1} · {SOURCE[s.source] ?? s.source}{s.fileName ? ` (${s.fileName}.dxf)` : ""}</p>
          </div>
          <button type="button" className="icon-btn dlg-close" onClick={onClose} aria-label="Close" title="Close (Esc)"><IconClose size={16} /></button>
        </header>

        <div className="proc-body">
          <figure className="proc-image pp-image">
            <div className="pp-thumb sp-thumb"><SheetPreview sheet={s} origin={origin} trims={trims} /></div>
            <div className="proc-size">{s.lengthMm || "–"} × {s.widthMm || "–"} mm</div>
            <div className="sp-turn" role="group" aria-label="Turn and mirror the sheet">
              <button type="button" className="sp-turn-btn" onClick={() => setS(rotateSheet)} title="Turn the sheet 90° clockwise (length and width swap)">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></svg>
                Rotate 90°
              </button>
              <button type="button" className="sp-turn-btn" onClick={() => setS((x) => mirrorSheet(x, "x"))} title="Mirror left to right">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M12 3v18" strokeDasharray="2 2" /><path d="M9 6 3 18h6zM15 6l6 12h-6z" /></svg>
                Mirror X
              </button>
              <button type="button" className="sp-turn-btn" onClick={() => setS((x) => mirrorSheet(x, "y"))} title="Mirror top to bottom">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M3 12h18" strokeDasharray="2 2" /><path d="M6 9 18 3v6zM6 15l12 6v-6z" /></svg>
                Mirror Y
              </button>
            </div>
            <p className="sp-hint">Turn a remnant so its long, straight edges are at the machine's 0,0 (red dot): easier for the operator and for nesting.</p>
          </figure>

          <div className="proc-form">
            <div className="proc-group">
              <span className="proc-label">Material and thickness</span>
              <div className="filter-pair">
                <Combobox value={s.material} onChange={(material) => set({ material })} options={lists.materials} placeholder="Material" ariaLabel="Material" newHint="a new material" />
                <Combobox value={s.thicknessMm ? String(s.thicknessMm) : ""} onChange={(t) => set({ thicknessMm: Number(t.replace(",", ".").replace(/[^\d.]/g, "")) || 0 })}
                  options={lists.thicknesses} placeholder="Thickness" ariaLabel="Thickness in mm" suffix="mm" numeric newHint="a new thickness" />
              </div>
            </div>

            <div className="sp-grid">
              <span className="sp-label">Size</span>
              <label className="sp-field"><span>X</span><NumInput value={s.lengthMm} min={0} aria-label="Size X (mm)" disabled={!!s.outline}
                onCommit={(n) => set({ lengthMm: n })} className={`field${tooBig ? " is-too-big" : ""}`} /></label>
              <label className="sp-field"><span>Y</span><NumInput value={s.widthMm} min={0} aria-label="Size Y (mm)" disabled={!!s.outline}
                onCommit={(n) => set({ widthMm: n })} className={`field${tooBig ? " is-too-big" : ""}`} /></label>

              <span className="sp-label" title="Gap from the sheet edge to the parts, by the machine's axes: X- and Y- are the edges at the machine's 0,0">Trim</span>
              <label className="sp-field"><span>X−</span><NumInput value={trims.xMinus} min={0} aria-label="Trim X- (mm)" onCommit={(n) => setTrim("xMinus", n)} /></label>
              <label className="sp-field"><span>X+</span><NumInput value={trims.xPlus} min={0} aria-label="Trim X+ (mm)" onCommit={(n) => setTrim("xPlus", n)} /></label>
              <span />
              <label className="sp-field"><span>Y−</span><NumInput value={trims.yMinus} min={0} aria-label="Trim Y- (mm)" onCommit={(n) => setTrim("yMinus", n)} /></label>
              <label className="sp-field"><span>Y+</span><NumInput value={trims.yPlus} min={0} aria-label="Trim Y+ (mm)" onCommit={(n) => setTrim("yPlus", n)} /></label>

              <span className="sp-label">Parts gap</span>
              <label className="sp-field"><NumInput value={s.partGapMm ?? DEFAULT_PART_GAP_MM} min={0} aria-label="Parts gap (mm)" onCommit={(n) => set({ partGapMm: n })} /><span className="sp-unit">mm</span></label>
              <span />

              <span className="sp-label" title="How many of this sheet there are to cut">Cut number</span>
              <label className="sp-field">
                <NumInput value={s.unlimited ? 0 : s.qty} min={1} int aria-label="Cut number" disabled={s.unlimited} placeholder="∞" onCommit={(n) => set({ qty: n })} />
              </label>
              <label className="chk sp-unlimited"><input type="checkbox" checked={s.unlimited} onChange={(e) => set({ unlimited: e.target.checked })} /> Unlimited</label>

              <span className="sp-label" title="Diameter of the cutting beam (kerf), for the post-processor">Cut diameter</span>
              <label className="sp-field"><NumInput value={s.kerfMm ?? 0} min={0} aria-label="Cut diameter (mm)" placeholder="–" onCommit={(n) => set({ kerfMm: n || undefined })} /><span className="sp-unit">mm</span></label>
              <span />
            </div>
            {tooBig && <p className="sp-warn">Bigger than the machine can cut ({MACHINE_LIMIT.join(" × ")} mm).</p>}
            {s.outline && <p className="sp-note">Shaped sheet from the DXF: its size follows the shape (rotate and mirror turn it).</p>}
          </div>
        </div>

        <footer className="dlg-foot">
          <button type="button" className="btn btn-plain" onClick={reset} title={`Size and shape as added; trims, parts gap and cut diameter of ${machine.name}`}>Reset</button>
          <span className="proc-missing">{changed ? "Saved with the job's stock." : ""}</span>
          <button type="button" className="btn btn-plain" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-save" disabled={!changed}>Save</button>
        </footer>
      </form>
    </div>,
    document.body,
  );
}

/** The sheet's shape to scale, the trims as a dashed line inside, the machine's 0,0 as a red dot. */
function SheetPreview({ sheet, origin, trims }: { sheet: StockSheet; origin: Origin; trims: Trims }) {
  const L = sheet.lengthMm || 1, W = sheet.widthMm || 1;
  const loops = useMemo(() => sheetLoops({ lengthMm: L, widthMm: W, outline: sheet.outline }), [L, W, sheet.outline]);
  const d = loops.map((lp) => lp.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join("") + "Z").join("");
  const right = origin.endsWith("right"), bottom = origin.startsWith("bottom");
  // trims by the machine's axes: X- is the edge at the origin in X, Y- the edge at the origin in Y
  const left = right ? trims.xPlus : trims.xMinus, rgt = right ? trims.xMinus : trims.xPlus;
  const top = bottom ? trims.yPlus : trims.yMinus, bot = bottom ? trims.yMinus : trims.yPlus;
  const pad = Math.max(L, W) * 0.04;
  const dot = Math.max(L, W) * 0.018;
  return (
    <svg className="sp-svg" viewBox={`${-pad} ${-pad} ${L + 2 * pad} ${W + 2 * pad}`} preserveAspectRatio="xMidYMid meet" aria-label="Sheet shape">
      <path d={d} fillRule="evenodd" className="sp-plate" />
      {!sheet.outline && L - left - rgt > 0 && W - top - bot > 0 && (
        <rect x={left} y={top} width={L - left - rgt} height={W - top - bot} className="sp-trim" />
      )}
      <circle cx={right ? L : 0} cy={bottom ? W : 0} r={dot} className="sp-origin" />
    </svg>
  );
}
