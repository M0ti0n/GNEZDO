import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { api, demoMode } from "./api/api";
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
import { applyRules, loadRules, saveRules, type ImportRules, type Rotation } from "./import/rules";
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
import { buildRequest, countsOf, isFinished, nestApi, nestProblem, nestsOfJob, solutionsFromSaved, type NestMode, type NestRun, type NestedSheet, type Solution } from "./job/nest";
import { CustomNestDialog, type CustomNestSettings } from "./components/CustomNestDialog";
import { NestPage, type NestSelection } from "./components/NestView";
import { EDIT_PART_EVENT, drawingOfPart } from "./import/partFile";
import { loadLocalMachines, machineOf, normalizeMachines, saveLocalMachines, type MachineList } from "./job/machine";
import { NewJobDialog, SaveAsDialog } from "./components/NewJobDialog";
import { setMachineLimit } from "./job/stock";
import { exportSolutionDxf } from "./job/exportNest";
import { loadStockSettings, saveStockSettings, type StockSettings, type StockSheet } from "./job/stock";
import { SettingsPage } from "./pages/SettingsPage";
import { HistoryStore, undoKey, type UndoState } from "./state/history";
import type { Drawing } from "./import/geometry";
import { VIEW_TITLE, drawingTab, initialShell, jobTab, shellReducer, type PageKind, type Tab, type ViewKind } from "./state/tabs";

const USER_NAME = "Fab"; // until sign-in exists

/** What saving a job keeps, as text: the same text means nothing to save. */
const snapOf = (parts: JobPart[], stock: StockSheet[], sols: Solution[], machine: string) =>
  JSON.stringify({ p: parts.map((jp) => [jp.part.id, jp.qty, jp.qtyMax, jp.no, jp.part.material, jp.part.thicknessMm]), stock, n: nestsOfJob(sols, null)?.solutions ?? [], machine });

export function App() {
  const [state, dispatch] = useReducer(shellReducer, initialShell);
  const [drawer, setDrawer] = useState<DrawerMode | null>(null);
  const [jobParts, setJobParts] = useState<Record<string, JobPart[] | undefined>>({});
  const [jobStock, setJobStock] = useState<Record<string, StockSheet[]>>({});
  // the nest going on or the last one, per job tab
  // every nesting run of a job tab ("solutions"), the one shown, and which screen the tab shows
  const [jobSol, setJobSol] = useState<Record<string, { list: Solution[]; sel: NestSelection } | undefined>>({});
  const [jobScreen, setJobScreen] = useState<Record<string, "parts" | "nest" | undefined>>({});
  const [customFor, setCustomFor] = useState<string | null>(null);
  const [stockSettings, setStockSettingsState] = useState<StockSettings>(loadStockSettings);
  // machines: shared on the server (the browser keeps a copy, and is all there is in the demo)
  const [machines, setMachinesState] = useState<MachineList>(loadLocalMachines);
  const setMachines = (m: MachineList) => {
    setMachinesState(m);
    saveLocalMachines(m);
    api.saveSetting("machines", m).catch((e) => setToast(`Machines not saved on the server: ${(e as Error).message}`));
  };
  useEffect(() => {
    api.setting<MachineList>("machines").then((v) => {
      const m = normalizeMachines(v);
      if (m) { setMachinesState(m); saveLocalMachines(m); }
      else if (!demoMode) void api.saveSetting("machines", machines).catch(() => {});  // first time: this browser's list
    }).catch(() => { /* server without settings: the browser's list */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // the machine each job tab is nested for
  const [jobMachine, setJobMachine] = useState<Record<string, string>>({});
  // each job tab as it was opened or last saved, to tell unsaved changes on closing
  const [savedSnap, setSavedSnap] = useState<Record<string, string>>({});
  const machineFor = (jobId: string | undefined) => machineOf(machines, jobId ? jobMachine[jobId] : undefined);
  const [newJobOpen, setNewJobOpen] = useState<string | null>(null);   // the name offered
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
    else {
      // a saved job brings its stock sheets, machine and solutions back (an older server: parts only)
      Promise.all([api.jobParts(id), api.job(id).catch(() => null)]).then(([p, d]) => {
        const parts = p.map((jp, i) => ({ ...jp, no: jp.no || i + 1, qtyMax: Math.max(jp.qty, jp.qtyMax ?? jp.qty) }));
        const stock = d && Array.isArray(d.stock) ? d.stock as StockSheet[] : [];
        const sols = d ? solutionsFromSaved(d.nest) : null;
        let machine = d?.machine || undefined;
        if (machine && !machines.list.some((x) => x.id === machine)) {
          setToast(`This job was nested for a machine that is no longer in Settings: it shows ${machineOf(machines, undefined).name}`);
          machine = undefined;
        }
        setJobParts((m) => ({ ...m, [id]: parts }));
        setJobStock((m) => ({ ...m, [id]: stock }));
        if (machine) setJobMachine((m) => ({ ...m, [id]: machine! }));
        if (sols) setJobSol((m) => ({ ...m, [id]: sols }));
        setSavedSnap((m) => ({ ...m, [id]: snapOf(parts, stock, sols?.list ?? [], machineOf(machines, machine).id) }));
      }).catch((e) => setToast(`Could not open the job: ${(e as Error).message}`));
    }
  }, [active, jobParts]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  // New job: a pop-up asks for its name and machine first
  const newJob = useCallback(() => {
    const n = newJobCount.current + 1;
    setNewJobOpen(n === 1 ? "New job" : `New job ${n}`);
  }, []);
  const createJob = (name: string, machineId: string) => {
    newJobCount.current += 1;
    const id = `new-${newJobCount.current}`;
    setJobMachine((m) => ({ ...m, [id]: machineId }));
    setNewJobOpen(null);
    dispatch({ type: "open", tab: jobTab(id, name) });
  };

  const openImport = () => setDrawer("import");

  // EDIT on a saved part (Part properties, right click in the part list): the part opens on the
  // importer canvas with its own properties; Process saves it back (replacing it, the old version kept).
  useEffect(() => {
    const onEdit = async (ev: Event) => {
      const part = (ev as CustomEvent<PartSummary>).detail;
      try {
        const [drawing, detail] = await Promise.all([drawingOfPart(part), api.part(part.id)]);
        const item: ImportItem = {
          id: `imp-db-${part.id}-${Date.now().toString(36)}`, fileName: `${part.name}.dxf`, name: part.name, qty: null,
          state: "ready", drawing, checked: true, processed: false,
          source: {
            partId: part.id, name: part.name, project: part.project, description: part.description, material: part.material,
            thicknessMm: String(part.thicknessMm), rotations: detail.rotations as Rotation[], mirror: detail.mirror, filler: detail.filler,
          },
        };
        setImports((list) => [...list, item]);
        setDrawer("import");
        dispatch({ type: "open", tab: drawingTab(item.id, item.name) });
      } catch (e) {
        setToast(`Could not open ${part.name}: ${(e as Error).message}`);
      }
    };
    window.addEventListener(EDIT_PART_EVENT, onEdit);
    return () => window.removeEventListener(EDIT_PART_EVENT, onEdit);
  }, []);

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
          // a part opened from the database (EDIT) is saved back over itself, with its own values
          if (i.source) return toSave(i, { ...i.source, rotations: [...i.source.rotations] }, true);
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
  const requestClose = (tabId: string, force = false) => {
    const t = state.tabs.find((x) => x.id === tabId);
    const itemId = t?.kind === "drawing" ? t.drawingId : undefined;
    if (itemId && history.changed(itemId)) {
      dispatch({ type: "activate", id: tabId });
      setClosing(itemId);
      return;
    }
    if (itemId) history.forget(itemId);
    const jid = t?.kind === "job" ? t.jobId : undefined;
    if (jid && !force && jobDirty(jid)) {
      dispatch({ type: "activate", id: tabId });
      setClosingJob({ jobId: jid, title: t!.title });
      return;
    }
    // a closed job tab forgets what it held: opened again, it shows the job as saved; its running
    // nest stops (nothing would show or keep its result)
    if (jid) {
      for (const x of solsOf(jid).list) if (x.run && !isFinished(x.run) && !x.error) void nestApi.stop(x.run.id).catch(() => {});
      const drop = <T,>(m: Record<string, T>) => { const n = { ...m }; delete n[jid]; return n; };
      setJobParts(drop); setJobStock(drop); setJobSol(drop); setJobScreen(drop); setJobServerId(drop); setJobMachine(drop); setSavedSnap(drop);
    }
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

  // Nesting: every run is a solution of the job tab. Start one, ask the server how it goes once a
  // second, show it in the SOLUTIONS panel; Qty nested follows the solution shown.
  const solsOf = (jobId: string) => jobSol[jobId] ?? { list: [], sel: { sol: null, sheet: 0 } };
  const setSols = (jobId: string, f: (s: { list: Solution[]; sel: NestSelection }) => { list: Solution[]; sel: NestSelection }) =>
    setJobSol((m) => ({ ...m, [jobId]: f(m[jobId] ?? { list: [], sel: { sol: null, sheet: 0 } }) }));
  const patchSol = (jobId: string, id: string, f: (s: Solution) => Solution) =>
    setSols(jobId, (st) => ({ ...st, list: st.list.map((x) => (x.id === id ? f(x) : x)) }));
  const pollNest = async (jobId: string, solId: string, runId: string) => {
    for (let fails = 0; ;) {
      await new Promise((r) => setTimeout(r, 1000));
      let run: NestRun;
      try { run = await nestApi.get(runId); fails = 0; } catch (e) {
        // a moment without the server (busy, restarting) is not a failed nest: give up after 10 tries
        if (++fails < 10) continue;
        patchSol(jobId, solId, (x) => ({ ...x, error: (e as Error).message }));
        return;
      }
      patchSol(jobId, solId, (x) => ({ ...x, run }));
      if (isFinished(run)) {
        // a finished solution with sheets is shown
        if (run.result?.sheets.length) setSols(jobId, (st) => ({ ...st, sel: { sol: solId, sheet: 0 } }));
        return;
      }
    }
  };
  const startNest = async (jobId: string, mode: NestMode, custom?: CustomNestSettings) => {
    const st = solsOf(jobId);
    if (st.list.some((x) => !x.error && !isFinished(x.run))) { setToast("A solution is running; start the next one when it is done"); return; }
    const problem = nestProblem(jobParts[jobId], jobStock[jobId] ?? []);
    if (problem) { setToast(problem); return; }
    const id = `sol${Date.now().toString(36)}`;
    const no = Math.max(0, ...st.list.map((x) => x.no)) + 1;
    // the sheets shown stay until the new solution has some
    setSols(jobId, (s0) => {
      const shown = s0.list.find((x) => x.id === s0.sel.sol)?.run?.result?.sheets.length;
      return { list: [...s0.list, { id, no, mode, custom, run: null, startedAt: Date.now(), locked: [], origin: machineFor(jobId).origin, machine: machineFor(jobId).id }], sel: shown ? s0.sel : { sol: id, sheet: 0 } };
    });
    setJobScreen((m) => ({ ...m, [jobId]: "nest" }));
    try {
      const req = await buildRequest(jobParts[jobId] ?? [], jobStock[jobId] ?? [], mode, custom, machineFor(jobId).origin);
      const run = await nestApi.start(req);
      patchSol(jobId, id, (x) => ({ ...x, run }));
      void pollNest(jobId, id, run.id);
    } catch (e) {
      patchSol(jobId, id, (x) => ({ ...x, error: (e as Error).message }));
    }
  };
  const stopNest = async (jobId: string, solId: string) => {
    const runId = solsOf(jobId).list.find((x) => x.id === solId)?.run?.id;
    if (!runId) return;
    patchSol(jobId, solId, (x) => (x.run ? { ...x, run: { ...x.run, stopAsked: true } } : x));
    try { await nestApi.stop(runId); } catch (e) { setToast((e as Error).message); }
  };
  // Saving a job (Work parts SAVE / SAVE AS; until those buttons exist, Ctrl+S): parts with their
  // quantities, the stock sheets and every finished solution. A new job gets its database id on the first save.
  const [jobServerId, setJobServerId] = useState<Record<string, string>>({});
  const [closingJob, setClosingJob] = useState<{ jobId: string; title: string } | null>(null);
  const [removingSol, setRemovingSol] = useState<{ jobId: string; id: string } | null>(null);
  /** Unsaved changes: the job differs from how it was opened or last saved (a new job: once it has parts). */
  const jobDirty = (jobId: string) => {
    const parts = jobParts[jobId];
    if (!parts) return false;
    const now = snapOf(parts, jobStock[jobId] ?? [], solsOf(jobId).list, machineFor(jobId).id);
    const saved = savedSnap[jobId];
    return saved === undefined ? parts.length > 0 || (jobStock[jobId] ?? []).length > 0 : saved !== now;
  };
  // SAVE writes over the job (a new one is created on its first save); SAVE AS makes a new job under
  // another name, and the tab goes on as that new job.
  const saveJob = async (jobId: string, title: string, asNew = false) => {
    const parts = jobParts[jobId];
    if (!parts) { setToast("The job is still loading"); return false; }
    const known = jobServerId[jobId] ?? (jobId.startsWith("new-") ? null : jobId);
    const serverId = asNew ? null : known;
    const st = solsOf(jobId);
    try {
      const r = await api.saveJob(serverId, { name: title, parts, stock: jobStock[jobId] ?? [], nest: nestsOfJob(st.list, st.sel.sol), modifiedBy: USER_NAME, machine: machineFor(jobId).id });
      if (!serverId) setJobServerId((m) => ({ ...m, [jobId]: r.id }));
      if (asNew) dispatch({ type: "rename", id: `job:${jobId}`, title });
      setSavedSnap((m) => ({ ...m, [jobId]: snapOf(parts, jobStock[jobId] ?? [], st.list, machineFor(jobId).id) }));
      setToast(`${asNew ? `Saved as ${title}` : "Job saved"}${r.sheetCount ? ` with ${r.sheetCount} ${r.sheetCount === 1 ? "sheet" : "sheets"}` : ""}`);
    } catch (e) {
      setToast(`Not saved: ${(e as Error).message}`);
      return false;
    }
    return true;
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "s" || !job) return;
      e.preventDefault();
      void saveJob(job.id, job.title);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Another machine for a job: of another technology (laser -> plasma, ...) its solutions are out of
  // date and it has to be nested again; of the same one they stay, with a reminder to check the gaps.
  // Another machine for a job: gaps, cutting area, materials and thicknesses all change with it, so
  // the stock and the solutions go (asked first when there are any); the name and part list stay.
  const [machineAsk, setMachineAsk] = useState<{ jobId: string; id: string } | null>(null);
  const changeMachine = (jobId: string, id: string, confirmed = false) => {
    if (machineFor(jobId).id === id) return;
    const has = (jobStock[jobId] ?? []).length > 0 || solsOf(jobId).list.length > 0;
    if (solsOf(jobId).list.some((x) => !isFinished(x.run) && !x.error)) { setToast("A solution is running: stop it first"); setMachineAsk(null); return; }
    if (has && !confirmed) { setMachineAsk({ jobId, id }); return; }
    setJobMachine((m) => ({ ...m, [jobId]: id }));
    setJobStock((m) => ({ ...m, [jobId]: [] }));
    setJobSol((m) => ({ ...m, [jobId]: undefined }));
    setJobScreen((m) => ({ ...m, [jobId]: "parts" }));
    setMachineAsk(null);
  };
  // closing the browser window with unsaved jobs: the browser asks first
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (!state.tabs.some((t) => t.kind === "job" && t.jobId && jobDirty(t.jobId))) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  });
  const [saveAsFor, setSaveAsFor] = useState<{ jobId: string; name: string } | null>(null);
  // the cutting area that the STOCK panel checks: the shown job's machine
  // (set while rendering, before the STOCK panel and the dialogs check sizes against it)
  { const m = machineFor(job?.id); setMachineLimit(m.cutLengthMm, m.cutWidthMm); }

  // One nested sheet changed by hand (its own size, trims, gap, cut number): only that sheet changes.
  const editSheet = (jobId: string, solId: string, index: number, patch: Partial<NestedSheet>) => {
    const sheets = solsOf(jobId).list.find((x) => x.id === solId)?.run?.result?.sheets;
    const stockOf = sheets?.[index] && (jobStock[jobId] ?? []).find((s) => s.id === sheets[index].sheetId);
    if (sheets && stockOf && !stockOf.unlimited && patch.cutNumber !== undefined) {
      const used = sheets.reduce((n, sh, i) => n + (sh.sheetId === stockOf.id ? (i === index ? patch.cutNumber! : sh.cutNumber ?? 1) : 0), 0);
      if (used > stockOf.qty) setToast(`The layouts now need ${used} of this stock sheet; the stock has ${stockOf.qty}`);
    }
    patchSol(jobId, solId, (x) => x.run?.result ? {
      ...x, run: { ...x.run, result: { ...x.run.result, sheets: x.run.result.sheets.map((sh, i) => (i === index ? { ...sh, ...patch } : sh)) } },
    } : x);
  };
  // Re-nest this sheet: its parts nested again on it alone (the other sheets stay as they are)
  const [renesting, setRenesting] = useState<string | null>(null);   // "solId:index"
  const renestSheet = async (jobId: string, solId: string, index: number) => {
    const sol = solsOf(jobId).list.find((x) => x.id === solId);
    const sh = sol?.run?.result?.sheets[index];
    if (!sol || !sh) return;
    const counts = new Map<string, number>();
    for (const p of sh.parts) counts.set(p.partId, (counts.get(p.partId) ?? 0) + 1);
    const jparts = (jobParts[jobId] ?? []).filter((jp) => counts.has(jp.part.id)).map((jp) => ({ ...jp, qty: counts.get(jp.part.id)! }));
    const m = machineFor(jobId);
    setRenesting(`${solId}:${index}`);
    try {
      const req = await buildRequest(jparts, [], "fast", undefined, sol.origin ?? m.origin);
      req.sheets = [{ id: sh.sheetId, material: sh.material, thicknessMm: sh.thicknessMm, lengthMm: sh.lengthMm, widthMm: sh.widthMm,
        qty: 1, source: "nested", trims: sh.trims ?? { ...m.trims }, partGapMm: sh.partGapMm ?? m.partGapMm, kerfMm: sh.kerfMm, outline: sh.outline }];
      let run = await nestApi.start(req);
      while (!isFinished(run)) { await new Promise((r) => setTimeout(r, 1000)); run = await nestApi.get(run.id); }
      const out = run.result?.sheets[0];
      const placed = out?.parts.length ?? 0;
      if (!out || placed < sh.parts.length) {
        setToast(`Only ${placed} of ${sh.parts.length} parts fit on this sheet: it is kept as it was`);
        return;
      }
      editSheet(jobId, solId, index, { parts: out.parts });
      setToast(`Sheet ${index + 1} nested again`);
    } catch (e) {
      setToast(`Not nested again: ${(e as Error).message}`);
    } finally {
      setRenesting(null);
    }
  };

  /** Pieces per part of the solution shown. */
  const nestedCounts = (jobId: string): Record<string, number> | null => {
    const st = jobSol[jobId];
    if (!st) return null;
    const done = (x: Solution) => !!x.run?.result && (x.run.state === "done" || x.run.state === "stopped");
    const sol = st.list.find((x) => x.id === st.sel.sol && done(x));
    // every sheet's parts times its cut number (how many times that layout is cut)
    return sol?.run?.result ? countsOf(sol.run.result.sheets) : null;
  };
  // GNEZDO menu -> Export solution to DXF: the solution shown in the job tab, every sheet in one file
  const shownSolution = () => {
    if (!job) return null;
    const st = jobSol[job.id];
    const sol = st?.list.find((x) => x.id === st.sel.sol);
    return sol?.run?.result?.sheets.length && (sol.run.state === "done" || sol.run.state === "stopped") ? sol : null;
  };
  const exportProblem = () => (!job ? "Open a job to export its solution" : !shownSolution() ? "Nest the job first: the solution shown is exported" : null);
  const exportDxf = async () => {
    const sol = shownSolution();
    if (!job || !sol) return;
    try {
      await exportSolutionDxf({ jobName: job.title, solutionNo: sol.no, sheets: sol.run!.result!.sheets, parts: jobParts[job.id] ?? [], origin: sol.origin ?? machineFor(job.id).origin });
      setToast(`Solution ${sol.no} exported to DXF`);
    } catch (e) {
      setToast(`Not exported: ${(e as Error).message}`);
    }
  };
  const onJobTool = (_section: string, tool: string, custom?: CustomNestSettings) => {
    if (!job) return;
    if (tool === "fastNest") void startNest(job.id, "fast");
    else if (tool === "thoroughNest") void startNest(job.id, "thorough");
    else if (tool === "customNest") { if (custom) void startNest(job.id, "custom", custom); else setCustomFor(job.id); }
  };

  return (
    <div className="app">
      <TabBar
        tabs={state.tabs}
        activeId={state.activeId}
        userName={USER_NAME}
        onActivate={(id) => dispatch({ type: "activate", id })}
        onClose={(id) => requestClose(id)}
        onMenu={(id) => (id === "exportDxf" ? void exportDxf() : showView(id))}
        menuOff={{ exportDxf: exportProblem() ?? undefined }}
        undo={undoState}
        save={job ? { onSave: () => void saveJob(job.id, job.title), onSaveAs: () => setSaveAsFor({ jobId: job.id, name: `${job.title} copy` }) } : null}
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
          {active.kind === "job" ? <JobToolbar key={job?.id} onTool={onJobTool}
            onSection={(sec) => job && sec && setJobScreen((m) => ({ ...m, [job.id]: sec === "work" ? "parts" : sec === "auto" || sec === "manual" ? "nest" : m[job.id] }))} />
            : active.kind !== "jobSearch" && active.kind !== "drawing" && active.kind !== "rules" && active.kind !== "settings" && <ToolStrip tools={toolsFor(active.kind)} onTool={onTool} />}
          <main className={`page${active.kind === "jobSearch" || active.kind === "drawing" || active.kind === "rules" || active.kind === "settings" ? " page-flush" : ""}`} aria-label={active.title}>
            {active.kind === "home" && <HomePage onAction={onHome} />}
            {active.kind === "job" && job && jobScreen[job.id] === "nest" && (
              <NestPage
                parts={jobParts[job.id] ?? []}
                solutions={solsOf(job.id).list}
                selected={solsOf(job.id).sel}
                onSelect={(sel) => setSols(job.id, (st) => ({ ...st, sel }))}
                onAdd={(mode) => (mode === "custom" ? setCustomFor(job.id) : void startNest(job.id, mode))}
                onStop={(id) => void stopNest(job.id, id)}
                onRemove={(id) => setRemovingSol({ jobId: job.id, id })}
                machine={machineFor(job.id)}
                stock={jobStock[job.id] ?? []}
                renesting={renesting}
                onEditSheet={(id, i, patch) => editSheet(job.id, id, i, patch)}
                onRenestSheet={(id, i) => void renestSheet(job.id, id, i)}
                onToggleLock={(id, i) => patchSol(job.id, id, (x) => ({ ...x, locked: x.locked.includes(i) ? x.locked.filter((n) => n !== i) : [...x.locked, i] }))}
              />
            )}
            {active.kind === "job" && job && jobScreen[job.id] !== "nest" && (
              <JobPage
                title={job.title}
                parts={(() => {
                  const counts = nestedCounts(job.id);
                  const list = jobParts[job.id];
                  return counts && list ? list.map((jp) => ({ ...jp, nested: counts[jp.part.id] ?? 0 })) : list;
                })()}
                stock={jobStock[job.id] ?? []}
                stockSettings={stockSettings}
                onStock={(st) => setJobStock((m) => ({ ...m, [job.id]: st }))}
                onDropParts={(parts) => addParts(job.id, job.title, parts)}
                onPart={(pid, patch) => setJobParts((m) => ({
                  ...m, [job.id]: (m[job.id] ?? []).map((jp) => (jp.part.id === pid ? { ...jp, ...patch } : jp)),
                }))}
                onNotice={setToast}
                machine={machineFor(job.id)}
                machines={machines}
                onMachine={(id) => changeMachine(job.id, id)}
                onRemove={(pid) => setJobParts((m) => ({ ...m, [job.id]: (m[job.id] ?? []).filter((jp) => jp.part.id !== pid) }))}
                onOpenParts={() => setDrawer("parts")}
              />
            )}
            {machineAsk && (
              <ConfirmDialog title="Change the machine?" confirmLabel={`Change to ${machineOf(machines, machineAsk.id).name}`}
                onCancel={() => setMachineAsk(null)} onConfirm={() => changeMachine(machineAsk.jobId, machineAsk.id, true)}>
                Gaps, cutting area, materials and thicknesses come from the machine, so the <b>stock sheets and all solutions</b> of this job are cleared
                and it has to be nested again. The job name and the work part list stay.
              </ConfirmDialog>
            )}
            {closingJob && (
              <div className="dlg-backdrop" role="presentation">
                <div className="dlg close-dlg" role="alertdialog" aria-modal="true" aria-labelledby="cj-title">
                  <header className="dlg-head"><span className="dlg-icon close-dlg-icon" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 2 20h20L12 3z" /><path d="M12 10v4" /><circle cx="12" cy="17" r=".6" fill="currentColor" /></svg></span><div className="dlg-title"><h2 id="cj-title">Close without saving?</h2></div></header>
                  <p className="close-dlg-text"><b>{closingJob.title}</b> has changes that are not saved: parts, stock, machine or solutions.
                    {solsOf(closingJob.jobId).list.some((x) => !isFinished(x.run) && !x.error) ? " Its running nest stops." : ""}</p>
                  <footer className="dlg-foot">
                    <span className="proc-missing" />
                    <button type="button" className="btn btn-plain" onClick={() => setClosingJob(null)}>Cancel</button>
                    <button type="button" className="btn btn-plain" onClick={() => { const c = closingJob; setClosingJob(null); requestClose(`job:${c.jobId}`, true); }}>Don't save</button>
                    <button type="button" className="btn btn-save" autoFocus onClick={async () => {
                      const c = closingJob; setClosingJob(null);
                      if (await saveJob(c.jobId, c.title)) requestClose(`job:${c.jobId}`, true);
                    }}>Save and close</button>
                  </footer>
                </div>
              </div>
            )}
            {removingSol && (
              <ConfirmDialog title={`Remove solution ${solsOf(removingSol.jobId).list.find((x) => x.id === removingSol.id)?.no ?? ""}?`} confirmLabel="Remove"
                onCancel={() => setRemovingSol(null)}
                onConfirm={() => {
                  const { jobId, id } = removingSol; setRemovingSol(null);
                  setSols(jobId, (st) => ({ list: st.list.filter((x) => x.id !== id),
                    sel: st.sel.sol === id ? { sol: st.list.filter((x) => x.id !== id).at(-1)?.id ?? null, sheet: 0 } : st.sel }));
                }}>
                Its sheets are gone from the job (the saved job keeps it until the job is saved again).
              </ConfirmDialog>
            )}
            {saveAsFor && (
              <SaveAsDialog name={saveAsFor.name} onCancel={() => setSaveAsFor(null)}
                onSave={(name) => { const j = saveAsFor.jobId; setSaveAsFor(null); void saveJob(j, name, true); }} />
            )}
            {newJobOpen && <NewJobDialog defaultName={newJobOpen} machines={machines} onCreate={createJob} onCancel={() => setNewJobOpen(null)} />}
            {customFor && (
              <CustomNestDialog onCancel={() => setCustomFor(null)}
                onStart={(c) => { const id = customFor; setCustomFor(null); void startNest(id, "custom", c); }} />
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
                properties={shownItem.source ? { ...importProps, ...shownItem.source } : importProps}
                nestRules={shownItem.source
                  ? { rotations: shownItem.source.rotations, mirror: shownItem.source.mirror, filler: shownItem.source.filler }
                  : { rotations: importProps.rotations, mirror: importProps.mirror, filler: importProps.filler }}
                onProcess={() => setProcessing(shownItem.id)}
                onProperties={() => { setDrawer("import"); setPropsOpen(true); }}
                onNestRules={(r) => shownItem.source
                  // a part from the database: its own rules change, not the batch's
                  ? patchItem(shownItem.id, { source: { ...shownItem.source, rotations: r.rotations, mirror: r.mirror, filler: r.filler } })
                  : setImportProps((p) => ({ ...p, rotations: r.rotations, mirror: r.mirror, filler: r.filler }))}
                mirrorBlocked={mirrorBlocked(shownItem, rules)}
                fromDatabase={!!shownItem.source}
                onEdit={(drawing, label) => editDrawing(shownItem.id, shownItem.drawing!, drawing, label)}
                undone={undone} />
              </ErrorBoundary>
            )}
            {active.kind === "rules" && <RulesPage rules={rules} onChange={(r) => {
              setRules(r);
              // a list that has not been touched yet follows the new defaults
              if (imports.length === 0) setImportProps((p) => ({ ...p, rotations: [...r.defaultRotations], mirror: r.mirrorWithoutOpenCut, filler: r.defaultFiller }));
            }} />}
            {active.kind === "settings" && <SettingsPage stock={stockSettings} onStock={setStockSettings} machines={machines} onMachines={setMachines} shared={!demoMode} />}
            {active.kind !== "home" && active.kind !== "job" && active.kind !== "jobSearch" && active.kind !== "drawing" && active.kind !== "rules" && active.kind !== "settings" && <PlaceholderPage tab={active} />}
          </main>
        </div>
      </div>
      {processingItem?.drawing && (
        <ProcessDialog
          drawing={processingItem.drawing}
          initial={processingItem.source ? { ...processingItem.source, rotations: [...processingItem.source.rotations] } : {
            ...importProps,
            name: processingItem.name,
          }}
          mirrorBlocked={mirrorBlocked(processingItem, rules)}
          onCancel={() => setProcessing(null)}
          onSave={async (v, replace) => {
            const [r] = await api.saveParts([toSave(processingItem, v, replace)], processingItem.fileName);
            if (r?.status === "exists") throw new Error("a part with this project and name was just saved by someone else; check again");
            setProcessing(null);
            // a part opened from the database keeps its own values; they do not become the batch's
            if (!processingItem.source) carryOver({ ...v, rotations: [...v.rotations] });
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
