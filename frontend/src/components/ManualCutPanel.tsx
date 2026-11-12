import { useEffect, useMemo, useState, type ReactNode } from "react";
import { liveContours, type CutContour } from "../job/cutPath";
import { diag } from "../job/diag";
import { contourKind, pickContour, reorderCut } from "../job/manualCut";
import { partColor, type NestedSheet } from "../job/nest";
import type { CutMode } from "./ManualNest";
import toolManualCut from "../shell/jobtools/tool-manualCut.png";

// Process -> Manual cut (after Auto cut's Selected parts): SELECT, then click contours of the processed
// sheet in the order to cut them; the list holds them in that order (drag, or Up / Down, to change it).
// Picked contours glow on the sheet, the one chosen in the list glows stronger. APPLY puts them in the
// cut path in that order, in the places they had (the rest stays where it is). A part shows as its ID in
// the job part list and its copy on the sheet (12_3: part 12, its third copy), the name on hover.

type PartRef = { path: string; name?: string; no?: number };

export function useManualCut({ index, single, sheets, parts, onCut }: {
  index: number;
  /** one sheet open (contours can be picked) */
  single: boolean;
  sheets: NestedSheet[];
  parts: Map<string, PartRef>;
  onCut: (index: number, cut: NonNullable<NestedSheet["cut"]>) => void;
}): { panel: ReactNode; cut: CutMode } {
  const sheet = sheets[index] as NestedSheet | undefined;
  const live = useMemo(() => new Set(sheet ? liveContours(sheet) : []), [sheet]);
  const [picking, setPicking] = useState(false);
  /** indexes in sheet.cut.contours, in the order picked */
  const [picked, setPicked] = useState<number[]>([]);
  const [rowSel, setRowSel] = useState<number | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  // another sheet, or the cut path changed (processed again, moved parts): a fresh pick
  useEffect(() => { setPicked([]); setRowSel(null); setPicking(false); }, [index, sheet?.cut?.at]);
  useEffect(() => { if (!single) setPicking(false); }, [single]);

  const cutPath = sheet?.cut;
  const can = single && !!cutPath && live.size > 0;
  const nameOf = (part: number) => { const p = sheet?.parts[part]; return (p && parts.get(p.partId)?.name) ?? `Part ${part + 1}`; };
  // a part as its ID in the job part list and which copy of it on the sheet it is: 12_3
  const copyNo = useMemo(() => {
    const seen = new Map<string, number>();
    return (sheet?.parts ?? []).map((p) => { const n = (seen.get(p.partId) ?? 0) + 1; seen.set(p.partId, n); return n; });
  }, [sheet?.parts]);
  const idOf = (part: number) => { const p = sheet?.parts[part]; const no = p ? parts.get(p.partId)?.no : undefined; return `${no ?? "?"}_${copyNo[part] ?? 1}`; };
  const labelOf = (c: CutContour) => (c.parts ? `Block ${c.parts.map(idOf).join(", ")}` : idOf(c.part));
  const fullOf = (c: CutContour) => (c.parts ? c.parts.map((i) => `${idOf(i)} ${nameOf(i)}`).join(", ") : `${idOf(c.part)} ${nameOf(c.part)}`);

  const point = (x: number, y: number, scale: number) => {
    if (!cutPath || !picking) return;
    const k = pickContour(cutPath, live, [x, y], Math.max(2, 12 / scale));
    if (k < 0) { setMsg({ text: "Click on a contour (its line or its leads)", bad: true }); return; }
    setMsg(null);
    setPicked((l) => (l.includes(k) ? l.filter((x) => x !== k) : [...l, k]));
    setRowSel((r) => (r === k ? null : r));
  };
  const move = (from: number, to: number) => setPicked((l) => {
    if (to < 0 || to >= l.length || from === to) return l;
    const n = l.slice();
    const [x] = n.splice(from, 1);
    n.splice(to, 0, x);
    return n;
  });
  const apply = () => {
    if (!sheet || !cutPath || !picked.length) return;
    const r = reorderCut(cutPath, picked, (i) => `${idOf(i)} (${nameOf(i)})`);
    if (typeof r === "string") { setMsg({ text: r, bad: true }); return; }
    onCut(index, r);
    diag("process", `Manual cut on sheet ${index + 1}`, { contours: picked.length });
    setMsg({ text: `${picked.length} ${picked.length === 1 ? "contour" : "contours"} put in the order picked` });
    setPicked([]); setRowSel(null); setPicking(false);
  };

  const sel = rowSel !== null ? picked.indexOf(rowSel) : -1;
  const panel = (
    <aside className="mn-parts ac" aria-label="Manual cut">
      <header className="sol-head ac-head"><span className="itool-box ac-icon-sm" aria-hidden="true"><img src={toolManualCut} alt="" draggable={false} /></span><h2>Manual cut</h2></header>
      <div className="ac-body">
        <div className="ac-pickbar">
          <button type="button" className={`btn btn-plain${picking ? " is-on" : ""}`} aria-pressed={picking} disabled={!can} onClick={() => setPicking((v) => !v)}
            title={can ? "On: click contours on the sheet in the order to cut them, click one again to take it out" : "Open a processed sheet (VIEW / EDIT) to pick its contours"}>Select</button>
          <button type="button" className="btn btn-plain ac-clear" disabled={!picked.length} onClick={() => { setPicked([]); setRowSel(null); setMsg(null); }}>Clear all</button>
        </div>
        <div className="ac-list pane-scroll">
          <div className="ac-table">
            <div className="ac-headrow"><span /><span>Contour</span></div>
            {picked.map((k, j) => {
              const c = cutPath?.contours[k];
              if (!c) return null;
              const p = sheet?.parts[c.part];
              const no = p ? parts.get(p.partId)?.no : undefined;
              const col = no !== undefined && !c.parts ? partColor(no) : null;
              return (
                <div key={k} className="ac-row">
                  {/* the place in the cut order: stays where it is when the rows are dragged */}
                  <span className="ac-no" style={col ? { color: col.stroke, borderColor: col.stroke } : undefined}>{j + 1}</span>
                  <span className={`ac-name mc-name${rowSel === k ? " is-sel" : ""}${dragFrom === j ? " is-drag" : ""}`} draggable title={`${fullOf(c)} · ${contourKind(c)}`}
                    onClick={() => setRowSel(rowSel === k ? null : k)}
                    onDragStart={(e) => { setDragFrom(j); setRowSel(k); e.dataTransfer.effectAllowed = "move"; }}
                    onDragOver={(e) => { e.preventDefault(); if (dragFrom !== null && dragFrom !== j) { move(dragFrom, j); setDragFrom(j); } }}
                    onDragEnd={() => setDragFrom(null)}>
                    <span className="mc-part">{labelOf(c)}</span><small>{contourKind(c)}</small>
                  </span>
                </div>
              );
            })}
            {!picked.length && <p className="ac-empty">{!single ? `Open a sheet (VIEW / EDIT) to pick its contours. Sheet ${index + 1} is selected.`
              : !can ? "Process the sheet first (Auto cut)." : picking ? "Click the contours on the sheet in the order to cut them." : "Press SELECT, then click the contours on the sheet."}</p>}
          </div>
        </div>
        <div className="ac-pickbar">
          <button type="button" className="btn btn-plain" disabled={sel <= 0} onClick={() => move(sel, sel - 1)} title="The contour chosen in the list one place earlier">▲ Up</button>
          <button type="button" className="btn btn-plain" disabled={sel < 0 || sel === picked.length - 1} onClick={() => move(sel, sel + 1)} title="The contour chosen in the list one place later">▼ Down</button>
        </div>
        <div className="ac-pickbar">
          <button type="button" className={`btn btn-plain mc-apply${picked.length ? " is-on" : ""}`} disabled={!picked.length} onClick={apply}
            title="Put the picked contours in the cut path in this order, in the places they had (the rest stays where it is)">Apply</button>
        </div>
        <p className="rule-help ac-help">The picked contours swap places among themselves in the cut path; pick every contour to set the whole order. A part&apos;s holes, marking and open cuts must stay before its outline.</p>
        {msg && <p className={`tech-msg ac-msg${msg.bad ? " is-bad" : ""}`} role="status">{msg.text}</p>}
      </div>
    </aside>
  );

  const glowAll = new Set<CutContour>(picked.map((k) => cutPath?.contours[k]).filter((c): c is CutContour => !!c));
  const strong = rowSel !== null ? cutPath?.contours[rowSel] : undefined;
  return {
    panel,
    cut: {
      picking: false, picked: [], onPick: () => { /* contours are picked here, not parts */ }, panel,
      ...(can && picking ? { onPoint: point, cursor: "pointer" } : {}),
      ...(glowAll.size ? { glow: { all: glowAll, ...(strong ? { strong } : {}) } } : {}),
      hint: !can ? (single ? "Process the sheet first (Auto cut), then set its order here." : "Open a sheet to set its cut order.")
        : picking ? "Click contours in the order to cut them (click again: out). Drag them in the list to change the order, then APPLY."
        : picked.length ? "Choose a contour in the list to see it; APPLY puts them in this order." : "Press SELECT on the right, then click the contours.",
    },
  };
}
