import { useEffect, useRef } from "react";

/**
 * Dynamic input (as in CAD): a small box next to where the user clicked, already focused, so a
 * value can be typed straight away. Enter applies, Esc closes it. Placed inside a positioned
 * parent (the canvas); x, y are pixels in that parent, kept inside it.
 */
export function DynamicInput({ x, y, w, h, label, value, placeholder, onChange, onEnter, onEscape }: {
  x: number; y: number;
  /** Size of the parent, to keep the box inside it. */
  w: number; h: number;
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  onEnter: () => void;
  onEscape: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  // focused when shown and when it moves (a new pick), so typing goes in without a click
  useEffect(() => { input.current?.focus(); }, [x, y]);
  const BW = 190, BH = 52, OFF = 18;
  const left = Math.max(4, Math.min(x + OFF, w - BW - 4));
  const top = y + OFF + BH > h - 4 ? Math.max(4, y - OFF - BH) : y + OFF;
  return (
    <div className="dyn-in" style={{ left, top }} onPointerDown={(e) => e.stopPropagation()}>
      <span className="dyn-label">{label}</span>
      <input ref={input} value={value} placeholder={placeholder} spellCheck={false} aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); onEnter(); }
          else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onEscape(); }
        }} />
    </div>
  );
}
