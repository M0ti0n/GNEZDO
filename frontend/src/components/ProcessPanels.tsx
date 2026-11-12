import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/api";
import { diag } from "../job/diag";
import { foldersOf, type Machine, type Origin } from "../job/machine";
import type { NestedSheet } from "../job/nest";
import { sheetProgram } from "../job/ncProgram";
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
export function useProcessDel({ index, sheets, onClear }: {
  index: number; sheets: NestedSheet[];
  onClear: (index: number, patch: Partial<Pick<NestedSheet, "cut" | "remnant">>) => void;
}): { panel: ReactNode; cut: CutMode } {
  const sheet = sheets[index] as NestedSheet | undefined;
  const [ask, setAsk] = useState<null | "remnant" | "cut" | "all">(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => setMsg(null), [index]);
  const has = { remnant: !!sheet?.remnant, cut: !!sheet?.cut?.contours.length };
  const what = { remnant: "the remnant", cut: "the cut path", all: "the cut path and the remnant" };
  const go = (k: "remnant" | "cut" | "all") => {
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
        <p className="rule-help ac-help">Delete process: the cut path and the remnant both. Works on the sheet that is open, or the sheet selected among all sheets.</p>
        {msg && <p className="tech-msg ac-msg" role="status">{msg}</p>}
      </div>
      {ask && (
        <ConfirmDialog title="Delete?" confirmLabel="Delete" onCancel={() => setAsk(null)} onConfirm={() => go(ask)}>
          Sheet {index + 1}: {what[ask]} goes. Undo (Ctrl+Z) brings it back.
        </ConfirmDialog>
      )}
    </aside>
  );
  return { panel, cut: { ...quiet, panel, hint: "Process del: delete the remnant, the cut path, or both, of this sheet." } };
}

interface Done { sheet: number; file?: string; error?: string }

/** POST PROCESS: the NC program of one sheet, or of every sheet (one file each: JOBNAME_#). */
export function usePostProcess({ index, sheets, machine, origin, jobName, needsSave, onSave, partName }: {
  index: number; sheets: NestedSheet[]; machine: Machine; origin: Origin; jobName: string;
  needsSave: boolean; onSave: () => Promise<boolean>;
  partName: (sheet: NestedSheet, i: number) => string | undefined;
}): { panel: ReactNode; cut: CutMode } {
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<{ ok: boolean; text: string; list: Done[] } | null>(null);
  const [ask, setAsk] = useState<null | { kind: "save"; all: boolean } | { kind: "over"; name: string }>(null);
  const pp = machine.postprocessor;
  const ext = pp?.extension || ".nc";
  const fileOf = (i: number) => `${jobName}_${i + 1}${ext}`;
  const folder = foldersOf(machine);

  const run = async (all: boolean, checked = false, saved = false) => {
    if (busy) return;
    if (!pp) { setDone({ ok: false, text: `${machine.name} has no postprocessor (Settings → Machines → NC output)`, list: [] }); return; }
    if (needsSave && !saved) { setAsk({ kind: "save", all }); return; }
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
