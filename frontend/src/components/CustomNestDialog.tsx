import { useEffect, useState } from "react";
import { IconClose } from "./Icons";
import { NumInput } from "./NumInput";
import icon from "../shell/jobtools/tool-customNest.png";

/** How long a custom nest runs. minutes = null: until it is stopped. */
export interface CustomNestSettings {
  minutes: number | null;
  /** Stop when no better layout has turned up for this many minutes (null: never). */
  stopAfterMinutes: number | null;
}

const PRESETS: { label: string; minutes: number | null }[] = [
  { label: "5 min", minutes: 5 },
  { label: "15 min", minutes: 15 },
  { label: "30 min", minutes: 30 },
  { label: "1 h", minutes: 60 },
  { label: "2 h", minutes: 120 },
  { label: "Until I stop it", minutes: null },
];

const KEY = "gnezdo.customNest";
const DEFAULTS: CustomNestSettings = { minutes: 15, stopAfterMinutes: 5 };

function load(): CustomNestSettings {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (s && typeof s === "object") return { ...DEFAULTS, ...s };
  } catch { /* no saved choice */ }
  return DEFAULTS;
}

function save(s: CustomNestSettings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* not kept, fine */ }
}

const clock = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

// Before a custom nest: how long it may run, and whether it stops early once nothing better turns up.
// The best layout so far is kept the whole time; "Stop and keep best" ends it at any moment.
export function CustomNestDialog({ onStart, onCancel }: { onStart: (s: CustomNestSettings) => void; onCancel: () => void }) {
  const [s, setS] = useState<CustomNestSettings>(load);
  const [stopEarly, setStopEarly] = useState(s.stopAfterMinutes !== null);
  const [stopAfter, setStopAfter] = useState(s.stopAfterMinutes ?? 5);
  const isPreset = PRESETS.some((p) => p.minutes === s.minutes);
  const [other, setOther] = useState(isPreset || s.minutes === null ? 45 : s.minutes);
  const [useOther, setUseOther] = useState(!isPreset);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if ((e.target as HTMLElement | null)?.closest("input")) return;  // Esc in a field only undoes the field
      onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const minutes = useOther ? other : s.minutes;
  const start = () => {
    const out = { minutes, stopAfterMinutes: stopEarly ? stopAfter : null };
    save(out);
    onStart(out);
  };
  const ends = minutes === null ? "when you stop it" : `at about ${clock(new Date(Date.now() + minutes * 60_000))}`;

  return (
    <div className="dlg-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="dlg cn-dlg" role="dialog" aria-modal="true" aria-labelledby="cn-title">
        <header className="dlg-head">
          <span className="dlg-icon cn-icon" aria-hidden="true"><img src={icon} alt="" /></span>
          <div className="dlg-title">
            <h2 id="cn-title">Custom nest</h2>
            <p>You choose how long it runs. The best layout so far is always kept.</p>
          </div>
          <button type="button" className="icon-btn dlg-close" onClick={onCancel} aria-label="Close" title="Close (Esc)"><IconClose size={16} /></button>
        </header>

        <div className="cn-body">
          <section className="cn-sec">
            <h3>Run for</h3>
            <div className="cn-chips" role="radiogroup" aria-label="Run for">
              {PRESETS.map((p) => {
                const on = !useOther && s.minutes === p.minutes;
                return (
                  <button key={p.label} type="button" role="radio" aria-checked={on}
                    className={`cn-chip${on ? " is-on" : ""}${p.minutes === null ? " is-wide" : ""}`}
                    onClick={() => { setUseOther(false); setS({ ...s, minutes: p.minutes }); }}>
                    {p.minutes === null && <span className="cn-inf" aria-hidden="true">∞</span>}{p.label}
                  </button>
                );
              })}
              <label className={`cn-chip cn-other${useOther ? " is-on" : ""}`} onClick={() => setUseOther(true)}>
                <span>Other</span>
                <NumInput className="field cn-num" value={other} min={1} int aria-label="Minutes"
                  onFocus={(e) => { setUseOther(true); e.target.select(); }} onCommit={(n) => { setOther(n); setUseOther(true); }} />
                <span>min</span>
              </label>
            </div>
          </section>

          <section className="cn-sec">
            <label className="cn-check">
              <input type="checkbox" checked={stopEarly} onChange={(e) => setStopEarly(e.target.checked)} />
              <span>Stop early when nothing better is found for</span>
              <NumInput className="field cn-num" value={stopAfter} min={1} int aria-label="Minutes without a better layout"
                disabled={!stopEarly} onCommit={setStopAfter} />
              <span>min</span>
            </label>
          </section>

          <p className="cn-note">
            Ends {ends}{stopEarly ? `, or sooner if ${stopAfter} min pass with no better layout` : ""}.
            While it runs you see the best layout so far and can press <b>Stop and keep best</b> at any time.
          </p>
        </div>

        <footer className="dlg-foot">
          <span className="proc-missing" />
          <button type="button" className="btn btn-plain" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn-save" onClick={start} autoFocus>Start</button>
        </footer>
      </div>
    </div>
  );
}
