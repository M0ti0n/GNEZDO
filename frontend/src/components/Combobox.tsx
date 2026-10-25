import { useEffect, useId, useMemo, useRef, useState } from "react";

export interface ComboOption {
  value: string;
  label?: string;   // shown instead of value, e.g. "5 mm"
  hint?: string;    // small grey text on the right, e.g. project name
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  options: ComboOption[];
  placeholder?: string;
  ariaLabel: string;
  suffix?: string;           // unit inside the field, e.g. "mm"
  numeric?: boolean;
  className?: string;
  readOnly?: boolean;
  /** Text for a typed value that is not in the list (it is still accepted). */
  newHint?: string;
}

// Drop-down list that can also be typed in: typing narrows the choices, the arrow
// shows them all, a value that is not in the list is accepted as a new one.
export function Combobox({ value, onChange, options, placeholder, ariaLabel, suffix, numeric, className, readOnly, newHint = "new" }: Props) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(false);       // filter only after typing, not when just opened
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();

  const shown = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!typed || !q) return options;
    return options.filter((o) => `${o.value} ${o.label ?? ""} ${o.hint ?? ""}`.toLowerCase().includes(q));
  }, [options, value, typed]);
  const exact = options.some((o) => o.value.toLowerCase() === value.trim().toLowerCase());

  // highlighted row: the current value, or nothing yet (the first arrow press goes to the first row)
  useEffect(() => { setActive(typed && shown.length ? 0 : shown.findIndex((o) => o.value === value)); }, [shown, value, open, typed]);
  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const pick = (o: ComboOption) => { onChange(o.value); setOpen(false); setTyped(false); };

  const onKey = (e: React.KeyboardEvent) => {
    if (readOnly) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      setActive((a) => Math.min(Math.max(a + (e.key === "ArrowDown" ? 1 : -1), 0), Math.max(shown.length - 1, 0)));
    } else if (e.key === "Enter" && open) {
      e.preventDefault();
      if (shown[active]) pick(shown[active]); else setOpen(false);
    } else if (e.key === "Escape" && open) {
      e.stopPropagation();   // close the list, not the dialog around it
      setOpen(false);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div className={`combo${open ? " is-open" : ""}${className ? ` ${className}` : ""}`}>
      <input ref={input} className="field combo-input" value={value} placeholder={placeholder} aria-label={ariaLabel}
        role="combobox" aria-expanded={open} aria-controls={id} aria-autocomplete="list" readOnly={readOnly}
        inputMode={numeric ? "decimal" : undefined} autoComplete="off"
        onChange={(e) => { onChange(e.target.value); setTyped(true); setOpen(true); }}
        onClick={() => !readOnly && setOpen(true)}
        onBlur={() => { setOpen(false); setTyped(false); }}
        onKeyDown={onKey} />
      {suffix && <span className="combo-suffix">{suffix}</span>}
      <button type="button" className="combo-arrow" tabIndex={-1} aria-label={`Show ${ariaLabel.toLowerCase()} list`} disabled={readOnly}
        onMouseDown={(e) => { e.preventDefault(); setTyped(false); setOpen((o) => !o); input.current?.focus(); }}>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <ul ref={list} id={id} className="combo-list" role="listbox" onMouseDown={(e) => e.preventDefault()}>
          {shown.map((o, i) => (
            <li key={o.value} data-i={i} role="option" aria-selected={o.value === value}
              className={`${i === active ? "is-active" : ""}${o.value === value ? " is-chosen" : ""}`}
              onMouseEnter={() => setActive(i)} onClick={() => pick(o)}>
              <span>{o.label ?? o.value}</span>
              {o.hint && <small>{o.hint}</small>}
            </li>
          ))}
          {shown.length === 0 && (
            <li className="combo-empty">{value.trim() && !exact ? <>“{value.trim()}” is not in the list: it will be {newHint}</> : "Nothing to choose yet"}</li>
          )}
        </ul>
      )}
    </div>
  );
}
