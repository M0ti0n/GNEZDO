import { useRef, useState } from "react";

/** A number field that is edited freely and checked when it is left (Enter or leaving the field). */
export function NumInput({ value, min = 0, int = false, onCommit, className = "field", ...rest }: {
  value: number; min?: number; int?: boolean; onCommit: (n: number) => void; className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "min">) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  const commit = () => {
    if (cancelled.current) { cancelled.current = false; setDraft(null); return; }  // Esc: keep the old value
    if (draft === null) return;
    const n = Number(draft.replace(",", "."));
    onCommit(Number.isFinite(n) && draft.trim() !== "" ? Math.max(min, int ? Math.round(n) : n) : value);
    setDraft(null);
  };
  return (
    <input {...rest} className={className} inputMode={int ? "numeric" : "decimal"}
      value={draft ?? (value ? String(value) : "")}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { cancelled.current = true; (e.target as HTMLInputElement).blur(); } }} />
  );
}

