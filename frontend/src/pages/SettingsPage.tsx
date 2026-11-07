import { useEffect, useMemo, useState } from "react";
import { flush, logDownloadUrl, logSettings, reportProblem, setLogEnabled, type LogSettings as LogSettingsData } from "../job/diag";
import { Combobox } from "../components/Combobox";
import { NumInput } from "../components/NumInput";
import { usePickLists } from "../components/pickLists";
import { DEFAULT_STOCK_SETTINGS, MACHINE_LIMIT, fitsMachine, type StockSettings } from "../job/stock";
import { ORIGINS, TECHNOLOGIES, newMachine, type Machine, type MachineList } from "../job/machine";
import { DEFAULT_KEYS, KEY_ACTIONS, keyLabel, loadKeys, saveKeys, type KeyAction, type KeyMap } from "../job/manualKeys";
import { DEFAULT_MANUAL_VIEW, loadManualView, saveManualView, type ManualView } from "../job/manualView";

type Section = "stock" | "machine" | "keys" | "log";
const SECTIONS: { id: Section; label: string; ready: boolean }[] = [
  { id: "stock", label: "Stock", ready: true },
  { id: "machine", label: "Machines", ready: true },
  { id: "keys", label: "Manual nest", ready: true },
  { id: "log", label: "Diagnostic log", ready: true },
];

// GNEZDO menu -> Settings. Stock: the global sheet size and the three default sheet slots.
export function SettingsPage({ stock, onStock, machines, onMachines, shared, isAdmin = true }: {
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
  const [section, setSection] = useState<Section>("stock");
  const lists = usePickLists("");
  const materials = useMemo(() => lists.materials, [lists.materials]);
  const set = (patch: Partial<StockSettings>) => onStock({ ...stock, ...patch });
  const setSlot = (i: number, patch: Partial<StockSettings["slots"][number]>) =>
    set({ slots: stock.slots.map((s, j) => (j === i ? { ...s, ...patch } : s)) as StockSettings["slots"] });
  const tooBig = (l: number, w: number) => l > 0 && w > 0 && !fitsMachine(l, w);

  return (
    <div className="settings">
      <nav className="settings-nav" aria-label="Settings">
        <h1>Settings</h1>
        {SECTIONS.map((s) => (
          <button key={s.id} className={`settings-link${section === s.id ? " is-on" : ""}`} disabled={!s.ready}
            onClick={() => setSection(s.id)} title={s.ready ? undefined : "Not built yet"}>
            {s.label}
          </button>
        ))}
      </nav>

      {section === "keys" && <KeysSettings />}
      {section === "log" && <LogSettings isAdmin={isAdmin} />}

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
        </section>

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
          <p className="rule-help">What a sheet added to a job for this machine starts with (Sheet properties can change them per sheet). Trims are by the machine's axes: X− and Y− are the edges at its 0,0.</p>
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
        </fieldset>
        <footer className="settings-foot">{shared ? "Saved on the server, for everyone." : "Saved in this browser."}</footer>
      </div>
      )}
      {section === "stock" && (
      <div className="settings-main">
        <header className="settings-head">
          <h2>Stock</h2>
          <p>Sheet sizes the STOCK panel of a job adds. Sizes are length × width in millimeters.</p>
        </header>

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
          <p className="rule-help">The three <b>Default</b> choices of <b>Add from</b>. Material can stay empty: the sheet then takes a material of the job.</p>
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
          <p className="rule-help">Red: bigger than the machine can cut ({MACHINE_LIMIT.join(" × ")} mm).</p>
        </section>

        <footer className="settings-foot">
          Saved in this browser.{" "}
          <button className="link" onClick={() => onStock(DEFAULT_STOCK_SETTINGS)}>Reset to defaults</button>
        </footer>
      </div>
      )}
    </div>
  );
}

/** Manual nest keys: two per action; click a key and press the new one (Esc: keep, Backspace: none). */
function KeysSettings() {
  const [keys, setKeysState] = useState<KeyMap>(loadKeys);
  const [wait, setWait] = useState<{ a: KeyAction; k: 0 | 1 } | null>(null);
  const setKeys = (k: KeyMap) => { setKeysState(k); saveKeys(k); };
  const [view, setViewState] = useState<ManualView>(loadManualView);
  const setView = (v: ManualView) => { setViewState(v); saveManualView(v); };
  const capture = (e: React.KeyboardEvent) => {
    if (!wait) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") { setWait(null); return; }
    const code = e.key === "Backspace" ? "" : e.code;
    const next = { ...keys } as KeyMap;
    // a key does one thing: taken from another action first
    if (code) for (const a of KEY_ACTIONS) next[a.id] = next[a.id].map((c) => (c === code ? "" : c)) as [string, string];
    const pair = [...next[wait.a]] as [string, string];
    pair[wait.k] = code;
    next[wait.a] = pair;
    setKeys(next);
    setWait(null);
  };
  return (
    <div className="settings-main">
      <header className="settings-head">
        <h2>Manual nest</h2>
        <p>Keys that move and turn the selected parts in manual nesting: a press moves 1 mm or turns 1°, held down 10 steps a second.
          A move stops at the sheet edge (the trims); parts may be moved over each other. Ctrl + a move key slides the parts up to the next part
          or the edge (keeping the gaps). Kept in this browser.</p>
      </header>
      <section className="rule">
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
        <p className="rule-help">Delete removes the selected parts, Ctrl+A selects all, Ctrl+C / Ctrl+V copy and paste them (the copy follows the pointer
          until a click puts it down; not over a part's required or max number), Ctrl+Z / Ctrl+Y undo and redo, Esc clears the selection.
          Numpad keys work with Num Lock on or off.</p>
      </section>
      <section className="rule">
        <h3>Job parts list</h3>
        <div className="rule-row" role="radiogroup" aria-label="Job parts list">
          <label className="chk"><input type="radio" name="mn-cols" checked={view.tileColumns === 2} onChange={() => setView({ tileColumns: 2 })} /> Two columns (names cut, the whole name on hover)</label>
          <label className="chk"><input type="radio" name="mn-cols" checked={view.tileColumns === 1} onChange={() => setView({ tileColumns: 1 })} /> One column of wider tiles (whole names)</label>
        </div>
      </section>
      <footer className="settings-foot">
        <button type="button" className="btn btn-plain" onClick={() => { setKeys(DEFAULT_KEYS); setView(DEFAULT_MANUAL_VIEW); }}>Reset to defaults</button>
      </footer>
    </div>
  );
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
