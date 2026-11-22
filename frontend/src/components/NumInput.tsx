import { useEffect, useRef, useState } from "react";

// Eastern Arabic and Persian digits read as 0-9
const DIGITS = /[٠-٩۰-۹]/g;
const ascii = (s: string) => s.replace(DIGITS, (d) => String((d.charCodeAt(0) & 0xf) % 10));

/** What was typed as a number: "1,5" and "1.5" are the same; "1.234,5" (two separators) and "abc" are not numbers. */
export function readNumber(text: string): number | null {
  const t = ascii(text).trim();
  if (!t || /[.,].*[.,]/.test(t)) return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * A number field that is edited freely and checked when it is left (Enter or leaving the field). Text that is
 * not a number keeps the old value, and a number under the minimum becomes the minimum: either way the
 * field turns red for a moment and says why (its tooltip).
 */
export function NumInput({ value, min = 0, int = false, onCommit, className = "field", ...rest }: {
  value: number; min?: number; int?: boolean; onCommit: (n: number) => void; className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "min">) {
  const [draft, setDraft] = useState<string | null>(null);
  const [bad, setBad] = useState<string | null>(null);
  const cancelled = useRef(false);
  useEffect(() => {
    if (!bad) return;
    const t = window.setTimeout(() => setBad(null), 3500);
    return () => window.clearTimeout(t);
  }, [bad]);
  const commit = () => {
    if (cancelled.current) { cancelled.current = false; setDraft(null); return; }  // Esc: keep the old value
    if (draft === null) return;
    const typed = draft.trim();
    const n = readNumber(draft);
    if (typed === "") onCommit(value);
    else if (n === null) { setBad(`"${typed}" is not a number: ${value} is kept`); onCommit(value); }
    else {
      const v = Math.max(min, int ? Math.round(n) : n);
      if (n < min) setBad(`At least ${min}: ${v} is used`);
      else if (int && v !== n) setBad(`A whole number: ${v} is used`);
      onCommit(v);
    }
    setDraft(null);
  };
  return (
    <input {...rest} className={bad ? `${className} is-bad` : className} inputMode={int ? "numeric" : "decimal"}
      value={draft ?? (value ? String(value) : "")}
      aria-invalid={bad ? true : undefined}
      title={bad ?? rest.title}
      onChange={(e) => { setDraft(e.target.value); setBad(null); }}
      onFocus={(e) => e.target.select()}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { cancelled.current = true; (e.target as HTMLInputElement).blur(); } }} />
  );
}
