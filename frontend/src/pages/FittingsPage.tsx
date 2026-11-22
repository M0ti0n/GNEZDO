import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ImportToolStrip, pluginIcon } from "../import/ImportTools";
import { Preview } from "../import/ProcessDialog";
import { NumInput } from "../components/NumInput";
import { Combobox } from "../components/Combobox";
import { usePickLists } from "../components/pickLists";
import type { FitSession, FittingPart } from "../tools/fitSession";
import { activeTools, useToolStore } from "../tools/toolStore";
import { runToolPackage } from "../tools/toolRunner";
import type { ToolResult } from "../tools/toolCore";
import { svgUrl, toolValues, type ToolField, type ToolPackage, type ToolValues } from "../tools/toolFormat";
// SPECIAL TOOLS: flat parts made from values by the plug-in tools added in Settings -> Special tools (the
// fittings of the HVAC Fittings workbench are such tools, in SPECIAL TOOLS on GitHub). One part on the canvas
// at a time, picked in the list. Here they only get their name, material and thickness: "Send to Import 2D"
// puts them in the import list, and Import 2D processes them, as it does every 2D drawing.

export type FitPartState = "new" | "listed" | "saved";

const GUIDE = "https://github.com/M0ti0n/GNEZDO/tree/main/SPECIAL%20TOOLS";

interface Props {
  session: FitSession;
  onSession: (s: FitSession) => void;
  /** A part (by its sig) waiting in the import list, saved, or not added yet. */
  stateOf: (sig: string) => FitPartState;
  /** The Import 2D properties' material and thickness (used where the tool has none of its own). */
  importMaterial: string;
  importThickness: string;
  /** The parts into the import list, `count` sets of them, with their material and thickness ("": the
   *  Import 2D properties'); the same part again replaces the one waiting. */
  onSend: (parts: { part: FittingPart; sig: string }[], count: number, own: { material: string; thicknessMm: string }) => void;
}

export function FittingsPage(props: Props) {
  const { session, onSession } = props;
  const store = useToolStore();
  const plugins = activeTools(store);
  // the tool picked, else the first one (none picked yet, or the picked one switched off or removed)
  const picked = session.kind.startsWith("tool:") ? session.kind.slice(5) : null;
  const plugin = plugins.find((t) => t.manifest.id === picked) ?? plugins[0];
  const onTool = (id: string) => { if (id.startsWith("tool:")) onSession({ ...session, kind: id as FitSession["kind"] }); };
  const strip = (
    <ImportToolStrip active={plugin ? `tool:${plugin.manifest.id}` : null} onTool={onTool}
      strip={plugins.map((t) => `tool:${t.manifest.id}`)}
      extra={plugins.map((t) => ({ id: `tool:${t.manifest.id}`, label: t.manifest.name, icon: pluginIcon(t.icon ? svgUrl(t.icon) : null) }))} />
  );
  if (!plugin) {
    return (
      <div className="import uf fit">
        {strip}
        <section className="uf-pane fit-pane is-alone" aria-label="Special tools">
          <div className="uf-empty">
            {store.loaded
              ? <div className="fit-none">
                  <p><b>No special tools yet.</b></p>
                  <p>A special tool makes flat parts from values. Add one in <b>Settings → Special tools → Add tool…</b> (a .gnezdo-tool.zip).</p>
                  <p>The fittings (segmented elbow, rectangle to round, branch reducer, flange, threaded flange, screw flight) and an example tool are in <a href={GUIDE} target="_blank" rel="noreferrer">SPECIAL TOOLS on GitHub</a>.</p>
                </div>
              : <p>Loading the special tools…</p>}
          </div>
        </section>
      </div>
    );
  }
  return <PluginTool {...props} strip={strip} pkg={plugin} key={plugin.manifest.id} />;
}

/** Everything a special tool's screen shows besides its own form. */
interface Made {
  kind: string;
  heading: string;
  icon: ReactNode;
  form: ReactNode;
  parts: FittingPart[];
  problems: string[];
  sigs: string[];
  /** The parts' name when none is given */
  title: string;
  countLabel: string;
  pill: string;
  /** A thickness the tool recommends (the flanges'): the thickness until another is set */
  rec?: string;
  busy?: boolean;
  onClear: () => void;
}

function FitScreen({ session, onSession, stateOf, importMaterial, importThickness, onSend, strip, made }: Props & { strip: ReactNode; made: Made }) {
  const { kind, parts, problems, sigs, rec = "" } = made;
  const count = session.count[kind] ?? 1;
  const name = session.name?.[kind] ?? "";
  const material = session.material?.[kind] ?? "";
  const thick = session.thick?.[kind] ?? rec;
  const lists = usePickLists(material || importMaterial);
  const pickKey = parts.some((p) => p.key === session.pick[kind]) ? session.pick[kind] : parts[0]?.key;
  const pi = parts.findIndex((p) => p.key === pickKey);
  const shown = pi >= 0 ? parts[pi] : undefined;
  const drawing = useMemo(() => (shown ? { id: `fit-${shown.key}`, fileName: shown.name, entities: shown.entities } : null), [shown]);
  const setOwn = (k: "name" | "material" | "thick", v: string) => onSession({ ...session, [k]: { ...(session[k] ?? {}), [kind]: v } });

  return (
    <div className="import uf fit">
      {strip}
      <section className={`uf-pane fit-pane${made.busy ? " is-busy" : ""}`} aria-label="Canvas">
        <h3>{shown ? <>{shown.name} <em>{shown.label} ×{shown.qty * count} · {fmt(shown.w)} × {fmt(shown.h)} mm{stateOf(sigs[pi]) === "saved" ? " · processed ✓" : stateOf(sigs[pi]) === "listed" ? " · sent to Import 2D" : ""}</em></> : made.heading}</h3>
        {drawing ? <div className="fit-canvas"><Preview drawing={drawing} /></div>
          : <div className="uf-empty">{made.busy && !problems.length ? <p>Working…</p> : <ul className="uf-problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}</div>}
        <p className="fit-hint"><b>{made.heading}</b> · The part picked in the list is on the canvas. <b>Send to Import 2D</b> puts the parts in the import list, to be processed there; once processed, a part&apos;s box gets a check mark.</p>
      </section>

      <aside className="uf-panel fit-panel" aria-label={made.heading}>
        <header>
          <h2 className="fit-title"><span className="fit-title-ic">{made.icon}</span>{made.heading}</h2>
          <span className="uf-pill is-ok">{made.pill}</span>
        </header>
        <div className="uf-body">
          {made.form}

          {problems.length > 0 && <ul className="uf-problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}

          <h3 className="uf-lbl">Parts <small>pick one to show it</small></h3>
          <div className="fit-parts">
            {parts.map((p, i) => {
              const st = stateOf(sigs[i]);
              return (
                <button key={p.key} type="button" className={`fit-part${p.key === pickKey ? " is-pick" : ""}`} aria-pressed={p.key === pickKey}
                  onClick={() => onSession({ ...session, pick: { ...session.pick, [kind]: p.key } })}>
                  <span className={`fit-box${st === "saved" ? " is-done" : ""}`} aria-label={st === "saved" ? "Processed" : "Not processed yet"}>
                    {st === "saved" && <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M2 6.5 5 9.5 10 3" fill="none" stroke="#fff" strokeWidth="2" /></svg>}
                  </span>
                  <span className="fit-part-name"><b>{p.name}</b> · {p.label}{st === "listed" && <em> sent to Import 2D</em>}</span>
                  <span className="fit-part-qty">×{p.qty * count}</span>
                </button>
              );
            })}
          </div>
          <h3 className="uf-lbl">For Import 2D <small>as the 3D extractor&apos;s parts</small></h3>
          <div className="uf-row uf-name">
            <label htmlFor="fit-name">Name</label>
            <NameField key={`${kind}:${name}`} value={name} placeholder={made.title} onCommit={(v) => setOwn("name", v)} />
          </div>
          <div className="uf-row uf-name fit-own">
            <label htmlFor="fit-count">{made.countLabel}</label>
            <NumInput id="fit-count" className="field uf-num uf-qty" value={count} min={1} int onCommit={(n) => onSession({ ...session, count: { ...session.count, [kind]: Math.max(1, n) } })} />
            <div className="uf-mat">
              <Combobox value={material}
                // a new material empties the thickness, so both are chosen together (a flange keeps its recommended one)
                onChange={(m) => onSession({ ...session, material: { ...(session.material ?? {}), [kind]: m }, thick: { ...(session.thick ?? {}), [kind]: m === material ? thick : rec } })}
                options={lists.strict ? lists.techMaterials : lists.materials} strict={lists.strict} strictNote="not in the Technology tables (Settings → Machines → Technology: material tags)"
                placeholder={importMaterial ? `${importMaterial} (Import 2D)` : "Material"} ariaLabel="Material" newHint="a new material" />
            </div>
            <div className="fit-thick">
              <Combobox value={thick} onChange={(t) => setOwn("thick", t.replace(",", ".").replace(/[^\d.]/g, ""))}
                options={lists.strict ? lists.techThicknesses : lists.thicknesses} strict={lists.strict} strictNote="no Technology row for this thickness of this material (Settings → Machines → Technology)"
                placeholder={importThickness ? `${importThickness} (Import 2D)` : "Thickness"} ariaLabel="Thickness in mm" suffix="mm" numeric newHint="a new thickness" />
            </div>
          </div>
          <p className="uf-note uf-name-note">The parts are named after it ({parts.length > 1 ? "with -A, -B, … where it makes several" : "one part"}). No material or thickness: the Import 2D properties&apos; ones.</p>
        </div>
        <footer className="fit-actions">
          <button type="button" className="btn" onClick={made.onClear} title="Back to the starting values">Clear</button>
          <button type="button" className="btn btn-primary" disabled={!parts.length || made.busy} onClick={() => onSend(parts.map((part, i) => ({ part, sig: sigs[i] })), count, { material: material.trim(), thicknessMm: thick.trim() })}
            title="The parts go into the Import 2D list with their quantity, material and thickness, to be processed there (sent again: the part waiting there is replaced)">Send to Import 2D</button>
        </footer>
      </aside>
    </div>
  );
}

// ------------------------------------------------------------------ a plug-in tool (Settings -> Special tools)

/** A plug-in tool's parts for its values, run in its sandbox; the last result stays while a new one is made. */
function usePluginResult(pkg: ToolPackage, values: ToolValues): { result: ToolResult | null; busy: boolean } {
  const key = JSON.stringify(values);
  const [got, setGot] = useState<{ pkg: ToolPackage; key: string; result: ToolResult } | null>(null);
  useEffect(() => {
    let live = true;
    void runToolPackage(pkg, values).then((result) => { if (live) setGot({ pkg, key, result }); });
    return () => { live = false; };
  }, [pkg, key]);   // eslint-disable-line react-hooks/exhaustive-deps
  const fresh = got?.pkg === pkg && got.key === key;
  return { result: got?.pkg === pkg ? got.result : null, busy: !fresh };
}

const toolSig = (pkg: ToolPackage, values: ToolValues, key: string) => `tool:${pkg.manifest.id}@${pkg.manifest.toolVersion ?? ""}:${JSON.stringify(values)}:${key}`;

function PluginTool({ strip, pkg, ...props }: Props & { strip: ReactNode; pkg: ToolPackage }) {
  const { session, onSession } = props;
  const m = pkg.manifest;
  const kind = `tool:${m.id}`;
  const values = useMemo(() => toolValues(m, session.tools?.[m.id]), [m, session.tools]);
  const name = session.name?.[kind] ?? "";
  const { result, busy } = usePluginResult(pkg, values);
  const set = (patch: ToolValues) => onSession({ ...session, tools: { ...(session.tools ?? {}), [m.id]: { ...values, ...patch } } });
  const ok = result && !("error" in result) ? result : null;
  const title = ok?.title || m.name.toUpperCase();
  const head = name.trim() || title;
  const parts: FittingPart[] = (ok?.parts ?? []).map((p) => {
    const sfx = p.suffix ?? ((ok?.parts.length ?? 0) > 1 ? p.key : "");
    return { key: p.key, label: p.label, name: sfx ? `${head}-${sfx}` : head, qty: p.qty, entities: p.entities, w: p.w, h: p.h };
  });
  const problems = !result ? [] : "error" in result ? [`The tool failed: ${result.error}`] : result.problems;
  const pieces = parts.reduce((n, p) => n + p.qty, 0) * (session.count[kind] ?? 1);
  return <FitScreen {...props} strip={strip} made={{
    kind, heading: m.name, icon: pluginIcon(pkg.icon ? svgUrl(pkg.icon) : null), parts, problems, busy,
    sigs: parts.map((p) => toolSig(pkg, values, p.key)), title, countLabel: m.countLabel || "Pieces",
    pill: parts.length === 1 ? `${pieces} ${pieces === 1 ? "piece" : "pieces"}` : `${parts.length} parts`,
    onClear: () => onSession({ ...session, tools: { ...(session.tools ?? {}), [m.id]: toolValues(m) }, count: { ...session.count, [kind]: 1 }, name: { ...(session.name ?? {}), [kind]: "" } }),
    form: <PluginForm pkg={pkg} values={values} set={set} />,
  }} />;
}

/** A plug-in tool's form, from its tool.json: value boxes on its diagram, the rest in rows by group. */
function PluginForm({ pkg, values, set }: { pkg: ToolPackage; values: ToolValues; set: (p: ToolValues) => void }) {
  const m = pkg.manifest;
  const onDiagram = (f: ToolField) => !!pkg.diagram && !!f.at && (f.type === "number" || f.type === "int");
  const boxes = m.fields.filter(onDiagram);
  const rows = m.fields.filter((f) => !onDiagram(f));
  const groups: { name: string; fields: ToolField[] }[] = [];
  for (const f of rows) {
    const g = f.group ?? "";
    const at = groups.find((x) => x.name === g);
    if (at) at.fields.push(f); else groups.push({ name: g, fields: [f] });
  }
  const numIn = (f: ToolField, cls: string, label: string) => (
    <NumInput className={cls} value={values[f.key] as number} min={f.min ?? -1e9} int={f.type === "int"} aria-label={label}
      onCommit={(n) => set({ [f.key]: f.max !== undefined ? Math.min(f.max, n) : n })} placeholder="0" />
  );
  return (<>
    {pkg.diagram && (
      <div className="li-editor fit-diagram">
        <img className="fit-diagram-img" src={svgUrl(pkg.diagram)} alt="" />
        {boxes.map((f) => {
          const c = COL[f.color ?? "dark"];
          return (
            <label key={f.key} className="li-val fit-val" style={{ left: `${f.at![0]}%`, top: `${f.at![1]}%`, borderColor: c[0] }} title={f.title ?? f.label}>
              <b style={{ color: c[1] }}>{f.label}</b>
              {numIn(f, "li-num", f.title ?? f.label)}
              <span>{f.unit ?? ""}</span>
            </label>
          );
        })}
      </div>
    )}
    {groups.map((g) => (
      <div key={g.name || "-"} className="fit-group">
        {g.name && <h3 className="uf-lbl">{g.name}</h3>}
        {g.fields.map((f) => (
          <div key={f.key} className="fit-field">
            {f.type === "check" ? (
              <label className="fit-check" title={f.title}><input type="checkbox" checked={values[f.key] === true} onChange={(e) => set({ [f.key]: e.target.checked })} /> {f.label}</label>
            ) : f.type === "choice" ? (
              <div className="uf-row"><span title={f.title}>{f.label}</span>
                <div className="fit-chips">
                  {f.options!.map((o) => <Chip key={String(o.value)} on={values[f.key] === o.value} onClick={() => set({ [f.key]: o.value })}>{o.label}</Chip>)}
                </div>
              </div>
            ) : f.type === "text" ? (
              <div className="uf-row"><label title={f.title}>{f.label}</label>
                <input className="field fit-text" value={values[f.key] as string} aria-label={f.title ?? f.label} spellCheck={false} onChange={(e) => set({ [f.key]: e.target.value })} /></div>
            ) : (
              <div className="uf-row"><label title={f.title}>{f.label}</label>{numIn(f, "field uf-num", f.title ?? f.label)}{f.unit && <small>{f.unit}</small>}</div>
            )}
            {f.note && <p className="uf-note">{f.note}</p>}
          </div>
        ))}
      </div>
    ))}
    {m.note && <p className="uf-note">{m.note}</p>}
  </>);
}

const fmt = (x: number) => (Math.round(x * 10) / 10).toLocaleString("en-US", { maximumFractionDigits: 1 });

/** The parts' name for Import 2D: committed on Enter or leaving the field; empty: its own (the placeholder). */
function NameField({ value, placeholder, onCommit }: { value: string; placeholder: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value);
  const done = () => { const t = v.trim().replace(/[\\/:*?"<>|]/g, "_"); if (t !== value) onCommit(t); setV(t); };
  return (
    <input id="fit-name" className="field" value={v} placeholder={placeholder} spellCheck={false} aria-label="Name of the parts for Import 2D"
      onChange={(e) => setV(e.target.value)} onBlur={done}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setV(value); setTimeout(() => (e.target as HTMLInputElement).blur(), 0); } }} />
  );
}

// ------------------------------------------------------------------ the value boxes' colors, choice buttons

const COL = {
  blue: ["#1e8db5", "#0d5873"], green: ["#4c9a2a", "#2d6316"], purple: ["#8a4fb3", "#57297a"], brown: ["#a8683a", "#6b3f1e"],
  red: ["#c2412d", "#8a2a1c"], dark: ["#1b2a30", "#1b2a30"], orange: ["#e98a15", "#7a4205"],
} as const;

const Chip = ({ on, onClick, children, disabled, title }: { on: boolean; onClick: () => void; children: ReactNode; disabled?: boolean; title?: string }) => (
  <button type="button" className={`fit-chip${on ? " is-on" : ""}`} aria-pressed={on} onClick={onClick} disabled={disabled} title={title}>{children}</button>
);
