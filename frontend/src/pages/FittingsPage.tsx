import { useMemo, type ReactNode } from "react";
import { ImportToolStrip, IMPORT_TOOLS, fitIcon } from "../import/ImportTools";
import { Preview } from "../import/ProcessDialog";
import { NumInput } from "../components/NumInput";
import {
  FITTING_DEFAULTS, FITTING_NAMES, fittingParts, fittingSig,
  type FitSession, type FittingKind, type FittingPart, type FittingValues,
} from "../import/fittings";
import { FLANGE_SIZES, THREADS, canDivide, flangeFor, isStandard, threadFlangeFor, threadSize } from "../import/fittings/flange";
import { screwResult } from "../import/fittings/screw";

// Import 2D -> FITTINGS: flat parts of sheet metal fittings made from their values (the HVAC Fittings
// workbench). One part on the canvas at a time, picked in the list; PROCESS saves it like any imported
// drawing, and "Add to the import list" puts them all in the Import 2D list to be saved there.

export type FitPartState = "new" | "listed" | "saved";

interface Props {
  session: FitSession;
  onSession: (s: FitSession) => void;
  /** A part (by its sig) waiting in the import list, saved, or not added yet. */
  stateOf: (sig: string) => FitPartState;
  /** Material, thickness and project of the import list (Properties), as text. */
  properties: string;
  onProperties: () => void;
  /** The parts into the import list, `count` fittings of them (the same part again replaces the one waiting). */
  onAdd: (parts: { part: FittingPart; sig: string }[], count: number) => void;
  /** PROCESS: the part into the import list (if not there yet) and its save pop-up. */
  onProcess: (part: FittingPart, sig: string, count: number) => void;
}

const COUNT_LABEL: Record<FittingKind, string> = { elbow: "Elbows", transition: "Fittings", branch: "Fittings", flange: "Flanges", thread: "Flanges", screw: "Screws" };
const NOT_HERE = "add the parts to the import list and open one there to change its lines";

export function FittingsPage({ session, onSession, stateOf, properties, onProperties, onAdd, onProcess }: Props) {
  const kind = session.kind;
  const values = session.values[kind];
  const count = session.count[kind];
  const { parts, problems } = useMemo(() => fittingParts(kind, values), [kind, values]);
  const sigs = parts.map((p) => fittingSig(kind, values, p.key));
  const pickKey = parts.some((p) => p.key === session.pick[kind]) ? session.pick[kind] : parts[0]?.key;
  const pi = parts.findIndex((p) => p.key === pickKey);
  const shown = pi >= 0 ? parts[pi] : undefined;
  const drawing = useMemo(() => (shown ? { id: `fit-${shown.key}`, fileName: shown.name, entities: shown.entities } : null), [shown]);

  const set = <K extends FittingKind>(k: K, patch: Partial<FittingValues[K]>) =>
    onSession({ ...session, values: { ...session.values, [k]: { ...session.values[k], ...patch } } });
  const blocked: Record<string, string> = {};
  for (const t of IMPORT_TOOLS) if (!t.id.startsWith("fit-") && t.id !== "process" && t.id !== "properties") blocked[t.id] = NOT_HERE;
  if (!shown) blocked.process = problems.length ? "fix the values first" : "no part";
  const onTool = (id: string) => {
    if (id.startsWith("fit-")) onSession({ ...session, kind: id.slice(4) as FittingKind });
    else if (id === "process" && shown) onProcess(shown, sigs[pi], count);
    else if (id === "properties") onProperties();
  };
  const pieces = parts.reduce((n, p) => n + p.qty, 0) * count;

  return (
    <div className="import uf fit">
      <ImportToolStrip active={`fit-${kind}`} onTool={onTool} blocked={blocked} openGroup="fitGroup" />
      <section className="uf-pane fit-pane" aria-label="Canvas">
        <h3>{shown ? <>{shown.name} <em>{shown.label} ×{shown.qty * count} · {fmt(shown.w)} × {fmt(shown.h)} mm{stateOf(sigs[pi]) === "saved" ? " · processed ✓" : stateOf(sigs[pi]) === "listed" ? " · in the import list" : ""}</em></> : FITTING_NAMES[kind]}</h3>
        {drawing ? <div className="fit-canvas"><Preview drawing={drawing} /></div>
          : <div className="uf-empty"><ul className="uf-problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul></div>}
        <p className="fit-hint"><b>{FITTING_NAMES[kind]}</b> · The part picked in the list is on the canvas. <b>PROCESS</b> it; once processed its box gets a check mark.</p>
      </section>

      <aside className="uf-panel fit-panel" aria-label={FITTING_NAMES[kind]}>
        <header>
          <h2 className="fit-title"><span className="fit-title-ic">{fitIcon(kind)}</span>{FITTING_NAMES[kind]}</h2>
          <span className="uf-pill is-ok">{kind === "screw" ? `${pieces} ${pieces === 1 ? "piece" : "pieces"}` : `${parts.length} ${parts.length === 1 ? "part" : "parts"}`}</span>
        </header>
        <div className="uf-body">
          {kind === "elbow" && <Elbow v={session.values.elbow} set={(p) => set("elbow", p)} />}
          {kind === "transition" && <Transition v={session.values.transition} set={(p) => set("transition", p)} />}
          {kind === "branch" && <Branch v={session.values.branch} set={(p) => set("branch", p)} />}
          {kind === "flange" && <Flange v={session.values.flange} set={(p) => set("flange", p)} />}
          {kind === "thread" && <Thread v={session.values.thread} set={(p) => set("thread", p)} />}
          {kind === "screw" && <Screw v={session.values.screw} set={(p) => set("screw", p)} ok={!problems.length} />}

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
                  <span className="fit-part-name"><b>{p.name}</b> · {p.label}{st === "listed" && <em> in the import list</em>}</span>
                  <span className="fit-part-qty">×{p.qty * count}</span>
                </button>
              );
            })}
          </div>
          <div className="uf-row fit-count">
            <label htmlFor="fit-count">{COUNT_LABEL[kind]}</label>
            <NumInput id="fit-count" className="field uf-num" value={count} min={1} int onCommit={(n) => onSession({ ...session, count: { ...session.count, [kind]: Math.max(1, n) } })} />
            <button type="button" className="link fit-props" onClick={onProperties} title="Material, thickness and project come from the Import 2D Properties">{properties}</button>
          </div>
        </div>
        <footer className="fit-actions">
          <button type="button" className="btn" onClick={() => onSession({ ...session, values: { ...session.values, [kind]: FITTING_DEFAULTS[kind] }, count: { ...session.count, [kind]: 1 } })}
            title="Back to the starting values">Clear</button>
          <button type="button" className="btn btn-primary" disabled={!parts.length} onClick={() => onAdd(parts.map((part, i) => ({ part, sig: sigs[i] })), count)}
            title="The parts go into the Import 2D list, waiting to be processed (the same part again replaces the one waiting)">Add to the import list</button>
        </footer>
      </aside>
    </div>
  );
}

const fmt = (x: number) => (Math.round(x * 10) / 10).toLocaleString("en-US", { maximumFractionDigits: 1 });

// ------------------------------------------------------------------ the diagrams, values in boxes on them

const COL = {
  blue: ["#1e8db5", "#0d5873"], green: ["#4c9a2a", "#2d6316"], purple: ["#8a4fb3", "#57297a"], brown: ["#a8683a", "#6b3f1e"],
  red: ["#c2412d", "#8a2a1c"], dark: ["#1b2a30", "#1b2a30"], orange: ["#e98a15", "#7a4205"],
} as const;
type Col = keyof typeof COL;

function Val({ x, y, c, k, title, unit = "mm", value, min = 0, int = false, wide, onCommit }: {
  x: number; y: number; c: Col; k: string; title: string; unit?: string; value: number; min?: number; int?: boolean; wide?: boolean; onCommit: (n: number) => void;
}) {
  return (
    <label className="li-val fit-val" style={{ left: `${x}%`, top: `${y}%`, borderColor: COL[c][0] }} title={title}>
      <b style={{ color: COL[c][1] }}>{k}</b>
      <NumInput value={value} min={min} int={int} aria-label={title} className={`li-num${wide ? " is-wide" : ""}`} onCommit={onCommit} placeholder="0" />
      <span>{unit}</span>
    </label>
  );
}

const Diagram = ({ children, svg }: { children: ReactNode; svg: ReactNode }) => (
  <div className="li-editor fit-diagram"><svg viewBox="0 0 300 220" aria-hidden="true">{svg}</svg>{children}</div>
);

const Chip = ({ on, onClick, children, disabled, title }: { on: boolean; onClick: () => void; children: ReactNode; disabled?: boolean; title?: string }) => (
  <button type="button" className={`fit-chip${on ? " is-on" : ""}`} aria-pressed={on} onClick={onClick} disabled={disabled} title={title}>{children}</button>
);

const T = ({ x, y, children, c = "#7b8c92", end }: { x: number; y: number; children: ReactNode; c?: string; end?: boolean }) => (
  <text x={x} y={y} textAnchor={end ? "end" : undefined} fontFamily="Barlow, sans-serif" fontSize="10" fill={c}>{children}</text>
);

const S = "#1b2a30", MUTED = "#7b8c92";

function FoldMarks({ folds, markLen, markGap, set, around = true }: { folds: number; markLen: number; markGap: number; set: (p: { folds?: number; markLen?: number; markGap?: number }) => void; around?: boolean }) {
  return (<>
    <h3 className="uf-lbl">Fold marks <small>tracing lines</small></h3>
    <div className="uf-row">
      <label className="fit-check"><input type="checkbox" checked={folds > 0} onChange={(e) => set({ folds: e.target.checked ? 24 : 0 })} /> Fold marks</label>
      {around && folds > 0 && <><NumInput className="field uf-num" value={folds} min={1} int aria-label="Fold marks around" onCommit={(n) => set({ folds: Math.max(1, n) })} /> around</>}
    </div>
    {folds > 0 && <div className="uf-row fit-sub">
      <NumInput className="field uf-num" value={markLen} min={0.5} aria-label="Mark length" onCommit={(n) => set({ markLen: n })} /> mm long,
      <NumInput className="field uf-num" value={markGap} min={0} aria-label="Gap from the edge" onCommit={(n) => set({ markGap: n })} /> mm in from the edge
    </div>}
  </>);
}

function Elbow({ v, set }: { v: FittingValues["elbow"]; set: (p: Partial<FittingValues["elbow"]>) => void }) {
  return (<>
    <Diagram svg={<>
      <path d="M140 196H216L213 166L138.5 180.8Z" fill="#f1e6f8" stroke={S} strokeWidth="1.6" />
      <path d="M138.5 180.8L213 166L190 110.4L126.9 152.7Z" fill="#e7f1f8" stroke={S} strokeWidth="1.6" />
      <path d="M126.9 152.7L190 110.4L147.6 68L105.3 131.1Z" fill="#e7f1f8" stroke={S} strokeWidth="1.6" />
      <path d="M105.3 131.1L147.6 68L92 45L77.2 119.5Z" fill="#e7f1f8" stroke={S} strokeWidth="1.6" />
      <path d="M77.2 119.5L92 45L62 42L62 118Z" fill="#f1e6f8" stroke={S} strokeWidth="1.6" />
      <path d="M178 196A116 116 0 0 0 62 80" fill="none" stroke={MUTED} strokeWidth="1" strokeDasharray="8 3 2 3" />
      <path d="M62 196 144 114" stroke="#4c9a2a" strokeWidth="1.8" />
      <circle cx="62" cy="196" r="3" fill="#4c9a2a" />
      <path d="M98 196A36 36 0 0 0 62 160" fill="none" stroke="#8a4fb3" strokeWidth="1.8" />
      <path d="M62 196H140 M62 196V118" stroke="#8a4fb3" strokeWidth="1" strokeDasharray="3 3" />
      <path d="M140 210H216 M140 204v12 M216 204v12" stroke="#1e8db5" strokeWidth="1.8" />
      <T x={178} y={185} c="#57297a">E</T><T x={70} y={82} c="#57297a">E</T>
      <T x={232} y={70} c="#4f6168">E = ½ middle</T>
    </>}>
      <Val x={59} y={95} c="blue" k="D" title="D: diameter (neutral)" value={v.d} onCommit={(n) => set({ d: n })} />
      <Val x={36} y={72} c="green" k="R" title="R: centerline radius" value={v.r} onCommit={(n) => set({ r: n })} />
      <Val x={13} y={92} c="purple" k="A" title="A: elbow angle" unit="°" value={v.a} onCommit={(n) => set({ a: n })} />
      <Val x={76} y={38} c="brown" k="N" title="N: middle sections" unit="middle" int value={v.n} onCommit={(n) => set({ n })} />
    </Diagram>
    <h3 className="uf-lbl">Pieces</h3>
    <div className="fit-chips">
      <Chip on={!v.stacked} onClick={() => set({ stacked: false })}>Separate sections</Chip>
      <Chip on={v.stacked} onClick={() => set({ stacked: true })}>Stacked in one rectangle</Chip>
    </div>
    <p className="uf-note">Seam always at the side, so the sections fit together; stacked, open cuts separate them (every other section turned round).</p>
    <FoldMarks folds={v.folds} markLen={v.markLen} markGap={v.markGap} set={set} />
  </>);
}

function Transition({ v, set }: { v: FittingValues["transition"]; set: (p: Partial<FittingValues["transition"]>) => void }) {
  return (<>
    <Diagram svg={<>
      <T x={18} y={16}>from above</T>
      <path d="M18 26H176V146H18z" fill="#e7f1f8" stroke={S} strokeWidth="1.6" />
      <circle cx="112" cy="94" r="30" fill="#fff" stroke={S} strokeWidth="1.6" />
      <path d="M18 26 92 72 M176 26 136 76 M176 146 134 114 M18 146 88 114" stroke={MUTED} strokeWidth="1" strokeDasharray="3 3" />
      <path d="M112 26V146 M18 94H176" stroke={MUTED} strokeWidth=".8" strokeDasharray="8 3 2 3" />
      <path d="M18 162H112 M18 156v12 M112 156v12" stroke="#1e8db5" strokeWidth="1.8" />
      <path d="M112 162H176 M176 156v12" stroke="#4c9a2a" strokeWidth="1.8" />
      <path d="M190 26V94 M184 26h12 M184 94h12" stroke="#8a4fb3" strokeWidth="1.8" />
      <path d="M190 94V146 M184 146h12" stroke="#a8683a" strokeWidth="1.8" />
      <path d="M82 94H142" stroke="#c2412d" strokeWidth="1.8" />
      <T x={226} y={16}>side</T>
      <path d="M222 40H292 M240 132H274 M222 40 240 132 M292 40 274 132" fill="none" stroke={S} strokeWidth="1.6" />
      <path d="M284 40v92 M278 40h12 M278 132h12" stroke={S} strokeWidth="1.4" />
    </>}>
      <Val x={22} y={74} c="blue" k="A" title="A: rectangle edge left of the round's center" value={v.a} onCommit={(n) => set({ a: n })} />
      <Val x={48} y={86} c="green" k="B" title="B: rectangle edge right of the round's center" value={v.b} onCommit={(n) => set({ b: n })} />
      <Val x={70} y={27} c="purple" k="E" title="E: rectangle edge above the round's center" value={v.e} onCommit={(n) => set({ e: n })} />
      <Val x={70} y={56} c="brown" k="F" title="F: rectangle edge below the round's center" value={v.f} onCommit={(n) => set({ f: n })} />
      <Val x={37} y={43} c="red" k="D" title="D: diameter of the round end" value={v.d} onCommit={(n) => set({ d: n })} />
      <Val x={88} y={84} c="dark" k="H" title="H: height" value={v.h} onCommit={(n) => set({ h: n })} />
    </Diagram>
    <h3 className="uf-lbl">Pieces</h3>
    <div className="fit-chips">
      <Chip on={v.combined} onClick={() => set({ combined: !v.combined })}>Combined</Chip>
      <Chip on={v.short} onClick={() => set({ short: !v.short })}>Short side</Chip>
      <Chip on={v.long} onClick={() => set({ long: !v.long })}>Long side</Chip>
    </div>
    <div className="uf-row">Sections per quarter of the round <NumInput className="field uf-num" value={v.n} min={1} int aria-label="N: sections per quarter of the round" onCommit={(n) => set({ n: Math.max(1, n) })} /></div>
    <p className="uf-note">Seam on the longer side, straight down from the round. Short side: its triangle and the two corner fans (half the round); long side: the flat triangle.</p>
    <h3 className="uf-lbl">Fold marks <small>tracing lines</small></h3>
    <div className="uf-row">
      <label className="fit-check"><input type="checkbox" checked={v.folds} onChange={(e) => set({ folds: e.target.checked })} /> At the round edge,</label>
      <NumInput className="field uf-num" value={v.markLen} min={0.5} aria-label="Mark length" onCommit={(n) => set({ markLen: n })} disabled={!v.folds} /> mm long
    </div>
  </>);
}

function Branch({ v, set }: { v: FittingValues["branch"]; set: (p: Partial<FittingValues["branch"]>) => void }) {
  return (<>
    <Diagram svg={<>
      <path d="M70 24H190L170 196H90z" fill="#e7f1f8" stroke={S} strokeWidth="1.6" />
      <path d="M183 83 255.6 41 277.6 79 178 136.5" fill="#f1e6f8" stroke={S} strokeWidth="1.6" />
      <path d="M130 14V206" stroke={MUTED} strokeWidth=".8" strokeDasharray="8 3 2 3" />
      <path d="M180 110 266.6 60" stroke={MUTED} strokeWidth=".8" strokeDasharray="8 3 2 3" />
      <path d="M130 110V196 M124 110h12" stroke="#a8683a" strokeWidth="1.8" />
      <path d="M52 24V196 M46 24h12 M46 196h12" stroke="#8a4fb3" strokeWidth="1.8" />
      <path d="M180 110H222" stroke={S} strokeWidth="1" strokeDasharray="3 3" />
      <path d="M216 110A36 36 0 0 0 211.2 92" fill="none" stroke="#c2412d" strokeWidth="1.8" />
      <path d="M130 110H180" stroke={MUTED} strokeWidth="1" strokeDasharray="2 3" />
      <T x={96} y={214} c="#c2412d">reducer seam through the hole</T>
    </>}>
      <Val x={43} y={6} c="blue" k="D1" title="D1: reducer diameter at the top" value={v.d1} onCommit={(n) => set({ d1: n })} />
      <Val x={43} y={82} c="green" k="D2" title="D2: reducer diameter at the bottom" value={v.d2} onCommit={(n) => set({ d2: n })} />
      <Val x={15} y={50} c="purple" k="H1" title="H1: reducer height" value={v.h1} onCommit={(n) => set({ h1: n })} />
      <Val x={43} y={62} c="brown" k="H2" title="H2: height where the branch axis meets the reducer's side" value={v.h2} onCommit={(n) => set({ h2: n })} />
      <Val x={86} y={14} c="blue" k="D3" title="D3: branch diameter" value={v.d3} onCommit={(n) => set({ d3: n })} />
      <Val x={82} y={50} c="green" k="L" title="L: along the branch axis to its end" value={v.l} onCommit={(n) => set({ l: n })} />
      <Val x={82} y={66} c="red" k="A" title="A: branch angle above the horizontal (negative: down)" unit="°" min={-89} value={v.a} onCommit={(n) => set({ a: n })} />
    </Diagram>
    <h3 className="uf-lbl">Seams</h3>
    <p className="uf-note">Reducer: straight through the middle of the branch hole (two half holes). Branch: on its shortest line. D1 = D2: a straight pipe (tee or lateral); a negative angle points the branch down.</p>
    <FoldMarks folds={v.folds} markLen={v.markLen} markGap={v.markGap} set={set} />
  </>);
}

const RING = (<>
  <circle cx="112" cy="112" r="92" fill="#e7f1f8" stroke={S} strokeWidth="1.6" />
  <circle cx="112" cy="112" r="52" fill="#fbfdfd" stroke={S} strokeWidth="1.6" />
  <circle cx="112" cy="112" r="72" fill="none" stroke={MUTED} strokeWidth=".8" strokeDasharray="8 3 2 3" />
</>);
const DIMS = (<>
  <path d="M60 112H164" stroke="#1e8db5" strokeWidth="1.8" />
  <path d="M112 112 163 61" stroke="#4c9a2a" strokeWidth="1.6" />
  <path d="M164 112H204 M204 104v16 M164 104v16" stroke="#a8683a" strokeWidth="1.6" />
</>);
const SLOTS = "M120.8 40.5A72 72 0 0 0 103.2 40.5M67.7 55.3A72 72 0 0 0 55.3 67.7M40.5 103.2A72 72 0 0 0 40.5 120.8M55.3 156.3A72 72 0 0 0 67.7 168.7M103.2 183.5A72 72 0 0 0 120.8 183.5M156.3 168.7A72 72 0 0 0 168.7 156.3M183.5 120.8A72 72 0 0 0 183.5 103.2M168.7 67.7A72 72 0 0 0 156.3 55.3";

function SizeSelect({ a, standard, onPick, note }: { a: number; standard: boolean; onPick: (a: number) => void; note: string }) {
  return (
    <div className="uf-row">
      <label htmlFor="fit-size">Standard size</label>
      <select id="fit-size" className="field fit-size" value={standard ? String(a) : ""} onChange={(e) => e.target.value && onPick(Number(e.target.value))}>
        {!standard && <option value="">custom</option>}
        {FLANGE_SIZES.map((s) => <option key={s} value={s}>A{s}</option>)}
      </select>
      <small>{note}</small>
    </div>
  );
}

function Divide({ v, set }: { v: { a: number; n: number; whole: boolean; divided: boolean }; set: (p: { whole?: boolean; divided?: boolean }) => void }) {
  const can = canDivide(v.a, v.n);
  return (<>
    <h3 className="uf-lbl">Pieces</h3>
    <div className="fit-chips">
      <Chip on={v.whole} onClick={() => set({ whole: !v.whole })}>Combined</Chip>
      <Chip on={v.divided && can} disabled={!can} onClick={() => set({ divided: !v.divided })}
        title={can ? "Three 120° sections, the first cut midway between the top hole and the next" : "Only flanges over A 100 with 3 holes or more are divided"}>Divided (3 × 120°)</Chip>
    </div>
  </>);
}

function Flange({ v, set }: { v: FittingValues["flange"]; set: (p: Partial<FittingValues["flange"]>) => void }) {
  return (<>
    <SizeSelect a={v.a} standard={isStandard(v)} onPick={(a) => set(flangeFor(a, v))} note={`${FLANGE_SIZES.length} sizes, A${FLANGE_SIZES[0]} … A${FLANGE_SIZES[FLANGE_SIZES.length - 1]}`} />
    <Diagram svg={<>
      {RING}
      <path d={SLOTS} fill="none" stroke={S} strokeWidth="7" strokeLinecap="round" />
      <path d={SLOTS} fill="none" stroke="#fbfdfd" strokeWidth="4" strokeLinecap="round" />
      <path d="M92.1 64 76.8 27 M80.3 153.3 56 185 M163.6 118.8 203.2 124" stroke="#c2412d" strokeWidth="1.6" strokeDasharray="5 3" />
      {DIMS}
      <T x={226} y={186} c="#c2412d">Divided: 3 × 120°</T>
      <T x={226} y={198} c="#c2412d">first cut between slots</T>
    </>}>
      <Val x={37} y={58} c="blue" k="A" title="A: inner (nominal) diameter; a size from the table fills in the rest" value={v.a} onCommit={(n) => set(flangeFor(n, v))} />
      <Val x={64} y={22} c="green" k="B" title="B: diameter the slots lie on" value={v.b} onCommit={(n) => set({ b: n })} />
      <Val x={37} y={9} c="purple" k="M" title="M: slot width" value={v.m} onCommit={(n) => set({ m: n })} />
      <Val x={84} y={51} c="brown" k="E" title="E: ring width" value={v.e} onCommit={(n) => set({ e: n })} />
      <Val x={84} y={70} c="dark" k="N" title="N: number of slots" unit="slots" int value={v.n} onCommit={(n) => set({ n })} />
    </Diagram>
    <div className="uf-row fit-facts"><span>D = A + 2E = <b>{fmt(v.a + 2 * v.e)} mm</b></span><span>T recommended <b>{v.t} mm</b></span><span>slots 25 mm</span></div>
    <Divide v={v} set={set} />
  </>);
}

function Thread({ v, set }: { v: FittingValues["thread"]; set: (p: Partial<FittingValues["thread"]>) => void }) {
  const ts = threadSize(v.m);
  return (<>
    <SizeSelect a={v.a} standard={isStandard(v)} onPick={(a) => set(threadFlangeFor(a, v))} note="its own table" />
    <Diagram svg={<>
      {RING}
      <path d="M107 35l10 10M117 35l-10 10M56.1 56.1l10 10M66.1 56.1l-10 10M35 107l10 10M45 107l-10 10M56.1 157.9l10 10M66.1 157.9l-10 10M107 179l10 10M117 179l-10 10M157.9 157.9l10 10M167.9 157.9l-10 10M179 107l10 10M189 107l-10 10M157.9 56.1l10 10M167.9 56.1l-10 10" stroke="#c2412d" strokeWidth="2" />
      {DIMS}
      <T x={226} y={196} c="#c2412d">X: drill and tap here</T>
      <T x={226} y={208} c="#c2412d">(tracing)</T>
    </>}>
      <Val x={37} y={58} c="blue" k="A" title="A: inner (nominal) diameter; a size from the table fills in the rest" value={v.a} onCommit={(n) => set(threadFlangeFor(n, v))} />
      <Val x={64} y={22} c="green" k="B" title="B: diameter the holes lie on" value={v.b} onCommit={(n) => set({ b: n })} />
      <label className="li-val fit-val" style={{ left: "37%", top: "9%", borderColor: COL.red[0] }} title="M: thread">
        <b style={{ color: COL.red[1] }}>M</b>
        <select className="fit-thread" value={v.m} aria-label="M: thread" onChange={(e) => set({ m: e.target.value })}>
          {Object.keys(THREADS).map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </label>
      <Val x={84} y={51} c="brown" k="E" title="E: ring width" value={v.e} onCommit={(n) => set({ e: n })} />
      <Val x={84} y={70} c="dark" k="N" title="N: number of holes" unit="holes" int value={v.n} onCommit={(n) => set({ n })} />
    </Diagram>
    <div className="uf-row fit-facts"><span>Tap drill <b>{ts ? `${ts.drill} mm` : "?"}</b></span><span>D = <b>{fmt(v.a + 2 * v.e)} mm</b></span><span>T recommended <b>{v.t} mm</b></span></div>
    <h3 className="uf-lbl">Marks</h3>
    <div className="uf-row">X marks <NumInput className="field uf-num" value={v.mark} min={1} aria-label="X mark size" onCommit={(n) => set({ mark: n })} /> mm big, as tracing</div>
    <p className="uf-note">Only the ring is cut; the holes are drilled and tapped after cutting.</p>
    <Divide v={v} set={set} />
  </>);
}

function Screw({ v, set, ok }: { v: FittingValues["screw"]; set: (p: Partial<FittingValues["screw"]>) => void; ok: boolean }) {
  const r = ok ? screwResult(v) : null;
  return (<>
    <Diagram svg={<>
      <T x={14} y={16}>the screw</T>
      <path d="M14 98H146 M14 122H146" stroke={S} strokeWidth="1.4" />
      <path d="M22 60 46 160 M66 60 90 160 M110 60 134 160" stroke={S} strokeWidth="1.6" />
      <path d="M22 60H134 M46 160H146" stroke={MUTED} strokeWidth=".8" strokeDasharray="3 3" />
      <path d="M22 182H66 M22 176v12 M66 176v12" stroke="#4c9a2a" strokeWidth="1.8" />
      <path d="M8 60V160 M2 60h12 M2 160h12" stroke="#1e8db5" strokeWidth="1.8" />
      <path d="M152 98V122 M146 98h12 M146 122h12" stroke="#8a4fb3" strokeWidth="1.8" />
      <path d="M14 204H146" stroke="#a8683a" strokeWidth="1.8" />
      <T x={196} y={16}>the blank</T>
      <path d="M232.6 33.1A72 72 0 1 1 223.4 33.1L226.9 91.1A14 14 0 1 0 229.1 91.1z" fill="#fde7c8" stroke={S} strokeWidth="1.6" />
      <path d="M226.9 91.1 223.4 33.1 M229.1 91.1 232.6 33.1" stroke="#e98a15" strokeWidth="1.6" />
    </>}>
      <Val x={14} y={22} c="blue" k="OD" title="OD: outer diameter of the flight" value={v.od} onCommit={(n) => set({ od: n })} />
      <Val x={50} y={50} c="purple" k="ID" title="ID: inner diameter of the flight (the shaft)" value={v.id} onCommit={(n) => set({ id: n })} />
      <Val x={15} y={83} c="green" k="P" title="P: pitch" value={v.p} onCommit={(n) => set({ p: n })} />
      <Val x={32} y={93} c="brown" k="L" title="L: screw length" wide value={v.l} onCommit={(n) => set({ l: n })} />
      <Val x={76} y={8} c="orange" k="Gap" title="Gap between the cut ends at the inner edge" value={v.gap} onCommit={(n) => set({ gap: n })} />
    </Diagram>
    <h3 className="uf-lbl">Results</h3>
    {r && <>
      <dl className="uf-facts fit-res">
        <dt>Ri</dt><dd>{fmt(r.ri)} mm</dd><dt>Ro</dt><dd>{fmt(r.ro)} mm</dd>
        <dt>Inner edge</dt><dd>{fmt(r.li)} mm</dd><dt>Outer edge</dt><dd>{fmt(r.lo)} mm</dd>
        <dt>Calculated</dt><dd>{r.calc.toFixed(1)}°</dd><dt>Blank</dt><dd>{r.blank.toFixed(1)}°</dd>
        <dt>Pieces</dt><dd>{r.pieces} <em>(L / P, up)</em></dd><dt>Ring width</dt><dd>{fmt(r.h)} mm</dd>
      </dl>
      {r.warning && <p className="uf-problems">{r.warning}</p>}
    </>}
    <p className="uf-note">The blank is extended past the calculated angle until the cut ends are Gap apart at the inner edge.</p>
  </>);
}
