import { useEffect, useRef } from "react";

/**
 * Dynamic input with fields (as in AutoCAD): small boxes next to the last point, the active one focused,
 * so values can be typed straight away. Tab goes to the next field (Shift+Tab back), Enter applies,
 * Esc steps back. A field left empty follows the pointer. x, y are pixels in the positioned parent.
 */
export function DynFields({ x, y, w, h, fields, values, active, onValues, onActive, onEnter, onEscape }: {
  x: number; y: number;
  /** size of the parent, to keep the boxes inside it */
  w: number; h: number;
  fields: { label: string; placeholder?: string; unit?: string }[];
  values: string[];
  active: number;
  onValues: (v: string[]) => void;
  onActive: (i: number) => void;
  onEnter: () => void;
  onEscape: () => void;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  // the active field focused when shown, when it changes and when the boxes move (a new point)
  useEffect(() => { const el = refs.current[active]; if (el) { el.focus(); el.select(); } }, [active, Math.round(x), Math.round(y), fields.length]);
  const BW = 112 * fields.length + 8, BH = 50, OFF = 18;
  const left = Math.max(4, Math.min(x + OFF, w - BW - 4));
  const top = y + OFF + BH > h - 4 ? Math.max(4, y - OFF - BH) : y + OFF;
  return (
    <div className="dyn-in dyn-fields" style={{ left, top }} onPointerDown={(e) => e.stopPropagation()}>
      {fields.map((f, i) => (
        <label key={f.label} className={`dyn-field${i === active ? " is-active" : ""}`}>
          <span className="dyn-label">{f.label}</span>
          <span className="dyn-box">
            <input ref={(el) => { refs.current[i] = el; }} value={values[i] ?? ""} placeholder={f.placeholder} spellCheck={false} inputMode="decimal"
              aria-label={f.label} onFocus={() => onActive(i)}
              onChange={(e) => { const v = [...values]; v[i] = e.target.value; onValues(v); }}
              onKeyDown={(e) => {
                if (e.key === "Tab") {
                  e.preventDefault();
                  onActive((i + (e.shiftKey ? fields.length - 1 : 1)) % fields.length);
                } else if (e.key === "Enter") { e.preventDefault(); onEnter(); }
                else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onEscape(); }
              }} />
            {f.unit && <i>{f.unit}</i>}
          </span>
        </label>
      ))}
    </div>
  );
}
