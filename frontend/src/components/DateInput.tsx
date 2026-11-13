// A date field with its own calendar, in English whatever the browser's language (the browser's own
// date picker speaks the computer's language: "Danes", "Počisti"). The value is yyyy-mm-dd ("" = none),
// as <input type="date"> has it; shown and typed as d. m. yyyy (2026-11-13 typed works too).
import { useEffect, useRef, useState } from "react";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const todayIso = () => { const t = new Date(); return iso(t.getFullYear(), t.getMonth(), t.getDate()); };
const parts = (v: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v); return m ? { y: +m[1], m: +m[2] - 1, d: +m[3] } : null; };
/** yyyy-mm-dd as shown: 13. 11. 2026 */
export const showDate = (v: string) => { const p = parts(v); return p ? `${p.d}. ${p.m + 1}. ${p.y}` : ""; };

/** What was typed as yyyy-mm-dd: d.m.yyyy, d/m/yyyy, d-m-yyyy or yyyy-mm-dd; null = not a date. */
export function parseDate(s: string): string | null {
  const t = s.trim();
  let y: number, m: number, d: number;
  const a = /^(\d{4})[-./ ]\s*(\d{1,2})[-./ ]\s*(\d{1,2})$/.exec(t);
  const b = /^(\d{1,2})[-./ ]\s*(\d{1,2})[-./ ]\s*(\d{2,4})$/.exec(t);
  if (a) { y = +a[1]; m = +a[2]; d = +a[3]; }
  else if (b) { d = +b[1]; m = +b[2]; y = +b[3]; if (y < 100) y += 2000; }
  else return null;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? iso(y, m - 1, d) : null;
}

export function DateInput({ value, onChange, className = "field", title, "aria-label": ariaLabel }: {
  value: string; onChange: (v: string) => void; className?: string; title?: string; "aria-label"?: string;
}) {
  const [text, setText] = useState(showDate(value));
  const [open, setOpen] = useState(false);
  const p = parts(value) ?? parts(todayIso())!;
  const [view, setView] = useState({ y: p.y, m: p.m });
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { setText(showDate(value)); }, [value]);
  // a click elsewhere or Esc closes the calendar
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key, true); };
  }, [open]);
  const commit = () => {
    if (!text.trim()) { if (value) onChange(""); return; }
    const v = parseDate(text);
    if (v) { if (v !== value) onChange(v); setText(showDate(v)); } else setText(showDate(value));
  };
  const show = () => { const q = parts(value) ?? parts(todayIso())!; setView({ y: q.y, m: q.m }); setOpen((o) => !o); };
  const pick = (v: string) => { onChange(v); setOpen(false); };
  const step = (k: number) => setView((w) => { const m = w.m + k; return { y: w.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 }; });
  // the month's days, Monday first, with the days of the months around it to fill the weeks
  const first = new Date(view.y, view.m, 1);
  const lead = (first.getDay() + 6) % 7;
  const cells = Array.from({ length: 42 }, (_, i) => { const dt = new Date(view.y, view.m, 1 - lead + i); return { v: iso(dt.getFullYear(), dt.getMonth(), dt.getDate()), d: dt.getDate(), out: dt.getMonth() !== view.m }; });
  const weeks = cells[35].out && cells[28].out ? 4 : cells[35].out ? 5 : 6;
  const today = todayIso();
  return (
    <div className="date-in" ref={box}>
      <input className={className} value={text} placeholder="d. m. yyyy" title={title} aria-label={ariaLabel} spellCheck={false}
        onChange={(e) => setText(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } if (e.key === "ArrowDown" && e.altKey) show(); }} />
      <button type="button" className="date-in-btn" onClick={show} aria-label="Calendar" title="Calendar" aria-expanded={open}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
          <rect x="3.5" y="5" width="17" height="15" rx="1.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>
      </button>
      {open && (
        <div className="date-cal" role="dialog" aria-label="Pick a date">
          <div className="date-cal-head">
            <button type="button" onClick={() => step(-1)} aria-label="Previous month">‹</button>
            <b>{MONTHS[view.m]} {view.y}</b>
            <button type="button" onClick={() => step(1)} aria-label="Next month">›</button>
          </div>
          <div className="date-cal-grid">
            {DAYS.map((d) => <span key={d} className="date-cal-dow">{d}</span>)}
            {cells.slice(0, weeks * 7).map((c) => (
              <button key={c.v} type="button" onClick={() => pick(c.v)}
                className={`date-cal-day${c.out ? " is-out" : ""}${c.v === value ? " is-sel" : ""}${c.v === today ? " is-today" : ""}`}>{c.d}</button>
            ))}
          </div>
          <div className="date-cal-foot">
            <button type="button" onClick={() => pick(today)}>Today</button>
            <button type="button" onClick={() => { onChange(""); setOpen(false); }}>Clear</button>
          </div>
        </div>
      )}
    </div>
  );
}
