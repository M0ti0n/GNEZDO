import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/api";
import { diag } from "../job/diag";
import { foldersOf, type Machine, type Origin } from "../job/machine";
import type { NestedSheet } from "../job/nest";
import { sheetProgram } from "../job/ncProgram";
import { techColumnsFor, techRowFor } from "../job/technology";
import { saveNcFile } from "../job/ncFile";
import { runPostprocessor } from "../job/postprocessor";
import { ConfirmDialog } from "./ConfirmDialog";
import type { CutMode } from "./ManualNest";
import toolProcessDel from "../shell/jobtools/tool-processDel.png";
import toolPostProcess from "../shell/jobtools/tool-postProcess.png";

// Process -> PROCESS DEL and POST PROCESS: their panels on the right, beside all sheets or one sheet
// (the sheet they work on: the one open, or the card selected).

const panelHead = (icon: string, title: string) => (
  <header className="sol-head ac-head"><span className="itool-box ac-icon-sm" aria-hidden="true"><img src={icon} alt="" draggable={false} /></span><h2>{title}</h2></header>
);
const quiet: Omit<CutMode, "panel" | "hint"> = { picking: false, picked: [], onPick: () => { /* nothing to pick */ } };

/** PROCESS DEL: take the remnant, the cut path, or both off the sheet. */
export function useProcessDel({ index, single, sheets, partName, onClear }: {
  index: number;
  /** one sheet open (DELETE SELECTED works there) */
  single: boolean;
  sheets: NestedSheet[];
  partName: (sheet: NestedSheet, i: number) => string | undefined;
  onClear: (index: number, patch: Partial<Pick<NestedSheet, "cut" | "remnant">>) => void;
}): { panel: ReactNode; cut: CutMode } {
  const sheet = sheets[index] as NestedSheet | undefined;
  const [ask, setAsk] = useState<null | "remnant" | "cut" | "all">(null);
  const [msg, setMsg] = useState<string | null>(null);
  /** DELETE SELECTED on: a click on a processed part takes its cut path away */
  const [delSel, setDelSel] = useState(false);
  /** what the deletes took, newest last, for UNDO (one step a press) */
  const [undo, setUndo] = useState<{ index: number; patch: Partial<Pick<NestedSheet, "cut" | "remnant">> }[]>([]);
  const last = undo[undo.length - 1] ?? null;
  const setLast = (u: { index: number; patch: Partial<Pick<NestedSheet, "cut" | "remnant">> } | null) =>
    setUndo((l) => (u ? [...l, u].slice(-50) : l.slice(0, -1)));
  useEffect(() => setMsg(null), [index]);
  useEffect(() => { if (!single) setDelSel(false); }, [single]);

  /** a part's cut path off the sheet (a common cut block's: the whole block) */
  const unprocess = (i: number) => {
    const cut = sheet?.cut;
    if (!sheet || !cut) return;
    const parts = new Set([i]);
    for (const c of cut.contours) if (c.parts?.includes(i)) c.parts.forEach((k) => parts.add(k));
    const goes = (c: { part: number; parts?: number[] }) => (c.parts ?? [c.part]).some((k) => parts.has(k));
    if (!cut.contours.some(goes)) { setMsg(`${partName(sheet, i) ?? `Part ${i + 1}`} is not processed`); return; }
    const contours = cut.contours.filter((c) => !goes(c));
    const keys = { ...cut.keys };
    for (const k of parts) delete keys[k];
    setLast({ index, patch: { cut } });
    onClear(index, { cut: contours.length ? { ...cut, contours, keys } : undefined });
    diag("process", "Process del: part", { sheet: index + 1, parts: [...parts] });
    const names = [...parts].map((k) => partName(sheet, k) ?? `Part ${k + 1}`);
    setMsg(`${names.join(", ")}: not processed any more`);
  };
  const has = { remnant: !!sheet?.remnant, cut: !!sheet?.cut?.contours.length };
  const what = { remnant: "the remnant", cut: "the cut path", all: "the cut path and the remnant" };
  const go = (k: "remnant" | "cut" | "all") => {
    setLast({ index, patch: k === "remnant" ? { remnant: sheet?.remnant } : k === "cut" ? { cut: sheet?.cut } : { cut: sheet?.cut, remnant: sheet?.remnant } });
    onClear(index, k === "remnant" ? { remnant: undefined } : k === "cut" ? { cut: undefined } : { cut: undefined, remnant: undefined });
    diag("process", `Process del: ${k}`, { sheet: index + 1 });
    setMsg(`Sheet ${index + 1}: ${what[k]} deleted`);
    setAsk(null);
  };
  const panel = (
    <aside className="mn-parts ac" aria-label="Process del">
      {panelHead(toolProcessDel, "Process del")}
      <div className="ac-body">
        <p className="rule-help ac-help">Sheet {index + 1}{sheet ? ` · ${sheet.material} ${sheet.thicknessMm} mm` : ""}: {has.cut ? "cut path" : "no cut path"}, {has.remnant ? "remnant" : "no remnant"}.</p>
        <div className="pp-actions">
          <button type="button" className="btn btn-plain pp-btn is-del" disabled={!has.remnant} onClick={() => setAsk("remnant")}>Delete remnant</button>
          <button type="button" className="btn btn-plain pp-btn is-del" disabled={!has.cut} onClick={() => setAsk("cut")}>Delete cut path</button>
          <button type="button" className="btn btn-plain pp-btn is-del" disabled={!has.cut && !has.remnant} onClick={() => setAsk("all")}>Delete process</button>
        </div>
        <button type="button" className={`btn btn-plain pp-btn is-del pd-sel${delSel ? " is-on" : ""}`} aria-pressed={delSel} disabled={!single || !has.cut}
          title={!single ? "Open a sheet (VIEW / EDIT) to delete the cut path of parts on it" : "On: click processed parts to take their cut path away (they are not processed any more); click again to turn it off"}
          onClick={() => setDelSel((v) => !v)}>Delete selected</button>
        <p className="rule-help ac-help">Delete process: the cut path and the remnant both. Works on the sheet that is open, or the sheet selected among all sheets. Delete selected (on / off): click parts on the open sheet to take their cut path away (a common cut block's whole).</p>
        {msg && <p className="tech-msg ac-msg" role="status">{msg}</p>}
        {last && (
          <button type="button" className="btn btn-plain pp-btn" title={`Sheet ${last.index + 1}: bring back what was deleted`}
            onClick={() => { onClear(last.index, last.patch); diag("process", "Process del: undone", { sheet: last.index + 1 }); setMsg(`Sheet ${last.index + 1}: brought back`); setLast(null); }}>Undo delete{undo.length > 1 ? ` (${undo.length})` : ""}</button>
        )}
      </div>
      {ask && (
        <ConfirmDialog title="Delete?" confirmLabel="Delete" onCancel={() => setAsk(null)} onConfirm={() => go(ask)}>
          Sheet {index + 1}: {what[ask]} goes. UNDO DELETE in this panel brings it back.
        </ConfirmDialog>
      )}
    </aside>
  );
  return {
    panel,
    cut: delSel && single
      ? { picking: true, picked: [], onPick: unprocess, panel, hint: "DELETE SELECTED: click processed parts to take their cut path away. UNDO DELETE brings it back." }
      : { ...quiet, panel, hint: "Process del: delete the remnant, the cut path, or both, of this sheet; DELETE SELECTED: of parts you click." },
  };
}

interface Done { sheet: number; file?: string; error?: string }

/** POST PROCESS: the NC program of one sheet, or of every sheet (one file each: JOBNAME_#). */
export function usePostProcess({ index, sheets, machine, origin, jobName, needsSave, dirty = false, onSave, onSheet, partName }: {
  index: number; sheets: NestedSheet[]; machine: Machine; origin: Origin; jobName: string;
  /** never saved: asked first (the files are named after the job) */
  needsSave: boolean;
  /** saved before, changed since: saved again before the files are written, without asking */
  dirty?: boolean;
  onSave: () => Promise<boolean>;
  /** a change to a sheet (its pre-pierce) */
  onSheet?: (index: number, patch: Partial<NestedSheet>) => void;
  partName: (sheet: NestedSheet, i: number) => string | undefined;
}): { panel: ReactNode; cut: CutMode } {
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<{ ok: boolean; text: string; list: Done[] } | null>(null);
  const [ask, setAsk] = useState<null | { kind: "save"; all: boolean } | { kind: "over"; name: string }>(null);
  const pp = machine.postprocessor;
  const ext = pp?.extension || ".nc";
  const fileOf = (i: number) => `${jobName}_${i + 1}${ext}`;
  const folder = foldersOf(machine);
  // pre-pierce of the selected sheet: its Technology row's, or set for this sheet (laser tables have it)
  const sheet = sheets[index];
  const prePierceShown = techColumnsFor(machine.technology).some((g) => g.cols.some((c) => c.key === "prePierce"));
  const row = sheet ? techRowFor(machine.technologies, sheet.material, sheet.thicknessMm)?.row : undefined;
  const tablePierce = !!row?.prePierce;
  const pierceOn = sheet?.prePierce ?? tablePierce;

  const run = async (all: boolean, checked = false, saved = false) => {
    if (busy) return;
    if (!pp) { setDone({ ok: false, text: `${machine.name} has no postprocessor (Settings → Machines → NC output)`, list: [] }); return; }
    if (needsSave && !saved) { setAsk({ kind: "save", all }); return; }
    // saved before: its changes saved again first, so the job and its NC files go together
    if (!needsSave && dirty && !saved) {
      setBusy("Saving the job");
      const ok = await onSave();
      setBusy(null);
      if (!ok) { setDone({ ok: false, text: "Not post processed: the job could not be saved", list: [] }); return; }
      saved = true;
    }
    // one sheet: ask before replacing its file (every sheet: replaced without asking)
    if (!all && !checked && folder.nc.trim() && api.hasServer) {
      const exists = await api.ncExists(machine.id, fileOf(index)).catch(() => false);
      if (exists) { setAsk({ kind: "over", name: fileOf(index) }); return; }
    }
    const list = all ? sheets.map((_, i) => i) : [index];
    const out: Done[] = [];
    setDone(null);
    for (const i of list) {
      setBusy(`Sheet ${i + 1} of ${sheets.length}`);
      await new Promise((r) => setTimeout(r, 30));   // let the spinner show
      const sh = sheets[i];
      const prog = sheetProgram(sh, machine, origin, `${jobName}_${i + 1}`, (k) => partName(sh, k));
      if ("error" in prog) { out.push({ sheet: i + 1, error: prog.error }); continue; }
      const r = runPostprocessor(pp.source, prog);
      if (!r.ok) { out.push({ sheet: i + 1, error: r.error }); continue; }
      try { out.push({ sheet: i + 1, file: await saveNcFile(machine, fileOf(i), r.text) }); }
      catch (e) { out.push({ sheet: i + 1, error: (e as Error).message }); }
    }
    setBusy(null);
    const good = out.filter((d) => d.file).length;
    diag("process", `Post process: ${good} of ${out.length}`, { job: jobName, errors: out.filter((d) => d.error).map((d) => `${d.sheet}: ${d.error}`) });
    setDone({ ok: good === out.length, text: good === out.length ? `POST PROCESS successful: ${good} NC ${good === 1 ? "file" : "files"}` : `${good} of ${out.length} written`, list: out });
  };

  const panel = (
    <aside className="mn-parts ac" aria-label="Post process">
      {panelHead(toolPostProcess, "Post process")}
      <div className="ac-body">
        {prePierceShown && sheet && (
          <div className="pp-pierce">
            <label className="chk">
              <input type="checkbox" checked={pierceOn} disabled={!row || !onSheet}
                onChange={(e) => onSheet?.(index, { prePierce: e.target.checked === tablePierce ? undefined : e.target.checked })} />
              Pre-pierce <span className="pp-pierce-of">sheet {index + 1}</span>
            </label>
            <span className="rule-help">{!row ? "No Technology row for this sheet" : sheet.prePierce === undefined ? `As the Technology table: ${tablePierce ? "on" : "off"}` : `Changed for this sheet · table: ${tablePierce ? "on" : "off"}`}</span>
          </div>
        )}
        <div className="pp-actions">
          <button type="button" className="btn btn-primary pp-btn" disabled={!!busy || !sheets.length} onClick={() => void run(false)}
            title={`Sheet ${index + 1}: ${fileOf(index)} (asks before replacing it)`}>Post process selected sheet</button>
          <button type="button" className="btn btn-primary pp-btn" disabled={!!busy || !sheets.length} onClick={() => void run(true)}
            title="Every sheet, one file each (files of the same name are replaced)">Post process all sheets</button>
        </div>
        <dl className="pp-info">
          <dt>Postprocessor</dt><dd>{pp ? pp.name : <em>none (Settings → Machines → NC output)</em>}</dd>
          <dt>Files</dt><dd>{jobName}_1{ext}, {jobName}_2{ext} …</dd>
          <dt>To</dt><dd>{folder.nc.trim() ? folder.nc : folder.ncDownload ? "downloaded in the browser" : <em>no NC folder (Settings → Machines → Folders)</em>}</dd>
        </dl>
        {busy && <p className="tech-msg ac-msg" role="status"><span className="pp-spin" aria-hidden="true" /> Post processing… {busy}</p>}
        {done && (
          <div className={`pp-done${done.ok ? "" : " is-bad"}`} role="status">
            <b>{done.text}</b>
            <ul>{done.list.map((d) => <li key={d.sheet} className={d.error ? "is-bad" : ""}>Sheet {d.sheet}: {d.error ?? d.file}</li>)}</ul>
          </div>
        )}
        <p className="rule-help ac-help">Selected sheet: the sheet open, or the one selected among all sheets. A sheet needs its cut path (Auto cut); its remnant&apos;s cuts come last.</p>
      </div>
      {busy && createPortal(<div className="pp-overlay" role="progressbar" aria-label="Post processing"><span className="pp-spin is-big" /><b>Post processing…</b><span>{busy}</span></div>, document.body)}
      {ask?.kind === "save" && (
        <ConfirmDialog title="Save the job first?" confirmLabel="Save and post process" onCancel={() => setAsk(null)}
          onConfirm={() => { const all = ask.all; setAsk(null); void onSave().then((ok) => { if (ok) void run(all, false, true); }); }}>
          The NC files are named after the job, so it is saved first.
        </ConfirmDialog>
      )}
      {ask?.kind === "over" && (
        <ConfirmDialog title="Replace the NC file?" confirmLabel="Replace" onCancel={() => setAsk(null)}
          onConfirm={() => { setAsk(null); void run(false, true, true); }}>
          {ask.name} is in the NC folder already. Replace it?
        </ConfirmDialog>
      )}
    </aside>
  );
  return { panel, cut: { ...quiet, panel, hint: "Post process: the NC programs of the sheet or of all sheets." } };
}
