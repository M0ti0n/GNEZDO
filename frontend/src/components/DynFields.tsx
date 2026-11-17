import { useEffect, useRef } from "react";

/**
 * Dynamic input with fields (as in AutoCAD): small boxes next to the last point, the active one focused,
 * so values can be typed straight away. Tab goes to the next field (Shift+Tab back), Enter applies,
 * Esc steps back. A field left empty follows the pointer. x, y are pixels in the positioned parent.
 * With the pointer given, the boxes sit on the other side of the point from it (diagonally), so they
 * never cover the line being drawn.
 */
export function DynFields({ x, y, w, h, away, fields, values, active, onValues, onActive, onEnter, onEscape }: {
  x: number; y: number;
  /** the pointer (pixels in the parent): the boxes keep to the other side of x, y */
  away?: { x: number; y: number };
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
  // (never while a pop-up is open, or while something else is being typed in: the boxes would take the keys)
  useEffect(() => {
    const el = refs.current[active];
    if (!el || document.querySelector(".dlg-backdrop")) return;
    const at = document.activeElement as HTMLElement | null;
    if (at && at !== document.body && !at.closest(".dyn-in") && (at.tagName === "INPUT" || at.tagName === "TEXTAREA" || at.tagName === "SELECT" || at.isContentEditable)) return;
    el.focus(); el.select();
  }, [active, Math.round(x), Math.round(y), fields.length]);
  const BW = 112 * fields.length + 8, BH = 50, OFF = 18;
  // the side away from the pointer (right / below without one), turned round where it does not fit
  const goLeft = !!away && away.x > x + 1, goUp = !!away && away.y > y + 1;
  let left = goLeft ? x - OFF - BW : x + OFF;
  if (left < 4) left = x + OFF; else if (left + BW > w - 4) left = x - OFF - BW;
  let top = goUp ? y - OFF - BH : y + OFF;
  if (top < 4) top = y + OFF; else if (top + BH > h - 4) top = y - OFF - BH;
  left = Math.max(4, Math.min(left, w - BW - 4));
  top = Math.max(4, Math.min(top, h - BH - 4));
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
