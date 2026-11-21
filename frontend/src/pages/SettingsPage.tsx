import { useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { machineFileName, machineZip, readMachineFile } from "../job/machineFile";
import { NavClose } from "./NavClose";
import { IconClose } from "../components/Icons";
import { ProjectsSettings } from "../components/ProjectsSettings";
import { RulesTabs } from "./RulesPage";
import type { ImportRules } from "../import/rules";
import { loadJobNames, saveJobNames, suggestJobName, type JobNameRule } from "../job/jobName";
import { loadViewPrefs, saveViewPrefs, type ViewPrefs } from "../job/viewPrefs";
import { flush, logDownloadUrl, logSettings, reportProblem, setLogEnabled, type LogSettings as LogSettingsData } from "../job/diag";
import { Combobox } from "../components/Combobox";
import { DatabaseForm } from "../components/DatabaseSetup";
import { data, restartFresh, type DataInfo } from "../api/data";
import { NumInput } from "../components/NumInput";
import { TechnologySettings } from "../components/TechnologySettings";
import { LeadsSettings } from "../components/LeadsSettings";
import { NcOutputSettings } from "../components/NcOutputSettings";
import { MachineFoldersSettings } from "../components/MachineFoldersSettings";
import { ToolsSettings } from "../components/ToolsSettings";
import { AdminSettings } from "../components/AdminSettings";
import type { NestingRules } from "../job/nestRules";
import type { Me } from "../api/auth";
import { usePickLists } from "../components/pickLists";
import { DEFAULT_STOCK_SETTINGS, MACHINE_LIMIT, fitsMachine, type StockSettings } from "../job/stock";
import { DEFAULT_CUT_ORDER, DEFAULT_RAPID_MM_MIN, LINE_CAPABILITIES, ORIGINS, TECHNOLOGIES, cutOrderOf, machineCan, newMachine, type Machine, type MachineList } from "../job/machine";
import { DEFAULT_KEYS, KEY_ACTIONS, RESERVED_KEYS, keyLabel, loadKeys, saveKeys, type KeyAction, type KeyMap } from "../job/manualKeys";
import { DEFAULT_MANUAL_VIEW, loadManualView, saveManualView, type ManualView } from "../job/manualView";

export type Section = "stock" | "machine" | "rules" | "tools" | "projects" | "personal" | "data" | "log" | "admin";
const SECTIONS: { id: Section; label: string; ready: boolean }[] = [
  { id: "stock", label: "Stock and remnants", ready: true },
  { id: "machine", label: "Machines", ready: true },
  { id: "rules", label: "Rules", ready: true },
  { id: "tools", label: "Special tools", ready: true },
  { id: "projects", label: "Projects and parts", ready: true },
  { id: "personal", label: "Personal", ready: true },
  { id: "data", label: "Data", ready: true },
  { id: "log", label: "Diagnostic log", ready: true },
  { id: "admin", label: "Administration", ready: true },
];

// The GNEZDO button -> Settings. Stock: the global sheet size and the three default sheet slots.
export function SettingsPage({ stock, onStock, machines, onMachines, shared, isAdmin = true, onClose, rules, onRules, startSection, startNo, onOpenJob, admin , nesting, onNesting}: {
  /** the section shown first (else Stock and remnants); shown again when startNo changes (the user menu -> Administration) */
  startSection?: Section;
  startNo?: number;
  /** Rules -> Nesting rules */
  nesting: NestingRules;
  onNesting: (r: NestingRules) => void;
  /** Administration: an admin signed in to the server build (missing: no such section) */
  admin?: { me: Me; onMe: (m: Me) => void };
  /** Projects and parts: a job a part is used in, opened */
  onOpenJob?: (id: string, name: string) => void;
  /** Close (bottom of the list): back to Home */
  onClose?: () => void;
  /** Rules: the import rules (Nesting rules keep their own) */
  rules: ImportRules;
  onRules: (r: ImportRules) => void;
  stock: StockSettings; onStock: (s: StockSettings) => void;
  machines: MachineList; onMachines: (m: MachineList) => void;
  /** Machines are kept on the server (false: in this browser, the demo). */
  shared: boolean;
  /** Settings shared by everyone (machines, the log switch) are an admin's (the server build). */
  isAdmin?: boolean;
}) {
  const [mSel, setMSel] = useState(machines.defaultId);
  const machine = machines.list.find((m) => m.id === mSel) ?? machines.list[0];
  const setM = (patch: Partial<Machine>) => onMachines({ ...machines, list: machines.list.map((m) => (m.id === machine.id ? { ...m, ...patch } : m)) });
  const setTrim = (k: keyof Machine["trims"], v: number) => setM({ trims: { ...machine.trims, [k]: v } });
  const addMachine = () => {
    const m = newMachine(machines.list.length + 1, { ...machine, id: undefined, name: `Machine ${machines.list.length + 1}` } as Partial<Machine>);
    const fresh = { ...m, id: `m${Date.now().toString(36)}` };
    onMachines({ ...machines, list: [...machines.list, fresh] });
    setMSel(fresh.id);
  };
  const removeMachine = () => {
    if (machines.list.length < 2) return;
    const list = machines.list.filter((m) => m.id !== machine.id);
    onMachines({ defaultId: machines.defaultId === machine.id ? list[0].id : machines.defaultId, list });
    setMSel(list[0].id);
  };
  const [section, setSection] = useState<Section>(startSection ?? "stock");
  useEffect(() => { if (startSection) setSection(startSection); }, [startSection, startNo]);
  const sections = SECTIONS.filter((s) => s.id !== "admin" || admin);
  const [mPage, setMPage] = useState<"machine" | "tech" | "leads" | "nc">("machine");
  // a machine's configuration as a file: Export gives a .zip, Import adds it (or replaces one of the same name)
  const mFile = useRef<HTMLInputElement>(null);
  const [mMsg, setMMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [mReplace, setMReplace] = useState<Machine | null>(null);
  const exportMachine = () => {
    const url = URL.createObjectURL(new Blob([machineZip(machine).slice()], { type: "application/zip" }));
    const a = document.createElement("a");
    a.href = url; a.download = machineFileName(machine); a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const addImported = (m: Machine, replace?: Machine) => {
    const list = replace ? machines.list.map((x) => (x.id === replace.id ? { ...m, id: replace.id, folders: x.folders } : x)) : [...machines.list, m];
    onMachines({ ...machines, list });
    setMSel(replace ? replace.id : m.id);
    setMMsg({ text: `${m.name} ${replace ? "replaced" : "added"}${m.technologies?.length ? ` with ${m.technologies.length} technologies` : ""}` });
  };
  const importMachine = async (f: File | undefined) => {
    if (!f) return;
    try {
      const m = await readMachineFile(await f.arrayBuffer());
      const same = machines.list.find((x) => x.name.trim().toLowerCase() === m.name.trim().toLowerCase());
      if (same) setMReplace(m); else addImported(m);
    } catch (e) { setMMsg({ text: `Could not import ${f.name}: ${(e as Error).message}`, bad: true }); }
    finally { if (mFile.current) mFile.current.value = ""; }
  };
  const lists = usePickLists("");
  const materials = useMemo(() => lists.materials, [lists.materials]);
  const set = (patch: Partial<StockSettings>) => onStock({ ...stock, ...patch });
  const setSlot = (i: number, patch: Partial<StockSettings["slots"][number]>) =>
    set({ slots: stock.slots.map((s, j) => (j === i ? { ...s, ...patch } : s)) as StockSettings["slots"] });
  const tooBig = (l: number, w: number) => l > 0 && w > 0 && !fitsMachine(l, w);
  const setRem = (patch: Partial<StockSettings["remnant"]>) => set({ remnant: { ...stock.remnant, ...patch } });

  return (
    <div className="settings">
      <nav className="settings-nav" aria-label="Settings">
        <h1>Settings</h1>
        {sections.map((s) => (
          <button key={s.id} className={`settings-link${section === s.id ? " is-on" : ""}`} disabled={!s.ready}
            onClick={() => setSection(s.id)} title={s.ready ? undefined : "Not built yet"}>
            {s.label}
          </button>
        ))}
        {onClose && <NavClose onClose={onClose} />}
      </nav>

      {section === "personal" && <PersonalSettings machines={machines} />}
      {section === "projects" && <ProjectsSettings onOpenJob={onOpenJob} isAdmin={isAdmin} />}
      {section === "rules" && <RulesTabs rules={rules} onChange={onRules} nesting={nesting} onNesting={onNesting} shared={shared} isAdmin={isAdmin} />}
      {section === "data" && <DataSettings />}
      {section === "tools" && <ToolsSettings isAdmin={isAdmin} />}
      {section === "log" && <LogSettings isAdmin={isAdmin} />}
      {section === "admin" && admin && <AdminSettings me={admin.me} onMe={admin.onMe} />}

      {section === "machine" && (
      <div className="settings-main">
        <header className="settings-head">
          <h2>Machines</h2>
          <p>Every job is nested for one machine: its gaps, its 0,0 corner and the largest sheet come from it. {shared ? "The same for everyone." : "Demo: kept in this browser."}</p>
          {!isAdmin && <p className="admin-only">Only an admin can change the machines.</p>}
        </header>
        <fieldset className="admin-lock" disabled={!isAdmin}>
        <div className="mc-tabs" role="tablist" aria-label="Machines">
          {machines.list.map((m) => (
            <button key={m.id} type="button" role="tab" aria-selected={m.id === machine.id} className={`mc-tab${m.id === machine.id ? " is-on" : ""}`} onClick={() => setMSel(m.id)}>
              {m.name}{m.id === machines.defaultId && <span className="mc-default" title="Default for new jobs">★</span>}
            </button>
          ))}
          <button type="button" className="mc-add" onClick={addMachine} title="A new machine, starting as a copy of this one">+ Add machine</button>
        </div>
        <div className="mc-pages" role="tablist" aria-label="Machine settings">
          <button type="button" role="tab" aria-selected={mPage === "machine"} className={mPage === "machine" ? "is-on" : ""} onClick={() => setMPage("machine")}>Machine</button>
          <button type="button" role="tab" aria-selected={mPage === "tech"} className={mPage === "tech" ? "is-on" : ""} onClick={() => setMPage("tech")}>Technology</button>
          <button type="button" role="tab" aria-selected={mPage === "leads"} className={mPage === "leads" ? "is-on" : ""} onClick={() => setMPage("leads")}>Leads &amp; cutting</button>
          <button type="button" role="tab" aria-selected={mPage === "nc"} className={mPage === "nc" ? "is-on" : ""} onClick={() => setMPage("nc")}>NC output</button>
        </div>
        {mPage === "nc" && <NcOutputSettings key={machine.id} machine={machine} onChange={(pp) => setM({ postprocessor: pp })} />}
        {mPage === "leads" && <LeadsSettings machine={machine} onChange={(r) => setM({ leads: r })} />}
        {mPage === "tech" && <TechnologySettings key={machine.id} techs={machine.technologies ?? []} machineName={machine.name} technology={machine.technology} onChange={(t) => setM({ technologies: t })} />}
        {mPage === "machine" && (<>

        <section className="rule">
          <h3>Machine</h3>
          <div className="mc-row">
            <label className="mc-field"><span>Name</span><input className="field" value={machine.name} onChange={(e) => setM({ name: e.target.value })} /></label>
            <label className="mc-field"><span>Technology</span>
              <select className="field" value={machine.technology} onChange={(e) => setM({ technology: e.target.value as Machine["technology"] })}>
                {TECHNOLOGIES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </label>
          </div>
          <div className="mc-row">
            <button type="button" className="btn btn-plain" disabled={machine.id === machines.defaultId} onClick={() => onMachines({ ...machines, defaultId: machine.id })}>
              {machine.id === machines.defaultId ? "★ Default for new jobs" : "Make default for new jobs"}</button>
            <button type="button" className="btn btn-danger-plain" disabled={machines.list.length < 2} onClick={removeMachine}
              title={machines.list.length < 2 ? "There must be one machine" : undefined}>Delete machine</button>
          </div>
          <div className="mc-row">
            <button type="button" className="btn btn-plain" onClick={exportMachine} title="This machine and its technology tables as a .zip file">Export machine…</button>
            <button type="button" className="btn btn-plain" onClick={() => mFile.current?.click()} title="A machine .zip exported from GNEZDO">Import machine…</button>
            <input ref={mFile} type="file" accept=".zip,.json" hidden onChange={(e) => importMachine(e.target.files?.[0])} />
          </div>
          {mMsg && <p className={`tech-msg${mMsg.bad ? " is-bad" : ""}`} role="status">{mMsg.text}</p>}
          {mReplace && (() => {
            const same = machines.list.find((x) => x.name.trim().toLowerCase() === mReplace.name.trim().toLowerCase());
            return (
              <ConfirmDialog title={`Replace ${mReplace.name}?`} confirmLabel="Replace" onCancel={() => setMReplace(null)}
                onConfirm={() => { addImported(mReplace, same); setMReplace(null); }}>
                There is already a machine called {mReplace.name}: its settings and technology tables are replaced by the imported ones. To keep both, rename that one first.
              </ConfirmDialog>
            );
          })()}
        </section>

        <MachineFoldersSettings machine={machine} onChange={(f) => setM({ folders: f })} />

        <section className="rule">
          <h3>What it cuts</h3>
          <p className="rule-help">Line properties of a part this machine does. Lines with a property it does not do are skipped for its jobs (common cut cannot be switched on).</p>
          <div className="mc-lines">
            <label className="chk" title="Closed cutting contours: every machine"><input type="checkbox" checked disabled /> Contours</label>
            {LINE_CAPABILITIES.map((c) => (
              <label key={c.id} className="chk" title={c.help}>
                <input type="checkbox" checked={machineCan(machine, c.id)} onChange={(e) => setM({ lines: { ...machine.lines, [c.id]: e.target.checked } })} /> {c.label}
              </label>
            ))}
          </div>
        </section>

        {(() => {
          const co = cutOrderOf(machine);
          const setCo = (patch: Partial<typeof co>) => setM({ cutOrder: { ...co, ...patch } });
          const isDef = JSON.stringify(co) === JSON.stringify(DEFAULT_CUT_ORDER);
          return (
            <section className="rule">
              <h3>Cut order</h3>
              <p className="rule-help">Rules Generate path keeps on this machine, above the order picked under AUTO CUT (direction, shortest travel, small to big). Always: holes first, then the outline; a part inside another part's outline or window before that part (no islands).</p>
              <div className="mc-rules">
                <label className="chk mc-big"><input type="checkbox" checked={co.bigLast} onChange={(e) => setCo({ bigLast: e.target.checked })} /> Significantly bigger parts last (heat expansion): area over
                  <NumInput value={co.bigTimesMedian} min={1} disabled={!co.bigLast} aria-label="Times the median part" onCommit={(n) => setCo({ bigTimesMedian: n })} />× the median part, or over
                  <NumInput value={co.bigSheetPct} min={1} disabled={!co.bigLast} aria-label="Percent of the sheet" onCommit={(n) => setCo({ bigSheetPct: Math.min(100, n) })} />% of the sheet</label>
              </div>
              <p className="rule-help">Last within its bounding box: the order picked under AUTO CUT runs up to the big part's box, cuts the parts in the box (touching it counts) in the same order, then the big part, then carries on.</p>
              {machine.technology === "laser" ? (
                <p className="rule-help">Tracing first, over the whole sheet, in the order of the shortest rapids: set per thickness in the Technology table (Laser · Trace shortest; on from 4 mm up unless a row says otherwise). AUTO CUT then puts every trace line of the sheet before the cutting, not part by part: from 0,0 the nearest line next (each from its nearer end), then shortened further where turning a stretch round saves travel.</p>
              ) : (<>
                <div className="mc-rules">
                  <label className="chk"><input type="checkbox" checked={co.traceShortest} onChange={(e) => setCo({ traceShortest: e.target.checked })} /> Tracing first, over the whole sheet, in the order of the shortest rapids</label>
                </div>
                <p className="rule-help">On: AUTO CUT puts every trace line of the sheet before the cutting, not part by part: from 0,0 the nearest line next (each from its nearer end), then shortened further where turning a stretch round saves travel. Off: the tracing goes with each part, in the parts' order.</p>
              </>)}
              
              <div className="mc-row"><button type="button" className="btn btn-plain" disabled={isDef} onClick={() => setM({ cutOrder: { ...DEFAULT_CUT_ORDER } })}>Back to the defaults</button></div>
            </section>
          );
        })()}

        <section className="rule">
          <h3>Cutting area</h3>
          <p className="rule-help">The largest sheet the machine can cut, length × width. A bigger sheet is refused in the STOCK panel and shown red.</p>
          <div className="size-row">
            <NumInput value={machine.cutLengthMm} min={1} aria-label="Cutting length (mm)" onCommit={(n) => setM({ cutLengthMm: n })} />
            <span>×</span>
            <NumInput value={machine.cutWidthMm} min={1} aria-label="Cutting width (mm)" onCommit={(n) => setM({ cutWidthMm: n })} />
            <span className="size-unit">mm</span>
          </div>
        </section>

        <section className="rule">
          <h3>Rapid speed</h3>
          <p className="rule-help">How fast the head travels between cuts, for the time estimates (Nest report, Cost report, Simulation). The pierce times are in the Technology table (Cutting · Pierce). Empty or 0: {DEFAULT_RAPID_MM_MIN[machine.technology].toLocaleString("en-US")} mm/min{machine.technology === "plasma" ? " (as on the HACO plasma)" : ""}.</p>
          <div className="size-row">
            <NumInput value={machine.rapidMmMin ?? 0} min={0} placeholder={String(DEFAULT_RAPID_MM_MIN[machine.technology])} aria-label="Rapid speed (mm/min)"
              onCommit={(n) => setM({ rapidMmMin: n > 0 ? n : undefined })} />
            <span className="size-unit">mm/min</span>
          </div>
        </section>

        <section className="rule">
          <h3>Hole compensation</h3>
          <p className="rule-help">Holes marked with the <b>Hole</b> tool in Import 2D are cut this size on this machine, in % of the drawn size: the plasma cuts holes smaller than drawn, so e.g. 115 % cuts them 15 % bigger (a Ø20 hole is cut Ø23). The kerf compensation stays as it is. Other holes and the outline are cut as drawn. Empty or 100: as drawn ({"50"} to {"200"} %).</p>
          <div className="size-row">
            <NumInput value={machine.holeCompPct ?? 100} min={50} placeholder="100" aria-label="Hole compensation (%)"
              onCommit={(n) => setM({ holeCompPct: n > 0 && Math.round(n * 10) / 10 !== 100 ? Math.min(200, Math.max(50, Math.round(n * 10) / 10)) : undefined })} />
            <span className="size-unit">%</span>
          </div>
        </section>

        <section className="rule">
          <h3>Sheet origin (0,0)</h3>
          <p className="rule-help">The corner of the sheet where the machine's 0,0 is. Nesting packs the parts towards this corner, so what is left over is one piece at the other end.</p>
          <div className="origin-pick" role="radiogroup" aria-label="Sheet origin">
            <div className="origin-sheet">
              {ORIGINS.map((o) => (
                <button key={o.id} type="button" role="radio" aria-checked={machine.origin === o.id} aria-label={o.label}
                  className={`origin-corner is-${o.id}${machine.origin === o.id ? " is-on" : ""}`}
                  onClick={() => setM({ origin: o.id })} title={o.label}>
                  <span>0,0</span>
                </button>
              ))}
              <span className="origin-label">{ORIGINS.find((o) => o.id === machine.origin)?.label}</span>
            </div>
          </div>
          <p className="rule-help">As the sheet is drawn on screen (length left to right).</p>
        </section>

        <section className="rule">
          <h3>Gaps of a new sheet</h3>
          <p className="rule-help">They come from the Technology table, by the sheet's material and thickness: Gaps · Parts, Gaps · Sheet trim (all four edges) and Cutting · Kerf (the cut diameter). Sheet properties can change them per sheet.</p>
          <p className="rule-help"><b>A thickness without a Technology row</b> (or a value left empty there) uses these. Trims are by the machine's axes: X− and Y− are the edges at its 0,0.</p>
          <div className="mc-gaps">
            <label className="sp-field"><span>X−</span><NumInput value={machine.trims.xMinus} min={0} aria-label="Trim X- (mm)" onCommit={(n) => setTrim("xMinus", n)} /></label>
            <label className="sp-field"><span>X+</span><NumInput value={machine.trims.xPlus} min={0} aria-label="Trim X+ (mm)" onCommit={(n) => setTrim("xPlus", n)} /></label>
            <label className="sp-field"><span>Y−</span><NumInput value={machine.trims.yMinus} min={0} aria-label="Trim Y- (mm)" onCommit={(n) => setTrim("yMinus", n)} /></label>
            <label className="sp-field"><span>Y+</span><NumInput value={machine.trims.yPlus} min={0} aria-label="Trim Y+ (mm)" onCommit={(n) => setTrim("yPlus", n)} /></label>
            <label className="sp-field mc-wide"><span className="mc-lbl">Parts gap</span><NumInput value={machine.partGapMm} min={0} aria-label="Parts gap (mm)" onCommit={(n) => setM({ partGapMm: n })} /><span className="sp-unit">mm</span></label>
            <label className="sp-field mc-wide"><span className="mc-lbl">Cut diameter</span><NumInput value={machine.kerfMm} min={0} placeholder="–" aria-label="Cut diameter (mm)" onCommit={(n) => setM({ kerfMm: n })} /><span className="sp-unit">mm</span></label>
          </div>
          <p className="rule-help">Materials and thicknesses it can cut come with the technology tables.</p>
        </section>
        </>)}
        </fieldset>
        <footer className="settings-foot">{shared ? "Saved on the server, for everyone." : "Saved in this browser."}</footer>
      </div>
      )}
      {section === "stock" && (
      <div className="settings-main">
        <header className="settings-head">
          <h2>Stock and remnants</h2>
          <p>Sheet sizes the STOCK panel of a job adds. Sizes are length × width in millimeters.</p>
          {!isAdmin && <p className="admin-only">Only an admin can change the stock and remnant settings.</p>}
        </header>
        <fieldset className="admin-lock" disabled={!isAdmin}>

        <section className="rule">
          <h3>Global sheet size</h3>
          <p className="rule-help"><b>Add from: Job part list</b> adds a sheet of this size for every material and thickness in the job.</p>
          <div className={`size-row${tooBig(stock.globalLengthMm, stock.globalWidthMm) ? " is-too-big" : ""}`}>
            <NumInput value={stock.globalLengthMm} min={1} aria-label="Global sheet length (mm)" onCommit={(n) => set({ globalLengthMm: n })} />
            <span>×</span>
            <NumInput value={stock.globalWidthMm} min={1} aria-label="Global sheet width (mm)" onCommit={(n) => set({ globalWidthMm: n })} />
            <span className="size-unit">mm</span>
          </div>
        </section>

        <section className="rule">
          <h3>Default sheets</h3>
          <p className="rule-help">The four <b>Default</b> choices of <b>Add from</b>. Material can stay empty: the sheet then takes a material of the job.</p>
          <div className="slot-table" role="table" aria-label="Default sheets">
            <div className="slot-head" role="row"><span /><span>Material</span><span>Size (length × width)</span></div>
            {stock.slots.map((s, i) => (
              <div key={i} className={`slot-row${tooBig(s.lengthMm, s.widthMm) ? " is-too-big" : ""}`} role="row">
                <b>Default {i + 1}</b>
                <Combobox value={s.material} options={materials} placeholder="Any (from the job)" ariaLabel={`Material of default ${i + 1}`}
                  onChange={(v) => setSlot(i, { material: v })} />
                <div className="size-row">
                  <NumInput value={s.lengthMm} min={1} aria-label={`Length of default ${i + 1} (mm)`} onCommit={(n) => setSlot(i, { lengthMm: n })} />
                  <span>×</span>
                  <NumInput value={s.widthMm} min={1} aria-label={`Width of default ${i + 1} (mm)`} onCommit={(n) => setSlot(i, { widthMm: n })} />
                  <span className="size-unit">mm</span>
                </div>
              </div>
            ))}
          </div>
          <p className="rule-help">Red: bigger than the machine can cut ({MACHINE_LIMIT.join(" × ")} mm); in a job it is grayed out in <b>Add from</b> while the job's machine is too small for it.</p>
        </section>

        <section className="rule">
          <h3>Remnants</h3>
          <p className="rule-help">How Process → <b>Remnant</b> works a sheet's remnant out (TRIM, RECTANGULAR, SKELET).</p>
          <div className="mc-row">
            <label className="mc-field" title="Used when the machine's Technology row has no Remnant cut · To parts"><span>Minimum distance to parts (mm)</span>
              <NumInput value={stock.remnant.minDistMm} min={0} aria-label="Minimum distance to parts (mm)" onCommit={(n) => setRem({ minDistMm: n })} /></label>
            <label className="mc-field"><span>Smallest remnant (% of the sheet)</span>
              <NumInput value={stock.remnant.minAreaPct} min={0} aria-label="Smallest remnant (% of the sheet)" onCommit={(n) => setRem({ minAreaPct: Math.min(100, n) })} /></label>
            <label className="mc-field"><span>SKELET: smallest arc followed (mm)</span>
              <NumInput value={stock.remnant.minRadiusMm} min={0} aria-label="Smallest arc radius SKELET follows (mm)" onCommit={(n) => setRem({ minRadiusMm: n })} /></label>
          </div>
          <p className="rule-help">The <b>smallest edge</b> is set in Process → <b>Remnant</b>, under the remnant modes: no remnant edge, and no step of a TRIM outline, shorter than it; a smaller piece is scrap and is not listed. SKELET keeps sharp corners: it follows a part's arc only from this radius up (a smaller rounded corner counts as sharp). TRIM and RECTANGULAR use straight lines only.</p>
          <div className="mc-row">
            <span className="mc-sub" title="Process → Remnant: Cut along X / Cut along Y changes it per sheet">RECTANGULAR: first cut to start with</span>
            <label className="chk"><input type="radio" name="rem-dir" checked={stock.remnant.rectDir === "x"} onChange={() => setRem({ rectDir: "x" })} /> Along X (the whole length, then up to it)</label>
            <label className="chk"><input type="radio" name="rem-dir" checked={stock.remnant.rectDir === "y"} onChange={() => setRem({ rectDir: "y" })} /> Along Y (the whole width, then up to it)</label>
          </div>
        </section>

        <footer className="settings-foot">
          {shared ? "Saved on the server, for everyone." : "Saved in this browser."}{" "}
          <button className="link" onClick={() => onStock(DEFAULT_STOCK_SETTINGS)}>Reset to defaults</button>
        </footer>
        </fieldset>
      </div>
      )}
    </div>
  );
}

/** Manual nest keys: two per action; click a key and press the new one (Esc: keep, Backspace: none). */
function PersonalSettings({ machines }: { machines: MachineList }) {
  const [names, setNames] = useState<JobNameRule[]>(loadJobNames);
  const [examples, setExamples] = useState<string[]>([]);
  const [view, setViewState] = useState(loadViewPrefs);
  const setView = (patch: Partial<ViewPrefs>) => { const n = { ...view, ...patch }; setViewState(n); saveViewPrefs(n); };
  // kept as typed; the next names worked out a moment after typing stops
  useEffect(() => {
    const t = setTimeout(() => {
      saveJobNames(names);
      void Promise.all(names.map((r) => (r.prefix.trim() ? suggestJobName(r.machine).catch(() => "") : Promise.resolve("")))).then(setExamples);
    }, 300);
    return () => clearTimeout(t);
  }, [names]);
  const setName = (i: number, patch: Partial<JobNameRule>) => setNames((l) => l.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const taken = (i: number) => new Set(names.filter((_, k) => k !== i).map((r) => r.machine));
  const free = machines.list.find((m) => !names.some((r) => r.machine === m.id));
  return (
    <div className="settings-main">
      <header className="settings-head">
        <h2>Personal</h2>
        <p>Your own preferences, kept in this browser: job names, how the cut path is drawn, and the manual nest shortcuts.</p>
      </header>
      <section className="rule">
        <h3>Job names</h3>
        <p className="rule-help">New job suggests the next number of your own job name: with <b>JOHN</b> and JOHN231, JOHN232, JOHN233 saved last, it suggests <b>JOHN234</b>. It goes on from the latest job that has the two numbers before it saved too, so a lone or old number is not where it continues. Empty: “New job”.</p>
        <p className="rule-help">A job name can be for <b>one machine</b>: New job suggests it when that machine is picked, and also counts the files in that machine’s NC and job folders (Settings → Machines → Folders), so JOHN233_1.NCP written there makes the next one JOHN234. A name for <b>all machines</b> is for the machines without one of their own.</p>
        {names.map((r, i) => (
          <div className="mc-row jn-row" key={i}>
            <label className="mc-field"><span>Job name</span>
              <input className="field" value={r.prefix} placeholder="e.g. JOHN" spellCheck={false} onChange={(e) => setName(i, { prefix: e.target.value })} /></label>
            <label className="mc-field"><span>Machine</span>
              <select className="field" value={r.machine} onChange={(e) => setName(i, { machine: e.target.value })}>
                <option value="" disabled={taken(i).has("")}>All machines</option>
                {machines.list.map((m) => <option key={m.id} value={m.id} disabled={taken(i).has(m.id)}>{m.name}</option>)}
              </select></label>
            {r.prefix.trim() && examples[i] && <span className="rule-help">Next suggested: <b>{examples[i]}</b></span>}
            {names.length > 1 && (
              <button type="button" className="icon-btn jn-del" aria-label="Remove this job name" title="Remove this job name"
                onClick={() => setNames((l) => l.filter((_, k) => k !== i))}><IconClose size={14} /></button>
            )}
          </div>
        ))}
        {free && (
          <div className="mc-row">
            <button type="button" className="mc-add" onClick={() => setNames((l) => [...l, { prefix: "", machine: free.id }])}
              title="A job name for one machine">+ Add job name</button>
          </div>
        )}
      </section>
      <section className="rule">
        <h3>Cut path</h3>
        <p className="rule-help">How Process draws the cut path on the sheet.</p>
        <label className="chk"><input type="checkbox" checked={view.rapidArrows} onChange={(e) => setView({ rapidArrows: e.target.checked })} />
          Arrows on the rapid moves (the way the head travels)</label>
        <label className="chk"><input type="checkbox" checked={view.cutArrows} onChange={(e) => setView({ cutArrows: e.target.checked })} />
          Arrows on the cut contours (the cutting direction)</label>
      </section>
      <ShortcutSections />
    </div>
  );
}

/** Personal → Shortcuts (the manual nest keys) and the JOB PARTS list. */
function ShortcutSections() {
  const [keys, setKeysState] = useState<KeyMap>(loadKeys);
  const [wait, setWait] = useState<{ a: KeyAction; k: 0 | 1 } | null>(null);
  const [taken, setTaken] = useState<string | null>(null);
  const setKeys = (k: KeyMap) => { setKeysState(k); saveKeys(k); };
  const [view, setViewState] = useState<ManualView>(loadManualView);
  const setView = (v: ManualView) => { setViewState(v); saveManualView(v); };
  const capture = (e: React.KeyboardEvent) => {
    if (!wait) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") { setWait(null); return; }
    const code = e.key === "Backspace" ? "" : e.code;
    // Ctrl and the keys of the other shortcuts stay theirs
    if (RESERVED_KEYS.has(code)) { setTaken(`${keyLabel(code)} is taken by another shortcut (Ctrl snapping, Ctrl+A / C / V / Y / Z, Delete, Esc): pick another key`); return; }
    setTaken(null);
    const next = { ...keys } as KeyMap;
    // a key does one thing: taken from another action first
    if (code) for (const a of KEY_ACTIONS) next[a.id] = next[a.id].map((c) => (c === code ? "" : c)) as [string, string];
    const pair = [...next[wait.a]] as [string, string];
    pair[wait.k] = code;
    next[wait.a] = pair;
    setKeys(next);
    setWait(null);
  };
  return (<>
      <section className="rule">
        <h3>Shortcuts</h3>
        <p className="rule-help">Keys that move and turn the selected parts in manual nesting: a press moves 1 mm or turns 1°, held down 10 steps a second.
          A move stops at the sheet edge (the trims); parts may be moved over each other. Ctrl + a move key slides the parts up to the next part
          or the edge (keeping the gaps).</p>
        <div className="keys-table" role="table" aria-label="Manual nest keys">
          <div className="keys-head" role="row"><span>Action</span><span>Key</span><span>Second key</span></div>
          {KEY_ACTIONS.map((a) => (
            <div key={a.id} className="keys-row" role="row">
              <span>{a.label}</span>
              {([0, 1] as const).map((k) => {
                const on = wait?.a === a.id && wait.k === k;
                return (
                  <button key={k} type="button" className={`key-cap${on ? " is-wait" : ""}${keys[a.id][k] ? "" : " is-empty"}`}
                    onClick={() => setWait(on ? null : { a: a.id, k })} onKeyDown={capture} onBlur={() => on && setWait(null)}
                    aria-label={`${a.label}: ${k ? "second key" : "key"} ${keyLabel(keys[a.id][k])}. Click and press a key to change`}>
                    {on ? "Press a key…" : keyLabel(keys[a.id][k])}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        {taken && <p className="tech-msg is-bad" role="status">{taken}</p>}
        <p className="rule-help"><b>Snapping:</b> Ctrl held when a dragged part is let go puts it the part gap from the part under it (or the nearest).
          The <b>Common cut snapping</b> key held while dragging snaps a marked common cut line onto another part&apos;s, a kerf apart (parts with the Common cut rule).</p>
        <p className="rule-help">Delete removes the selected parts, Ctrl+A selects all, Ctrl+C / Ctrl+V copy and paste them (the copy follows the pointer
          until a click puts it down; not over a part's required or max number), Ctrl+Z / Ctrl+Y undo and redo, Esc clears the selection.
          Numpad keys work with Num Lock on or off.</p>
      </section>
      <section className="rule">
        <h3>Manual nest: job parts list</h3>
        <div className="rule-row" role="radiogroup" aria-label="Job parts list">
          <label className="chk"><input type="radio" name="mn-cols" checked={view.tileColumns === 2} onChange={() => setView({ tileColumns: 2 })} /> Two columns (names cut, the whole name on hover)</label>
          <label className="chk"><input type="radio" name="mn-cols" checked={view.tileColumns === 1} onChange={() => setView({ tileColumns: 1 })} /> One column of wider tiles (whole names)</label>
        </div>
        <div className="rule-row">
          <button type="button" className="btn btn-plain" onClick={() => { setKeys(DEFAULT_KEYS); setView(DEFAULT_MANUAL_VIEW); }}>Shortcuts and list: reset to defaults</button>
        </div>
      </section>
    </>);
}

// Settings -> Diagnostic log: what the server and the browsers did, kept on the server to find out
// afterwards what went wrong. On for everyone by default; off here for everyone on this server.
function LogSettings({ isAdmin }: { isAdmin: boolean }) {
  const [s, setS] = useState<LogSettingsData | null | undefined>(undefined);   // undefined: loading, null: no server log
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [text, setText] = useState("");
  const [days, setDays] = useState(3);
  useEffect(() => { void logSettings().then(setS); }, []);
  const toggle = async (on: boolean) => {
    setBusy(true); setMsg(null);
    try { await setLogEnabled(on); setS(await logSettings()); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  };
  const send = async () => {
    if (!text.trim()) return;
    setBusy(true); setMsg(null);
    try {
      await reportProblem(text.trim(), { page: window.location.pathname, screen: `${window.innerWidth}x${window.innerHeight}` });
      setText("");
      setMsg({ ok: true, text: `Reported at ${new Date().toLocaleTimeString()}. Download the log below and send it with a few words.` });
      setS(await logSettings());
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  };
  return (
    <div className="settings-main">
      <header className="settings-head">
        <h2>Diagnostic log</h2>
        <p>GNEZDO writes down what happens on the server and in every browser using it: nests started and how they ended, saves,
          tools used, and every error, with who and when. If something goes wrong, report it here, then download the log and send it,
          so it can be looked at without describing every step. Job, part and user names are in it; drawings and outlines are not.
          It stays on the server, {s?.keepDays ?? 30} days at most.</p>
      </header>
      {s === undefined && <section className="rule"><p className="rule-help">Loading…</p></section>}
      {s === null && <section className="rule"><p className="rule-help">There is no server log here (these demo pages run without GNEZDO's server).</p></section>}
      {s && (
        <>
          <section className="rule">
            <h3>Keep a diagnostic log</h3>
            <label className="chk">
              <input type="checkbox" checked={s.enabled} disabled={busy || !isAdmin} onChange={(e) => void toggle(e.target.checked)} />
              {" "}On (for everyone on this server; switched off, nothing more is written)
            </label>
            {!isAdmin && <p className="admin-only">Only an admin can switch the log on or off.</p>}
            <p className="rule-help">{s.files ? `${s.files} ${s.files === 1 ? "day" : "days"} kept, ${s.sizeMb < 0.1 ? "under 0.1" : s.sizeMb} MB, since ${s.oldest}` : "Nothing written yet"} · folder {s.dir}</p>
          </section>
          <section className="rule">
            <h3>Report a problem</h3>
            <p className="rule-help">Say in a few words what went wrong: it goes into the log as a marked entry at this moment, with what this browser did just before.</p>
            <textarea className="field log-report" rows={3} value={text} placeholder="e.g. Fast nest stuck at 80 %, job 26-0412" disabled={!s.enabled || busy}
              onChange={(e) => setText(e.target.value)} aria-label="What went wrong" />
            <div className="rule-row">
              <button type="button" className="btn btn-save" disabled={!s.enabled || busy || !text.trim()} onClick={() => void send()}>Report</button>
              {!s.enabled && <span className="rule-help">The log is off: switch it on to report.</span>}
            </div>
          </section>
          <section className="rule">
            <h3>Download log</h3>
            <div className="rule-row">
              <select className="field log-days" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Days">
                {[1, 3, 7, 30].map((d) => <option key={d} value={d}>{d === 1 ? "Today" : `Last ${d} days`}</option>)}
              </select>
              <a className="btn btn-plain log-dl" href={logDownloadUrl(days)} download onClick={() => { void flush(); }}>Download (zip)</a>
            </div>
          </section>
          {msg && <p className={`log-msg${msg.ok ? "" : " is-bad"}`} role="status">{msg.text}</p>}
        </>
      )}
    </div>
  );
}

// Settings -> Data: where GNEZDO keeps parts, jobs and settings. The desktop: a database file in the
// user's app-data folder (open it, back it up). The server: its SQL Server database (an admin may
// point GNEZDO at another one, used after a restart).
function DataSettings() {
  const [d, setD] = useState<DataInfo | null | undefined>(undefined);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [changing, setChanging] = useState(false);
  const [fresh, setFresh] = useState<null | { word: string; busy: boolean; error?: string }>(null);
  useEffect(() => { void data.info().then(setD).catch(() => setD(null)); }, []);
  const startFresh = async () => {
    if (!fresh || fresh.busy || fresh.word.trim() !== "DELETE") return;
    setFresh({ ...fresh, busy: true, error: undefined });
    try { await data.startFresh(fresh.word); restartFresh(); }
    catch (e) { setFresh({ ...fresh, busy: false, error: (e as Error).message }); }
  };
  const open = async () => {
    setMsg(null);
    try { await data.openFolder(); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  return (
    <div className="settings-main">
      <header className="settings-head">
        <h2>Data</h2>
        <p>Where GNEZDO keeps parts, jobs, stock, machines and settings.</p>
      </header>
      {d === undefined && <section className="rule"><p className="rule-help">Loading…</p></section>}
      {d === null && <section className="rule"><p className="rule-help">Could not ask GNEZDO's server.</p></section>}
      {d?.kind === "demo" && <section className="rule"><p className="rule-help">The demo: sample data in this browser tab only; nothing is saved.</p></section>}
      {d?.kind === "file" && (
        <>
          <section className="rule">
            <h3>Data folder</h3>
            <p className="data-path">{d.folder}</p>
            <p className="rule-help">In your own app-data folder, not in the GNEZDO program folder: updating or deleting GNEZDO does not touch it.
              The database is data{d.file.includes("\\") ? "\\" : "/"}gnezdo.db ({d.sizeMb < 0.1 ? "under 0.1" : d.sizeMb} MB); the diagnostic log is in logs.</p>
            <div className="rule-row"><button type="button" className="btn btn-plain" onClick={() => void open()}>Open folder</button></div>
          </section>
          <section className="rule">
            <h3>Back up</h3>
            <p className="rule-help">A complete copy of the database as one file (gnezdo-backup-date-time.db), saved like any download.
              Keep it somewhere safe, e.g. on another drive. To go back to it: close GNEZDO and put it in place of data{d.file.includes("\\") ? "\\" : "/"}gnezdo.db, renamed to gnezdo.db.</p>
            <div className="rule-row"><a className="btn btn-save" href={data.backupUrl} download>Back up now</a></div>
          </section>
          <section className="rule">
            <h3>Start fresh</h3>
            <p className="rule-help">Like a new install: deletes all parts, jobs, projects, remnants, machines, added special tools and settings, and resets what the screens
              remember (view options, open panels). A copy of the database is saved first in data{d.file.includes("\\") ? "\\" : "/"}backups.
              There is no need to delete the data folder by hand.</p>
            <div className="rule-row"><button type="button" className="btn btn-danger-plain" onClick={() => setFresh({ word: "", busy: false })}>Start fresh…</button></div>
          </section>
          {fresh && (
            <ConfirmDialog title="Delete all data and start fresh?" confirmLabel={fresh.busy ? "Deleting…" : "Delete everything"}
              confirmDisabled={fresh.busy || fresh.word.trim() !== "DELETE"}
              onCancel={() => { if (!fresh.busy) setFresh(null); }} onConfirm={() => void startFresh()}>
              All parts, jobs, projects, remnants, machines, added special tools and settings are deleted, and open tabs close. A backup copy is kept in
              data{d.file.includes("\\") ? "\\" : "/"}backups. Machines then need importing again (Settings → Machines → Import machine).
              <span className="fresh-type">Type <b>DELETE</b> to confirm:
                <input className="fresh-word" ref={(el) => { if (el && !fresh.word && !fresh.busy) window.setTimeout(() => el.focus(), 0); }} value={fresh.word} disabled={fresh.busy} autoComplete="off" spellCheck={false} aria-label="Type DELETE to confirm"
                  onChange={(e) => setFresh({ ...fresh, word: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter") void startFresh(); }} /></span>
              {fresh.error && <span className="fresh-error" role="alert">{fresh.error}</span>}
            </ConfirmDialog>
          )}
        </>
      )}
      {d?.kind === "sqlite" && <section className="rule"><h3>Database file</h3><p className="data-path">{d.file}</p></section>}
      {d?.kind === "postgres" && (
        <section className="rule">
          <h3>PostgreSQL database</h3>
          <dl className="data-db">
            <dt>Server</dt><dd>{d.server}</dd>
            <dt>Database</dt><dd>{d.database}</dd>
            <dt>Sign-in</dt><dd>{d.login}</dd>
          </dl>
          <p className="admin-only">Set in config.json on the server (ConnectionStrings → Gnezdo), used after GNEZDO is started again.</p>
        </section>
      )}
      {d?.kind === "sqlserver" && (
        <section className="rule">
          <h3>SQL Server database</h3>
          <dl className="data-db">
            <dt>Server</dt><dd>{d.server}</dd>
            <dt>Database</dt><dd>{d.database}</dd>
            <dt>Sign-in</dt><dd>{d.login}</dd>
          </dl>
          {d.canChange && !changing && <div className="rule-row"><button type="button" className="btn btn-plain" onClick={() => { setChanging(true); setMsg(null); }}>Change…</button></div>}
          {!d.canChange && <p className="admin-only">Only an admin can change the database.</p>}
          {changing && (
            <div className="data-change">
              <DatabaseForm start={{ server: d.server, database: d.database }} saveLabel="Save"
                onSaved={(m) => { setChanging(false); setMsg({ ok: true, text: m }); }} />
              <button type="button" className="btn btn-plain" onClick={() => setChanging(false)}>Cancel</button>
            </div>
          )}
        </section>
      )}
      {msg && <p className={`log-msg${msg.ok ? "" : " is-bad"}`} role="status">{msg.text}</p>}
    </div>
  );
}

