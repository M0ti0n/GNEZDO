import { startDesktop } from "./api/desktop";
import { drafts, newDraftId, type DraftContent, type DraftRow } from "./api/drafts";
import { RestoreDialog } from "./components/RestoreDialog";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { api, demoMode } from "./api/api";
import type { JobFilter, JobPart, JobSummary, PartSummary } from "./api/types";
import { ImportPage } from "./pages/ImportPage";
import { sampleDrawings } from "./import/sampleDrawing";
import { isDrawingFile, loadProperties, mirrorBlocked, mirrorFor, newItem, readItem, saveProperties, statusOf, type BatchProperties, type ImportItem } from "./import/batch";
import { draggingFiles, droppedFiles, droppedFolder } from "./import/dropped";
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
import { buildRequest, commonCutNote, continuedSheets, countsOf, isFinished, missingParts, nestApi, nestProblem, nestsOfJob, solutionsFromSaved, type NestMode, type NestRun, type NestedSheet, type Solution } from "./job/nest";
import { CustomNestDialog, type CustomNestSettings } from "./components/CustomNestDialog";
import { NestPage, type NestSelection } from "./components/NestView";
import { EDIT_PART_EVENT, drawingOfPart } from "./import/partFile";
import { loadLocalMachines, machineOf, normalizeMachines, saveLocalMachines, type MachineList } from "./job/machine";
import { NewJobDialog, SaveAsDialog } from "./components/NewJobDialog";
import { setMachineLimit } from "./job/stock";
import { exportSolutionDxf } from "./job/exportNest";
import { loadStockSettings, newSheet, saveStockSettings, type StockSettings, type StockSheet } from "./job/stock";
import { SheetPropertiesDialog } from "./components/SheetPropertiesDialog";
import { diag, flush, startDiag } from "./job/diag";
import { auth, SIGN_IN_NEEDED, type AuthState, type Me } from "./api/auth";
import { SignInPage } from "./components/SignInPage";
import { DatabaseSetupPage } from "./components/DatabaseSetup";
import { PasswordDialog, UsersDialog } from "./components/UsersDialog";
import { SettingsPage } from "./pages/SettingsPage";
import { HistoryStore, undoKey, type UndoState } from "./state/history";
import type { Drawing } from "./import/geometry";
import { VIEW_TITLE, drawingTab, initialShell, jobTab, shellReducer, type PageKind, type Tab, type ViewKind } from "./state/tabs";

const USER_NAME = "Fab"; // where there is no sign-in (the demo; the desktop build)

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
  const [customFor, setCustomFor] = useState<{ jobId: string; fresh: boolean } | null>(null);
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
    setImportProps({ project: v.project, description: v.description, material: v.material, thicknessMm: v.thicknessMm, rotations: [...v.rotations], mirror: v.mirror, filler: v.filler, commonCut: !!v.commonCut });
  const patchItem = (id: string, patch: Partial<ImportItem>) =>
    setImports((list) => list.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const [toast, setToastState] = useState<string | null>(null);
  // every message shown is in the diagnostic log too: it is what the user saw
  const setToast = (m: string | null) => { if (m) diag("toast", m); setToastState(m); };
  // -- sign-in (server build) ------------------------------------------------------------------
  const [authState, setAuthState] = useState<AuthState | null>(demoMode ? { required: false, setupNeeded: false, user: null } : null);
  const [me, setMe] = useState<Me | null>(null);
  const [accountDlg, setAccountDlg] = useState<"password" | "users" | null>(null);
  useEffect(() => { void auth.state().then((s) => { setAuthState(s); setMe(s.user); }); }, []);
  // desktop build: the PC's user is the name on saves and in the log
  const [deskUser, setDeskUser] = useState<string | null>(null);
  useEffect(() => { void startDesktop().then((u) => { if (u) setDeskUser(u); }); }, []);
  // a call answered "sign in first" (signed out elsewhere, removed, password changed): the sign-in page
  useEffect(() => {
    const on = () => { setMe(null); void auth.state().then((s) => { setAuthState(s); setMe(s.user); }); };
    window.addEventListener(SIGN_IN_NEEDED, on);
    return () => window.removeEventListener(SIGN_IN_NEEDED, on);
  }, []);
  // signed in during this page's life: a sign-in that ends later shows over the open work (nothing is lost)
  const signedInAs = useRef<string | null>(null);
  if (me) signedInAs.current = me.name;
  const userName = me?.name ?? signedInAs.current ?? deskUser ?? USER_NAME;
  const isAdmin = !authState?.required || !!me?.isAdmin;
  useEffect(() => { startDiag(userName); }, [userName]);
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
  const open = (tab: Tab) => { diag("tab", `Opened ${tab.kind}: ${tab.title}`); dispatch({ type: "open", tab }); };

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
            thicknessMm: String(part.thicknessMm), rotations: detail.rotations as Rotation[], mirror: detail.mirror, filler: detail.filler, commonCut: detail.commonCut,
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

  // A DXF / DWG (or a folder) dropped anywhere outside a drop area goes to the importer, as if dropped
  // on its list. Without this the browser opens the file itself: the page turns into the DXF's text
  // or, on a job, asks to leave the page and closes the job tab.
  const addFilesRef = useRef<(files: File[], openFirst: boolean) => void>(() => {});
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (!draggingFiles(e.dataTransfer)) return;
      if (!e.defaultPrevented) e.dataTransfer!.dropEffect = "copy";   // (a drop area sets its own)
      e.preventDefault();   // the browser does not open it
    };
    const drop = (e: DragEvent) => {
      if (!draggingFiles(e.dataTransfer)) return;
      const handled = e.defaultPrevented;   // a drop area (the import list, the stock's DXF) took it
      e.preventDefault();
      if (handled) return;
      const dt = e.dataTransfer!;
      const folder = droppedFolder(dt);
      void droppedFiles(dt).then((all) => {
        const files = all.filter(isDrawingFile);
        if (!files.length) { setToast("Only DXF and DWG files can be dropped into GNEZDO"); return; }
        setDrawer("import");
        addFilesRef.current(files, !folder && files.length === 1);
        diag("import", `${files.length} ${files.length === 1 ? "file" : "files"} dropped outside the import list: sent to the importer`);
      });
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => { window.removeEventListener("dragover", over); window.removeEventListener("drop", drop); };
  }, []);

  const addFiles = async (files: File[], openFirst: boolean) => {
    const fresh = files.map((f) => ({ file: f, item: newItem(f) }));
    setImports((list) => [...list, ...fresh.map((x) => x.item)]);
    const read = await Promise.all(fresh.map((x) => readItem(x.item, x.file, rules)));
    setImports((list) => list.map((i) => read.find((r) => r.id === i.id) ?? i));
    if (openFirst && read[0]?.state === "ready") openItem(read[0]);
    const failed = read.filter((r) => r.state === "failed").length;
    if (failed) setToast(`${failed} ${failed === 1 ? "file" : "files"} could not be read`);
  };
  addFilesRef.current = (f, o) => { void addFiles(f, o); };

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
    rotations: [...v.rotations], mirror: v.mirror, filler: v.filler, commonCut: !!v.commonCut,
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
      dropDraft(jid);   // closed without saving: its recovery copy goes too
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
  /** A run continuing a solution: its sheets merged into that solution's sheets. */
  const mergeRun = (run: NestRun, base: NestedSheet[] | undefined): NestRun => {
    if (!base) return run;
    const best = run.best ? { sheets: continuedSheets(base, run.best.sheets) } : run.best;
    const result = run.result ? (() => {
      const sheets = continuedSheets(base, run.result.sheets);
      const nested: Record<string, number> = {};
      for (const sh of sheets) for (const p of sh.parts) nested[p.partId] = (nested[p.partId] ?? 0) + 1;
      return { ...run.result, sheets, nested };
    })() : run.result;
    return { ...run, best, result };
  };
  const pollNest = async (jobId: string, solId: string, runId: string) => {
    for (let fails = 0; ;) {
      await new Promise((r) => setTimeout(r, 1000));
      let run: NestRun;
      try { run = await nestApi.get(runId); fails = 0; } catch (e) {
        // a moment without the server (busy, restarting) is not a failed nest: give up after 10 tries
        if (++fails < 10) continue;
        patchSol(jobId, solId, (x) => ({ ...x, error: (e as Error).message }));
        diag("error", `Nest ${runId}: no answer from the server (${(e as Error).message})`, { job: jobId });
        return;
      }
      patchSol(jobId, solId, (x) => {
        if (!x.base) return { ...x, run };
        if (!isFinished(run)) return { ...x, run: mergeRun(run, x.base) };
        // continuing a solution: done, the new layout replaces it; failed, it stays as it was
        if (run.result?.sheets && run.state !== "error") return { ...x, run: mergeRun(run, x.base), prev: undefined, base: undefined };
        setToast(`Solution ${x.no} not continued: ${run.error ?? run.result?.errors?.[0] ?? "the nest failed"}`);
        return { ...x, run: x.prev ?? null, prev: undefined, base: undefined };
      });
      if (isFinished(run)) {
        diag(run.state === "error" ? "error" : "nest", `Nest ${run.id} ${run.state} in ${Math.round(run.seconds)} s: ${run.result?.sheets.length ?? 0} sheets${run.result && !run.result.valid ? ", NOT VALID" : ""}`,
          { job: jobId, error: run.error, errors: run.result?.errors?.slice(0, 5), skipped: run.result?.skipped?.length, bestAt: run.result?.bestAt });
        // a finished solution with sheets is shown
        if (run.result?.sheets.length) setSols(jobId, (st) => ({ ...st, sel: { sol: solId, sheet: 0 } }));
        const cc = commonCutNote(run.result);
        if (cc) { setToast(cc.charAt(0).toUpperCase() + cc.slice(1)); diag("nest", `Nest ${run.id}: ${cc}`, { job: jobId }); }
        return;
      }
    }
  };
  // Fast / Thorough / Custom: with a finished solution selected, the nest continues it (what is on
  // its sheets stays, the parts still missing are added); without one, or with fresh (Add new
  // solution), a new solution from blank
  const startNest = async (jobId: string, mode: NestMode, custom?: CustomNestSettings, fresh = false) => {
    const st = solsOf(jobId);
    if (st.list.some((x) => !x.error && !isFinished(x.run))) { setToast("A solution is running; start the next one when it is done"); return; }
    const base = fresh ? undefined : st.list.find((x) => x.id === st.sel.sol && !x.error && !x.outdated && isFinished(x.run) && x.run?.result?.sheets.length);
    if (base) { void continueNest(jobId, base, mode, custom); return; }
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
      diag("nest", `Nest ${run.id} started: ${mode}${custom ? ` ${custom.minutes ?? "until stopped"} min ${custom.blocks ? "blocks" : "standard"}${custom.commonCut ? " common cut" : ""}` : ""}, new solution ${no}`,
        { job: jobId, partTypes: req.parts.length, pieces: req.parts.reduce((n, p) => n + p.qty, 0), stockSheets: req.sheets.length });
      patchSol(jobId, id, (x) => ({ ...x, run }));
      void pollNest(jobId, id, run.id);
    } catch (e) {
      diag("error", `Nest not started (${mode}): ${(e as Error).message}`, { job: jobId });
      patchSol(jobId, id, (x) => ({ ...x, error: (e as Error).message }));
    }
  };
  const continueNest = async (jobId: string, base: Solution, mode: NestMode, custom?: CustomNestSettings) => {
    const sheets = base.run!.result!.sheets;
    const parts = jobParts[jobId] ?? [];
    const missing = missingParts(parts, sheets);
    if (!missing.length) { setToast(`Solution ${base.no}: all parts are nested. For a new layout use Add new solution`); return; }
    const pathOf = new Map<string, string>(parts.map((jp) => [jp.part.id, jp.part.path]));
    // its sheets that may take more parts: not locked, cut once
    const fixed = sheets.flatMap((sh, index) => base.locked.includes(index) || (sh.cutNumber ?? 1) !== 1 ? [] : [{
      index, id: sh.sheetId, material: sh.material, thicknessMm: sh.thicknessMm, lengthMm: sh.lengthMm, widthMm: sh.widthMm,
      outline: sh.outline, trims: sh.trims, partGapMm: sh.partGapMm, kerfMm: sh.kerfMm,
      parts: sh.parts.flatMap((p) => { const path = pathOf.get(p.partId); return path ? [{ path, x: p.x, y: p.y, angle: p.angle, mirror: p.mirror }] : []; }),
    }]);
    const stock = jobStock[jobId] ?? [];
    const problem = nestProblem(missing, stock);
    if (problem && !fixed.some((f) => missing.some((jp) => jp.part.material.trim().toLowerCase() === f.material.trim().toLowerCase() && Math.abs(jp.part.thicknessMm - f.thicknessMm) < 1e-6))) {
      setToast(problem);
      return;
    }
    patchSol(jobId, base.id, (x) => ({ ...x, prev: x.run ?? undefined, base: sheets, run: null, mode, custom, startedAt: Date.now() }));
    setJobScreen((m) => ({ ...m, [jobId]: "nest" }));
    try {
      const req = await buildRequest(missing, stock, mode, custom, base.origin ?? machineFor(jobId).origin);
      req.fixedSheets = fixed;
      const run = await nestApi.start(req);
      diag("nest", `Nest ${run.id} started: ${mode}, continuing solution ${base.no} (${fixed.length} of its ${sheets.length} sheets open to more parts)`,
        { job: jobId, missingTypes: missing.length, pieces: missing.reduce((n, jp) => n + jp.qty, 0) });
      patchSol(jobId, base.id, (x) => ({ ...x, run }));
      void pollNest(jobId, base.id, run.id);
    } catch (e) {
      setToast(`Solution ${base.no} not continued: ${(e as Error).message}`);
      patchSol(jobId, base.id, (x) => ({ ...x, run: x.prev ?? null, prev: undefined, base: undefined }));
    }
  };
  const stopNest = async (jobId: string, solId: string) => {
    const runId = solsOf(jobId).list.find((x) => x.id === solId)?.run?.id;
    if (!runId) return;
    patchSol(jobId, solId, (x) => (x.run ? { ...x, run: { ...x.run, stopAsked: true } } : x));
    diag("nest", `Nest ${runId} stop asked`, { job: jobId });
    try { await nestApi.stop(runId); } catch (e) { setToast((e as Error).message); }
  };
  // Saving a job (Work parts SAVE / SAVE AS; until those buttons exist, Ctrl+S): parts with their
  // quantities, the stock sheets and every finished solution. A new job gets its database id on the first save.
  const [jobServerId, setJobServerId] = useState<Record<string, string>>({});
  const [closingJob, setClosingJob] = useState<{ jobId: string; title: string } | null>(null);
  const [removingSol, setRemovingSol] = useState<{ jobId: string; id: string } | null>(null);
  // Work parts -> remove a part that is on nested sheets: asked first (not nested: removed at once)
  const [removingPart, setRemovingPart] = useState<{ jobId: string; partId: string; name: string; sols: number[]; pieces: number } | null>(null);
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
      const r = await api.saveJob(serverId, { name: title, parts, stock: jobStock[jobId] ?? [], nest: nestsOfJob(st.list, st.sel.sol), modifiedBy: userName, machine: machineFor(jobId).id });
      if (!serverId) setJobServerId((m) => ({ ...m, [jobId]: r.id }));
      if (asNew) dispatch({ type: "rename", id: `job:${jobId}`, title });
      setSavedSnap((m) => ({ ...m, [jobId]: snapOf(parts, jobStock[jobId] ?? [], st.list, machineFor(jobId).id) }));
      diag("save", `Job ${title} saved${asNew ? " as new" : ""}`, { job: jobId, serverId: r.id, parts: parts.length, sheets: r.sheetCount, solutions: st.list.length });
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
  // ---- Restore unsaved work: a recovery copy of each job tab with unsaved changes, on the server
  // (the desktop: its data file), written every few seconds; offered back on the next start.
  const draftIds = useRef<Record<string, string>>({});      // job tab -> its copy
  const draftSnap = useRef<Record<string, string>>({});     // what was last written for it
  const restoredIds = useRef<Record<string, string>>({});   // restored tabs carry on with their copy
  const dropDraft = (jid: string) => {
    const id = draftIds.current[jid] ?? restoredIds.current[jid];
    delete draftIds.current[jid]; delete draftSnap.current[jid]; delete restoredIds.current[jid];
    if (id) void drafts.remove(id).catch(() => {});
  };
  const draftTick = useRef<() => void>(() => {});
  draftTick.current = () => {
    if (demoMode || !authState || (authState.required && !me)) return;
    const open = new Set<string>();
    for (const t of state.tabs) {
      if (t.kind !== "job" || !t.jobId) continue;
      const jid = t.jobId;
      open.add(jid);
      const parts = jobParts[jid];
      if (!parts) continue;
      if (!jobDirty(jid)) { if (draftIds.current[jid]) dropDraft(jid); continue; }
      const st = solsOf(jid), stock = jobStock[jid] ?? [], machine = machineFor(jid).id;
      const snap = `${t.title}\n${snapOf(parts, stock, st.list, machine)}`;
      if (draftSnap.current[jid] === snap) continue;
      const id = (draftIds.current[jid] ??= restoredIds.current[jid] ?? newDraftId());
      delete restoredIds.current[jid];
      draftSnap.current[jid] = snap;
      const content: DraftContent = {
        title: t.title, jobId: jobServerId[jid] ?? (jid.startsWith("new-") ? null : jid), machine,
        parts, stock, nest: nestsOfJob(st.list, st.sel.sol), screen: jobScreen[jid],
      };
      drafts.put(id, content).catch(() => { delete draftSnap.current[jid]; });   // tried again next time
    }
    for (const jid of Object.keys(draftIds.current)) if (!open.has(jid)) dropDraft(jid);
  };
  useEffect(() => {
    const t = window.setInterval(() => draftTick.current(), 4000);
    return () => window.clearInterval(t);
  }, []);
  // on start (signed in): copies left from last time
  const [restoreRows, setRestoreRows] = useState<DraftRow[] | null>(null);
  const restoreAsked = useRef(false);
  useEffect(() => {
    if (restoreAsked.current || demoMode || !authState || (authState.required && !me)) return;
    restoreAsked.current = true;
    drafts.list().then((r) => { if (r.length) setRestoreRows(r); }).catch(() => { /* an older server */ });
  }, [authState, me]);
  const doneWith = (ids: string[]) => setRestoreRows((rows) => {
    const left = (rows ?? []).filter((r) => !ids.includes(r.id));
    return left.length ? left : null;
  });
  const restoreDrafts = async (ids: string[]) => {
    doneWith(ids);
    const taken = new Set(state.tabs.map((t) => t.jobId).filter(Boolean));
    for (const id of ids) {
      try {
        const c = (await drafts.get(id)).content;
        // the saved job's own tab, unless it is open already: then a new tab, saving over that job
        const jid = c.jobId && !taken.has(c.jobId) ? c.jobId : `new-${++newJobCount.current}`;
        taken.add(jid);
        const sols = solutionsFromSaved(c.nest);
        setJobParts((m) => ({ ...m, [jid]: c.parts }));
        setJobStock((m) => ({ ...m, [jid]: c.stock ?? [] }));
        if (machines.list.some((x) => x.id === c.machine)) setJobMachine((m) => ({ ...m, [jid]: c.machine }));
        if (sols) setJobSol((m) => ({ ...m, [jid]: sols }));
        if (c.screen) setJobScreen((m) => ({ ...m, [jid]: c.screen }));
        if (c.jobId && jid !== c.jobId) setJobServerId((m) => ({ ...m, [jid]: c.jobId! }));
        setSavedSnap((m) => ({ ...m, [jid]: "restored" }));   // unsaved until SAVE
        restoredIds.current[jid] = id;
        dispatch({ type: "open", tab: jobTab(jid, c.title) });
        diag("save", `Restored unsaved job ${c.title}`, { job: jid, parts: c.parts.length, solutions: sols?.list.length ?? 0 });
      } catch (e) {
        setToast(`Could not restore: ${(e as Error).message}`);
      }
    }
  };
  const discardDrafts = (ids: string[]) => {
    doneWith(ids);
    for (const id of ids) void drafts.remove(id).catch(() => {});
  };

  // closing the browser window with unsaved jobs or a nest running: the browser asks first
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      const busy = (jid: string) => jobDirty(jid) || solsOf(jid).list.some((x) => x.run && !isFinished(x.run) && !x.error);
      if (!state.tabs.some((t) => t.kind === "job" && t.jobId && busy(t.jobId))) return;
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
    // locked parts (Manual nest) stay where they are: the others are nested around them
    const pinned = sh.parts.filter((p) => p.lock !== undefined);
    const loose = sh.parts.filter((p) => p.lock === undefined);
    if (!loose.length) { setToast("Every part on this sheet is locked: nothing to nest again"); return; }
    const counts = new Map<string, number>();
    for (const p of loose) counts.set(p.partId, (counts.get(p.partId) ?? 0) + 1);
    const jparts = (jobParts[jobId] ?? []).filter((jp) => counts.has(jp.part.id)).map((jp) => ({ ...jp, qty: counts.get(jp.part.id)! }));
    const m = machineFor(jobId);
    setRenesting(`${solId}:${index}`);
    try {
      const req = await buildRequest(jparts, [], "fast", undefined, sol.origin ?? m.origin);
      if (pinned.length) {
        // the sheet as a fixed sheet with its locked parts on it, no other stock
        const pathOf = new Map<string, string>((jobParts[jobId] ?? []).map((jp) => [jp.part.id, jp.part.path]));
        req.sheets = [];
        req.fixedSheets = [{
          index: 0, id: sh.sheetId, material: sh.material, thicknessMm: sh.thicknessMm, lengthMm: sh.lengthMm, widthMm: sh.widthMm,
          outline: sh.outline, trims: sh.trims ?? { ...m.trims }, partGapMm: sh.partGapMm ?? m.partGapMm, kerfMm: sh.kerfMm,
          parts: pinned.flatMap((p) => { const path = pathOf.get(p.partId); return path ? [{ path, x: p.x, y: p.y, angle: p.angle, mirror: p.mirror }] : []; }),
        }];
      } else {
        req.sheets = [{ id: sh.sheetId, material: sh.material, thicknessMm: sh.thicknessMm, lengthMm: sh.lengthMm, widthMm: sh.widthMm,
          qty: 1, source: "nested", trims: sh.trims ?? { ...m.trims }, partGapMm: sh.partGapMm ?? m.partGapMm, kerfMm: sh.kerfMm, outline: sh.outline }];
      }
      let run = await nestApi.start(req);
      while (!isFinished(run)) { await new Promise((r) => setTimeout(r, 1000)); run = await nestApi.get(run.id); }
      const out = pinned.length ? run.result?.sheets.find((s) => s.fixedIndex === 0) : run.result?.sheets[0];
      const placed = out?.parts.length ?? 0;
      if (!out || placed < loose.length) {
        setToast(`Only ${placed} of ${loose.length} parts fit on this sheet${pinned.length ? " around the locked ones" : ""}: it is kept as it was`);
        return;
      }
      editSheet(jobId, solId, index, { parts: [...pinned, ...out.parts] });
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
  // the solutions (their numbers) with a part on their sheets: its material and thickness are locked
  const nestedSols = (jobId: string): Record<string, number[]> => {
    const out: Record<string, number[]> = {};
    for (const x of jobSol[jobId]?.list ?? []) {
      if (x.error) continue;   // a failed solution's last layout so far is not a nest
      for (const sh of x.run?.result?.sheets ?? x.run?.best?.sheets ?? [])
        for (const pl of sh.parts) {
          const l = (out[pl.partId] ??= []);
          if (!l.includes(x.no)) l.push(x.no);
        }
    }
    return out;
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
  // manual nesting (EDIT / VIEW on a sheet) opens Manual nest on the toolbar, BACK Automatic nest;
  // opening Automatic nest there leaves manual nesting
  const [toolbarReq, setToolbarReq] = useState<{ section: "auto" | "manual" | null; n: number }>({ section: null, n: 0 });
  const [leaveManual, setLeaveManual] = useState(0);
  // Manual nest tools: to the sheet open in manual nest (a new n each click)
  const [manualTool, setManualTool] = useState<{ tool: string; n: number }>({ tool: "", n: 0 });
  // Manual nest -> Common cut, per job (not kept: off when GNEZDO is opened again)
  const [commonSnap, setCommonSnap] = useState<Record<string, boolean>>({});
  // -- Manual nest: Add sheet / Delete sheet ------------------------------------------------------
  const [addSheetFor, setAddSheetFor] = useState<{ jobId: string; sheet: StockSheet } | null>(null);
  const [deleteAsk, setDeleteAsk] = useState<{ jobId: string; solId: string; index: number; parts: number } | null>(null);
  const [openManual, setOpenManual] = useState<{ sheet: number; n: number }>({ sheet: 0, n: 0 });
  const manualOn = useRef(false);   // Manual nest open (a sheet in place of the sheets)

  /** Add sheet: the dialog, filled in like the shown sheet, else the first material of the part list. */
  const askAddSheet = (jobId: string) => {
    const st = solsOf(jobId);
    const cur = st.list.find((x) => x.id === st.sel.sol)?.run?.result?.sheets[st.sel.sheet];
    const m = machineFor(jobId);
    const first = (jobParts[jobId] ?? [])[0]?.part;
    setAddSheetFor({ jobId, sheet: newSheet({
      source: "manual", material: cur?.material ?? first?.material ?? "", thicknessMm: cur?.thicknessMm ?? first?.thicknessMm ?? 0,
      lengthMm: cur && !cur.outline ? cur.lengthMm : stockSettings.globalLengthMm, widthMm: cur && !cur.outline ? cur.widthMm : stockSettings.globalWidthMm,
      qty: 1, unlimited: false, trims: { ...(cur?.trims ?? m.trims) }, partGapMm: cur?.partGapMm ?? m.partGapMm, kerfMm: cur?.kerfMm ?? (m.kerfMm || undefined),
    }) });
  };

  /** ADD SHEET: into the stock (one more of the same sheet when it is there already) and, empty, onto
   * the shown solution, or a new Manual nest solution when there is none to add to; then opened. */
  const addSheet = (jobId: string, s: StockSheet) => {
    const stock = jobStock[jobId] ?? [];
    // an identical stock sheet gets one more; never a remnant or a DXF sheet (each is a piece of its own)
    const own = s.source === "remnant" || s.source === "dxf";
    const same = own ? undefined : stock.find((x) => !x.outline && x.source !== "remnant" && x.source !== "dxf" && x.material.trim().toLowerCase() === s.material.trim().toLowerCase()
      && Math.abs(x.thicknessMm - s.thicknessMm) < 1e-6 && x.lengthMm === s.lengthMm && x.widthMm === s.widthMm
      && JSON.stringify(x.trims) === JSON.stringify(s.trims) && x.partGapMm === s.partGapMm && x.kerfMm === s.kerfMm);
    let sheetId = s.id;
    if (same) {
      sheetId = same.id;
      if (!same.unlimited) setJobStock((mm) => ({ ...mm, [jobId]: (mm[jobId] ?? []).map((x) => (x.id === same.id ? { ...x, qty: x.qty + 1 } : x)) }));
    } else {
      // as added (Reset goes back to it); a DXF sheet turned to fit keeps the shape it came with
      setJobStock((mm) => ({ ...mm, [jobId]: [...(mm[jobId] ?? []), { ...s, original: s.original ?? { lengthMm: s.lengthMm, widthMm: s.widthMm, outline: s.outline } }] }));
    }
    const nested: NestedSheet = {
      sheetId, lengthMm: s.lengthMm, widthMm: s.widthMm, material: s.material.trim(), thicknessMm: s.thicknessMm,
      trims: s.trims, partGapMm: s.partGapMm, kerfMm: s.kerfMm, parts: [],
      ...(s.outline ? { outline: s.outline } : {}),   // a remnant's shape from its DXF
    };
    const st = solsOf(jobId);
    const sol = st.list.find((x) => x.id === st.sel.sol && !x.error && !x.outdated && isFinished(x.run) && x.run?.result);
    let at = 0;
    if (sol) {
      at = sol.run!.result!.sheets.length;
      patchSol(jobId, sol.id, (x) => ({ ...x, run: { ...x.run!, result: { ...x.run!.result!, sheets: [...x.run!.result!.sheets, nested] } } }));
      setSols(jobId, (s0) => ({ ...s0, sel: { sol: sol.id, sheet: at } }));
    } else {
      const id = `sol${Date.now().toString(36)}`;
      const no = Math.max(0, ...st.list.map((x) => x.no)) + 1;
      const run: NestRun = { id, state: "done", stopAsked: false, seconds: 0,
        result: { state: "done", seconds: 0, sheets: [nested], nested: {}, skipped: [], valid: true, errors: [] } };
      setSols(jobId, (s0) => ({ list: [...s0.list, { id, no, mode: "manual", run, startedAt: Date.now(), locked: [], origin: machineFor(jobId).origin, machine: machineFor(jobId).id }],
        sel: { sol: id, sheet: 0 } }));
    }
    setJobScreen((mm) => ({ ...mm, [jobId]: "nest" }));
    setOpenManual((o) => ({ sheet: at, n: o.n + 1 }));
    diag("sheet", `Sheet added${s.source === "dxf" ? ` from ${s.fileName}.dxf` : s.source === "remnant" ? " (remnant)" : ""}: ${s.material} ${s.thicknessMm} mm ${s.lengthMm}x${s.widthMm}${sol ? `, onto solution ${sol.no} as sheet ${at + 1}` : ", new manual solution"}`, { job: jobId });
  };

  /** Delete sheet (Sheet properties of a nested sheet): a sheet with parts asks first. */
  const askDeleteSheet = (jobId: string, solId: string, i: number) => {
    const sol = solsOf(jobId).list.find((x) => x.id === solId);
    const sheets = sol?.run?.result?.sheets;
    if (!sol || !sheets?.[i] || !isFinished(sol.run)) return;
    if (sol.locked.includes(i)) { setToast(`Sheet ${i + 1} is locked: unlock it to delete it`); return; }
    if (!sheets[i].parts.length) deleteSheet(jobId, sol.id, i);
    else setDeleteAsk({ jobId, solId: sol.id, index: i, parts: sheets[i].parts.length });
  };
  /** Work parts -> remove: not nested, at once; nested, asked first (its pieces come off the sheets). */
  const askRemovePart = (jobId: string, partId: string) => {
    const jp = (jobParts[jobId] ?? []).find((x) => x.part.id === partId);
    const list = solsOf(jobId).list;
    // a nest still running (it nests every part of the job) would bring its pieces back
    if (list.some((x) => x.run && !x.error && !isFinished(x.run))) { setToast("A nest is running: stop it first, then remove the part"); return; }
    let pieces = 0;
    const sols: number[] = [];
    for (const x of list) {
      if (x.error || !x.run?.result) continue;
      let n = 0;
      for (const sh of x.run.result.sheets) n += sh.parts.filter((pl) => pl.partId === partId).length * (sh.cutNumber ?? 1);
      if (n) { pieces += n; sols.push(x.no); }
    }
    if (!sols.length) { removePart(jobId, partId); return; }
    setRemovingPart({ jobId, partId, name: jp?.part.name ?? "the part", sols, pieces });
  };
  const removePart = (jobId: string, partId: string) => {
    setJobParts((m) => ({ ...m, [jobId]: (m[jobId] ?? []).filter((jp) => jp.part.id !== partId) }));
    // its pieces off every sheet; a sheet left with nothing goes (and a solution left with no sheet)
    setSols(jobId, (st) => {
      const list = st.list.flatMap((x) => {
        const sheets = x.run?.result?.sheets;
        if (x.error || !sheets || !sheets.some((sh) => sh.parts.some((pl) => pl.partId === partId))) return [x];
        const keep = sheets.map((sh, k) => ({ sh: { ...sh, parts: sh.parts.filter((pl) => pl.partId !== partId) }, k, was: sh.parts.length }))
          .filter(({ sh, was }) => sh.parts.length > 0 || was === 0);
        if (!keep.length) return [];
        const at = new Map(keep.map(({ k }, i) => [k, i]));
        return [{ ...x, locked: x.locked.filter((n) => at.has(n)).map((n) => at.get(n)!),
          run: { ...x.run!, result: { ...x.run!.result!, sheets: keep.map(({ sh }) => sh) } } }];
      });
      const sel = list.some((x) => x.id === st.sel.sol) ? { sol: st.sel.sol, sheet: Math.min(st.sel.sheet, Math.max(0, (list.find((x) => x.id === st.sel.sol)?.run?.result?.sheets.length ?? 1) - 1)) }
        : { sol: list.at(-1)?.id ?? null, sheet: 0 };
      return { list, sel };
    });
  };

  const deleteSheet = (jobId: string, solId: string, i: number) => {
    const st = solsOf(jobId);
    const sol = st.list.find((x) => x.id === solId);
    const sheets = sol?.run?.result?.sheets;
    if (!sol || !sheets?.[i]) return;
    diag("sheet", `Sheet ${i + 1} of solution ${sol.no} deleted (${sheets[i].parts.length} parts back to the list)`, { job: jobId });
    if (sheets.length === 1) {
      // its last sheet: the solution goes
      setSols(jobId, (s0) => {
        const list = s0.list.filter((x) => x.id !== solId);
        return { list, sel: s0.sel.sol === solId ? { sol: list.length ? list[list.length - 1].id : null, sheet: 0 } : s0.sel };
      });
      if (manualOn.current) setLeaveManual((n) => n + 1);
      setToast(`Solution ${sol.no} had only this sheet: removed`);
      return;
    }
    patchSol(jobId, solId, (x) => ({
      ...x, locked: x.locked.filter((n) => n !== i).map((n) => (n > i ? n - 1 : n)),
      run: { ...x.run!, result: { ...x.run!.result!, sheets: x.run!.result!.sheets.filter((_, k) => k !== i) } },
    }));
    const next = Math.min(i, sheets.length - 2);
    setSols(jobId, (s0) => ({ ...s0, sel: { sol: solId, sheet: next } }));
    if (manualOn.current) setOpenManual((o) => ({ sheet: next, n: o.n + 1 }));
  };

  const onJobTool = (section: string, tool: string, custom?: CustomNestSettings) => {
    if (!job) return;
    diag("tool", `${section}: ${tool}`, { job: job.id, custom });
    if (section === "manual" && tool === "addSheet") { askAddSheet(job.id); return; }
    if (section === "manual" && tool === "commonCut") {
      // a switch for this job (off when the job is opened again): snapping and Arrange blocks
      const on = !commonSnap[job.id];
      setCommonSnap((m) => ({ ...m, [job.id]: on }));
      setToast(on ? "Common cut on: marked lines snap together (Alt: place without snapping); Arrange makes blocks" : "Common cut off");
      return;
    }
    if (section === "manual") { setManualTool((t) => ({ tool, n: t.n + 1 })); return; }
    if (tool === "fastNest") void startNest(job.id, "fast");
    else if (tool === "thoroughNest") void startNest(job.id, "thorough");
    else if (tool === "customNest") { if (custom) void startNest(job.id, "custom", custom); else setCustomFor({ jobId: job.id, fresh: false }); }
  };

  // the server build without a signed-in user: only the sign-in page
  if (!authState) return <div className="signin" aria-busy="true" />;
  // first sign-in on this page: reloaded, so everything loads as this user; signed out while working:
  // the same person carries on where they were, someone else gets a fresh page
  const signedIn = (m: Me) => {
    if (signedInAs.current && signedInAs.current === m.name) { setMe(m); setAuthState({ ...authState, setupNeeded: false, user: m }); }
    else window.location.reload();
  };
  if (authState.dbSetup) return <DatabaseSetupPage onDone={() => window.location.reload()} />;
  if (authState.required && !me && !signedInAs.current) return <SignInPage setupNeeded={authState.setupNeeded} onSignedIn={signedIn} />;

  return (
    <div className="app">
      {authState.required && !me && <div className="signin-over"><SignInPage setupNeeded={false} onSignedIn={signedIn} /></div>}
      {restoreRows && <RestoreDialog rows={restoreRows} onRestore={(ids) => void restoreDrafts(ids)} onDiscard={discardDrafts} onLater={() => setRestoreRows(null)} />}
      {accountDlg === "users" && me && <UsersDialog me={me} onMe={setMe} onClose={() => setAccountDlg(null)} />}
      {accountDlg === "password" && me && <PasswordDialog me={me} onMe={setMe} onClose={() => setAccountDlg(null)} />}
      <TabBar
        tabs={state.tabs}
        activeId={state.activeId}
        userName={userName}
        account={authState?.required && me ? {
          isAdmin: me.isAdmin, hasPassword: me.hasPassword,
          onPick: (id) => {
            // signed out: a fresh page, so the next person does not see these tabs
            if (id === "signout") { diag("auth", `${me.name} signed out`); void flush().finally(() => auth.signOut().finally(() => window.location.reload())); }
            else setAccountDlg(id);
          },
        } : undefined}
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
          {active.kind === "job" ? <JobToolbar key={job?.id} onTool={onJobTool} request={toolbarReq} lit={{ commonCut: !!(job && commonSnap[job.id]) }}
            onSection={(sec) => {
              if (sec === "auto" || sec === "work") { setLeaveManual((n) => n + 1); manualOn.current = false; }
              if (job && sec) setJobScreen((m) => ({ ...m, [job.id]: sec === "work" ? "parts" : sec === "auto" || sec === "manual" ? "nest" : m[job.id] }));
            }} />
            : active.kind !== "jobSearch" && active.kind !== "drawing" && active.kind !== "rules" && active.kind !== "settings" && <ToolStrip tools={toolsFor(active.kind)} onTool={onTool} />}
          <main className={`page${active.kind === "jobSearch" || active.kind === "drawing" || active.kind === "rules" || active.kind === "settings" ? " page-flush" : ""}`} aria-label={active.title}>
            {active.kind === "home" && <HomePage onAction={onHome} />}
            {active.kind === "job" && job && jobScreen[job.id] === "nest" && (
              <NestPage
                onManual={(on) => { manualOn.current = on; setToolbarReq((r) => ({ section: on ? "manual" : "auto", n: r.n + 1 })); }}
                leaveManual={leaveManual}
                openManual={openManual}
                onManualOpened={() => setOpenManual((o) => ({ ...o, sheet: -1 }))}
                onDeleteSheet={(solId, i) => askDeleteSheet(job.id, solId, i)}
                manualTool={manualTool}
                commonCut={!!commonSnap[job.id]}
                parts={jobParts[job.id] ?? []}
                solutions={solsOf(job.id).list}
                selected={solsOf(job.id).sel}
                onSelect={(sel) => setSols(job.id, (st) => ({ ...st, sel }))}
                onAdd={(mode) => (mode === "custom" ? setCustomFor({ jobId: job.id, fresh: true }) : void startNest(job.id, mode, undefined, true))}
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
                nestedIn={nestedSols(job.id)}
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
                onRemove={(pid, deleted) => (deleted ? removePart(job.id, pid) : askRemovePart(job.id, pid))}
                onOpenParts={() => setDrawer("parts")}
              />
            )}
            {addSheetFor && (
              <SheetPropertiesDialog adding index={(jobStock[addSheetFor.jobId] ?? []).length} sheet={addSheetFor.sheet}
                machine={machineFor(addSheetFor.jobId)}
                onSave={(s) => addSheet(addSheetFor.jobId, s)} onClose={() => setAddSheetFor(null)} />
            )}
            {deleteAsk && (
              <ConfirmDialog title={`Delete sheet ${deleteAsk.index + 1}?`} confirmLabel="Delete sheet"
                onCancel={() => setDeleteAsk(null)}
                onConfirm={() => { const d = deleteAsk; setDeleteAsk(null); deleteSheet(d.jobId, d.solId, d.index); }}>
                Its <b>{deleteAsk.parts} {deleteAsk.parts === 1 ? "part goes" : "parts go"} back</b> to the work part list, to be nested again.
                The sheet stays in the stock.
              </ConfirmDialog>
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
            {removingPart && (
              <ConfirmDialog title={`Remove ${removingPart.name} from the job?`} confirmLabel="Remove"
                onCancel={() => setRemovingPart(null)}
                onConfirm={() => {
                  const r = removingPart; setRemovingPart(null);
                  removePart(r.jobId, r.partId);
                  diag("parts", `Removed ${r.name} from the job: ${r.pieces} nested pieces taken off solution ${r.sols.map((n) => `#${n}`).join(", ")}`, { job: r.jobId });
                }}>
                It is nested: {removingPart.pieces} {removingPart.pieces === 1 ? "piece" : "pieces"} in solution {removingPart.sols.map((n) => `#${n}`).join(", ")}.
                {" "}{removingPart.pieces === 1 ? "It is" : "They are"} taken off the sheets; the rest of the layout stays as it is (a sheet left empty goes).
              </ConfirmDialog>
            )}
            {saveAsFor && (
              <SaveAsDialog name={saveAsFor.name} onCancel={() => setSaveAsFor(null)}
                onSave={(name) => { const j = saveAsFor.jobId; setSaveAsFor(null); void saveJob(j, name, true); }} />
            )}
            {newJobOpen && <NewJobDialog defaultName={newJobOpen} machines={machines} onCreate={createJob} onCancel={() => setNewJobOpen(null)} />}
            {customFor && (
              <CustomNestDialog onCancel={() => setCustomFor(null)}
                partIds={(jobParts[customFor.jobId] ?? []).filter((jp) => jp.qty > 0).map((jp) => jp.part.id)}
                onStart={(c) => { const cf = customFor; setCustomFor(null); void startNest(cf.jobId, "custom", c, cf.fresh); }} />
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
                  ? { rotations: shownItem.source.rotations, mirror: shownItem.source.mirror, filler: shownItem.source.filler, commonCut: shownItem.source.commonCut }
                  : { rotations: importProps.rotations, mirror: importProps.mirror, filler: importProps.filler, commonCut: importProps.commonCut }}
                onProcess={() => setProcessing(shownItem.id)}
                onProperties={() => { setDrawer("import"); setPropsOpen(true); }}
                onNestRules={(r) => shownItem.source
                  // a part from the database: its own rules change, not the batch's
                  ? patchItem(shownItem.id, { source: { ...shownItem.source, rotations: r.rotations, mirror: r.mirror, filler: r.filler, commonCut: r.commonCut } })
                  : setImportProps((p) => ({ ...p, rotations: r.rotations, mirror: r.mirror, filler: r.filler, commonCut: r.commonCut }))}
                mirrorBlocked={mirrorBlocked(shownItem, rules)}
                fromDatabase={!!shownItem.source}
                onEdit={(drawing, label) => editDrawing(shownItem.id, shownItem.drawing!, drawing, label)}
                undone={undone} />
              </ErrorBoundary>
            )}
            {active.kind === "rules" && <RulesPage rules={rules} onClose={() => showView("home")} onChange={(r) => {
              setRules(r);
              // a list that has not been touched yet follows the new defaults
              if (imports.length === 0) setImportProps((p) => ({ ...p, rotations: [...r.defaultRotations], mirror: r.mirrorWithoutOpenCut, filler: r.defaultFiller }));
            }} />}
            {active.kind === "settings" && <SettingsPage onClose={() => showView("home")} stock={stockSettings} onStock={setStockSettings} machines={machines} onMachines={setMachines} shared={!demoMode} isAdmin={isAdmin} />}
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
