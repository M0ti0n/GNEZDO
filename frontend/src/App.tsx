import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { api } from "./api/api";
import type { JobFilter, JobPart, JobSummary, PartSummary } from "./api/types";
import { ImportPage } from "./pages/ImportPage";
import { sampleDrawings } from "./import/sampleDrawing";
import {
  loadProperties, mirrorBlocked, mirrorFor, newItem, readItem, saveProperties, statusOf,
  type BatchProperties, type ImportItem,
} from "./import/batch";
import { ProcessDialog, type ProcessValues } from "./import/ProcessDialog";
import { CloseUnsavedDialog } from "./import/CloseUnsavedDialog";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { partGeometry } from "./import/toPart";
import type { SavePart } from "./api/api";
import { applyRules, loadRules, saveRules, type ImportRules } from "./import/rules";
import { RulesPage } from "./pages/RulesPage";
import { quantityFromName } from "./import/geometry";
import { HomePage, type HomeAction } from "./pages/HomePage";
import { JobPage } from "./pages/JobPage";
import { JobSearchPage } from "./pages/JobSearchPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { Drawer, type DrawerMode } from "./shell/Drawer";
import { TabBar } from "./shell/TabBar";
import { ToolStrip, toolsFor } from "./shell/ToolStrip";
import { JobToolbar } from "./shell/JobToolbar";
import { buildRequest, isFinished, nestApi, nestProblem, type JobNest, type NestMode, type NestRun } from "./job/nest";
import type { CustomNestSettings } from "./components/CustomNestDialog";
import { loadStockSettings, saveStockSettings, type StockSettings, type StockSheet } from "./job/stock";
import { SettingsPage } from "./pages/SettingsPage";
import { HistoryStore, undoKey, type UndoState } from "./state/history";
import type { Drawing } from "./import/geometry";
import { VIEW_TITLE, drawingTab, initialShell, jobTab, shellReducer, type PageKind, type Tab, type ViewKind } from "./state/tabs";

const USER_NAME = "Fab"; // until sign-in exists

export function App() {
  const [state, dispatch] = useReducer(shellReducer, initialShell);
  const [drawer, setDrawer] = useState<DrawerMode | null>(null);
  const [jobParts, setJobParts] = useState<Record<string, JobPart[] | undefined>>({});
  const [jobStock, setJobStock] = useState<Record<string, StockSheet[]>>({});
  // the nest going on or the last one, per job tab
  const [jobNest, setJobNest] = useState<Record<string, JobNest | undefined>>({});
  const [stockSettings, setStockSettingsState] = useState<StockSettings>(loadStockSettings);
  const setStockSettings = (s: StockSettings) => { setStockSettingsState(s); saveStockSettings(s); };
  // Import list: files read from DXF, opened in tabs for checking; kept here so marks survive switching tabs.
  const [imports, setImports] = useState<ImportItem[]>([]);
  const [rules, setRulesState] = useState<ImportRules>(loadRules);
  const setRules = (r: ImportRules) => { setRulesState(r); saveRules(r); };
  // Properties for all parts carry over between imports and visits (kept in this browser).
  const [importProps, setImportPropsState] = useState<BatchProperties>(() => loadProperties(loadRules()));
  const setImportProps = (u: BatchProperties | ((p: BatchProperties) => BatchProperties)) =>
    setImportPropsState((p) => { const next = typeof u === "function" ? u(p) : u; saveProperties(next); return next; });
  // Properties section of the Import panel: expanded or collapsed (kept in this browser).
  const [propsOpen, setPropsOpenState] = useState(() => { try { return localStorage.getItem("gnezdo.propsOpen") !== "0"; } catch { return true; } });
  const setPropsOpen = (open: boolean) => {
    setPropsOpenState(open);
    try { localStorage.setItem("gnezdo.propsOpen", open ? "1" : "0"); } catch { /* session only */ }
  };
  /** Values saved in the Process pop-up become the Properties for the next parts. */
  const carryOver = (v: BatchProperties) =>
    setImportProps({ project: v.project, description: v.description, material: v.material, thicknessMm: v.thicknessMm, rotations: [...v.rotations], mirror: v.mirror, filler: v.filler });
  const patchItem = (id: string, patch: Partial<ImportItem>) =>
    setImports((list) => list.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const [toast, setToast] = useState<string | null>(null);
  const newJobCount = useRef(0);
  // Last job search: results show in the Job search view on the main screen.
  const [jobSearch, setJobSearch] = useState<{ filter: JobFilter | null; run: number }>({ filter: null, run: 0 });

  const runJobSearch = (filter: JobFilter) => {
    setJobSearch((s) => ({ filter, run: s.run + 1 }));
    dispatch({ type: "view", view: "jobSearch" });
  };

  const showView = (view: ViewKind) => dispatch({ type: "view", view });
  const activeTab = state.tabs.find((t) => t.id === state.activeId) ?? null;
  // what the main area shows: the active document tab, else the current view
  const active: { kind: PageKind; title: string; jobId?: string; drawingId?: string } =
    activeTab ?? { kind: state.view, title: VIEW_TITLE[state.view] };
  const open = (tab: Tab) => dispatch({ type: "open", tab });

  // Load the part list when a job tab is opened for the first time.
  useEffect(() => {
    const id = active.jobId;
    if (active.kind !== "job" || !id || id in jobParts) return;
    setJobParts((m) => ({ ...m, [id]: undefined }));
    if (id.startsWith("new-")) setJobParts((m) => ({ ...m, [id]: [] }));
    else api.jobParts(id).then((p) => setJobParts((m) => ({ ...m, [id]: p.map((jp, i) => ({ ...jp, no: jp.no ?? i + 1, qtyMax: jp.qtyMax ?? jp.qty })) })));
  }, [active, jobParts]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const newJob = useCallback(() => {
    newJobCount.current += 1;
    const n = newJobCount.current;
    dispatch({ type: "open", tab: jobTab(`new-${n}`, n === 1 ? "New job" : `New job ${n}`) });
  }, []);

  const openImport = () => setDrawer("import");

  const openItem = (item: ImportItem) => {
    if (item.state !== "ready") return;
    patchItem(item.id, { checked: true });   // looking at a part counts as checking it
    open(drawingTab(item.id, item.name));
  };

  const addFiles = async (files: File[], openFirst: boolean) => {
    const fresh = files.map((f) => ({ file: f, item: newItem(f) }));
    setImports((list) => [...list, ...fresh.map((x) => x.item)]);
    const read = await Promise.all(fresh.map((x) => readItem(x.item, x.file, rules)));
    setImports((list) => list.map((i) => read.find((r) => r.id === i.id) ?? i));
    if (openFirst && read[0]?.state === "ready") openItem(read[0]);
    const failed = read.filter((r) => r.state === "failed").length;
    if (failed) setToast(`${failed} ${failed === 1 ? "file" : "files"} could not be read`);
  };

  /** Parts leave the import list: their tabs close and their Undo history ends. */
  const closeTabs = (ids: string[]) => ids.forEach((id) => { history.forget(id); dispatch({ type: "close", id: `drawing:${id}` }); });

  const [saving, setSaving] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);   // part shown in the Process pop-up

  /** Saved parts leave the import list and their tabs close. */
  const dropSaved = (ids: string[]) => {
    closeTabs(ids);
    setImports((list) => list.filter((i) => !ids.includes(i.id)));
  };

  const toSave = (i: ImportItem, v: ProcessValues, replace: boolean): SavePart => ({
    name: v.name.trim(), project: v.project.trim(), description: v.description.trim(),
    material: v.material.trim(), thicknessMm: Number(v.thicknessMm),
    rotations: [...v.rotations], mirror: v.mirror, filler: v.filler,
    ...partGeometry(i.drawing!),
    sourceFile: i.fileName, replace,
    qty: rules.qtyFromName ? i.qty ?? 0 : 0,
  });

  const importPanel = {
    items: imports,
    properties: importProps,
    rules,
    onProperties: setImportProps,
    onFiles: addFiles,
    onCheckLines: () => {
      setImports((list) => list.map((i) => (i.state === "ready" ? { ...i, checked: true } : i)));
      const next = imports.map((i) => statusOf({ ...i, checked: i.state === "ready" }));
      const bad = next.filter((s) => s.verdict === "attention").length;
      setToast(bad ? `${bad} ${bad === 1 ? "part needs" : "parts need"} attention: double-click the red ones to check them` : "All parts have closed contours");
    },
    busy: saving,
    // Saves the green parts with the Properties; parts already in the database are not
    // replaced but marked, to be processed one by one.
    onProcessAll: async () => {
      const green = imports.filter((i) => statusOf(i).verdict === "ok" && i.drawing);
      if (!green.length) return;
      setSaving(true);
      try {
        const res = await api.saveParts(green.map((i) => {
          return toSave(i, { ...importProps, name: i.name, mirror: mirrorFor(i, importProps, rules) }, false);
        }), "Import list");
        const saved = green.filter((_, k) => res[k]?.status !== "exists").map((i) => i.id);
        const dup = green.filter((_, k) => res[k]?.status === "exists").map((i) => i.id);
        dropSaved(saved);
        setImports((list) => list.map((i) => (dup.includes(i.id) ? { ...i, duplicate: true } : i)));
        const already = `${dup.length} ${dup.length === 1 ? "part is" : "parts are"} already in the database: open ${dup.length === 1 ? "it" : "them"} to replace`;
        setToast(saved.length === 0 ? already
          : `Saved ${saved.length} ${saved.length === 1 ? "part" : "parts"} to the database` + (dup.length ? ` · ${already}` : ""));
      } catch (e) {
        setToast(`Not saved: ${(e as Error).message}`);
      } finally {
        setSaving(false);
      }
    },
    onOpen: (id: string) => { const it = imports.find((i) => i.id === id); if (it) openItem(it); },
    // removing parts with unsaved changes asks first
    onRemove: (id: string) => askRemove([id]),
    onClear: () => askRemove(imports.map((i) => i.id)),
    onSamples: () => setImports((list) => [...list, ...sampleDrawings
      .filter((d) => !list.some((i) => i.id === d.id))
      .map((d): ImportItem => ({
        id: d.id, fileName: `${d.fileName}.dxf`, name: d.fileName, qty: quantityFromName(d.fileName),
        state: "ready", drawing: { ...d, entities: d.entities.some((e) => e.role) ? d.entities : applyRules(d.entities, rules) },
        checked: false, processed: false,
      }))]),
    openId: activeTab?.kind === "drawing" ? activeTab.drawingId ?? null : null,
    propsOpen,
    onPropsOpen: setPropsOpen,
  };
  const shownItem = active.kind === "drawing" ? imports.find((i) => i.id === active.drawingId) : undefined;

  // Undo / Redo (green bar, Ctrl+Z / Ctrl+Y): one history per import drawing, kept while the part is in the list.
  const history = useRef(new HistoryStore<Drawing>()).current;
  const [, setHistoryTick] = useState(0);
  const [undone, setUndone] = useState<{ text: string } | null>(null);
  const editDrawing = (id: string, before: Drawing, next: Drawing, label: string) => {
    history.record(id, before, label);
    setHistoryTick((n) => n + 1);
    patchItem(id, { drawing: next, processed: false, applied: undefined });
  };
  const step = (kind: "undo" | "redo") => {
    if (!shownItem?.drawing || processing) return;
    const s = kind === "undo" ? history.undo(shownItem.id, shownItem.drawing) : history.redo(shownItem.id, shownItem.drawing);
    if (!s) return;
    setHistoryTick((n) => n + 1);
    patchItem(shownItem.id, { drawing: s.state, processed: false, applied: undefined });
    setUndone({ text: `${kind === "undo" ? "Undone" : "Redone"}: ${s.label}` });
  };
  const undoState: UndoState = {
    undoLabel: shownItem?.drawing && !processing ? history.undoLabel(shownItem.id) : null,
    redoLabel: shownItem?.drawing && !processing ? history.redoLabel(shownItem.id) : null,
    onUndo: () => step("undo"),
    onRedo: () => step("redo"),
  };
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = undoKey(e);
      if (!k || document.querySelector(".dlg")) return;
      e.preventDefault();
      stepRef.current(k);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const processingItem = processing ? imports.find((i) => i.id === processing) : undefined;

  // Closing the tab of an edited, unsaved part asks first. Without saving, the part goes back
  // to how it was imported and its Undo history ends; an unchanged part just closes.
  const [closing, setClosing] = useState<string | null>(null);   // import item id
  const closingItem = closing ? imports.find((i) => i.id === closing) : undefined;
  const requestClose = (tabId: string) => {
    const t = state.tabs.find((x) => x.id === tabId);
    const itemId = t?.kind === "drawing" ? t.drawingId : undefined;
    if (itemId && history.changed(itemId)) {
      dispatch({ type: "activate", id: tabId });
      setClosing(itemId);
      return;
    }
    if (itemId) history.forget(itemId);
    dispatch({ type: "close", id: tabId });
  };
  const closeWithoutSaving = (itemId: string) => {
    const original = history.original(itemId);
    if (original) patchItem(itemId, { drawing: original, processed: false, applied: undefined });
    history.forget(itemId);
    setHistoryTick((n) => n + 1);
    setClosing(null);
    dispatch({ type: "close", id: `drawing:${itemId}` });
  };

  // Remove from the import list (× or Clear list); parts with unsaved changes are asked about.
  const [removing, setRemoving] = useState<string[] | null>(null);
  const removeNow = (ids: string[]) => { closeTabs(ids); setImports((list) => list.filter((i) => !ids.includes(i.id))); };
  const askRemove = (ids: string[]) => (ids.some((id) => history.changed(id)) ? setRemoving(ids) : removeNow(ids));
  const removingChanged = removing ? imports.filter((i) => removing.includes(i.id) && history.changed(i.id)) : [];

  const openJob = (j: JobSummary) => open(jobTab(j.id, j.name));

  const addParts = (jobId: string, title: string, parts: PartSummary[]) => {
    const current = jobParts[jobId] ?? [];
    const fresh = parts.filter((p) => !current.some((c) => c.part.id === p.id));
    setJobParts((m) => {
      const list = m[jobId] ?? [];
      // ID numbers go on from the highest one, so a part keeps its number for the life of the job
      const next = list.reduce((n, jp) => Math.max(n, jp.no ?? 0), 0);
      return { ...m, [jobId]: [...list, ...fresh.map((p, i) => {
        // the required number: the part's quantity from its file name when the import rule says so,
        // otherwise 0, to be set by hand
        const q = rules.qtyFromName ? p.qty : 0;
        return { part: p, qty: q, qtyMax: q, no: next + i + 1, nested: 0 };
      })] };
    });
    const skipped = parts.length - fresh.length;
    setToast(
      fresh.length === 0
        ? `Already in ${title}`
        : `Added ${fresh.length} ${fresh.length === 1 ? "part" : "parts"} to ${title}` +
          (skipped ? ` (${skipped} already there)` : ""),
    );
  };

  const onHome = (a: HomeAction) => {
    switch (a.kind) {
      case "import": return openImport();
      case "newJob": return newJob();
      case "jobSearch": setDrawer("jobs"); return runJobSearch({}); // "All jobs"
      case "openJob": return openJob(a.job);
      case "openImport": return showView("import");
    }
  };

  const onTool = (toolId: string) => {
    switch (toolId) {
      case "import": return openImport();
      case "newJob": return newJob();
      case "jobSearch": setDrawer("jobs"); return showView("jobSearch");
      case "parts": case "addParts": return setDrawer("parts");
    }
  };

  const job = activeTab?.kind === "job" && activeTab.jobId ? { id: activeTab.jobId, title: activeTab.title } : null;

  // Nesting: start a run for a job tab, ask the server how it goes once a second, and when it
  // has finished put the nested counts into Qty nested.
  const setNest = (jobId: string, f: (n: JobNest | undefined) => JobNest | undefined) =>
    setJobNest((m) => ({ ...m, [jobId]: f(m[jobId]) }));
  const finishNest = (jobId: string, run: NestRun) => {
    setNest(jobId, (n) => n && { ...n, run });
    const nested = run.result?.nested;
    if (nested) setJobParts((m) => ({ ...m, [jobId]: (m[jobId] ?? []).map((jp) => ({ ...jp, nested: nested[jp.part.id] ?? 0 })) }));
  };
  const pollNest = async (jobId: string, id: string) => {
    for (;;) {
      await new Promise((r) => setTimeout(r, 1000));
      let run: NestRun;
      try { run = await nestApi.get(id); } catch (e) {
        setNest(jobId, (n) => n && { ...n, error: (e as Error).message });
        return;
      }
      if (isFinished(run)) return finishNest(jobId, run);
      setNest(jobId, (n) => n && n.run?.id === id ? { ...n, run } : n);
    }
  };
  const startNest = async (jobId: string, mode: NestMode, custom?: CustomNestSettings) => {
    const cur = jobNest[jobId];
    if (cur && !cur.error && !isFinished(cur.run)) { setToast("A nest is already running for this job"); return; }
    const problem = nestProblem(jobParts[jobId], jobStock[jobId] ?? []);
    if (problem) { setToast(problem); return; }
    setNest(jobId, () => ({ mode, custom, run: null, startedAt: Date.now() }));
    try {
      const req = await buildRequest(jobParts[jobId] ?? [], jobStock[jobId] ?? [], mode, custom);
      const run = await nestApi.start(req);
      setNest(jobId, (n) => n && { ...n, run });
      void pollNest(jobId, run.id);
    } catch (e) {
      setNest(jobId, (n) => n && { ...n, error: (e as Error).message });
    }
  };
  const stopNest = async (jobId: string) => {
    const id = jobNest[jobId]?.run?.id;
    if (!id) return;
    setNest(jobId, (n) => n && n.run ? { ...n, run: { ...n.run, stopAsked: true } } : n);
    try { await nestApi.stop(id); } catch (e) { setToast((e as Error).message); }
  };
  const onJobTool = (_section: string, tool: string, custom?: CustomNestSettings) => {
    if (!job) return;
    if (tool === "fastNest") void startNest(job.id, "fast");
    else if (tool === "thoroughNest") void startNest(job.id, "thorough");
    else if (tool === "customNest") void startNest(job.id, "custom", custom);
  };

  return (
    <div className="app">
      <TabBar
        tabs={state.tabs}
        activeId={state.activeId}
        userName={USER_NAME}
        onActivate={(id) => dispatch({ type: "activate", id })}
        onClose={requestClose}
        onMenu={(id) => showView(id)}
        undo={undoState}
      />
      <div className={`body${drawer ? " has-drawer" : ""}`}>
        <Drawer
          showQty={rules.qtyFromName}
          mode={drawer}
          onMode={setDrawer}
          targetJob={job}
          onAddToJob={(parts) => job && addParts(job.id, job.title, parts)}
          onJobSearch={runJobSearch}
          homeActive={!activeTab && state.view === "home"}
          onHome={() => showView("home")}
          importPanel={importPanel}
        />
        <div className="workspace">
          {active.kind === "job" ? <JobToolbar key={job?.id} onTool={onJobTool} />
            : active.kind !== "jobSearch" && active.kind !== "drawing" && active.kind !== "rules" && active.kind !== "settings" && <ToolStrip tools={toolsFor(active.kind)} onTool={onTool} />}
          <main className={`page${active.kind === "jobSearch" || active.kind === "drawing" || active.kind === "rules" || active.kind === "settings" ? " page-flush" : ""}`} aria-label={active.title}>
            {active.kind === "home" && <HomePage onAction={onHome} />}
            {active.kind === "job" && job && (
              <JobPage
                title={job.title}
                parts={jobParts[job.id]}
                stock={jobStock[job.id] ?? []}
                stockSettings={stockSettings}
                onStock={(st) => setJobStock((m) => ({ ...m, [job.id]: st }))}
                onDropParts={(parts) => addParts(job.id, job.title, parts)}
                onPart={(pid, patch) => setJobParts((m) => ({
                  ...m, [job.id]: (m[job.id] ?? []).map((jp) => (jp.part.id === pid ? { ...jp, ...patch } : jp)),
                }))}
                onNotice={setToast}
                onRemove={(pid) => setJobParts((m) => ({ ...m, [job.id]: (m[job.id] ?? []).filter((jp) => jp.part.id !== pid) }))}
                onOpenParts={() => setDrawer("parts")}
                nest={jobNest[job.id]}
                onStopNest={() => void stopNest(job.id)}
                onHideNest={() => setNest(job.id, (n) => (n && !n.error && !isFinished(n.run) ? n : undefined))}
              />
            )}
            {active.kind === "jobSearch" && (
              <JobSearchPage filter={jobSearch.filter} run={jobSearch.run} onOpenJob={openJob}
                onShowFilters={() => setDrawer("jobs")} />
            )}
            {shownItem?.drawing && (
              <ErrorBoundary key={shownItem.id} what={shownItem.name}>
              <ImportPage key={shownItem.id}
                drawing={shownItem.drawing}
                processed={shownItem.processed}
                properties={importProps}
                nestRules={{ rotations: importProps.rotations, mirror: importProps.mirror, filler: importProps.filler }}
                onProcess={() => setProcessing(shownItem.id)}
                onProperties={() => { setDrawer("import"); setPropsOpen(true); }}
                onNestRules={(r) => setImportProps((p) => ({ ...p, rotations: r.rotations, mirror: r.mirror, filler: r.filler }))}
                mirrorBlocked={mirrorBlocked(shownItem, rules)}
                onEdit={(drawing, label) => editDrawing(shownItem.id, shownItem.drawing!, drawing, label)}
                undone={undone} />
              </ErrorBoundary>
            )}
            {active.kind === "rules" && <RulesPage rules={rules} onChange={(r) => {
              setRules(r);
              // a list that has not been touched yet follows the new defaults
              if (imports.length === 0) setImportProps((p) => ({ ...p, rotations: [...r.defaultRotations], mirror: r.mirrorWithoutOpenCut, filler: r.defaultFiller }));
            }} />}
            {active.kind === "settings" && <SettingsPage stock={stockSettings} onStock={setStockSettings} />}
            {active.kind !== "home" && active.kind !== "job" && active.kind !== "jobSearch" && active.kind !== "drawing" && active.kind !== "rules" && active.kind !== "settings" && <PlaceholderPage tab={active} />}
          </main>
        </div>
      </div>
      {processingItem?.drawing && (
        <ProcessDialog
          drawing={processingItem.drawing}
          initial={{
            ...importProps,
            name: processingItem.name,
          }}
          mirrorBlocked={mirrorBlocked(processingItem, rules)}
          onCancel={() => setProcessing(null)}
          onSave={async (v, replace) => {
            const [r] = await api.saveParts([toSave(processingItem, v, replace)], processingItem.fileName);
            if (r?.status === "exists") throw new Error("a part with this project and name was just saved by someone else; check again");
            setProcessing(null);
            carryOver({ ...v, rotations: [...v.rotations] });
            dropSaved([processingItem.id]);
            setToast(`${r?.status === "replaced" ? "Replaced" : "Saved"} ${v.name.trim()} in the database`);
          }}
        />
      )}
      {closingItem && (
        <CloseUnsavedDialog name={closingItem.name} canProcess={statusOf(closingItem).openContours === 0}
          onCancel={() => setClosing(null)}
          onDiscard={() => closeWithoutSaving(closingItem.id)}
          onProcess={() => { setClosing(null); setProcessing(closingItem.id); }} />
      )}
      {removing && (
        <ConfirmDialog title={removing.length === 1 ? "Remove without saving?" : "Clear the list?"}
          confirmLabel={removing.length === 1 ? "Remove" : "Clear list"}
          onCancel={() => setRemoving(null)}
          onConfirm={() => { removeNow(removing); setRemoving(null); }}>
          {removingChanged.length === 1
            ? <><b>{removingChanged[0].name}</b> has changes that are not saved in the database. They are lost when it leaves the list.</>
            : <>{removingChanged.length} parts have changes that are not saved in the database. They are lost when they leave the list.</>}
        </ConfirmDialog>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
      <div id="drag-ghost" className="drag-ghost" aria-hidden="true" />
    </div>
  );
}
