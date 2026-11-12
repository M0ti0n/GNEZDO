import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api/api";
import type { JobPart } from "../api/types";
import { diag } from "../job/diag";
import type { Machine } from "../job/machine";
import { techRowFor } from "../job/technology";
import { ConfirmDialog } from "./ConfirmDialog";
import type { NestedSheet } from "../job/nest";
import { computeRemnant, cutAt, cutNear, remnantRecord, remnantValid, type RemnantMode, type RemnantSettings, type SheetRemnant } from "../job/remnant";
import type { CutMode } from "./ManualNest";
import toolRemnant from "../shell/jobtools/tool-remnant.png";
import remTrim from "../shell/jobtools/rem-trim.png";
import remRect from "../shell/jobtools/rem-rect.png";
import remSkelet from "../shell/jobtools/rem-skelet.png";
import remCutV from "../shell/jobtools/rem-cutV.png";
import remCutH from "../shell/jobtools/rem-cutH.png";
import remDelete from "../shell/jobtools/rem-delete.png";

// Process -> Remnant (after Fab's layout): a mode works the sheet's remnant out (TRIM / RECTANGULAR /
// SKELET), CUT V / CUT H split a remnant with an open cut where you click, DELETE CUT takes such a cut
// away. The list names every remnant; SAVE keeps the ticked ones in the remnant store, DISCARD marks
// them as scrap. Doing neither is fine: the remnant is worked out anyway and can be saved later.

type Tool = "cutV" | "cutH" | "delete";

const MODES: { id: RemnantMode; label: string; icon: string; hint: string }[] = [
  { id: "trim", label: "Trim", icon: remTrim, hint: "A rough outline of the parts: straight edges, angles 90° to 270°" },
  { id: "rect", label: "Rectangular", icon: remRect, hint: "Rectangles only: a cut across the sheet, a second one up to it" },
  { id: "skelet", label: "Skelet", icon: remSkelet, hint: "Close round the parts at the minimum distance; windows in parts count too" },
];
const TOOLS: { id: Tool; label: string; icon: string; hint: string }[] = [
  { id: "cutV", label: "Cut V", icon: remCutV, hint: "Click in a remnant: a vertical open cut there, edge to edge" },
  { id: "cutH", label: "Cut H", icon: remCutH, hint: "Click in a remnant: a horizontal open cut there, edge to edge" },
  { id: "delete", label: "Delete cut", icon: remDelete, hint: "Click on an open cut (magenta) to take it away, or on the remnant's own cut (red) to delete the whole remnant" },
];

type PartRef = { path: string };

const SaveIcon = () => (
  <svg viewBox="0 0 20 20" width="18" height="18" aria-label="Saved"><path d="M3 2h11l3 3v13H3z" fill="#1f8a3b" /><path d="M6 2h7v5H6z" fill="#fff" /><rect x="6" y="11" width="8" height="5" fill="#fff" /></svg>
);
const DiscardIcon = () => (
  <svg viewBox="0 0 20 20" width="18" height="18" aria-label="Discarded"><path d="M4 4l12 12M16 4L4 16" stroke="#d62828" strokeWidth="3" strokeLinecap="round" /></svg>
);

/** Distance from p to the polyline [mm]. */
function distTo(l: [number, number][], x: number, y: number) {
  let best = Infinity;
  for (let i = 1; i < l.length; i++) {
    const [ax, ay] = l[i - 1], [bx, by] = l[i];
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx - x, ay + t * dy - y));
  }
  return best;
}

export function useRemnant({ index, single, sheets, parts, jobParts = [], jobName, settings: base, machine, onRemnant }: {
  /** the sheet's machine: its Technology row's Remnant cut · To parts, when set, is the distance kept from the parts */
  machine?: Machine;
  /** the job's parts (the projects a saved remnant came from) */
  jobParts?: JobPart[];
  /** the sheet shown or selected */
  index: number;
  /** one sheet shown (the cut tools work there) */
  single: boolean;
  sheets: NestedSheet[];
  parts: Map<string, PartRef>;
  jobName: string;
  settings: RemnantSettings;
  onRemnant: (index: number, rem: SheetRemnant | undefined) => void;
}): { panel: ReactNode; cut: CutMode } {
  const sheet = sheets[index] as NestedSheet | undefined;
  const techDist = sheet && machine ? techRowFor(machine.technologies, sheet.material, sheet.thicknessMm)?.row.remMinDistMm ?? 0 : 0;
  const settings: RemnantSettings = techDist > 0 ? { ...base, minDistMm: techDist } : base;
  const rem = sheet && remnantValid(sheet) ? sheet.remnant! : undefined;
  const [askAll, setAskAll] = useState(false);
  const stale = !!sheet?.remnant && !rem;
  const [tool, setTool] = useState<Tool | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setTool(null); setOff(new Set()); setMsg(null); }, [index]);
  useEffect(() => { if (!single || !rem) setTool(null); }, [single, rem]);
  const paths = new Map([...parts].map(([id, r]) => [id, r.path]));

  const make = (mode: RemnantMode) => {
    if (!sheet) return;
    const t = performance.now();
    const before = sheet.remnant?.pieces;
    const r = computeRemnant({ sheet, sheetNo: index + 1, paths, jobName, mode, settings, before });
    onRemnant(index, r);
    setOff(new Set());
    diag("process", `Remnant ${mode} on sheet ${index + 1}`, { pieces: r.pieces.length, ms: Math.round(performance.now() - t) });
    setMsg(r.pieces.length ? null : { text: "No remnant big enough on this sheet (Settings → Stock → Remnants)", bad: true });
  };

  const point = (x: number, y: number) => {
    if (!sheet || !rem || !tool) return;
    if (tool === "delete") {
      const k = cutNear(rem, x, y, 15);
      if (k < 0) {
        // the remnant's own contour (its cut lines or a piece's outline): the whole remnant goes
        const onOwn = rem.lines.some((l) => distTo(l, x, y) <= 15) || rem.pieces.some((p) => !p.window && distTo([...p.outline, p.outline[0]], x, y) <= 15);
        if (onOwn) setAskAll(true);
        else setMsg({ text: "Click on an open cut (magenta) or on the remnant's cut (red)", bad: true });
        return;
      }
      const cuts = rem.cuts.filter((_, i) => i !== k);
      onRemnant(index, computeRemnant({ sheet, sheetNo: index + 1, paths, jobName, mode: rem.mode, settings: rem.settings, cuts, before: rem.pieces }));
      setMsg(null);
      return;
    }
    const c = cutAt(sheet, paths, rem, tool === "cutV" ? "v" : "h", x, y);
    if (!c) { setMsg({ text: "Click inside a remnant (hatched)", bad: true }); return; }
    onRemnant(index, computeRemnant({ sheet, sheetNo: index + 1, paths, jobName, mode: rem.mode, settings: rem.settings, cuts: [...rem.cuts, c], before: rem.pieces }));
    setMsg(null);
  };

  const picked = rem ? rem.pieces.filter((p) => !off.has(p.name)) : [];
  const mark = async (status: "saved" | "discarded") => {
    if (!sheet || !rem || !picked.length || busy) return;
    setBusy(true);
    try {
      if (status === "saved") {
        const byId = new Map(jobParts.map((jp) => [jp.part.id, jp.part.project]));
        const projects = [...new Set(sheet.parts.map((sp) => byId.get(sp.partId)).filter((x): x is string => !!x))].sort();
        await api.saveRemnants(picked.map((p) => remnantRecord(p, sheet, jobName, index + 1, projects)));
      }
      else {
        const wasSaved = picked.filter((p) => p.status === "saved").map((p) => p.name);
        if (wasSaved.length) await api.deleteRemnants(wasSaved);
      }
      const names = new Set(picked.map((p) => p.name));
      onRemnant(index, { ...rem, pieces: rem.pieces.map((p) => (names.has(p.name) ? { ...p, status } : p)) });
      diag("process", `Remnants ${status}`, { names: [...names] });
      setMsg({ text: `${picked.length} ${picked.length === 1 ? "remnant" : "remnants"} ${status}` });
    } catch (e) {
      setMsg({ text: `Not ${status}: ${(e as Error).message}`, bad: true });
    } finally {
      setBusy(false);
    }
  };

  const size = (p: { x0: number; y0: number; x1: number; y1: number; areaMm2: number }) =>
    `${Math.round(p.x1 - p.x0)} × ${Math.round(p.y1 - p.y0)} mm, ${(p.areaMm2 / 1e6).toFixed(2)} m²`;

  const panel = (
    <aside className="mn-parts ac rm" aria-label="Remnant">
      <header className="sol-head ac-head"><span className="itool-box ac-icon-sm" aria-hidden="true"><img src={toolRemnant} alt="" draggable={false} /></span><h2>Remnant</h2></header>
      <div className="ac-body">
        <div className="ac-field"><span>Remnant mode</span></div>
        <div className="rm-tools" role="group" aria-label="Remnant mode">
          {MODES.map((m) => (
            <button key={m.id} type="button" className={`rm-btn${rem?.mode === m.id ? " is-on" : ""}`} title={m.hint} disabled={!sheet} onClick={() => make(m.id)}>
              <img src={m.icon} alt="" draggable={false} /><span>{m.label}</span>
            </button>
          ))}
        </div>
        <div className="ac-field"><span>Remnant tools</span></div>
        <div className="rm-tools" role="group" aria-label="Remnant tools">
          {TOOLS.map((t) => (
            <button key={t.id} type="button" className={`rm-btn${tool === t.id ? " is-on" : ""}`} aria-pressed={tool === t.id}
              disabled={!single || !rem}
              title={!single ? "Open a sheet (VIEW / EDIT) to cut its remnant" : !rem ? "Pick a remnant mode first" : t.hint}
              onClick={() => { setTool(tool === t.id ? null : t.id); setMsg(null); }}>
              <img src={t.icon} alt="" draggable={false} /><span>{t.label}</span>
            </button>
          ))}
        </div>
        <div className="ac-list pane-scroll">
          <div className="ac-table">
            <div className="ac-headrow has-trace"><span /><span>Remnant</span><span>Save</span></div>
            {rem?.pieces.map((p) => (
              <div key={p.name} className="ac-row has-trace">
                <span className="rm-status">{p.status === "saved" ? <SaveIcon /> : p.status === "discarded" ? <DiscardIcon /> : null}</span>
                <span className={`ac-name rm-name${p.status ? ` is-${p.status}` : ""}`} title={`${p.name}: ${size(p)}${p.window ? " (window in a part)" : ""}`}>{p.name}</span>
                <input type="checkbox" className="ac-trace" checked={!off.has(p.name)} aria-label={`Pick ${p.name}`}
                  onChange={() => setOff((s) => { const n = new Set(s); if (n.has(p.name)) n.delete(p.name); else n.add(p.name); return n; })} />
              </div>
            ))}
            {!rem && <p className="ac-empty">{stale ? "The parts moved since: pick a remnant mode again." : `Pick a remnant mode for sheet ${index + 1}.`}</p>}
          </div>
        </div>
        <div className="ac-pickbar">
          <button type="button" className="btn btn-plain" disabled={!picked.length || busy} onClick={() => void mark("saved")} title="Keep the ticked remnants in the remnant store">Save</button>
          <button type="button" className="btn btn-plain ac-clear" disabled={!picked.length || busy} onClick={() => void mark("discarded")} title="The ticked remnants are scrap">Discard</button>
        </div>
        <p className="rule-help ac-help">Minimum distance to parts {settings.minDistMm} mm{techDist > 0 ? " (Technology → Remnant cut)" : ""}, edge {settings.minEdgeMm} mm, area {settings.minAreaPct} % of the sheet (Settings → Stock).</p>
        {msg && <p className={`tech-msg ac-msg${msg.bad ? " is-bad" : ""}`} role="status">{msg.text}</p>}
      </div>
      {askAll && rem && (
        <ConfirmDialog title="Delete the remnant?" confirmLabel="Delete" onCancel={() => setAskAll(false)}
          onConfirm={() => {
            setAskAll(false); setTool(null);
            onRemnant(index, undefined);
            diag("process", `Remnant deleted on sheet ${index + 1}`, { pieces: rem.pieces.length });
            setMsg({ text: `Sheet ${index + 1}: remnant deleted` });
          }}>
          Sheet {index + 1}: the whole remnant goes ({rem.pieces.length} {rem.pieces.length === 1 ? "piece" : "pieces"}, its cuts and the open cuts){rem.pieces.some((p) => p.status === "saved") ? ". Remnants saved already stay in the remnant store." : "."}
        </ConfirmDialog>
      )}
    </aside>
  );

  return {
    panel,
    cut: {
      picking: false, picked: [], onPick: () => { /* parts are not picked here */ }, panel,
      ...(tool ? { onPoint: point, cursor: "crosshair" } : {}),
      hint: tool === "delete" ? "Click on an open cut (magenta) to delete it, or on the remnant's cut (red) to delete the whole remnant." : tool ? `Click inside a remnant: a ${tool === "cutV" ? "vertical" : "horizontal"} open cut there.`
        : rem ? "Remnant worked out. Cut it further with CUT V / CUT H, then SAVE the ones to keep." : "Pick a remnant mode on the right.",
    },
  };
}
