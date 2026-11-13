import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { NumInput } from "../components/NumInput";
import { normalAt, type Solid, type V3 } from "../import/step/step";
import {
  infoOf, kFor, loadProfiles, marksOf, saveProfiles, setCurrentProfile, solidOf, unfoldPart,
  DEFAULT_PROFILE, type Grain, type MarkAs, type StepPart, type StepSettings, type UnfoldProfile,
} from "../import/step/stepPart";
import { KIND_LABEL, type BodyKind } from "../import/step/extract";
import { flatDxf, type Unfolded, type V2 } from "../import/step/unfold";

// 3D EXTRACTOR -> a part: the part and its flat pattern side by side, the Unfold panel on the right.
// Sheet metal is unfolded across its bends; STITCH lays picked flat faces flat across their shared edges
// (a surface model, or a part drawn with sharp corners). The flat pattern lies top side up (the side up
// on the machine): foil / finish on it when marked; bend marks are traced on the bends coming up from it.
// SEND TO IMPORT 2D puts the flat pattern into the import list (sent again: replaced there).

type Pick = "base" | "top" | "stitch" | "measure" | null;

const K = "#1b1b1b", G = "#1d9641", R = "#e3262b", B = "#1d7fd0";
const Ico = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 48 48" width={48} height={48} fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const ICONS: Record<string, ReactNode> = {
  base: <Ico><path d="M6 32l16-8 20 8-16 8z" fill="#cfe3d4" stroke={K} strokeWidth="2.2" /><path d="M24 6v20" stroke={R} strokeWidth="2.6" /><circle cx="24" cy="7" r="3.5" fill={R} /></Ico>,
  top: <Ico><path d="M6 30l16-8 20 8-16 8z" fill="#fff" stroke={K} strokeWidth="2.2" /><path d="M6 24l16-8 20 8-16 8z" fill="#bfe3c8" stroke={G} strokeWidth="2.2" /><path d="M24 4v10M19 9l5-5 5 5" stroke={G} strokeWidth="2.4" /></Ico>,
  stitch: <Ico><path d="M4 30l12-6v-16l-12 6z" fill="#d6e8f8" stroke={K} strokeWidth="2.2" /><path d="M16 24l14 6 14-6-14-6z" fill="#d6e8f8" stroke={K} strokeWidth="2.2" /><path d="M16 8v16" stroke={B} strokeWidth="3" /><path d="M9 14l3 2M9 20l3 2" stroke={B} strokeWidth="2.2" /></Ico>,
  measure: <Ico><path d="M6 26h36M6 18v16M42 18v16" stroke={K} strokeWidth="2.2" /><path d="M11 26l6-3.5v7zM37 26l-6-3.5v7z" fill={R} /></Ico>,
  send: <Ico><rect x="4" y="10" width="26" height="28" stroke={K} strokeWidth="2.2" /><path d="M4 24h26" stroke={G} strokeWidth="2.4" strokeDasharray="5 4" /><path d="M28 24h16M38 18l6 6-6 6" stroke={G} strokeWidth="3" /></Ico>,
  dxf: <Ico><path d="M10 4h18l10 10v30H10z" stroke={K} strokeWidth="2.2" /><path d="M24 18v16M18 28l6 6 6-6" stroke={G} strokeWidth="2.6" /></Ico>,
};

export function UnfoldPage({ name, kind, qty, sent, step, material, onChange, onSend, onName }: {
  name: string;
  kind: BodyKind;
  qty: number;
  /** its flat pattern is in Import 2D */
  sent: boolean;
  step: StepPart;
  /** the Import 2D material (the profile's K-factor by material and thickness) */
  material: string;
  /** new settings: the part unfolded again */
  onChange: (step: StepPart) => void;
  onSend: () => void;
  /** the name and quantity it goes to Import 2D with */
  onName: (name: string, qty: number) => void;
}) {
  const st = step.settings;
  const stitchMode = st.mode === "stitch";
  const solid = useMemo(() => solidOf(step.text, step.body), [step.text, step.body]);
  const u = useMemo(() => unfoldPart(step.text, st, step.body), [step.text, st, step.body]);
  const [pick, setPick] = useState<Pick>(stitchMode && !st.stitch.length ? "stitch" : null);
  const [profiles, setProfiles] = useState<UnfoldProfile[]>(loadProfiles);
  const [editProfiles, setEditProfiles] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const set = (patch: Partial<StepSettings>) => {
    const next = { ...st, ...patch };
    const nu = unfoldPart(step.text, next, step.body);
    if (next.mode === "sheet" && !nu.outline.length) { setMsg(nu.problems[0] ?? "Not unfolded with this face"); return; }
    setMsg(null);
    onChange({ ...step, settings: next, info: infoOf(nu) });
  };
  const useProfile = (n: string) => {
    const p = profiles.find((x) => x.name === n) ?? DEFAULT_PROFILE;
    setCurrentProfile(p.name);
    set({ profile: p.name, kFactor: kFor(p, material, stitchMode ? (st.comp.t || null) : u.thickness), markLen: p.markLen, markInset: p.markInset, marks: p.marks, annotate: p.annotate, foil: p.foil });
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPick(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const flip = stitchMode ? false : st.top !== undefined ? !u.skinFaces.includes(st.top) : u.bends.filter((b) => !b.inner).length > u.bends.filter((b) => b.inner).length;
  const ups = u.bends.filter((b) => b.up).length;
  const download = () => {
    const url = URL.createObjectURL(new Blob([flatDxf(u, { marks: marksOf(u, st) })], { type: "application/dxf" }));
    const a = document.createElement("a");
    a.href = url; a.download = `${name}_flat.dxf`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const toggleStitch = () => {
    if (stitchMode) { set({ mode: "sheet" }); setPick(null); return; }
    set({ mode: "stitch" });
    setPick("stitch");
  };

  const tool = (id: string, label: string, on: boolean, act: () => void, title: string, disabled = false) => (
    <button type="button" className={`itool${on ? " is-on" : ""}`} aria-pressed={on} aria-disabled={disabled} title={title} onClick={() => !disabled && act()}>
      <span className="itool-box">{ICONS[id]}</span><span className="itool-label">{label}</span>
    </button>
  );
  const hint = pick === "base" ? "click a flat face to unfold from" : pick === "top" ? "click a face on the top side"
    : pick === "stitch" ? "click flat faces one next to the other (again: out)" : "drag: turn · wheel: zoom";

  return (
    <div className="import uf">
      <div className="itools">
        {tool("stitch", "Stitch", stitchMode, toggleStitch, "Stitch faces (manual): click flat faces one next to the other; they are laid flat across the edges they share (a surface, or a part with sharp corners). Off: unfolded as sheet metal")}
        {tool("base", "Fixed face", pick === "base", () => setPick(pick === "base" ? null : "base"), "Click a flat face of the part: the flat pattern is unfolded from it (else from the biggest)", stitchMode)}
        {tool("top", "Top side", stitchMode ? st.flip !== undefined : pick === "top", () => (stitchMode ? set({ flip: !(st.flip ?? isFlippedAuto(step)) }) : setPick(pick === "top" ? null : "top")),
          stitchMode ? "Turn the flat pattern over: the faces' other side up" : "Click a face on the side that lies up on the machine (the foil / finish side, or the inside of the bends to trace)")}
        {tool("measure", "Distance", pick === "measure", () => setPick(pick === "measure" ? null : "measure"), "Click two points of the flat pattern (corners and hole centers snap)")}
        <span className="uf-sep" />
        {tool("send", sent ? "Send again" : "Send to Import 2D", false, onSend, step.info.ok
          ? `Put the flat pattern into Import 2D (×${qty}) to be processed there${sent ? "; it replaces the one sent before" : ""}`
          : "The flat pattern is not ready (not unfolded, or the outline is open)", !step.info.ok)}
        {tool("dxf", "Flat DXF", false, download, "Download the flat pattern as DXF (with the whole bend lines on layer BEND)", !u.outline.length)}
      </div>
      <div className="uf-panes">
        <section className="uf-pane uf-3d">
          <h3>Part <em>{hint}</em></h3>
          <Part3d solid={solid} u={u} st={st} flip={flip} pick={pick === "base" || pick === "top" || pick === "stitch" ? pick : null}
            onPick={(f, k) => {
              if (pick === "base") { if (k !== "plane") { setMsg("The fixed face must be flat"); return; } set({ base: f }); setPick(null); }
              else if (pick === "top") { set({ top: f }); setPick(null); }
              else if (pick === "stitch") {
                if (k !== "plane") { setMsg("Only flat faces can be stitched"); return; }
                set({ stitch: st.stitch.includes(f) ? st.stitch.filter((x) => x !== f) : [...st.stitch, f] });
              }
            }} />
          <div className="uf-leg">{stitchMode
            ? <><span><i className="is-stitch" />stitched</span><span><i className="is-base" />first face (stays)</span><span><i className="is-other" />other faces</span></>
            : <><span><i className="is-skin" />unfolded side</span><span><i className="is-other" />other faces</span><span><i className="is-base" />fixed face</span><span><i className="is-bad" />not unfolded</span></>}</div>
        </section>
        <section className="uf-pane uf-flat">
          <h3>Flat pattern <em>{u.outline.length ? `${fmt(u.box.x1)} × ${fmt(u.box.y1)} mm · ` : ""}{stitchMode && st.comp.side === "none" ? "faces as they are" : `K ${st.kFactor}`} · top side up{st.foil ? " (foil / finish)" : ""}</em></h3>
          {u.outline.length ? <FlatView u={u} st={st} measure={pick === "measure"} />
            : <div className="uf-empty">{stitchMode ? "Click the faces to stitch on the part: the first one stays, each next one must share an edge with one picked before." : "Not unfolded."}</div>}
          <div className="uf-leg"><span><i className="is-mark" />bend marks ({st.marks === "none" ? "off" : st.marks === "trace" ? "traced" : "open cut"}, up bends)</span><span><i className="is-bend" />bend line (not cut)</span><span className="uf-up">UP</span><span className="uf-down">DOWN</span></div>
        </section>
      </div>
      <aside className="uf-panel" aria-label="Unfold">
        <header><h2>{KIND_LABEL[kind] === "Other parts" ? "Part" : KIND_LABEL[kind].replace(/s$/, "")} <small>×{qty}</small></h2>
          <span className={`uf-pill${step.info.ok ? " is-ok" : " is-warn"}`}>{sent ? "Sent" : step.info.ok ? (stitchMode ? "Stitched" : "Unfolded") : stitchMode ? "Pick faces" : "Check it"}</span></header>
        <div className="uf-body">
          <div className="uf-row uf-name">
            <label htmlFor="uf-name">Name</label>
            <NameInput key={name} value={name} onCommit={(n) => onName(n, qty)} />
            <NumInput className="field uf-num uf-qty" value={qty} min={0} int aria-label="Quantity" title="Pieces (from the assembly)" onCommit={(n) => onName(name, Math.round(n))} />
          </div>
          <p className="uf-note uf-name-note">The part's name in Import 2D (and in the parts library): the drawing's number, usually.</p>
          <div className="uf-row">
            <span>Mode</span>
            <span className="cols-toggle uf-seg" role="radiogroup" aria-label="How it is laid flat">
              <button type="button" role="radio" aria-checked={!stitchMode} className={!stitchMode ? "is-on" : ""} onClick={() => stitchMode && toggleStitch()}>Sheet metal</button>
              <button type="button" role="radio" aria-checked={stitchMode} className={stitchMode ? "is-on" : ""} onClick={() => !stitchMode && toggleStitch()}>Stitch faces</button>
            </span>
          </div>
          <div className="uf-row">
            <label htmlFor="uf-prof">Profile</label>
            <select id="uf-prof" className="field" value={st.profile} onChange={(e) => useProfile(e.target.value)}>
              {profiles.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select>
            <button type="button" className="btn btn-plain uf-mini" onClick={() => setEditProfiles(true)}>Edit…</button>
          </div>
          <dl className="uf-facts">
            <dt>Thickness</dt><dd>{u.thickness !== null ? `${fmt(u.thickness)} mm` : stitchMode ? <em>Import 2D properties</em> : "not found"}</dd>
            <dt>Material</dt><dd>{material || <em>Import 2D properties</em>}</dd>
            <dt>Bends</dt><dd>{u.bends.length}{u.bends.length ? ` · ${ups} up, ${u.bends.length - ups} down` : ""}</dd>
            <dt>Flat size</dt><dd>{u.outline.length ? `${fmt(u.box.x1)} × ${fmt(u.box.y1)}` : "–"}</dd>
          </dl>
          {stitchMode ? (<>
            <div className="uf-lbl">Stitched faces</div>
            <div className="uf-row"><span>Faces</span><span className="uf-val">{st.stitch.length}</span>
              <button type="button" className={`btn btn-plain uf-mini${pick === "stitch" ? " is-on" : ""}`} onClick={() => setPick(pick === "stitch" ? null : "stitch")}>{pick === "stitch" ? "Picking…" : "Pick"}</button>
              {st.stitch.length > 0 && <button type="button" className="btn btn-plain uf-mini" onClick={() => set({ stitch: [] })}>Clear</button>}</div>
            <div className="uf-row"><span>Top side</span><span className="uf-val">{st.flip === undefined ? "inside of most bends" : "turned by hand"}</span>
              <button type="button" className="btn btn-plain uf-mini" onClick={() => set({ flip: !(st.flip ?? isFlippedAuto(step)) })}>Turn over</button>
              {st.flip !== undefined && <button type="button" className="btn btn-plain uf-mini" onClick={() => set({ flip: undefined })}>Auto</button>}</div>
            <div className="uf-row"><span>Compensate</span>
              <span className="cols-toggle uf-seg" role="radiogroup" aria-label="Bend compensation">
                {(["none", "top", "bottom"] as const).map((c) => (
                  <button key={c} type="button" role="radio" aria-checked={st.comp.side === c} className={st.comp.side === c ? "is-on" : ""}
                    title={c === "none" ? "The faces laid flat as they are (fine for thin sheet)" : `The faces are the sheet's ${c} side: each bend gets its allowance less the setbacks (thickness, inner radius, K-factor below)`}
                    onClick={() => set({ comp: { ...st.comp, side: c, t: st.comp.t || 2, r: st.comp.r || st.comp.t || 2 } })}>{c === "none" ? "No" : c === "top" ? "Top side" : "Bottom side"}</button>
                ))}
              </span></div>
            {st.comp.side !== "none" && (<>
              <div className="uf-row"><span>Thickness</span><NumInput className="field uf-num" value={st.comp.t} min={0} aria-label="Sheet thickness (mm)" onCommit={(n) => set({ comp: { ...st.comp, t: n } })} />
                <span>inner R</span><NumInput className="field uf-num" value={st.comp.r} min={0} aria-label="Inner bend radius (mm)" onCommit={(n) => set({ comp: { ...st.comp, r: n } })} /><small>mm</small></div>
              <div className="uf-row"><label>K-factor</label><NumInput className="field uf-num" value={st.kFactor} min={0} aria-label="K-factor" onCommit={(n) => set({ kFactor: Math.min(1, n) })} /></div>
            </>)}
          </>) : (<>
            <div className="uf-row">
              <label>K-factor <small>inner R + K × t</small></label>
              <NumInput className="field uf-num" value={st.kFactor} min={0} aria-label="K-factor" onCommit={(n) => set({ kFactor: Math.min(1, n) })} />
            </div>
            <div className="uf-lbl">Faces</div>
            <div className="uf-row"><span>Fixed face</span><span className="uf-val">{st.base !== undefined ? "picked" : "the biggest"}</span>
              {st.base !== undefined && <button type="button" className="btn btn-plain uf-mini" onClick={() => set({ base: undefined })}>Biggest</button>}</div>
            <div className="uf-row"><span>Top side</span><span className="uf-val">{st.top !== undefined ? "picked" : "inside of most bends"}</span>
              {st.top !== undefined && <button type="button" className="btn btn-plain uf-mini" onClick={() => set({ top: undefined })}>Auto</button>}</div>
          </>)}
          <label className="chk" title="The top side has a protective foil or a finish: it stays up on the machine, so the part is never mirrored when nesting">
            <input type="checkbox" checked={st.foil} onChange={(e) => set({ foil: e.target.checked })} /> Foil / finish on the top side</label>
          <div className="uf-row"><span>Grain</span>
            <span className="cols-toggle uf-seg" role="radiogroup" aria-label="Grain direction">
              {(["none", "x", "y"] as Grain[]).map((g) => (
                <button key={g} type="button" role="radio" aria-checked={st.grain === g} className={st.grain === g ? "is-on" : ""}
                  title={g === "none" ? "No grain direction" : `Grain along the flat pattern's ${g.toUpperCase()}: turned so it runs along the sheet; nesting only turns it 180°`}
                  onClick={() => set({ grain: g })}>{g === "none" ? "None" : g.toUpperCase()}</button>
              ))}
            </span></div>
          <div className="uf-lbl">Bend marks</div>
          <div className="uf-row"><span>Length</span><NumInput className="field uf-num" value={st.markLen} min={1} aria-label="Bend mark length (mm)" onCommit={(n) => set({ markLen: n })} />
            <span>in</span><NumInput className="field uf-num" value={st.markInset} min={0} aria-label="Bend mark inset (mm)" onCommit={(n) => set({ markInset: n })} /><small>mm</small></div>
          <div className="uf-row"><span>As</span>
            <span className="cols-toggle uf-seg" role="radiogroup" aria-label="Bend marks as">
              {(["trace", "openCut", "none"] as MarkAs[]).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={st.marks === m} className={st.marks === m ? "is-on" : ""} onClick={() => set({ marks: m })}>
                  {m === "trace" ? "Trace" : m === "openCut" ? "Open cut" : "None"}</button>
              ))}
            </span></div>
          <label className="chk"><input type="checkbox" checked={st.annotate} onChange={(e) => set({ annotate: e.target.checked })} /> Show angle and UP / DOWN</label>
          <div className="uf-tbl">
            <table>
              <thead><tr><th>#</th><th>Angle</th><th>Dir</th><th>Inner R</th><th>Length</th></tr></thead>
              <tbody>{u.bends.map((b, i) => (
                <tr key={i}><td>{i + 1}</td><td>{fmt(b.angleDeg, 1)}°</td><td><span className={b.up ? "uf-up" : "uf-down"}>{b.up ? "UP" : "DOWN"}</span></td><td>{fmt(b.innerR)}</td><td>{fmt(b.length)}</td></tr>
              ))}</tbody>
            </table>
            {!u.bends.length && <p className="uf-note">{u.outline.length ? "No bends: a flat part." : "No flat pattern yet."}</p>}
          </div>
          {(() => {
            // faces of reliefs and corners are not unfolded on purpose: a note, not a problem
            const minor = (p: string) => p.includes("are fine") || p.startsWith("Click the faces");
            const bad = [...(msg ? [msg] : []), ...u.problems.filter((p) => !minor(p))];
            return (<>
              {bad.length > 0 && <ul className="uf-problems">{bad.map((p, i) => <li key={i}>{p}</li>)}</ul>}
              {u.problems.filter(minor).map((p, i) => <p key={`n${i}`} className="uf-note">{p}.</p>)}
            </>);
          })()}
          <p className="uf-note">Send to Import 2D: the flat pattern goes to the import list with its quantity, to be processed there. Foil / finish: never mirrored; grain: turned only 180°.</p>
        </div>
      </aside>
      {editProfiles && <ProfilesDialog profiles={profiles} onClose={() => setEditProfiles(false)}
        onSave={(l) => { saveProfiles(l); setProfiles(l); setEditProfiles(false); if (!l.some((p) => p.name === st.profile)) useProfile(l[0].name); }} />}
    </div>
  );
}

/** The name, taken when the field is left (Enter) or kept as it was (Esc, empty). */
function NameInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value);
  const done = () => { const t = v.trim(); if (t && t !== value) onCommit(t); else setV(value); };
  return (
    <input id="uf-name" className="field" value={v} spellCheck={false} aria-label="Part name for Import 2D"
      onChange={(e) => setV(e.target.value)} onBlur={done}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setV(value); setTimeout(() => (e.target as HTMLInputElement).blur(), 0); } }} />
  );
}

/** Stitched with the top side chosen automatically: is it turned over? */
function isFlippedAuto(step: StepPart): boolean {
  const st = step.settings;
  const a = unfoldPart(step.text, { ...st, flip: false }, step.body), b = unfoldPart(step.text, { ...st, flip: undefined }, step.body);
  return a.box.x1 !== b.box.x1 || a.bends.some((x, i) => x.up !== b.bends[i]?.up);
}

const fmt = (v: number, d = 2) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString("en-US", { maximumFractionDigits: d });

// ------------------------------------------------------------------ the part in 3D (shaded, faces picked)

function Part3d({ solid, u, st, flip, pick, onPick }: {
  solid: Solid; u: Unfolded; st: StepSettings; flip: boolean; pick: "base" | "top" | "stitch" | null;
  onPick: (face: number, kind: string) => void;
}) {
  const cv = useRef<HTMLCanvasElement>(null);
  const [cam, setCam] = useState({ yaw: -0.7, pitch: 0.5, zoom: 1 });
  const [hover, setHover] = useState<number | null>(null);
  const shapes = useRef<{ i: number; path: Path2D }[]>([]);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const skin = useMemo(() => new Set(u.skinFaces), [u]);
  // the fixed face: picked, else the biggest flat face of the unfolded side
  const stitchMode = st.mode === "stitch";
  const base = stitchMode ? st.stitch[0] : st.base ?? u.skinFaces[0];
  const picked = useMemo(() => new Set(stitchMode ? st.stitch : []), [stitchMode, st.stitch]);

  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const W = c.clientWidth, H = c.clientHeight;
      c.width = W * dpr; c.height = H * dpr;
      const g = c.getContext("2d")!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      const all = solid.faces.flatMap((f) => f.loops.flatMap((l) => l.edges.flatMap((e) => e.pts)));
      if (!all.length) return;
      const lo = [0, 1, 2].map((i) => Math.min(...all.map((p) => p[i]))), hi = [0, 1, 2].map((i) => Math.max(...all.map((p) => p[i])));
      const ctr: V3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
      const size = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
      const s = (Math.min(W, H) * 0.78 * cam.zoom) / size;
      const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
      const pr = (p: V3): [number, number, number] => {
        const x = p[0] - ctr[0], y = p[1] - ctr[1], z = p[2] - ctr[2];
        const x1 = cy * x - sy * y, y1 = sy * x + cy * y;
        return [W / 2 + x1 * s, H / 2 - (sp * y1 + cp * z) * s, cp * y1 - sp * z];
      };
      const rotN = (n: V3): V3 => { const x1 = cy * n[0] - sy * n[1], y1 = sy * n[0] + cy * n[1]; return [x1, cp * y1 - sp * n[2], sp * y1 + cp * n[2]]; };
      const L: V3 = [-0.29, -0.83, 0.48];
      const items = solid.faces.map((f, i) => {
        const pts = f.loops.flatMap((l) => l.edges.flatMap((e) => e.pts));
        const depth = pts.reduce((sum, q) => sum + pr(q)[2], 0) / Math.max(1, pts.length);
        let n = normalAt(f, pts[Math.floor(pts.length / 2)] ?? [0, 0, 0]);
        if (!n) {
          const lp = f.loops[0]?.edges.flatMap((e) => e.pts) ?? [];
          const nw: V3 = [0, 0, 0];
          for (let k = 0; k < lp.length; k++) { const a = lp[k], b = lp[(k + 1) % lp.length]; nw[0] += (a[1] - b[1]) * (a[2] + b[2]); nw[1] += (a[2] - b[2]) * (a[0] + b[0]); nw[2] += (a[0] - b[0]) * (a[1] + b[1]); }
          const k = Math.hypot(...nw) || 1; n = [nw[0] / k, nw[1] / k, nw[2] / k];
        }
        const nr = rotN(n);
        return { f, i, depth, lit: 0.4 + 0.6 * Math.abs(nr[0] * L[0] + nr[1] * L[1] + nr[2] * L[2]) };
      }).sort((a, b) => b.depth - a.depth);
      const out: { i: number; path: Path2D }[] = [];
      for (const it of items) {
        const k = it.i === base ? "base" : stitchMode ? (picked.has(it.i) ? "stitch" : "side") : solid.faces[it.i].surf.kind === "other" ? "bad" : skin.has(it.i) ? "skin" : "side";
        const rgb = k === "bad" ? [214, 90, 70] : k === "base" ? [120, 196, 140] : k === "skin" ? [200, 228, 208] : k === "stitch" ? [150, 196, 238] : [178, 192, 196];
        const c2 = rgb.map((v) => Math.round(v * it.lit));
        const path = new Path2D();
        for (const l of it.f.loops) {
          let first = true;
          for (const e of l.edges) for (const p of e.pts) { const q = pr(p); if (first) { path.moveTo(q[0], q[1]); first = false; } else path.lineTo(q[0], q[1]); }
          path.closePath();
        }
        g.fillStyle = hover === it.i && pick ? "rgba(242,183,5,0.9)" : `rgba(${c2[0]},${c2[1]},${c2[2]},0.94)`;
        g.fill(path, "evenodd");
        g.strokeStyle = k === "skin" || k === "base" ? "#1d9641" : k === "stitch" ? "#1d7fd0" : k === "bad" ? "#c2412d" : "#7f9296";
        g.lineWidth = k === "side" ? 0.9 : 1.2;
        g.beginPath();
        for (const l of it.f.loops) for (const e of l.edges) e.pts.forEach((p, j) => { const q = pr(p); if (j) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); });
        g.stroke();
        out.push({ i: it.i, path });
      }
      shapes.current = out.reverse();   // nearest first, for picking
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(c);
    return () => ro.disconnect();
  }, [solid, cam, skin, base, hover, pick, picked, stitchMode]);

  const faceAt = (x: number, y: number) => {
    const g = cv.current?.getContext("2d");
    if (!g) return null;
    const dpr = window.devicePixelRatio || 1;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // the point in the canvas's own pixels (the paths are drawn scaled by the screen's pixel ratio)
    return shapes.current.find((s) => g.isPointInPath(s.path, x * dpr, y * dpr, "evenodd"))?.i ?? null;
  };
  const local = (e: React.PointerEvent) => { const r = cv.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
  return (
    <div className="uf-canvas">
      <canvas ref={cv} className={pick ? "is-pick" : ""}
        onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, moved: false }; (e.target as Element).setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d && (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3 || d.moved)) {
            d.moved = true;
            setCam((c) => ({ ...c, yaw: c.yaw + (e.clientX - d.x) * 0.01, pitch: Math.max(-1.55, Math.min(1.55, c.pitch + (e.clientY - d.y) * 0.01)) }));
            d.x = e.clientX; d.y = e.clientY;
            return;
          }
          if (pick) { const [x, y] = local(e); setHover(faceAt(x, y)); }
        }}
        onPointerUp={(e) => {
          const d = drag.current; drag.current = null;
          if (d?.moved || !pick) return;
          const [x, y] = local(e);
          const f = faceAt(x, y);
          if (f !== null) onPick(f, solid.faces[f].surf.kind);
        }}
        onPointerLeave={() => setHover(null)}
        onWheel={(e) => setCam((c) => ({ ...c, zoom: Math.max(0.2, Math.min(10, c.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12))) }))}
      />
      {!stitchMode && <span className="uf-top">{flip ? "Top side: the other side (grey)" : "Top side: the green side"}</span>}
    </div>
  );
}

// ------------------------------------------------------------------ the flat pattern (SVG, measured)

function FlatView({ u, st, measure }: { u: Unfolded; st: StepSettings; measure: boolean }) {
  const svg = useRef<SVGSVGElement>(null);
  const [pts, setPts] = useState<V2[]>([]);
  const [near, setNear] = useState<V2 | null>(null);
  useEffect(() => { setPts([]); setNear(null); }, [measure, u]);
  const W = u.box.x1, H = u.box.y1;
  const pad = Math.max(W, H) * 0.09;
  const y = (v: number) => H - v;
  const marks = marksOf(u, st);
  const fs = Math.max(W, H) * 0.026;
  // snap points: outline corners and arc centers
  const snaps = useMemo(() => {
    const out: V2[] = [];
    for (const e of u.outline) { if (e.arc) out.push(e.arc.c); out.push(e.pts[0], e.pts[e.pts.length - 1]); }
    return out;
  }, [u]);
  const toMm = (e: React.PointerEvent): { p: V2; snap: V2 | null } => {
    const s = svg.current!;
    const m = s.getScreenCTM()!.inverse();
    const q = new DOMPoint(e.clientX, e.clientY).matrixTransform(m);
    const p: V2 = [q.x, H - q.y];
    const tol = 10 / s.getScreenCTM()!.a;
    let best: V2 | null = null, bd = tol;
    for (const c of snaps) { const d = Math.hypot(c[0] - p[0], c[1] - p[1]); if (d < bd) { bd = d; best = c; } }
    return { p, snap: best };
  };
  const dim = (a: V2, b: V2, k: number) => {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return (
      <g key={`d${k}`} className="uf-dim">
        <path d={`M${a[0]} ${y(a[1])} L${b[0]} ${y(b[1])}`} />
        <circle cx={a[0]} cy={y(a[1])} r={fs * 0.18} /><circle cx={b[0]} cy={y(b[1])} r={fs * 0.18} />
        <text x={(a[0] + b[0]) / 2} y={y((a[1] + b[1]) / 2) - fs * 0.5} fontSize={fs} textAnchor="middle">{fmt(d)} (X {fmt(Math.abs(b[0] - a[0]))}, Y {fmt(Math.abs(b[1] - a[1]))})</text>
      </g>
    );
  };
  return (
    <svg ref={svg} className={`uf-svg${measure ? " is-measure" : ""}`} viewBox={`${-pad} ${-pad} ${W + 2 * pad} ${H + 2 * pad}`}
      onPointerMove={(e) => { if (measure) setNear(toMm(e).snap); }}
      onPointerDown={(e) => {
        if (!measure) return;
        const { p, snap } = toMm(e);
        const q = snap ?? p;
        setPts((l) => (l.length >= 2 ? [q] : [...l, q]));
      }}>
      {u.outline.map((e, i) => (e.arc && e.arc.a1 - e.arc.a0 >= 2 * Math.PI - 1e-9
        ? <circle key={i} className="uf-o" cx={e.arc.c[0]} cy={y(e.arc.c[1])} r={e.arc.r} />
        : <path key={i} className="uf-o" d={`M${e.pts.map((p) => `${p[0]} ${y(p[1])}`).join(" L")}`} />))}
      {u.bendLines.map(([a, b], i) => <path key={`b${i}`} className="uf-b" d={`M${a[0]} ${y(a[1])} L${b[0]} ${y(b[1])}`} />)}
      {marks.map(([a, b], i) => <path key={`m${i}`} className="uf-m" d={`M${a[0]} ${y(a[1])} L${b[0]} ${y(b[1])}`} />)}
      {st.annotate && u.bendLines.map(([a, b], i) => {
        const bd = u.bends[i];
        if (!bd) return null;
        const mx = (a[0] + b[0]) / 2, my = y((a[1] + b[1]) / 2);
        let ang = (Math.atan2(-(b[1] - a[1]), b[0] - a[0]) * 180) / Math.PI;
        if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
        // short bends (tabs) get smaller text, so it stays beside its own bend
        const f = Math.min(fs, Math.hypot(b[0] - a[0], b[1] - a[1]) / 7);
        return <text key={`t${i}`} className={bd.up ? "uf-t is-up" : "uf-t is-down"} x={mx} y={my - f * 0.4} fontSize={f} textAnchor="middle" transform={`rotate(${ang} ${mx} ${my})`}>{fmt(bd.angleDeg, 1)}° {bd.up ? "UP" : "DOWN"}</text>;
      })}
      {st.grain !== "none" && (
        <g className="uf-grain" transform={`translate(${W - Math.min(W * 0.3, fs * 9)} ${-pad * 0.45})`}>
          <path d={`M0 0 H${Math.min(W * 0.3, fs * 8)}`} /><path d={`M${Math.min(W * 0.3, fs * 8)} 0 l${-fs * 0.8} ${-fs * 0.4} v${fs * 0.8}z`} className="is-head" />
          <text x={-fs * 0.4} y={fs * 0.35} fontSize={fs * 0.9} textAnchor="end">GRAIN</text>
        </g>
      )}
      {st.foil && <text className="uf-foil" x={0} y={-pad * 0.35} fontSize={fs * 0.9}>TOP: FOIL / FINISH UP</text>}
      <text className="uf-size" x={W / 2} y={H + pad * 0.6} fontSize={fs} textAnchor="middle">{fmt(W)}</text>
      <text className="uf-size" x={-pad * 0.45} y={H / 2} fontSize={fs} textAnchor="middle" transform={`rotate(-90 ${-pad * 0.45} ${H / 2})`}>{fmt(H)}</text>
      {measure && near && <circle className="uf-snap" cx={near[0]} cy={y(near[1])} r={fs * 0.35} />}
      {pts.length === 2 && dim(pts[0], pts[1], 0)}
      {pts.length === 1 && <circle className="uf-snap" cx={pts[0][0]} cy={y(pts[0][1])} r={fs * 0.25} />}
    </svg>
  );
}

// ------------------------------------------------------------------ customer profiles

function ProfilesDialog({ profiles, onClose, onSave }: { profiles: UnfoldProfile[]; onClose: () => void; onSave: (l: UnfoldProfile[]) => void }) {
  const [list, setList] = useState<UnfoldProfile[]>(() => profiles.map((p) => ({ ...p, kTable: p.kTable.map((r) => ({ ...r })) })));
  const [sel, setSel] = useState(0);
  const p = list[sel];
  const setP = (patch: Partial<UnfoldProfile>) => setList((l) => l.map((x, i) => (i === sel ? { ...x, ...patch } : x)));
  const names = new Set(list.map((x) => x.name.trim()));
  const ok = list.every((x) => x.name.trim()) && names.size === list.length;
  return (
    <div className="dlg-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dlg uf-prof" role="dialog" aria-modal="true" aria-label="Unfold profiles">
        <header className="dlg-head">
          <div className="dlg-title"><h2>Unfold profiles</h2><p>A profile per customer (or the shop standard): K-factors and how bends are marked. Kept in this browser for now.</p></div>
          <button type="button" className="icon-btn dlg-close" onClick={onClose} aria-label="Close" title="Close (Esc)">×</button>
        </header>
        <div className="uf-prof-body">
          <ul className="uf-prof-list">
            {list.map((x, i) => <li key={i}><button type="button" className={i === sel ? "is-on" : ""} onClick={() => setSel(i)}>{x.name || <em>no name</em>}</button></li>)}
            <li><button type="button" className="uf-add" onClick={() => { setList((l) => [...l, { ...DEFAULT_PROFILE, name: `Customer ${l.length}` }]); setSel(list.length); }}>+ Profile</button></li>
          </ul>
          {p && (
            <div className="uf-prof-edit">
              <label className="uf-row"><span>Name</span><input className="field" value={p.name} onChange={(e) => setP({ name: e.target.value })} /></label>
              <div className="uf-row"><span>K-factor</span><NumInput className="field uf-num" value={p.kFactor} min={0} aria-label="K-factor" onCommit={(n) => setP({ kFactor: Math.min(1, n) })} /><small>for anything not in the table</small></div>
              <table className="uf-ktable">
                <thead><tr><th>Material</th><th>Thickness</th><th>K</th><th /></tr></thead>
                <tbody>
                  {p.kTable.map((r, i) => (
                    <tr key={i}>
                      <td><input className="field" value={r.material} placeholder="any" onChange={(e) => setP({ kTable: p.kTable.map((x, j) => (j === i ? { ...x, material: e.target.value } : x)) })} /></td>
                      <td><NumInput className="field uf-num" value={r.thicknessMm} min={0} aria-label="Thickness (mm)" onCommit={(n) => setP({ kTable: p.kTable.map((x, j) => (j === i ? { ...x, thicknessMm: n } : x)) })} /></td>
                      <td><NumInput className="field uf-num" value={r.kFactor} min={0} aria-label="K-factor" onCommit={(n) => setP({ kTable: p.kTable.map((x, j) => (j === i ? { ...x, kFactor: Math.min(1, n) } : x)) })} /></td>
                      <td><button type="button" className="icon-btn" aria-label="Remove the row" onClick={() => setP({ kTable: p.kTable.filter((_, j) => j !== i) })}>×</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button type="button" className="btn btn-plain uf-mini" onClick={() => setP({ kTable: [...p.kTable, { material: "", thicknessMm: 0, kFactor: p.kFactor }] })}>+ K-factor row</button>
              <div className="uf-row"><span>Bend marks</span><NumInput className="field uf-num" value={p.markLen} min={1} aria-label="Mark length (mm)" onCommit={(n) => setP({ markLen: n })} /><span>long,</span>
                <NumInput className="field uf-num" value={p.markInset} min={0} aria-label="Inset (mm)" onCommit={(n) => setP({ markInset: n })} /><span>mm in</span></div>
              <div className="uf-row"><span>Marks as</span>
                <select className="field" value={p.marks} onChange={(e) => setP({ marks: e.target.value as MarkAs })}><option value="trace">Trace</option><option value="openCut">Open cut</option><option value="none">None</option></select></div>
              <label className="chk"><input type="checkbox" checked={p.annotate} onChange={(e) => setP({ annotate: e.target.checked })} /> Show angle and UP / DOWN</label>
              <label className="chk"><input type="checkbox" checked={p.foil} onChange={(e) => setP({ foil: e.target.checked })} /> Foil / finish on the top side</label>
              {list.length > 1 && <button type="button" className="btn btn-danger-plain uf-mini" onClick={() => { setList((l) => l.filter((_, i) => i !== sel)); setSel(0); }}>Delete profile</button>}
            </div>
          )}
        </div>
        <div className="dlg-foot">
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn-plain" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!ok} onClick={() => onSave(list)}>Save</button>
        </div>
      </div>
    </div>
  );
}

