import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { api } from "./api/api";
import type { JobFilter, JobPart, JobSummary, PartSummary } from "./api/types";
import { ImportPage } from "./pages/ImportPage";
import { sampleDrawings } from "./import/sampleDrawing";
import { mirrorFor, newItem, propertiesFrom, readItem, statusOf, type BatchProperties, type ImportItem } from "./import/batch";
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
import { VIEW_TITLE, drawingTab, initialShell, jobTab, shellReducer, type PageKind, type Tab, type ViewKind } from "./state/tabs";

const USER_NAME = "Fab"; // until sign-in exists

export function App() {
  const [state, dispatch] = useReducer(shellReducer, initialShell);
  const [drawer, setDrawer] = useState<DrawerMode | null>(null);
  const [jobParts, setJobParts] = useState<Record<string, JobPart[] | undefined>>({});
  // Import list: files read from DXF, opened in tabs for checking; kept here so marks survive switching tabs.
  const [imports, setImports] = useState<ImportItem[]>([]);
  const [rules, setRulesState] = useState<ImportRules>(loadRules);
  const setRules = (r: ImportRules) => { setRulesState(r); saveRules(r); };
  const [importProps, setImportProps] = useState<BatchProperties>(() => propertiesFrom(loadRules()));
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
    else api.jobParts(id).then((p) => setJobParts((m) => ({ ...m, [id]: p })));
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

  const closeTabs = (ids: string[]) => ids.forEach((id) => dispatch({ type: "close", id: `drawing:${id}` }));

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
      setToast(bad ? `${bad} ${bad === 1 ? "part needs" : "parts need"} attention: click the red ones to check them` : "All parts have closed contours");
    },
    onProcessAll: () => {
      const ids = imports.filter((i) => statusOf(i).verdict === "ok").map((i) => i.id);
      setImports((list) => list.map((i) => (ids.includes(i.id)
        ? { ...i, processed: true, applied: { rotations: [...importProps.rotations], mirror: mirrorFor(i, importProps, rules) } }
        : i)));
      setToast(`Processed ${ids.length} ${ids.length === 1 ? "part" : "parts"}`);
    },
    onOpen: (id: string) => { const it = imports.find((i) => i.id === id); if (it) openItem(it); },
    onRemove: (id: string) => { closeTabs([id]); setImports((list) => list.filter((i) => i.id !== id)); },
    onClear: () => { closeTabs(imports.map((i) => i.id)); setImports([]); },
    onSamples: () => setImports((list) => [...list, ...sampleDrawings
      .filter((d) => !list.some((i) => i.id === d.id))
      .map((d): ImportItem => ({
        id: d.id, fileName: `${d.fileName}.dxf`, name: d.fileName, qty: quantityFromName(d.fileName),
        state: "ready", drawing: { ...d, entities: d.entities.some((e) => e.role) ? d.entities : applyRules(d.entities, rules) },
        checked: false, processed: false,
      }))]),
    openId: activeTab?.kind === "drawing" ? activeTab.drawingId ?? null : null,
  };
  const shownItem = active.kind === "drawing" ? imports.find((i) => i.id === active.drawingId) : undefined;

  const openJob = (j: JobSummary) => open(jobTab(j.id, j.name));

  const addParts = (jobId: string, title: string, parts: PartSummary[]) => {
    const current = jobParts[jobId] ?? [];
    const fresh = parts.filter((p) => !current.some((c) => c.part.id === p.id));
    setJobParts((m) => ({ ...m, [jobId]: [...(m[jobId] ?? []), ...fresh.map((p) => ({ part: p, qty: p.qty }))] }));
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

  return (
    <div className="app">
      <TabBar
        tabs={state.tabs}
        activeId={state.activeId}
        userName={USER_NAME}
        onActivate={(id) => dispatch({ type: "activate", id })}
        onClose={(id) => dispatch({ type: "close", id })}
        onMenu={(id) => showView(id)}
      />
      <div className={`body${drawer ? " has-drawer" : ""}`}>
        <Drawer
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
          {active.kind !== "jobSearch" && active.kind !== "drawing" && active.kind !== "rules" && <ToolStrip tools={toolsFor(active.kind)} onTool={onTool} />}
          <main className={`page${active.kind === "jobSearch" || active.kind === "drawing" || active.kind === "rules" ? " page-flush" : ""}`} aria-label={active.title}>
            {active.kind === "home" && <HomePage onAction={onHome} />}
            {active.kind === "job" && job && (
              <JobPage
                title={job.title}
                parts={jobParts[job.id]}
                onDropParts={(parts) => addParts(job.id, job.title, parts)}
                onQty={(pid, qty) => setJobParts((m) => ({
                  ...m, [job.id]: (m[job.id] ?? []).map((jp) => (jp.part.id === pid ? { ...jp, qty } : jp)),
                }))}
                onRemove={(pid) => setJobParts((m) => ({ ...m, [job.id]: (m[job.id] ?? []).filter((jp) => jp.part.id !== pid) }))}
                onOpenParts={() => setDrawer("parts")}
              />
            )}
            {active.kind === "jobSearch" && (
              <JobSearchPage filter={jobSearch.filter} run={jobSearch.run} onOpenJob={openJob}
                onShowFilters={() => setDrawer("jobs")} />
            )}
            {shownItem?.drawing && (
              <ImportPage key={shownItem.id}
                drawing={shownItem.drawing}
                processed={shownItem.processed}
                properties={importProps}
                nestRules={shownItem.processed && shownItem.applied
                  ? shownItem.applied
                  : { rotations: importProps.rotations, mirror: mirrorFor(shownItem, importProps, rules) }}
                onChange={(drawing, processed) => patchItem(shownItem.id, {
                  drawing, processed,
                  applied: processed ? { rotations: [...importProps.rotations], mirror: mirrorFor({ ...shownItem, drawing }, importProps, rules) } : undefined,
                })} />
            )}
            {active.kind === "rules" && <RulesPage rules={rules} onChange={(r) => {
              setRules(r);
              // a list that has not been touched yet follows the new defaults
              if (imports.length === 0) setImportProps((p) => ({ ...p, rotations: [...r.defaultRotations], mirror: r.mirrorWithoutOpenCut }));
            }} />}
            {active.kind !== "home" && active.kind !== "job" && active.kind !== "jobSearch" && active.kind !== "drawing" && active.kind !== "rules" && <PlaceholderPage tab={active} />}
          </main>
        </div>
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
      <div id="drag-ghost" className="drag-ghost" aria-hidden="true" />
    </div>
  );
}
