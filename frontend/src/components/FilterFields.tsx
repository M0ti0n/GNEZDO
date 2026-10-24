import type { JSX, ReactNode } from "react";
import type { DateMode } from "../api/types";
import { IconChevronLeft } from "./Icons";

// Filter controls shared by the Imported parts and Job search panels.

export function PanelHead({ title, onClose, children }: { title: string; onClose: () => void; children?: ReactNode }) {
  return (
    <div className="drawer-head">
      <h2>{title}</h2>
      {children}
      <button className="icon-btn" onClick={onClose} aria-label="Close panel" title="Close panel">
        <IconChevronLeft size={18} />
      </button>
    </div>
  );
}


/** A date filter as typed in a panel. Only counts when ticked. */
export interface DateDraft { on: boolean; mode: DateMode; date: string }

export const EMPTY_DATE: DateDraft = { on: false, mode: "on", date: "" };

export const dateFilterOf = (d: DateDraft) => (d.on && d.date ? { mode: d.mode, date: d.date } : undefined);

// Pictograms: the bar is the chosen date, hatching marks the side that is left out.
export const DATE_MODES: { id: DateMode; label: string; icon: JSX.Element }[] = [
  {
    id: "upTo", label: "Up to this date",
    icon: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h9M7 8l-4 4 4 4" /><path className="bar" d="M14 4v16" /><path className="hatch" d="M16.5 8.5 20.5 4.5M16.5 13.5l4-4M16.5 18.5l4-4" /></svg>,
  },
  {
    id: "on", label: "On this date",
    icon: <svg viewBox="0 0 24 24" aria-hidden="true"><path className="hatch" d="M1.5 8.5l3-3M1.5 13.5l3-3M1.5 18.5l3-3M19.5 8.5l3-3M19.5 13.5l3-3M19.5 18.5l3-3" /><path className="bar" d="M7 4v16M17 4v16" /><path d="M9.5 12h5M11.5 9.5 9.5 12l2 2.5M12.5 9.5l2 2.5-2 2.5" /></svg>,
  },
  {
    id: "from", label: "From this date on",
    icon: <svg viewBox="0 0 24 24" aria-hidden="true"><path className="hatch" d="M3.5 8.5l4-4M3.5 13.5l4-4M3.5 18.5l4-4" /><path className="bar" d="M10 4v16" /><path d="M12 12h9M17 8l4 4-4 4" /></svg>,
  },
];

export function DateLine({ label, on, value, onToggle, onChange }: {
  label: string; on: boolean; value: { mode: DateMode; date: string };
  onToggle: (on: boolean) => void; onChange: (v: { mode: DateMode; date: string }) => void;
}) {
  return (
    <div className={`date-line${on ? "" : " is-off"}`} role="group" aria-label={`${label} date`}>
      <label className="line-check">
        <input type="checkbox" checked={on} onChange={(e) => onToggle(e.target.checked)} aria-label={`Use ${label.toLowerCase()} date`} />
        <span className="date-label">{label}</span>
      </label>
      <div className="date-field">
        <input className="field" type="date" value={value.date} title={`${label} date`} aria-label={`${label} date`}
          onChange={(e) => onChange({ ...value, date: e.target.value })} />
        <div className="date-modes" role="radiogroup" aria-label={`${label}: compare`}>
          {DATE_MODES.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={value.mode === m.id} aria-label={m.label}
              title={m.label} className={`date-mode${value.mode === m.id ? " is-on" : ""}`}
              onClick={() => onChange({ ...value, mode: m.id })}>
              {m.icon}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SizeLine({ label, on, min, max, onToggle, onChange }: {
  label: string; on: boolean; min: string; max: string;
  onToggle: (on: boolean) => void; onChange: (min: string, max: string) => void;
}) {
  return (
    <div className={`date-line${on ? "" : " is-off"}`} role="group" aria-label={`${label} in mm`}>
      <label className="line-check">
        <input type="checkbox" checked={on} onChange={(e) => onToggle(e.target.checked)} aria-label={`Use ${label}`} />
        <span className="date-label">{label}</span>
      </label>
      <div className="size-row">
        <input className="field" type="number" min={0} inputMode="numeric" placeholder="min" value={min}
          aria-label={`${label} minimum`} onChange={(e) => onChange(e.target.value, max)} />
        <span className="dash">–</span>
        <input className="field" type="number" min={0} inputMode="numeric" placeholder="max" value={max}
          aria-label={`${label} maximum`} onChange={(e) => onChange(min, e.target.value)} />
        <span className="unit">mm</span>
      </div>
    </div>
  );
}
