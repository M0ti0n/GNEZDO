import { useEffect, useState } from "react";
import { SideScroll } from "../components/SideScroll";
import type { CustomNestSettings } from "../components/CustomNestDialog";

// Toolbar of a job tab, drawn after Fab's layout: five sections, left to right. Collapsed, a
// section is one coloured tile. Pressing the tile opens it: the tile gives way to a narrow back
// button and the section's tools, in a frame of the section's colour. Opening another section
// closes the open one; the back button (or Esc) closes it.

export type SectionId = "work" | "auto" | "manual" | "process" | "report";

import tileWork from "./jobtools/tile-work.png";
import tileAuto from "./jobtools/tile-auto.png";
import tileManual from "./jobtools/tile-manual.png";
import tileProcess from "./jobtools/tile-process.png";
import tileReport from "./jobtools/tile-report.png";
import toolFastNest from "./jobtools/tool-fastNest.png";
import toolThoroughNest from "./jobtools/tool-thoroughNest.png";
import toolCustomNest from "./jobtools/tool-customNest.png";
import toolMirrorV from "./jobtools/tool-mirrorV.png";
import toolMirrorH from "./jobtools/tool-mirrorH.png";
import toolArrange from "./jobtools/tool-arrange.png";
import toolStackV from "./jobtools/tool-stackV.png";
import toolStackH from "./jobtools/tool-stackH.png";
import toolStackGrid from "./jobtools/tool-stackGrid.png";
import toolNestReport from "./jobtools/tool-nestReport.png";
import toolCostReport from "./jobtools/tool-costReport.png";

// The icons are cut from Fab's design sheet as they are (tile icons on their tile colour).
interface SectionTool { id: string; label: string; icon: string; hint?: string; ready?: boolean }
interface Section { id: SectionId; label: string; icon: string; tools: SectionTool[] }

const SECTIONS: Section[] = [
  { id: "work", label: "Work parts", icon: tileWork, tools: [] },
  {
    id: "auto", label: "Automatic nest", icon: tileAuto, tools: [
      { id: "fastNest", label: "Fast", icon: toolFastNest, hint: "Fast nest: the whole job in about 30 s", ready: true },
      { id: "thoroughNest", label: "Thorough", icon: toolThoroughNest, hint: "Thorough nest: up to 90 s, a shorter last sheet", ready: true },
      { id: "customNest", label: "Custom", icon: toolCustomNest, hint: "Custom nest: you set the time, or run until you stop it; keeps the best layout so far", ready: true },
    ],
  },
  {
    id: "manual", label: "Manual nest", icon: tileManual, tools: [
      { id: "mirrorV", label: "Mirror V", icon: toolMirrorV },
      { id: "mirrorH", label: "Mirror H", icon: toolMirrorH },
      { id: "arrange", label: "Arrange", icon: toolArrange },
      { id: "stackV", label: "Stack V", icon: toolStackV },
      { id: "stackH", label: "Stack H", icon: toolStackH },
      { id: "stackGrid", label: "Stack grid", icon: toolStackGrid },
    ],
  },
  { id: "process", label: "Process", icon: tileProcess, tools: [] },
  {
    id: "report", label: "Report", icon: tileReport, tools: [
      { id: "nestReport", label: "Nest report", icon: toolNestReport },
      { id: "costReport", label: "Cost report", icon: toolCostReport },
    ],
  },
];

export function JobToolbar({ onTool, onSection }: {
  onTool?: (section: SectionId, tool: string, custom?: CustomNestSettings) => void;
  /** a section was opened (null: closed) */
  onSection?: (section: SectionId | null) => void;
}) {
  const [open, setOpenState] = useState<SectionId | null>(null);
  const setOpen = (s: SectionId | null) => { setOpenState(s); onSection?.(s); };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector(".dlg-backdrop, .full-view")) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, select, textarea")) return;
      setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (<>
    <SideScroll className="jtools" wrapClassName="jtools-wrap" role="toolbar" label="Job tools" more="tools" activeKey={open}>
      {SECTIONS.map((s) => open === s.id ? (
        <div key={s.id} className={`jsec jsec-${s.id} is-open is-active`} role="group" aria-label={s.label}>
          <button type="button" className="jsec-back" onClick={() => setOpen(null)} title={`Close ${s.label} (Esc)`} aria-label={`Close ${s.label}`}>
            <svg viewBox="0 0 20 60" width="20" height="60" aria-hidden="true"><path d="M16 2 3 30l13 28Z" fill="currentColor" /></svg>
          </button>
          {s.tools.length ? s.tools.map((t) => (
            <button key={t.id} type="button" className="itool jtool" title={t.ready ? t.hint ?? t.label : `${t.hint ?? t.label} (not built yet)`}
              onClick={() => onTool?.(s.id, t.id)}>
              <span className="itool-box"><img src={t.icon} alt="" draggable={false} /></span>
              <span className="itool-label">{t.label}</span>
            </button>
          )) : <span className="jsec-empty">Tools for {s.label.toLowerCase()} come next</span>}
        </div>
      ) : (
        <button key={s.id} type="button" className={`jsec jsec-${s.id} jsec-tile`} onClick={() => setOpen(s.id)}
          aria-expanded={false} title={`Open ${s.label}`}>
          <img className="jsec-icon" src={s.icon} alt="" draggable={false} />
          <span className="jsec-label">{s.label}</span>
        </button>
      ))}
    </SideScroll>
  </>);
}
