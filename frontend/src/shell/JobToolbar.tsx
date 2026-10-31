import { useEffect, useState, type ReactNode } from "react";
import { SideScroll } from "../components/SideScroll";

// Toolbar of a job tab, drawn after Fab's layout: five sections, left to right. Collapsed, a
// section is one coloured tile. Pressing the tile opens it: the tile gives way to a narrow back
// button and the section's tools, in a frame of the section's colour. Opening another section
// closes the open one; the back button (or Esc) closes it.

export type SectionId = "work" | "auto" | "manual" | "process" | "report";

interface SectionTool { id: string; label: string; icon: ReactNode }
interface Section { id: SectionId; label: string; icon: ReactNode; tools: SectionTool[] }

const K = "#111", R = "#ed1c24", G = "#22b14c", B = "#00a2e8";

const Tile = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 64 48" width={64} height={48} fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const Ico = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 48 48" width={48} height={48} fill="none" aria-hidden="true">{children}</svg>
);

// collapsed-state icons; `currentColor` is the section's colour
const ICON_WORK = (
  <Tile>
    <rect x="18" y="5" width="28" height="40" rx="1" stroke="currentColor" strokeWidth="2.6" />
    <rect x="26" y="2" width="12" height="5" rx="1" stroke="currentColor" strokeWidth="2.2" fill="var(--js-fill)" />
    <path d="M24 19 27 13 30 19Z" fill="currentColor" />
    <circle cx="27" cy="26" r="3" fill="currentColor" />
    <rect x="24" y="32" width="6" height="6" fill="currentColor" />
    {[16, 26, 35].map((y) => <path key={y} d={`M33 ${y}h2M37 ${y}h6`} stroke="currentColor" strokeWidth="3" strokeLinecap="butt" />)}
  </Tile>
);
const ICON_AUTO = (
  <Tile>
    <path d="M6 44h18" stroke="currentColor" strokeWidth="2.6" />
    <path d="M9 43a6 4 0 0 1 12 0Z" fill="currentColor" />
    <path d="M14 40 9 26l12-9 9 6" stroke="currentColor" strokeWidth="4.5" />
    <circle cx="9" cy="26" r="3.6" fill="var(--js-fill)" stroke="currentColor" strokeWidth="2.4" />
    <circle cx="21" cy="17" r="3.6" fill="var(--js-fill)" stroke="currentColor" strokeWidth="2.4" />
    <path d="M30 23l3-3M30 23l1 4" stroke="currentColor" strokeWidth="2" />
    <path d="M36 25h9l-9 10Z" stroke="currentColor" strokeWidth="1.8" />
    <path d="M38 37 46 27V18h4v26h-5" stroke="currentColor" strokeWidth="1.8" />
    <rect x="35" y="37" width="10" height="7" stroke="currentColor" strokeWidth="1.8" />
  </Tile>
);
const ICON_MANUAL = (
  <Tile>
    <rect x="25" y="5" width="13" height="12" stroke="currentColor" strokeWidth="2" />
    <circle cx="32" cy="10" r="2.2" stroke="currentColor" strokeWidth="1.6" />
    <rect x="41" y="5" width="11" height="32" stroke="currentColor" strokeWidth="2" />
    <rect x="44" y="9" width="5" height="8" rx="1" stroke="currentColor" strokeWidth="1.6" />
    <path d="M28 25h11v12Z" stroke="currentColor" strokeWidth="2" />
    <path d="M12 26c-2-4 2-6 4-3l3 5 9-12c2-2 5 0 3 3l-6 8c3-1 5 2 3 4 2 1 2 4 0 5-3 6-8 9-14 7-6-2-6-10-2-17Z"
      stroke="currentColor" strokeWidth="2" />
  </Tile>
);
const ICON_PROCESS = (
  <Tile>
    <path d="M13 6v18" stroke="currentColor" strokeWidth="4" strokeLinecap="butt" />
    <path d="M7 23h12l-6 9Z" fill="currentColor" />
    <path d="M13 37h12M21 37V28h9v9M30 37h9V8h-9M30 37h9" stroke="currentColor" strokeWidth="1.4" />
    {[[13, 37], [21, 37], [21, 28], [30, 28], [30, 37], [39, 37], [30, 8], [39, 8]].map(([x, y]) => (
      <rect key={`${x}-${y}`} x={x - 2.6} y={y - 2.6} width="5.2" height="5.2" fill="currentColor" />
    ))}
  </Tile>
);
const ICON_REPORT = (
  <Tile>
    <rect x="23" y="3" width="18" height="15" stroke="currentColor" strokeWidth="2" />
    <path d="M18 34h-6V20h40v14h-6" stroke="currentColor" strokeWidth="2.6" />
    <path d="M19 22h26" stroke="currentColor" strokeWidth="2" />
    <rect x="46" y="23" width="3" height="3" fill="currentColor" />
    <rect x="21" y="27" width="22" height="18" stroke="currentColor" strokeWidth="2" />
    <path d="M24 30h16M24 33h16" stroke="currentColor" strokeWidth="1" />
    <rect x="25" y="36" width="14" height="6" stroke="currentColor" strokeWidth="1" />
  </Tile>
);

// tool icons (full colour, as drawn)
const MIRROR_V = <Ico><path d="M7 41 19 9v32Z" fill={K} /><path d="M23 7v34" stroke={K} strokeWidth="2" /><path d="M41 41 29 9v32Z" fill={R} /></Ico>;
const MIRROR_H = <Ico><path d="M7 7l34 12H7Z" fill={K} /><path d="M7 23h34M7 25.5h34" stroke={K} strokeWidth="1.6" /><path d="M7 41l34-12H7Z" fill={R} /></Ico>;
const ARRANGE = <Ico><path d="M7 7h31v8H23v12h-6L7 17Z" fill={R} /><path d="M7 22l13 13h4v6H7Z" fill={G} /><rect x="27" y="17" width="11" height="24" fill={B} /></Ico>;
const STACK_V = <Ico><path d="M8 7l32 7v2H8Z" fill={R} /><path d="M8 19l32 7v2H8Z" fill={R} /><path d="M8 31l32 7v2H8Z" fill={K} /></Ico>;
const STACK_H = <Ico><path d="M8 41l4-32 6 32Z" fill={K} /><path d="M19 41l4-32 6 32Z" fill={R} /><path d="M30 41l4-32 6 32Z" fill={R} /></Ico>;
const STACK_GRID = (
  <Ico>
    {[0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => (
      <path key={`${r}${c}`} d={`M${7 + c * 12} ${7 + r * 12}l11 11h-11Z`} fill={r === 2 && c === 0 ? K : R} />
    )))}
  </Ico>
);
const NEST_REPORT = (
  <Ico>
    <rect x="11" y="5" width="26" height="38" stroke={K} strokeWidth="2.2" />
    <path d="M15 10h3M20 10h11M33 10h1" stroke={K} strokeWidth="2.4" strokeLinecap="butt" />
    <rect x="15" y="14" width="5" height="3" fill="#ffd700" /><rect x="21" y="14" width="4" height="3" fill="#c3a6e0" />
    <path d="M15 18v4h5" stroke={G} strokeWidth="2" /><circle cx="23" cy="20" r="1.8" stroke="#c03a8a" strokeWidth="1.4" />
    <rect x="26" y="17" width="4" height="6" fill={B} /><rect x="31" y="18" width="3" height="5" fill="#ff8c3a" />
    <path d="M15 23h5" stroke={R} strokeWidth="1.6" />
    {[27, 31, 35, 39].map((y) => <path key={y} d={`M15 ${y}h1.5M18 ${y}h15`} stroke={K} strokeWidth="2" strokeLinecap="butt" />)}
  </Ico>
);
const COST_REPORT = (
  <Ico>
    <path d="M17 8h27v31H27" stroke={K} strokeWidth="1.8" />
    <path d="M12 6v22" stroke={K} strokeWidth="5" strokeLinecap="butt" /><path d="M12 6v22" stroke={R} strokeWidth="1.4" />
    <path d="M6 26h12l-6 9Z" fill={K} />
    <path d="M12 36l-4 4M12 36l4 4M12 36v4M6 41h12" stroke={R} strokeWidth="1" />
    <text x="34" y="33" textAnchor="middle" fontSize="22" fontWeight="600" fill={K} fontFamily="Barlow, sans-serif">$</text>
  </Ico>
);

const SECTIONS: Section[] = [
  { id: "work", label: "Work parts", icon: ICON_WORK, tools: [] },
  { id: "auto", label: "Automatic nest", icon: ICON_AUTO, tools: [] },
  {
    id: "manual", label: "Manual nest", icon: ICON_MANUAL, tools: [
      { id: "mirrorV", label: "Mirror V", icon: MIRROR_V },
      { id: "mirrorH", label: "Mirror H", icon: MIRROR_H },
      { id: "arrange", label: "Arrange", icon: ARRANGE },
      { id: "stackV", label: "Stack V", icon: STACK_V },
      { id: "stackH", label: "Stack H", icon: STACK_H },
      { id: "stackGrid", label: "Stack grid", icon: STACK_GRID },
    ],
  },
  { id: "process", label: "Process", icon: ICON_PROCESS, tools: [] },
  {
    id: "report", label: "Report", icon: ICON_REPORT, tools: [
      { id: "nestReport", label: "Nest report", icon: NEST_REPORT },
      { id: "costReport", label: "Cost report", icon: COST_REPORT },
    ],
  },
];

export function JobToolbar({ onTool }: { onTool?: (section: SectionId, tool: string) => void }) {
  const [open, setOpen] = useState<SectionId | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector(".dlg-backdrop")) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, select, textarea")) return;
      setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <SideScroll className="jtools" wrapClassName="jtools-wrap" role="toolbar" label="Job tools" more="tools" activeKey={open}>
      {SECTIONS.map((s) => open === s.id ? (
        <div key={s.id} className={`jsec jsec-${s.id} is-open is-active`} role="group" aria-label={s.label}>
          <button type="button" className="jsec-back" onClick={() => setOpen(null)} title={`Close ${s.label} (Esc)`} aria-label={`Close ${s.label}`}>
            <svg viewBox="0 0 20 60" width="20" height="60" aria-hidden="true"><path d="M15 6 4 30l11 24Z" fill="currentColor" /></svg>
          </button>
          {s.tools.length ? s.tools.map((t) => (
            <button key={t.id} type="button" className="itool jtool" title={`${t.label} (not built yet)`}
              onClick={() => onTool?.(s.id, t.id)}>
              <span className="itool-box">{t.icon}</span>
              <span className="itool-label">{t.label}</span>
            </button>
          )) : <span className="jsec-empty">Tools for {s.label.toLowerCase()} come next</span>}
        </div>
      ) : (
        <button key={s.id} type="button" className={`jsec jsec-${s.id} jsec-tile`} onClick={() => setOpen(s.id)}
          aria-expanded={false} title={`Open ${s.label}`}>
          <span className="jsec-icon">{s.icon}</span>
          <span className="jsec-label">{s.label}</span>
        </button>
      ))}
    </SideScroll>
  );
}
