import { useEffect, useState, type ReactNode } from "react";
import { IMPORT_TOOLS } from "../import/ImportTools";
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
import toolAlignEdge from "./jobtools/tool-alignEdge.png";
import toolAddSheet from "./jobtools/tool-addSheet.png";
import toolNestReport from "./jobtools/tool-nestReport.png";
import toolAutoCut from "./jobtools/tool-autoCut.png";
import toolManualCut from "./jobtools/tool-manualCut.png";
import toolBreakCut from "./jobtools/tool-breakCut.png";
import toolMicroJoint from "./jobtools/tool-microJoint.png";
import toolLeadInOut from "./jobtools/tool-leadInOut.png";
import toolMovement from "./jobtools/tool-movement.png";
import toolRemnant from "./jobtools/tool-remnant.png";
import toolProcessDel from "./jobtools/tool-processDel.png";
import toolPostProcess from "./jobtools/tool-postProcess.png";
import toolCostReport from "./jobtools/tool-costReport.png";

// The icons are cut from Fab's design sheet as they are (tile icons on their tile colour).
interface SectionTool { id: string; label: string; icon: string; hint?: string; ready?: boolean; svg?: ReactNode }
interface Section {
  id: SectionId; label: string; icon: string; tools: SectionTool[];
  /** false: the tile does not open into tools (none yet); a click only switches to its screen */
  expands?: boolean;
}

const SECTIONS: Section[] = [
  // no tools of its own yet: the tile only opens the work parts list (set expands back when it gets some)
  { id: "work", label: "Work parts", icon: tileWork, tools: [], expands: false },
  {
    id: "auto", label: "Automatic nest", icon: tileAuto, tools: [
      { id: "fastNest", label: "Fast", icon: toolFastNest, hint: "Fast nest: about 30 s to 1 min (longer for big jobs)", ready: true },
      { id: "thoroughNest", label: "Thorough", icon: toolThoroughNest, hint: "Thorough nest: about 3 min, fewer and fuller sheets (on a server: two nests side by side, the better one kept)", ready: true },
      { id: "customNest", label: "Custom", icon: toolCustomNest, hint: "Custom nest: you set the time, or run until you stop it; keeps the best layout so far", ready: true },
    ],
  },
  {
    id: "manual", label: "Manual nest", icon: tileManual, tools: [
      { id: "addSheet", label: "Add sheet", icon: toolAddSheet, ready: true, hint: "Add sheet: a new empty sheet (its properties first) into the stock and the shown solution, opened in Manual nest" },
      { id: "mirrorV", label: "Mirror V", icon: toolMirrorV, ready: true, hint: "Mirror V: flip the selected parts left-right" },
      { id: "mirrorH", label: "Mirror H", icon: toolMirrorH, ready: true, hint: "Mirror H: flip the selected parts top-bottom" },
      { id: "arrange", label: "Arrange", icon: toolArrange, ready: true, hint: "Arrange: nest the selected parts (up to 50) as compactly as possible into the free space; 1.5 s, or 3 s for more than 20 parts" },
      { id: "stackV", label: "Stack V", icon: toolStackV, ready: true, hint: "Stack V: copies of the selection along Y until the edge or the next part" },
      { id: "stackH", label: "Stack H", icon: toolStackH, ready: true, hint: "Stack H: copies of the selection along X until the edge or the next part" },
      { id: "stackGrid", label: "Stack grid", icon: toolStackGrid, ready: true, hint: "Stack grid: rows and columns of copies of the selection until the edges or other parts" },
      { id: "alignEdge", label: "Align edge", icon: toolAlignEdge, ready: true, hint: "Align edge: click the edge that stays (a part's or the sheet's), then an edge of the part to turn: it turns until the two are parallel" },
      // the importer's Common cut icon; a switch: on, marked lines snap together and Arrange makes blocks
      { id: "commonCut", label: "Common cut", icon: "", svg: IMPORT_TOOLS.find((t) => t.id === "commonCut")?.icon, ready: true,
        hint: "Common cut (on / off): parts with the Common cut rule snap together on their marked lines, cut once (Alt: place without snapping); Arrange makes blocks of them" },
    ],
  },
  {
    // Fab's icons; what they do comes later
    id: "process", label: "Process", icon: tileProcess, tools: [
      { id: "autoCut", label: "Auto cut", icon: toolAutoCut, ready: true, hint: "Auto cut: the cut order and lead-ins worked out for every sheet, the shown sheet or picked parts" },
      { id: "manualCut", label: "Manual cut", icon: toolManualCut, hint: "Manual cut: set the cut order by hand" },
      { id: "breakCut", label: "Break cut", icon: toolBreakCut, hint: "Break cut: the contour stops a gap short of its start, so the part stays held in the sheet" },
      { id: "microJoint", label: "Micro joint", icon: toolMicroJoint, hint: "Micro joint: small uncut places that keep the part in the sheet" },
      { id: "leadInOut", label: "Lead in / out", icon: toolLeadInOut, hint: "Lead in / out: where and how the cut starts and ends on a contour" },
      { id: "movement", label: "Movement", icon: toolMovement, hint: "Movement: the head's travel between contours" },
      { id: "remnant", label: "Remnant", icon: toolRemnant, ready: true, hint: "Remnant: what is left of the sheet, worked out, named and saved for later" },
      { id: "processDel", label: "Process del", icon: toolProcessDel, hint: "Process del: take the cut path off the sheet or the parts" },
      { id: "postProcess", label: "Post process", icon: toolPostProcess, hint: "Post process: the NC program for the machine, written to its NC folder" },
    ],
  },
  {
    id: "report", label: "Report", icon: tileReport, tools: [
      { id: "nestReport", label: "Nest report", icon: toolNestReport, ready: true, hint: "Nest report: a page per sheet with its parts, weights and times; print all, the changed pages or chosen ones" },
      { id: "costReport", label: "Cost report", icon: toolCostReport, ready: true, hint: "Cost report: a price per part from its weight and cutting time, per project, with the sum" },
    ],
  },
];

export function JobToolbar({ onTool, onSection, request, lit = {} }: {
  /** switches that are on (Common cut) */
  lit?: Record<string, boolean>;
  onTool?: (section: SectionId, tool: string, custom?: CustomNestSettings) => void;
  /** a section was opened (null: closed) */
  onSection?: (section: SectionId | null) => void;
  /** Opens a section from outside (EDIT / VIEW on a sheet: Manual nest); a new n each time. */
  request?: { section: SectionId | null; n: number };
}) {
  const [open, setOpenState] = useState<SectionId | null>(null);
  const setOpen = (s: SectionId | null) => { setOpenState(s); onSection?.(s); };
  useEffect(() => { if (request?.n) setOpenState(request.section); }, [request?.n]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // in manual nest Escape clears the selection only
      if (e.key !== "Escape" || document.querySelector(".dlg-backdrop, .full-view, .mn")) return;
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
            <button key={t.id} type="button" className={`itool jtool${lit[t.id] ? " is-on" : ""}`} title={t.ready ? t.hint ?? t.label : `${t.hint ?? t.label} (not built yet)`}
              aria-pressed={t.id in lit ? !!lit[t.id] : undefined}
              onClick={() => onTool?.(s.id, t.id)}>
              <span className={`itool-box${t.svg ? " is-svg" : ""}`}>{t.svg ?? <img src={t.icon} alt="" draggable={false} />}</span>
              <span className="itool-label">{t.label}</span>
            </button>
          )) : <span className="jsec-empty">Tools for {s.label.toLowerCase()} come next</span>}
        </div>
      ) : (
        <button key={s.id} type="button" className={`jsec jsec-${s.id} jsec-tile`} onClick={() => { if (s.expands === false) { setOpenState(null); onSection?.(s.id); } else setOpen(s.id); }}
          aria-expanded={s.expands === false ? undefined : false} title={s.expands === false ? `${s.label}: the job part list` : `Open ${s.label}`}>
          <img className="jsec-icon" src={s.icon} alt="" draggable={false} />
          <span className="jsec-label">{s.label}</span>
        </button>
      ))}
    </SideScroll>
  </>);
}
