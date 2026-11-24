import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { loadRules, splineTolOf } from "../import/rules";
import { useMiddleDouble } from "../components/middleDouble";
import { NumInput } from "../components/NumInput";
import { Combobox } from "../components/Combobox";
import { usePickLists } from "../components/pickLists";
import { add3, len3, lowHigh, mul3, normalAt, sub3, type Solid, type V3 } from "../import/step/step";
import { describe, edgePick, facePick, fmtMeasure, measureSummary, refPoint, type MPick } from "../import/step/measure3d";
import {
  applyThreads, bendTexts, holeGroups, TAP_DRILLS, infoOf, kFor, loadProfiles, marksDownOf, marksOf, partSolid, saveProfiles, setCurrentProfile, solidOf, unfoldPart,
  DEFAULT_PROFILE, type Grain, type MarkAs, type StepPart, type StepSettings, type UnfoldProfile,
} from "../import/step/stepPart";
import { KIND_LABEL, type BodyKind } from "../import/step/extract";
import { cutProblem, edgeAlong, keepPicks, type FaceCut } from "../import/step/split";
import { cylStrips, type CylStrip } from "../import/step/cylStrips";
import { flatDxf, type Unfolded, type V2 } from "../import/step/unfold";
import { dimensionOf, type Measure, type Pick as DimPick } from "../import/measure";

// 3D EXTRACTOR -> a part: the part and its flat pattern side by side, the Unfold panel on the right.
// Sheet metal is unfolded across its bends; STITCH lays picked flat faces flat across their shared edges
// (a surface model, or a part drawn with sharp corners). The flat pattern lies top side up (the side up
// on the machine): foil / finish on it when marked; bend marks are traced on the bends coming up from it.
// SEND TO IMPORT 2D puts the flat pattern into the import list (sent again: replaced there).

type Pick = "base" | "top" | "stitch" | "edge" | "deledge" | "one" | "measure3d" | "measure" | "look" | null;

const K = "#1b1b1b", R = "#e3262b", B = "#1d7fd0";

/** How the part is shown in 3D (kept for next time, on this computer). */
interface ViewPrefs {
  /** edge lines: their width, × */
  edge: number;
  wire: boolean;
  /** face colors: by what unfolding does with them, the STEP file's colors, or the material's color */
  colors: "roles" | "file" | "material";
  /** material (lower case) -> color */
  matColors: Record<string, string>;
}
const VIEW_KEY = "gnezdo.x3.view";
const VIEW0: ViewPrefs = { edge: 1, wire: false, colors: "roles", matColors: {} };
function loadView(): ViewPrefs {
  try { const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "null"); return v ? { ...VIEW0, ...v } : VIEW0; } catch { return VIEW0; }
}
const hexOf = (c: [number, number, number]) => "#" + c.map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, "0")).join("");
const rgbOf = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
const Ico = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 48 48" width={48} height={48} fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const ICONS: Record<string, ReactNode> = {
  // Fab's icon: the face that stays put (green), held by the red support
  base: <Ico><path d="M18.7 10.2H32.8M19.9 9.4L21.8 6.2M24.4 9.4L26.3 6.2M28.7 9.4L30.6 6.2M31.6 9.4L33.5 6.2M26.4 11V22" stroke={R} strokeWidth="1.8" strokeLinecap="round" /><path d="M24 21.6H28.8L26.4 25.8Z" fill={R} /><path d="M8.3 22.2L19.5 15.5V23.3L8.3 31Z" fill="#dcdcdc" stroke={K} strokeWidth="1.8" strokeLinejoin="round" /><path d="M8.3 31H28.8L40 23.3H19.5Z" fill="#cde5bb" stroke={K} strokeWidth="1.8" strokeLinejoin="round" /><path d="M28 31L40 23.3V30.7L28 37.7Z" fill="#dcdcdc" stroke={K} strokeWidth="1.8" strokeLinejoin="round" /></Ico>,
  // Fab's icon: the protective foil (blue) comes down on the part's top side
  top: <Ico><path d="M10.4 10.4H33.6" stroke={K} strokeWidth="1.8" /><path d="M10.4 9.1H28Q31 9.1 31 6.6T29.3 4.6" fill="none" stroke="#1d8fd6" strokeWidth="1.8" strokeLinecap="round" /><path d="M22.9 12.3V23.5" stroke="#1d8fd6" strokeWidth="1.8" /><path d="M20.5 22.8H25.3L22.9 27Z" fill="#1d8fd6" /><path d="M6.4 36.3H26.4L37.9 28.8H17.6Z" fill="#a8cbe8" stroke={K} strokeWidth="1.8" strokeLinejoin="round" /><path d="M6.4 36.3V43.5L15.5 37.9V36.3" fill="#dcdcdc" stroke={K} strokeWidth="1.8" strokeLinejoin="round" /><path d="M26.4 36.3L37.9 28.8V36.3L26.4 43.5Z" fill="#a8cbe8" stroke={K} strokeWidth="1.8" strokeLinejoin="round" /><path d="M21.6 30.4H30.9M17.6 32.8H26.4M14.4 34.7H22.4M28.8 35.7V38.4M32 34.4V37M35.2 32.8V35.2" stroke="#1d8fd6" strokeWidth="1.3" /></Ico>,
  // Fab's icon: two faces laid flat across the edges they share (red), the green arrows bringing them together
  stitch: <Ico><path d="M4.6 10.9L17.4 3.6V27.6L4.6 35.8Z" fill="#dcdcdc" stroke={K} strokeWidth="2.2" strokeLinejoin="miter" /><path d="M24.9 3.6H40.3V28.3H24.9Z" fill="#dcdcdc" stroke={K} strokeWidth="2.2" /><path d="M24.9 35.8H40.3V42H24.9Z" fill="#dcdcdc" stroke={K} strokeWidth="2.2" /><path d="M17.4 3.6V27.6M24.9 3.6V28.3H40.3M24.9 35.8H40.3" stroke={R} strokeWidth="2.2" /><path d="M19.2 5.6L23.6 8L19.2 10.4ZM23.6 12.8L19.2 15.2L23.6 17.6ZM19.2 21.5L23.6 23.9L19.2 26.3Z" fill="#22b14c" /><path d="M27 34.6L29.4 30.4L31.8 34.6ZM34 30.4L36.4 34.6L38.8 30.4Z" fill="#22b14c" /></Ico>,
  // Fab's icon: a frame cut at its corners by added edges (green), from corner (red) to corner
  edge: <Ico><path d="M4.4 5.1H42V41.8H4.4ZM14.5 15.2V31.9H31.9V15.2Z" fill="#dcdcdc" fillRule="evenodd" stroke={K} strokeWidth="2.4" /><path d="M4.4 5.1L14.5 15.2M42 5.1L31.9 15.2M42 41.8L31.9 31.9M4.4 41.8L14.5 31.9" stroke="#22b14c" strokeWidth="2" /><circle cx="4.9" cy="41.3" r="3" fill={R} /><circle cx="15" cy="31.4" r="3" fill={R} /></Ico>,
  // Fab's icon: one face of the part (red) with its holes taken flat
  one: <Ico><path d="M6.4 14L18.4 7.9V34.3L6.4 40.4Z" fill="#dcdcdc" stroke={K} strokeWidth="1.8" strokeLinejoin="round" /><path d="M18.7 7.9H41.1V34.3H18.7Z" fill="#dcdcdc" stroke={R} strokeWidth="2.4" /><circle cx="34.4" cy="14.8" r="2.6" fill="#fff" stroke={R} strokeWidth="1.8" /><path d="M24.5 19.3H28.8V29.5H24.5Z" fill="#fff" stroke={R} strokeWidth="1.8" /></Ico>,
  // Fab's icon: a box with its width and depth dimensioned (red)
  measure3d: <Ico><path d="M4.1 16.5L20.1 5.3H44.9L29.2 16.5Z" fill="#dcdcdc" stroke={K} strokeWidth="2.2" strokeLinejoin="round" /><path d="M4.1 16.5H29.2V26.7H4.1Z" fill="#a3a3a3" stroke={K} strokeWidth="2.2" /><path d="M29.2 16.5L44.9 5.3V15.7L29.2 26.7Z" fill="#cfcfcf" stroke={K} strokeWidth="2.2" strokeLinejoin="round" /><path d="M4.1 28.4V38.3M29.2 28.4V38.3M44.9 17.5V27.2M6 35.5H27.3M31.3 34.3L43.2 26.4" stroke={R} strokeWidth="1.8" /><path d="M5 35.5L8.6 33.6V37.4ZM28.3 35.5L24.7 33.6V37.4ZM30.6 34.8L32.3 31.3L34.4 34.2ZM43.9 25.9L42.3 29.4L40.1 26.6Z" fill={R} /></Ico>,
  // Fab's icon: a flat pattern with its width dimensioned (red), its bends (blue)
  measure: <Ico><path d="M14.2 1.7H34.6V7.6H40.7V30.6H34.6V36.2H14.2V30.6H8.4V7.6H14.2Z" fill="#dcdcdc" stroke={K} strokeWidth="1.9" strokeLinejoin="miter" /><path d="M14.2 9.6V14M14.2 24.2V28.6M34.6 9.6V14M34.6 24.2V28.6M16.2 7.6H20.4M28.4 7.6H32.6M16.2 30.6H20.4M28.4 30.6H32.6" stroke="#1d8fd6" strokeWidth="1.6" /><path d="M8.4 32V45M40.7 32V45M10.4 41.6H38.7" stroke={R} strokeWidth="1.8" /><path d="M9.2 41.6L12.8 39.7V43.5ZM39.9 41.6L36.3 39.7V43.5Z" fill={R} /></Ico>,
  look: <Ico><path d="M10 12h28v24H10z" fill="#d6e8f8" stroke={K} strokeWidth="2.2" /><circle cx="24" cy="24" r="6" stroke={B} strokeWidth="2.6" /><circle cx="24" cy="24" r="2" fill={B} /><path d="M24 4v6M24 38v6M4 24h6M38 24h6" stroke={R} strokeWidth="2.2" /></Ico>,
  // a part with a bend line (dotted green), and a red arrow: into the Import 2D list
  send: <Ico><path d="M6.3 9.8H35.7L40.7 14.7V28.7H14.4V22.3H6.3Z" stroke={K} strokeWidth="2.4" /><path d="M24.7 10.8V28.2" stroke="#22b14c" strokeWidth="2.2" strokeDasharray="2.2 2.4" strokeLinecap="butt" /><path d="M11.5 38.4H32.5" stroke={R} strokeWidth="2.4" /><path d="M31.4 35.6L38.4 38.4L31.4 41.2Z" fill={R} /></Ico>,
  // a sheet of paper with a part (blue) on it, and "DXF" in red
  dxf: <Ico><path d="M18.8 38.7H9.6V6.6H26.5L31.9 11.8V29" stroke={K} strokeWidth="2.4" /><path d="M16.2 11.8H27.6V25.3H12.9V14.9Z" stroke="#1d8fd6" strokeWidth="2.2" /><circle cx="18.8" cy="21.8" r="1.8" stroke="#1d8fd6" strokeWidth="1.8" /><text x="21" y="42" fontFamily="Arial, Helvetica, sans-serif" fontSize="12.5" fill={R}>DXF</text></Ico>,
};

export function UnfoldPage({ name, kind, section, qty, sent, step, material, partMaterial, fileMaterial = "", onChange, onSend, onSendOne, onName }: {
  name: string;
  kind: BodyKind;
  /** a tube or profile: its section and length */
  section?: string;
  qty: number;
  /** its flat pattern is in Import 2D */
  sent: boolean;
  step: StepPart;
  /** the Import 2D material (the profile's K-factor by material and thickness) */
  material: string;
  /** new settings: the part unfolded again */
  onChange: (step: StepPart) => void;
  onSend: () => void;
  /** Send to Import 2D and take it off the 3D Extractor's list (part by part; the next part opens) */
  onSendOne?: () => void;
  /** the name and quantity it goes to Import 2D with */
  onName: (name: string, qty: number, material: string) => void;
  /** its own material ("": the Import 2D properties' one) */
  partMaterial: string;
  /** the material the STEP file names ("": none) */
  fileMaterial?: string;
}) {
  // how the part is shown in 3D (kept for next time)
  const [view, setViewState] = useState<ViewPrefs>(loadView);
  const setView = (patch: Partial<ViewPrefs>) => setViewState((v) => {
    const n = { ...v, ...patch };
    try { localStorage.setItem(VIEW_KEY, JSON.stringify(n)); } catch { /* this session */ }
    return n;
  });
  const [viewOpen, setViewOpen] = useState(false);
  const st = step.settings;
  const stitchMode = st.mode === "stitch";
  // with the edges added across its faces (stitch): what is seen, picked and stitched
  const solid = useMemo(() => partSolid(step.text, step.body, st), [step.text, step.body, st.mode, st.cuts]);   // eslint-disable-line react-hooks/exhaustive-deps
  const cuts = useMemo(() => st.cuts ?? [], [st.cuts]);
  const [edgeA, setEdgeA] = useState<V3 | null>(null);
  /** the edges added change: faces split by the change (and their pieces) are picked again */
  const setCuts = (next: FaceCut[], text: string) => {
    const base = solidOf(step.text, step.body);
    const picks = keepPicks(base, cuts, next, st.stitch);
    set({ mode: "stitch", cuts: next, stitch: picks });
    setMsg(picks.length < st.stitch.length ? `${text}: pick the faces of the split face again` : text);
  };
  const seams = st.seams ?? [];
  const toggleSeam = (id: number) => {
    const on = seams.includes(id);
    set({ mode: "stitch", seams: on ? seams.filter((x) => x !== id) : [...seams, id] });
    setMsg(on ? "Seam taken away: the edge is stitched again" : "Along an edge: this edge is a seam, not stitched (cut in the flat pattern; the same two points again: stitched)");
  };
  const edgeCorner = (p: V3) => {
    if (!edgeA) { setEdgeA(p); setMsg("Now click the second point on the outline of the same flat face (Ctrl: square to the edge)"); return; }
    const c: FaceCut = [edgeA, p];
    // along an edge there already: that edge is a seam (again: stitched)
    const along = edgeAlong(solid, edgeA, p);
    if (along !== null) { setEdgeA(null); toggleSeam(along); return; }
    const why = cutProblem(solidOf(step.text, step.body), cuts, c);
    if (why) { setMsg(why); if (len3(sub3(edgeA, p)) > 1e-3) setEdgeA(null); return; }
    setEdgeA(null);
    setCuts([...cuts, c], `Edge ${cuts.length + 1} added`);
  };
  const u0 = useMemo(() => unfoldPart(step.text, st, step.body), [step.text, st, step.body]);
  // a tube or a profile is cut to length (saw, tube laser), not laid flat: no flat pattern unless asked for
  const cutToLength = kind === "tube" || kind === "profile";
  const [anyway, setAnyway] = useState(false);
  const flatOff = cutToLength && !anyway;
  const u = useMemo(() => (flatOff ? { ...u0, skinFaces: [] } : u0), [u0, flatOff]);
  const ready = step.info.ok && !flatOff;
  const [pick, setPick] = useState<Pick>(stitchMode && !st.stitch.length ? "stitch" : null);
  // DEL: no added edges left, nothing to delete
  useEffect(() => { if (pick === "deledge" && !cuts.length) setPick(null); }, [pick, cuts.length]);
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
  const lists = usePickLists(partMaterial);
  // its own material: the profile's K-factor for it (sheet metal) and the material it goes to Import 2D with
  const setMaterial = (m: string) => {
    onName(name, qty, m.trim());
    if (!stitchMode) {
      const p = profiles.find((x) => x.name === st.profile) ?? DEFAULT_PROFILE;
      const k = kFor(p, m.trim() || material, u.thickness);
      if (k !== st.kFactor) set({ kFactor: k });
    }
  };
  const useProfile = (n: string) => {
    const p = profiles.find((x) => x.name === n) ?? DEFAULT_PROFILE;
    setCurrentProfile(p.name);
    set({ profile: p.name, kFactor: kFor(p, material, stitchMode ? (st.comp.t || null) : u.thickness), markLen: p.markLen, markInset: p.markInset, marks: p.marks, marksDown: !!p.marksDown, annotate: p.annotate, engraveText: !!p.engraveText, textMm: p.textMm ?? 6, foil: p.foil });
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setPick(null); setEdgeA(null); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const flip = stitchMode ? false : st.top !== undefined ? !u.skinFaces.includes(st.top) : u.bends.filter((b) => !b.inner).length > u.bends.filter((b) => b.inner).length;
  const ups = u.bends.filter((b) => b.up).length;
  const download = () => {
    const t = applyThreads(u, st);
    const url = URL.createObjectURL(new Blob([flatDxf(t.u, { marks: [...marksOf(t.u, st), ...marksDownOf(t.u, st)], texts: bendTexts(t.u, st), threads: t.lines, fitTol: splineTolOf(loadRules()) })], { type: "application/dxf" }));
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
    : pick === "stitch" ? "click flat faces one next to the other (again: out)"
    : pick === "edge" ? (edgeA ? "click the second point of the same flat face (corners and middles snap; Ctrl: square to the edge); along an edge: a seam" : "click a corner or an edge's middle, then a second one: across a flat face it is split; along an edge (its two ends) that edge is a seam")
    : pick === "deledge" ? "click an added edge (green) to delete it"
    : pick === "one" ? "click the flat face to send as it is"
    : pick === "measure3d" ? "click a face, an edge, a hole's edge or a corner; then a second one"
    : pick === "look" ? "click a face: the view looks straight at it" : "drag: turn · right drag: move · wheel: zoom where the pointer is";
  const [meas, setMeas] = useState<MPick[]>([]);
  // the part and the flat pattern side by side, or one of them folded away to the side (kept for next time)
  const [panes, setPanesState] = useState<Panes>(loadPanes);
  const setPanes = (v: Panes) => { setPanesState(v); try { localStorage.setItem(PANES_KEY, v); } catch { /* this session */ } };
  const measured = meas.length === 2 ? measureSummary(meas[0], meas[1]) : null;

  return (
    <div className="import uf">
      <div className="itools">
        {tool("stitch", "Stitch", stitchMode, toggleStitch, "Stitch faces (manual): click flat faces one next to the other; they are laid flat across the edges they share (a surface, or a part with sharp corners). Off: unfolded as sheet metal")}
        {tool("edge", "Add edge", pick === "edge", () => { if (!stitchMode) set({ mode: "stitch" }); setEdgeA(null); setPick(pick === "edge" ? null : "edge"); },
          "Stitch: add an edge across a flat face between two points of its outline: corners and edge middles snap, hold Ctrl for the second point square to the edge (a flange running all round, cut at its corners: one piece per wall; a seam in the middle of a face). The new edge is cut in the flat pattern. Along an existing edge (its two ends): that edge is a seam, not stitched (where a tube opens); again: stitched")}
        {tool("base", "Fixed face", pick === "base", () => setPick(pick === "base" ? null : "base"), "Click a flat face of the part: the flat pattern is unfolded from it (else from the biggest)", stitchMode)}
        {tool("top", "Top side", stitchMode ? st.flip !== undefined : pick === "top", () => (stitchMode ? set({ flip: !(st.flip ?? isFlippedAuto(step)) }) : setPick(pick === "top" ? null : "top")),
          stitchMode ? "Turn the flat pattern over: the faces' other side up" : "Click a face on the side that lies up on the machine (the foil / finish side, or the inside of the bends to trace)")}
        {tool("one", "One face", pick === "one", () => setPick(pick === "one" ? null : "one"), "Click one flat face: its outline (with its holes) is the flat pattern, as it is (Stitch with one face)")}
        {tool("measure3d", "Measure 3D", pick === "measure3d", () => { setPick(pick === "measure3d" ? null : "measure3d"); setMeas([]); }, "Measure the part: click a face, an edge, a hole's edge or a corner, then a second one: offset between faces, hole sizes, distance between holes, angles")}
        {tool("look", "Face view", pick === "look", () => setPick(pick === "look" ? null : "look"), "Click a face of the part: the view turns to look straight at it")}
        {tool("measure", "Measure 2D", pick === "measure", () => setPick(pick === "measure" ? null : "measure"), "Measure the flat pattern: click two things. Points (corners, hole centers, middles) snap; a click on an edge or a bend line takes the line, on an arc or a hole its center. Point to point: straight (X and Y); point to line: square to it; two lines: the distance between them")}
        <span className="uf-sep" />
        {tool("send", sent ? "Send again" : "Send to Import 2D", false, onSend, ready
          ? `Put the flat pattern into Import 2D (×${qty}) to be processed there${sent ? "; it replaces the one sent before" : ""}`
          : flatOff ? `${KIND_LABEL[kind].replace(/s$/, "")}: cut to length, not unfolded (Unfold anyway, on the right, makes a flat pattern)`
          : "The flat pattern is not ready (not unfolded, or the outline is open)", !ready)}
        {tool("dxf", "Export to DXF", false, download, "Save the flat pattern as a DXF file (with the whole bend lines on layer BEND)", !u.outline.length || flatOff)}
      </div>
      <div className={`uf-panes is-${panes}`}>
        <section className={`uf-pane uf-3d${panes === "flat" ? " is-shut" : ""}`}>
          <button type="button" className="uf-strip" onClick={() => setPanes("both")} title="Show the part (3D) again">
            <PaneIcon dir="right" /><span>Part (3D)</span></button>
          <h3>Part <em>{hint}</em>
            <button type="button" className={`icon-btn uf-wire-btn${view.wire ? " is-on" : ""}`} aria-pressed={view.wire} onClick={() => setView({ wire: !view.wire })}
              title={view.wire ? "Wireframe: the edges, hidden ones dashed (click: solid)" : "Solid (click: wireframe, the edges with hidden ones dashed)"}>
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
                {view.wire
                  ? <><path d="M2.5 5.5L8 2.5l5.5 3v6L8 14.5l-5.5-3z" /><path d="M2.5 5.5L8 8.5l5.5-3M8 8.5v6" strokeDasharray="1.6 1.4" /></>
                  : <><path d="M2.5 5.5L8 2.5l5.5 3L8 8.5z" fill="#c7d3d6" /><path d="M2.5 5.5L8 8.5v6l-5.5-3z" fill="#8fa2a7" /><path d="M8 8.5l5.5-3v6L8 14.5z" fill="#a9b9bd" /></>}
              </svg>
            </button>
            <button type="button" className={`icon-btn uf-view-btn${viewOpen ? " is-on" : ""}`} aria-expanded={viewOpen} onClick={() => setViewOpen(!viewOpen)} title="View options: edge lines, colors">
              <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M2 4h12M2 8h12M2 12h12" /><circle cx="5" cy="4" r="1.6" fill="#fff" /><circle cx="11" cy="8" r="1.6" fill="#fff" /><circle cx="7" cy="12" r="1.6" fill="#fff" /></svg>
            </button>
            <PaneButtons side="3d" panes={panes} onPanes={setPanes} /></h3>
          {viewOpen && <ViewOptions view={view} onView={setView} onClose={() => setViewOpen(false)}
            material={(partMaterial || fileMaterial || material).trim()} fileColor={solid.color} />}
          <Part3d solid={solid} u={u} st={st} flip={flip} pick={pick === "measure" ? null : pick} edgeA={edgeA} onCorner={edgeCorner}
            cuts={cuts} onDeleteCut={(i) => setCuts(cuts.filter((_, k) => k !== i), `Edge ${i + 1} deleted`)}
            view={view} material={(partMaterial || fileMaterial || material).trim().toLowerCase()} onLooked={() => setPick(null)}
            measure={pick === "measure3d" ? meas : []} onMeasure={(m) => setMeas((l) => (l.length >= 2 ? [m] : [...l, m]))}
            onPick={(f, k) => {
              if (pick === "one") {
                if (k !== "plane") { setMsg("Pick a flat face"); return; }
                set({ mode: "stitch", stitch: [f], flip: undefined });
                setPick(null);
                return;
              }
              if (pick === "base") { if (k !== "plane") { setMsg("The fixed face must be flat"); return; } set({ base: f }); setPick(null); }
              else if (pick === "top") { set({ top: f }); setPick(null); }
              else if (pick === "stitch") {
                if (k !== "plane") { setMsg("Only flat faces can be stitched"); return; }
                set({ stitch: st.stitch.includes(f) ? st.stitch.filter((x) => x !== f) : [...st.stitch, f] });
              }
            }} />
          {pick === "measure3d" && (
            <div className="uf-meas" aria-live="polite">
              {!meas.length && <p>Click a flat face, a round face, an edge, a hole's edge or a corner.</p>}
              {meas.length > 0 && (
                <div className="uf-meas-top">
                  <div className="uf-meas-picks">
                    {meas.map((m, i) => { const d = describe(m); return <p key={i}><b>{i + 1}. {d.title}</b>{d.lines.map((l, k) => <span key={k}>{l}</span>)}</p>; })}
                    {meas.length === 1 && <p className="uf-meas-hint">Click a second one to measure between them.</p>}
                  </div>
                  <button type="button" className="uf-meas-clear" onClick={() => setMeas([])} title="Clear: measure again">CLEAR</button>
                </div>
              )}
              {measured && (
                <div className="uf-meas-out">
                  <div className="uf-meas-main">
                    <b>{measured.main.label}: {measured.main.value}{measured.main.unit === "°" ? "°" : ""}</b>
                    <output className="uf-meas-big">{measured.main.value} <small>{measured.main.unit}</small></output>
                    {measured.notes.map((l, i) => <span key={i} className="uf-meas-note">{l}</span>)}
                  </div>
                  <div className="uf-meas-delta">
                    {(["X", "Y", "Z"] as const).map((ax, i) => (
                      <label key={ax} className={`is-${ax.toLowerCase()}`} title={`Δ${ax}: apart along ${ax}`}>
                        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 2.5L14 13.5H2z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
                        <span>{ax}</span>
                        <input readOnly value={fmtMeasure(measured.delta[i])} aria-label={`Delta ${ax}`} onFocus={(e) => e.target.select()} />
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="uf-leg">{flatOff ? null : stitchMode
            ? <><span><i className="is-stitch" />stitched</span><span><i className="is-base" />first face (stays)</span><span><i className="is-other" />other faces</span></>
            : <><span><i className="is-skin" />unfolded side</span><span><i className="is-other" />other faces</span><span><i className="is-base" />fixed face</span><span><i className="is-bad" />not unfolded</span></>}</div>
        </section>
        <section className={`uf-pane uf-flat${panes === "3d" ? " is-shut" : ""}`}>
          <button type="button" className="uf-strip" onClick={() => setPanes("both")} title="Show the flat pattern again">
            <PaneIcon dir="left" /><span>Flat pattern</span></button>
          <h3>Flat pattern <em>{flatOff ? "not unfolded" : <>{u.outline.length ? `${fmt(u.box.x1)} × ${fmt(u.box.y1)} mm · ` : ""}{stitchMode && st.comp.side === "none" ? "faces as they are" : stitchMode && st.comp.side === "direct" ? `direct: −2 × ${fmt(st.comp.t)} mm on down bends` : `K ${st.kFactor}`} · top side up{st.foil ? " (foil / finish)" : ""}</>}</em>
            <PaneButtons side="flat" panes={panes} onPanes={setPanes} /></h3>
          {flatOff ? <div className="uf-empty"><div><p>{KIND_LABEL[kind].replace(/s$/, "")}{section ? ` ${section}` : ""}: cut to length, not on the laser, so it is not unfolded.</p>
              <button type="button" className="btn btn-plain uf-anyway" onClick={() => setAnyway(true)}>Unfold anyway</button></div></div>
            : u.outline.length ? <FlatView u={u} st={st} measure={pick === "measure"} />
            : <div className="uf-empty">{stitchMode ? "Click the faces to stitch on the part: the first one stays, each next one must share an edge with one picked before." : "Not unfolded."}</div>}
          <div className="uf-leg"><span><i className="is-mark" />bend marks ({st.marks === "none" ? "off" : st.marks === "trace" ? "traced" : "open cut"}, up bends)</span>{st.marks !== "none" && st.marksDown && <span><i className="is-mark-down" />down bends (dashed)</span>}<span><i className="is-bend" />bend line (not cut)</span><span className="uf-up">UP</span><span className="uf-down">DOWN</span></div>
        </section>
      </div>
      <aside className="uf-panel" aria-label="Unfold">
        <header><h2>{KIND_LABEL[kind] === "Other parts" ? "Part" : KIND_LABEL[kind].replace(/s$/, "")} <small>×{qty}</small></h2>
          <span className={`uf-pill${ready || flatOff ? " is-ok" : " is-warn"}`}>{sent ? "Sent" : flatOff ? "Cut to length" : step.info.ok ? (stitchMode ? "Stitched" : "Unfolded") : stitchMode ? "Pick faces" : "Check it"}</span></header>
        <div className="uf-body">
          <div className="uf-row uf-name">
            <label htmlFor="uf-name">Name</label>
            <NameInput key={name} value={name} onCommit={(n) => onName(n, qty, partMaterial)} />
          </div>
          <div className="uf-row uf-name">
            <label>Pieces</label>
            <NumInput className="field uf-num uf-qty" value={qty} min={0} int aria-label="Pieces" title="Pieces (from the assembly)" onCommit={(n) => onName(name, Math.round(n), partMaterial)} />
            <div className="uf-mat">
              <Combobox value={partMaterial} onChange={(m) => setMaterial(m)}
                options={lists.strict ? lists.techMaterials : lists.materials} strict={lists.strict} strictNote="not in the Technology tables (Settings → Machines → Technology: material tags)"
                placeholder={material && !partMaterial ? `${material} (Import 2D)` : "Material"} ariaLabel="Material" newHint="a new material" />
            </div>
          </div>
          {cutToLength && (
            <p className="uf-note uf-cut">{section && <b>{section}</b>}{section ? ": " : ""}{KIND_LABEL[kind] === "Tubes" ? "a tube" : "a profile"}, cut to length, not on the laser: {anyway ? "unfolded only because you asked." : "not unfolded."}{" "}
              <button type="button" className="link" onClick={() => setAnyway(!anyway)}>{anyway ? "Don't unfold" : "Unfold anyway"}</button></p>
          )}
          {onSendOne && (
            <button type="button" className="btn btn-plain uf-send-one" disabled={!ready} onClick={onSendOne}
              title={ready
                ? `Send this part to Import 2D with its name, ${qty} ${qty === 1 ? "piece" : "pieces"} and material (no material: the Import 2D properties' one); it leaves this list and the next part opens`
                : flatOff ? "Cut to length, not unfolded: nothing to send (Unfold anyway makes a flat pattern)" : "Not unfolded yet: nothing to send"}>
              <span className="uf-send-ic" aria-hidden="true">{ICONS.send}</span>Send to Import 2D
            </button>
          )}
          {/* the STEP file's material, when it can be taken (a material of the Technology tables) */}
          {fileMaterial && fileMaterial.toLowerCase() !== partMaterial.trim().toLowerCase()
            && (!lists.strict || lists.techMaterials.some((o) => o.value.toLowerCase() === fileMaterial.toLowerCase())) && (
            <p className="uf-note">The STEP file says: <b>{fileMaterial}</b>{" "}
              <button type="button" className="link" onClick={() => setMaterial(lists.techMaterials.find((o) => o.value.toLowerCase() === fileMaterial.toLowerCase())?.value ?? fileMaterial)}>use it</button></p>
          )}
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
          {flatOff ? (
            <dl className="uf-facts">
              <dt>Section</dt><dd>{section ?? "–"}</dd>
              <dt>Material</dt><dd>{material || <em>Import 2D properties</em>}</dd>
            </dl>
          ) : <dl className="uf-facts">
            <dt>Thickness</dt><dd>{u.thickness !== null ? `${fmt(u.thickness)} mm` : stitchMode ? <em>Import 2D properties</em> : "not found"}</dd>
            <dt>Material</dt><dd>{material || <em>Import 2D properties</em>}</dd>
            <dt>Bends</dt><dd>{u.bends.length}{u.bends.length ? ` · ${ups} up, ${u.bends.length - ups} down` : ""}</dd>
            <dt>Flat size</dt><dd>{u.outline.length ? `${fmt(u.box.x1)} × ${fmt(u.box.y1)}` : "–"}</dd>
          </dl>}
          {stitchMode ? (<>
            <div className="uf-lbl">Stitched faces</div>
            <div className="uf-row"><span>Faces</span><span className="uf-val">{st.stitch.length}</span>
              <button type="button" className={`btn btn-plain uf-mini${pick === "stitch" ? " is-on" : ""}`} onClick={() => setPick(pick === "stitch" ? null : "stitch")}>{pick === "stitch" ? "Picking…" : "Pick"}</button>
              {st.stitch.length > 0 && <button type="button" className="btn btn-plain uf-mini" onClick={() => set({ stitch: [] })}>Clear</button>}</div>
            <div className="uf-row"><span>Added edges</span><span className="uf-val">{cuts.length}</span>
              <button type="button" className={`btn btn-plain uf-mini${pick === "edge" ? " is-on" : ""}`} title="Click two corners of a flat face: it is split along the line (a flange cut at its corners)"
                onClick={() => { setEdgeA(null); setPick(pick === "edge" ? null : "edge"); }}>{pick === "edge" ? "Adding…" : "Add"}</button>
              {cuts.length > 0 && <button type="button" className={`btn btn-plain uf-mini${pick === "deledge" ? " is-on" : ""}`} title="Delete added edges one by one: click an added edge (green) on the part"
                onClick={() => { setEdgeA(null); setPick(pick === "deledge" ? null : "deledge"); }}>{pick === "deledge" ? "Deleting…" : "Del"}</button>}
              {cuts.length > 0 && <button type="button" className="btn btn-plain uf-mini" onClick={() => { if (pick === "deledge") setPick(null); setCuts([], "Added edges cleared"); }}>Clear</button>}</div>
            <div className="uf-row"><span>Seams</span><span className="uf-val">{seams.length}</span>
              {seams.length > 0 && <button type="button" className="btn btn-plain uf-mini" onClick={() => set({ seams: [] })}>Clear</button>}</div>
            <div className="uf-row"><span>Top side</span><span className="uf-val">{st.flip === undefined ? "inside of most bends" : "turned by hand"}</span>
              <button type="button" className="btn btn-plain uf-mini" onClick={() => set({ flip: !(st.flip ?? isFlippedAuto(step)) })}>Turn over</button>
              {st.flip !== undefined && <button type="button" className="btn btn-plain uf-mini" onClick={() => set({ flip: undefined })}>Auto</button>}</div>
            <div className="uf-row"><span>Compensate</span>
              <span className="cols-toggle uf-seg" role="radiogroup" aria-label="Bend compensation">
                {(["none", "top", "bottom", "direct"] as const).map((c) => (
                  <button key={c} type="button" role="radio" aria-checked={st.comp.side === c} className={st.comp.side === c ? "is-on" : ""}
                    title={c === "none" ? "The faces laid flat as they are (fine for thin sheet)"
                      : c === "direct" ? "The faces are the top side: on every DOWN bend the top side is the outside, wider by the thickness, so the thickness comes off both faces (2 × thickness at a 90° bend). UP bends: as they are"
                      : `The faces are the sheet's ${c} side: each bend gets its allowance less the setbacks (thickness, inner radius, K-factor below)`}
                    onClick={() => set({ comp: { ...st.comp, side: c, t: st.comp.t || 2, r: st.comp.r || st.comp.t || 2 } })}>{c === "none" ? "No" : c === "top" ? "Top side" : c === "bottom" ? "Bottom side" : "Direct"}</button>
                ))}
              </span></div>
            {st.comp.side === "direct" && (
              <div className="uf-row"><span>Thickness</span><NumInput className="field uf-num" value={st.comp.t} min={0} aria-label="Sheet thickness (mm)" onCommit={(n) => set({ comp: { ...st.comp, t: n } })} /><small>mm: off each face at a down bend</small></div>
            )}
            {st.comp.side !== "none" && st.comp.side !== "direct" && (<>
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
          {(() => {
            const groups = holeGroups(u, st);
            if (!groups.length) return null;
            return (<>
              <div className="uf-lbl">Holes</div>
              <div className="uf-holes">
                {groups.map((g) => (
                  <div key={g.key} className="uf-row">
                    <span className="uf-hole">Ø {fmt(g.d)} <small>×{g.count}</small></span>
                    <select className="field" value={g.thread ?? "cut"} aria-label={`Holes Ø${fmt(g.d)}`}
                      title="Cut: the hole is cut. A thread: not cut; a small cross and the thread (M8) are traced, to drill and tap after cutting"
                      onChange={(e) => set({ threads: { ...(st.threads ?? {}), [g.key]: e.target.value } })}>
                      <option value="cut">Cut</option>
                      {TAP_DRILLS.map(([m, t]) => <option key={m} value={m}>{m} thread{Math.abs(t - g.d) <= 0.06 ? " (tap drill size)" : ""}</option>)}
                    </select>
                    {g.auto && g.thread === g.auto && st.threads?.[g.key] === undefined && <small className="uf-auto" title={`Ø${fmt(g.d)} is the tap drill of ${g.auto}: probably tapped`}>probably</small>}
                  </div>
                ))}
                {groups.some((g) => g.thread) && (
                  <div className="uf-row"><span>Mark</span><NumInput className="field uf-num" value={st.threadCross ?? 15} min={2} aria-label="Cross size (mm)" title="The cross, overall (mm)" onCommit={(n) => set({ threadCross: n })} />
                    <span>text</span><NumInput className="field uf-num" value={st.threadText ?? 15} min={2} aria-label="Text height (mm)" title="The thread's text height, capitals (mm)" onCommit={(n) => set({ threadText: n })} /><small>mm</small></div>
                )}
              </div>
            </>);
          })()}
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
          <label className="chk" title="Down bends get marks too, dashed (the up bends' are solid), and they go to Import 2D and the exported DXF like the up bends' marks">
            <input type="checkbox" checked={!!st.marksDown} disabled={st.marks === "none"} onChange={(e) => set({ marksDown: e.target.checked })} /> Down bends too (dashed marks)</label>
          <div className="uf-row"><span>Angle, UP</span>
            <span className="cols-toggle uf-seg" role="radiogroup" aria-label="Angle and UP / DOWN beside the bends">
              {([["off", "Off"], ["show", "Shown"], ["engrave", "Engraved"]] as const).map(([k, l]) => {
                const on = k === "off" ? !st.annotate : k === "show" ? st.annotate && !st.engraveText : st.annotate && !!st.engraveText;
                return <button key={k} type="button" role="radio" aria-checked={on} className={on ? "is-on" : ""}
                  title={k === "engrave" ? "Traced on the part with a single-line font (Relief SingleLine), beside each bend" : k === "show" ? "Only on the screen" : "Not shown"}
                  onClick={() => set({ annotate: k !== "off", engraveText: k === "engrave" })}>{l}</button>;
              })}
            </span></div>
          {st.annotate && st.engraveText && (
            <div className="uf-row"><span>Text height</span><NumInput className="field uf-num" value={st.textMm ?? 6} min={1.5} aria-label="Text height (mm, capitals)" onCommit={(n) => set({ textMm: n })} /><small>mm (capitals; smaller on short bends)</small></div>
          )}
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

type Panes = "both" | "3d" | "flat";
const PANES_KEY = "gnezdo.unfoldPanes";
const loadPanes = (): Panes => { try { const v = localStorage.getItem(PANES_KEY); return v === "3d" || v === "flat" ? v : "both"; } catch { return "both"; } };

const PaneIcon = ({ dir }: { dir: "left" | "right" }) => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {dir === "left" ? <path d="M10 3.5L5.5 8l4.5 4.5" /> : <path d="M6 3.5L10.5 8 6 12.5" />}
  </svg>
);

/** In a pane's title: the arrow makes this pane bigger (it points the way it grows: the other one folds
 *  away to the side); made bigger, the button puts them side by side again. */
function PaneButtons({ side, panes, onPanes }: { side: "3d" | "flat"; panes: Panes; onPanes: (p: Panes) => void }) {
  const alone = panes === side;
  return (
    <span className="uf-pane-btns">
      {alone ? (
        <button type="button" className="icon-btn" onClick={() => onPanes("both")} title="Side by side again">
          <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
            <rect x="2" y="3" width="5" height="10" rx="1" /><rect x="9" y="3" width="5" height="10" rx="1" />
          </svg>
        </button>
      ) : (
        <button type="button" className="icon-btn" onClick={() => onPanes(side)}
          title={`Make this one bigger (the ${side === "3d" ? "flat pattern" : "part"} folds away to the side)`}>
          <PaneIcon dir={side === "3d" ? "right" : "left"} />
        </button>
      )}
    </span>
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

function Part3d({ solid, u, st, flip, pick, onPick, measure, onMeasure, edgeA, onCorner, cuts = [], onDeleteCut, view, material, onLooked }: {
  solid: Solid; u: Unfolded; st: StepSettings; flip: boolean; pick: "base" | "top" | "stitch" | "edge" | "deledge" | "one" | "measure3d" | "look" | null;
  /** the edges added (stitch), and DEL: one of them clicked */
  cuts?: FaceCut[];
  onDeleteCut?: (i: number) => void;
  /** how it is shown: edge lines, wireframe, colors */
  view: ViewPrefs;
  /** its material (lower case), for its color */
  material: string;
  /** FACE VIEW: the view turned to a face */
  onLooked: () => void;
  /** ADD EDGE: the first corner clicked; a corner clicked */
  edgeA?: V3 | null;
  onCorner?: (p: V3) => void;
  onPick: (face: number, kind: string) => void;
  /** MEASURE 3D: what is picked (up to two) */
  measure: MPick[];
  onMeasure: (m: MPick) => void;
}) {
  const cv = useRef<HTMLCanvasElement>(null);
  // turned (yaw, pitch), zoomed and moved (ox, oy: screen pixels off the middle)
  const [cam, setCam] = useState({ yaw: -0.7, pitch: 0.5, zoom: 1, ox: 0, oy: 0 });
  const middleDouble3d = useMiddleDouble(() => setCam((c) => ({ ...c, zoom: 1, ox: 0, oy: 0 })));
  const [hover, setHover] = useState<number | null>(null);
  const shapes = useRef<{ i: number; path: Path2D }[]>([]);
  const proj = useRef<((p: V3) => [number, number, number]) | null>(null);
  const sizeRef = useRef(1);
  const [hoverM, setHoverM] = useState<MPick | null>(null);
  // ADD EDGE: the point the pointer snaps to
  const [hoverP, setHoverP] = useState<{ p: V3; kind: "corner" | "mid" | "perp" } | null>(null);
  // DEL: the added edge under the pointer
  const [hoverCut, setHoverCut] = useState<number | null>(null);
  const seamSet = useMemo(() => new Set(st.seams ?? []), [st.seams]);
  const drag = useRef<{ x: number; y: number; moved: boolean; pan: boolean } | null>(null);
  const rotNRef = useRef<((n: V3) => V3) | null>(null);
  const skin = useMemo(() => new Set(u.skinFaces), [u]);
  // the fixed face: picked, else the biggest flat face of the unfolded side
  const stitchMode = st.mode === "stitch";
  const base = stitchMode ? st.stitch[0] : st.base ?? u.skinFaces[0];
  const picked = useMemo(() => new Set(stitchMode ? st.stitch : []), [stitchMode, st.stitch]);
  // round faces (pipes, bends): drawn in strips, made once per solid
  const strips = useMemo(() => solid.faces.map((f) => { try { return cylStrips(f); } catch { return null; } }), [solid]);

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
      const r3 = [0, 1, 2].map((i) => lowHigh(all.map((p) => p[i])));
      const lo = r3.map((x) => x[0]), hi = r3.map((x) => x[1]);
      const ctr: V3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
      const size = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
      const s = (Math.min(W, H) * 0.78 * cam.zoom) / size;
      const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
      const pr = (p: V3): [number, number, number] => {
        const x = p[0] - ctr[0], y = p[1] - ctr[1], z = p[2] - ctr[2];
        const x1 = cy * x - sy * y, y1 = sy * x + cy * y;
          return [W / 2 + cam.ox + x1 * s, H / 2 + cam.oy - (sp * y1 + cp * z) * s, cp * y1 - sp * z];
      };
      const rotN = (n: V3): V3 => { const x1 = cy * n[0] - sy * n[1], y1 = sy * n[0] + cy * n[1]; return [x1, cp * y1 - sp * n[2], sp * y1 + cp * n[2]]; };
      rotNRef.current = rotN;
      // the part's own color: the material's (set in View options), else the file's
      const matHex = view.matColors[material];
      const own = (fid: number): number[] | null => {
        const fc = solid.faceColor?.[fid];
        const file = fc ?? solid.color;
        const m = matHex ? rgbOf(matHex).map((x) => x / 255) : null;
        const c = view.colors === "material" ? m ?? file : view.colors === "file" ? file ?? m : null;
        return c ? c.map((x) => x * 255) : null;
      };
      const L: V3 = [-0.29, -0.83, 0.48];
      // the pieces to draw, the farthest first: a face, or a strip of a round face (a pipe, a bend)
      type Piece = { f: (typeof solid.faces)[number]; i: number; depth: number; lit: number; strip?: CylStrip };
      const litOf = (n: V3) => { const nr = rotN(n); return 0.4 + 0.6 * Math.abs(nr[0] * L[0] + nr[1] * L[1] + nr[2] * L[2]); };
      const items: Piece[] = solid.faces.flatMap((f, i): Piece[] => {
        const fs: CylStrip[] | null = strips[i] ?? null;
        if (fs) return fs.map((sp) => {
          const pts = sp.loops.length ? sp.loops.flat() : sp.segs.flatMap((q) => [q.a, q.b]);
          return { f, i, strip: sp, depth: pts.reduce((sum, q) => sum + pr(q)[2], 0) / Math.max(1, pts.length), lit: litOf(sp.n) };
        });
        const pts = f.loops.flatMap((l) => l.edges.flatMap((e) => e.pts));
        const depth = pts.reduce((sum, q) => sum + pr(q)[2], 0) / Math.max(1, pts.length);
        let n = normalAt(f, pts[Math.floor(pts.length / 2)] ?? [0, 0, 0]);
        if (!n) {
          const lp = f.loops[0]?.edges.flatMap((e) => e.pts) ?? [];
          const nw: V3 = [0, 0, 0];
          for (let k = 0; k < lp.length; k++) { const a = lp[k], b = lp[(k + 1) % lp.length]; nw[0] += (a[1] - b[1]) * (a[2] + b[2]); nw[1] += (a[2] - b[2]) * (a[0] + b[0]); nw[2] += (a[0] - b[0]) * (a[1] + b[1]); }
          const k = Math.hypot(...nw) || 1; n = [nw[0] / k, nw[1] / k, nw[2] / k];
        }
        return [{ f, i, depth, lit: litOf(n) }];
      }).sort((a, b) => b.depth - a.depth);
      const out: { i: number; path: Path2D }[] = [];
      // wireframe, hidden lines dashed: every edge is drawn dashed first; the visible lines go on a layer of
      // their own where each face (the farthest first) wipes out the lines behind it, then draws its own;
      // the layer goes over the dashed lines, so only the hidden ones stay dashed
      let layC: HTMLCanvasElement | null = null, lay: CanvasRenderingContext2D | null = null;
      if (view.wire) {
        layC = document.createElement("canvas");
        layC.width = c.width; layC.height = c.height;
        lay = layC.getContext("2d");
        lay?.setTransform(dpr, 0, 0, dpr, 0, 0);
        const seen = new Set<number>();
        g.save();
        g.strokeStyle = "#98a8ac"; g.lineWidth = 0.9 * view.edge; g.setLineDash([5, 4]);
        g.beginPath();
        for (const f of solid.faces) for (const l of f.loops) for (const e of l.edges) {
          if (seen.has(e.id)) continue;
          seen.add(e.id);
          e.pts.forEach((p, j) => { const q = pr(p); if (j) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); });
        }
        g.stroke();
        g.restore();
      }
      for (const it of items) {
        const k = it.i === base ? "base" : stitchMode ? (picked.has(it.i) ? "stitch" : "side") : solid.faces[it.i].surf.kind === "other" ? "bad" : skin.has(it.i) ? "skin" : "side";
        const roleRgb = k === "bad" ? [214, 90, 70] : k === "base" ? [120, 196, 140] : k === "skin" ? [200, 228, 208] : k === "stitch" ? [150, 196, 238] : [178, 192, 196];
        // part colors: the face's own color; what is picked (fixed face, stitched faces) keeps its color
        const mine = view.colors !== "roles" && k !== "base" && k !== "stitch" && k !== "bad" ? own(it.f.id) : null;
        const rgb = mine ?? (view.colors !== "roles" && k === "skin" ? [178, 192, 196] : roleRgb);
        const c2 = rgb.map((v) => Math.round(v * it.lit));
        const path = new Path2D();
        const outlines: V3[][] = it.strip ? it.strip.loops : it.f.loops.map((l) => l.edges.flatMap((e) => e.pts));
        for (const lp of outlines) {
          lp.forEach((p, j) => { const q = pr(p); if (j) path.lineTo(q[0], q[1]); else path.moveTo(q[0], q[1]); });
          path.closePath();
        }
        // the face's edges in this piece (a strip: the bits of them that run in it)
        const edgesHere: { id: number; pts: V3[] }[] = it.strip ? it.strip.segs.map((q) => ({ id: q.id, pts: [q.a, q.b] })) : it.f.loops.flatMap((l) => l.edges);
        const hot = hover === it.i && pick && pick !== "measure3d";
        // wireframe: only the edges (a face under the pointer still shows)
        if (!view.wire || hot) {
          g.fillStyle = hot ? "rgba(242,183,5,0.9)" : `rgba(${c2[0]},${c2[1]},${c2[2]},0.94)`;
          g.fill(path, "evenodd");
        }
        // wireframe: the face hides what is behind it on the layer of visible lines
        const t = lay ?? g;
        if (lay) { lay.globalCompositeOperation = "destination-out"; lay.fill(path, "evenodd"); lay.globalCompositeOperation = "source-over"; }
        t.strokeStyle = view.wire ? (k === "base" ? "#1d9641" : k === "stitch" ? "#1d7fd0" : k === "bad" ? "#c2412d" : "#33464c")
          : mine ? "#3c4a4e" : k === "skin" || k === "base" ? "#1d9641" : k === "stitch" ? "#1d7fd0" : k === "bad" ? "#c2412d" : "#7f9296";
        t.lineWidth = (k === "side" ? 0.9 : 1.2) * view.edge;
        t.beginPath();
        for (const e of edgesHere) e.pts.forEach((p, j) => { const q = pr(p); if (j) t.lineTo(q[0], q[1]); else t.moveTo(q[0], q[1]); });
        t.stroke();
        // edges added across faces (ADD EDGE): green; existing edges made seams: red dashed
        for (const e of edgesHere) {
          const col = seamSet.has(e.id) ? "#e3262b" : e.id <= -1_000_000 ? "#22b14c" : null;
          if (!col) continue;
          t.strokeStyle = col; t.lineWidth = 2.8 * Math.max(1, view.edge);
          t.setLineDash(seamSet.has(e.id) ? [7, 4] : []);
          t.beginPath(); e.pts.forEach((p, j) => { const q = pr(p); if (j) t.lineTo(q[0], q[1]); else t.moveTo(q[0], q[1]); }); t.stroke();
          t.setLineDash([]);
        }
        out.push({ i: it.i, path });
      }
      if (layC) { g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(layC, 0, 0); g.restore(); }
      shapes.current = out.reverse();   // nearest first, for picking
      proj.current = pr;
      sizeRef.current = size;
      // MEASURE 3D: what is picked (orange), what the pointer is on (yellow), the line between two picks
      const mark = (m: MPick, col: string, w: number) => {
        g.strokeStyle = col; g.fillStyle = col; g.lineWidth = w;
        if (m.kind === "plane" || m.kind === "cyl") {
          for (const sh of out.filter((x) => x.i === m.face)) { g.globalAlpha = 0.45; g.fill(sh.path, "evenodd"); g.globalAlpha = 1; g.lineWidth = 1.6; g.stroke(sh.path); }
          if (m.kind === "cyl") { const a = pr(add3(m.c, mul3(m.d, -m.r * 1.6))), b = pr(add3(m.c, mul3(m.d, m.r * 1.6))); g.setLineDash([5, 3]); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); g.setLineDash([]); }
          return;
        }
        if (m.kind === "point") { const q = pr(m.p); g.beginPath(); g.arc(q[0], q[1], 4.5, 0, 2 * Math.PI); g.fill(); return; }
        const e = solid.faces[m.face].loops.flatMap((l) => l.edges).find((x) => x.id === m.edge);
        if (!e) return;
        g.beginPath(); e.pts.forEach((p, j) => { const q = pr(p); if (j) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); }); g.stroke();
        if (m.kind === "circle") { const q = pr(m.c); g.beginPath(); g.arc(q[0], q[1], 3, 0, 2 * Math.PI); g.fill(); }
      };
      if (hoverM && pick === "measure3d") mark(hoverM, "rgba(242,183,5,0.95)", 3.5);
      // ADD EDGE: the corner under the pointer, the first corner and the line to come
      if (pick === "edge") {
        const hc = hoverP ? pr(hoverP.p) : null;
        if (edgeA) {
          const a = pr(edgeA);
          if (hc) { g.strokeStyle = "#22b14c"; g.lineWidth = 2.2; g.setLineDash([6, 4]); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(hc[0], hc[1]); g.stroke(); g.setLineDash([]); }
          g.fillStyle = "#1d7fd0"; g.beginPath(); g.arc(a[0], a[1], 5, 0, 2 * Math.PI); g.fill();
        }
        if (hc && hoverP) {
          g.fillStyle = "rgba(242,183,5,0.95)"; g.strokeStyle = "#8a6200"; g.lineWidth = 1.5;
          g.beginPath();
          if (hoverP.kind === "mid") { g.moveTo(hc[0], hc[1] - 7); g.lineTo(hc[0] + 7, hc[1] + 5); g.lineTo(hc[0] - 7, hc[1] + 5); g.closePath(); }
          else if (hoverP.kind === "perp") { g.rect(hc[0] - 6, hc[1] - 6, 12, 12); }
          else g.arc(hc[0], hc[1], 5.5, 0, 2 * Math.PI);
          g.fill(); g.stroke();
          g.font = "600 11px system-ui, sans-serif"; g.fillStyle = "#6b4d00";
          g.fillText(hoverP.kind === "corner" ? "Corner" : hoverP.kind === "mid" ? "Middle" : "Square to edge", hc[0] + 10, hc[1] + 18);
        }
      }
      // DEL: the added edge under the pointer, red
      if (pick === "deledge" && hoverCut !== null && cuts[hoverCut]) {
        const a = pr(cuts[hoverCut][0]), b = pr(cuts[hoverCut][1]);
        g.strokeStyle = "#e3262b"; g.lineWidth = 5; g.lineCap = "round";
        g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); g.lineCap = "butt";
      }
      for (const m of measure) mark(m, "#f07d1a", 3.5);
      if (measure.length === 2) {
        const a = pr(refPoint(measure[0])), b = pr(refPoint(measure[1]));
        g.strokeStyle = "#c8171d"; g.lineWidth = 1.6; g.setLineDash([6, 4]);
        g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); g.setLineDash([]);
        g.fillStyle = "#c8171d";
        for (const q of [a, b]) { g.beginPath(); g.arc(q[0], q[1], 3.5, 0, 2 * Math.PI); g.fill(); }
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(c);
    return () => ro.disconnect();
  }, [solid, strips, cam, skin, base, hover, pick, picked, stitchMode, measure, hoverM, edgeA, hoverP, hoverCut, cuts, seamSet, view, material]);

  const faceAt = (x: number, y: number) => {
    const g = cv.current?.getContext("2d");
    if (!g) return null;
    const dpr = window.devicePixelRatio || 1;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // the point in the canvas's own pixels (the paths are drawn scaled by the screen's pixel ratio)
    return shapes.current.find((s) => g.isPointInPath(s.path, x * dpr, y * dpr, "evenodd"))?.i ?? null;
  };
  // MEASURE 3D, what the pointer is on: a corner (9 px), an edge (8 px), inside a hole (its circle), else
  // the face. Only what is not hidden behind the face under the pointer.
  /** the depth of the face under the pointer there (flat: exact; round: its nearest point), Infinity: none */
  const frontAt = (x: number, y: number, f: number | null): number => {
    const pr = proj.current;
    if (!pr || f === null) return Infinity;
    let front = Infinity;
    const q = solid.faces[f].loops.flatMap((l) => l.edges.flatMap((e) => e.pts)).map((p) => pr(p));
    const sf = solid.faces[f].surf;
    if (sf.kind === "plane" && q.length >= 3) {
      const p0 = q[0];
      let p1 = q[1], far = 0;
      for (const r of q) { const d = Math.hypot(r[0] - p0[0], r[1] - p0[1]); if (d > far) { far = d; p1 = r; } }
      let p2 = q[2], area = 0;
      for (const r of q) { const ar = Math.abs((p1[0] - p0[0]) * (r[1] - p0[1]) - (p1[1] - p0[1]) * (r[0] - p0[0])); if (ar > area) { area = ar; p2 = r; } }
      const det = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
      if (Math.abs(det) > 1e-9) {
        const A = ((p1[2] - p0[2]) * (p2[1] - p0[1]) - (p2[2] - p0[2]) * (p1[1] - p0[1])) / det;
        const B = ((p2[2] - p0[2]) * (p1[0] - p0[0]) - (p1[2] - p0[2]) * (p2[0] - p0[0])) / det;
        front = p0[2] + A * (x - p0[0]) + B * (y - p0[1]);
      }
    }
    if (front === Infinity && q.length) front = q.reduce((b, r) => (Math.hypot(r[0] - x, r[1] - y) < Math.hypot(b[0] - x, b[1] - y) ? r : b), q[0])[2];
    return front;
  };
  /** the edge seen nearest the pointer (8 px): its face, its number, the 3D segment and where along it */
  const edgeNear = (x: number, y: number) => {
    const pr = proj.current;
    if (!pr) return null;
    const front = frontAt(x, y, faceAt(x, y)), eps = sizeRef.current * 0.01;
    let best: { d: number; z: number; id: number; a: V3; b: V3 } | null = null;
    for (const fc of solid.faces) for (const l of fc.loops) for (const e of l.edges) {
      const q = e.pts.map((p) => pr(p));
      for (let k = 1; k < q.length; k++) {
        const [ax, ay, az] = q[k - 1], [bx, by, bz] = q[k];
        const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / L2));
        const d = Math.hypot(ax + vx * t - x, ay + vy * t - y), z = az + (bz - az) * t;
        if (d < 8 && z <= front + eps && (!best || d < best.d - 0.5 || (Math.abs(d - best.d) <= 0.5 && z < best.z))) best = { d, z, id: e.id, a: e.pts[k - 1], b: e.pts[k] };
      }
    }
    return best;
  };
  /** DEL: the added edge nearest the pointer (8 px), the one in front first */
  const cutAt = (x: number, y: number): number | null => {
    const pr = proj.current;
    if (!pr) return null;
    let best: { d: number; z: number; i: number } | null = null;
    cuts.forEach(([p0, p1], i) => {
      const [ax, ay, az] = pr(p0), [bx, by, bz] = pr(p1);
      const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / L2));
      const d = Math.hypot(ax + vx * t - x, ay + vy * t - y), z = az + (bz - az) * t;
      if (d < 8 && (!best || d < best.d - 0.5 || (Math.abs(d - best.d) <= 0.5 && z < best.z))) best = { d, z, i };
    });
    return (best as { i: number } | null)?.i ?? null;
  };
  /** ADD EDGE: a corner, an edge's middle (10 px), or with Ctrl after the first point: square onto the edge under the pointer */
  const edgePointAt = (x: number, y: number, ctrl: boolean): { p: V3; kind: "corner" | "mid" | "perp" } | null => {
    const pr = proj.current;
    if (!pr) return null;
    if (ctrl && edgeA) {
      const n = edgeNear(x, y);
      if (n) {
        const d = sub3(n.b, n.a), L2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1;
        const t = Math.max(0, Math.min(1, ((edgeA[0] - n.a[0]) * d[0] + (edgeA[1] - n.a[1]) * d[1] + (edgeA[2] - n.a[2]) * d[2]) / L2));
        return { p: add3(n.a, mul3(d, t)), kind: "perp" };
      }
    }
    const front = frontAt(x, y, faceAt(x, y)), eps = sizeRef.current * 0.01;
    let best: { d: number; z: number; p: V3; kind: "corner" | "mid" } | null = null;
    const take = (p: V3, kind: "corner" | "mid") => {
      const q = pr(p), d = Math.hypot(q[0] - x, q[1] - y);
      if (d >= 10 || q[2] > front + eps) return;
      // hidden where it is on the screen (a face in front of it there): not this one. Off the part, at its
      // outline, nothing is under the pointer and a corner behind (the sheet's other side) came first
      if (frontAt(q[0], q[1], faceAt(q[0], q[1])) < q[2] - eps) return;
      // a corner wins over a middle a little nearer; points (nearly) on top of each other on the screen
      // (a corner in front and one behind it, the part turned to look along an edge): the one in front
      const score = d - (kind === "corner" ? 3 : 0);
      if (!best || score < best.d - 2 || (Math.abs(score - best.d) <= 2 && q[2] < best.z - eps)) best = { d: score, z: q[2], p, kind };
    };
    for (const fc of solid.faces) for (const l of fc.loops) for (const e of l.edges) {
      if (e.pts.length < 2) continue;
      take(e.pts[0], "corner"); take(e.pts[e.pts.length - 1], "corner");
      if (len3(sub3(e.pts[0], e.pts[e.pts.length - 1])) < 1e-6) continue;
      // the middle along it
      let total = 0;
      for (let k = 1; k < e.pts.length; k++) total += len3(sub3(e.pts[k], e.pts[k - 1]));
      let run = 0;
      for (let k = 1; k < e.pts.length; k++) {
        const s0 = len3(sub3(e.pts[k], e.pts[k - 1]));
        if (run + s0 >= total / 2) { const t = (total / 2 - run) / (s0 || 1); take(add3(e.pts[k - 1], mul3(sub3(e.pts[k], e.pts[k - 1]), t)), "mid"); break; }
        run += s0;
      }
    }
    const b = best as { p: V3; kind: "corner" | "mid" } | null;
    return b ? { p: b.p, kind: b.kind } : null;
  };
  const measureAt = (x: number, y: number): MPick | null => {
    const pr = proj.current;
    if (!pr) return null;
    const f = faceAt(x, y);
    const eps = sizeRef.current * 0.01;
    // the depth of the face under the pointer there (flat: exact; round: its nearest point)
    let front = Infinity;
    if (f !== null) {
      const q = solid.faces[f].loops.flatMap((l) => l.edges.flatMap((e) => e.pts)).map((p) => pr(p));
      const sf = solid.faces[f].surf;
      if (sf.kind === "plane" && q.length >= 3) {
        // depth = A x + B y + C through three points far apart
        const p0 = q[0];
        let p1 = q[1], far = 0;
        for (const r of q) { const d = Math.hypot(r[0] - p0[0], r[1] - p0[1]); if (d > far) { far = d; p1 = r; } }
        let p2 = q[2], area = 0;
        for (const r of q) { const ar = Math.abs((p1[0] - p0[0]) * (r[1] - p0[1]) - (p1[1] - p0[1]) * (r[0] - p0[0])); if (ar > area) { area = ar; p2 = r; } }
        const det = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
        if (Math.abs(det) > 1e-9) {
          const A = ((p1[2] - p0[2]) * (p2[1] - p0[1]) - (p2[2] - p0[2]) * (p1[1] - p0[1])) / det;
          const B = ((p2[2] - p0[2]) * (p1[0] - p0[0]) - (p1[2] - p0[2]) * (p2[0] - p0[0])) / det;
          front = p0[2] + A * (x - p0[0]) + B * (y - p0[1]);
        }
      }
      if (front === Infinity) front = q.reduce((b, r) => (Math.hypot(r[0] - x, r[1] - y) < Math.hypot(b[0] - x, b[1] - y) ? r : b), q[0])[2];
    }
    const seen = (z: number) => z <= front + eps;
    let corner: { d: number; z: number; face: number; p: V3 } | null = null;
    let edge: { d: number; z: number; face: number; id: number } | null = null;
    let hole: { z: number; face: number; id: number; r: number } | null = null;
    const done = new Set<number>();
    solid.faces.forEach((fc, fi) => {
      for (const l of fc.loops) for (const e of l.edges) {
        if (done.has(e.id)) continue;
        done.add(e.id);
        const q = e.pts.map((p) => pr(p));
        for (let k = 1; k < q.length; k++) {
          const [ax, ay, az] = q[k - 1], [bx, by, bz] = q[k];
          const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy || 1;
          const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / L2));
          const d = Math.hypot(ax + vx * t - x, ay + vy * t - y), z = az + (bz - az) * t;
          if (d < 8 && seen(z) && (!edge || d < edge.d - 0.5 || (Math.abs(d - edge.d) <= 0.5 && z < edge.z))) edge = { d, z, face: fi, id: e.id };
        }
        if (!e.arc) {
          for (const [p, c] of [[e.pts[0], q[0]], [e.pts[e.pts.length - 1], q[q.length - 1]]] as const) {
            const d = Math.hypot(c[0] - x, c[1] - y);
            if (d < 9 && seen(c[2]) && (!corner || d < corner.d)) corner = { d, z: c[2], face: fi, p };
          }
        } else if (len3(sub3(e.pts[0], e.pts[e.pts.length - 1])) < 1e-6) {
          // a whole circle around the pointer: a hole (the smallest one, in front)
          let inside = false;
          for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
            const [xi, yi] = q[i], [xj, yj] = q[j];
            if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
          }
          const zc = pr(e.arc.c)[2];
          if (inside && seen(zc) && (!hole || e.arc.r < hole.r - 1e-3 || (Math.abs(e.arc.r - hole.r) <= 1e-3 && zc < hole.z))) hole = { z: zc, face: fi, id: e.id, r: e.arc.r };
        }
      }
    });
    const c = corner as { face: number; p: V3 } | null, ed = edge as { face: number; id: number } | null, h = hole as { face: number; id: number } | null;
    if (c) return { kind: "point", face: c.face, p: c.p, what: "corner" };
    if (ed) return edgePick(solid, ed.face, ed.id);
    if (h) return edgePick(solid, h.face, h.id);
    return f === null ? null : facePick(solid, f);
  };
  const local = (e: React.PointerEvent | React.MouseEvent) => { const r = cv.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
  /** FACE VIEW: turned to look straight at the face, from the side it is seen (the part in the middle again) */
  const lookAt = (fi: number) => {
    const f = solid.faces[fi];
    const pts = f.loops.flatMap((l) => l.edges.flatMap((e) => e.pts));
    let n = normalAt(f, pts[Math.floor(pts.length / 2)] ?? [0, 0, 0]);
    if (!n && f.loops[0]) {
      const lp = f.loops[0].edges.flatMap((e) => e.pts), nw: V3 = [0, 0, 0];
      for (let k = 0; k < lp.length; k++) { const a = lp[k], b = lp[(k + 1) % lp.length]; nw[0] += (a[1] - b[1]) * (a[2] + b[2]); nw[1] += (a[2] - b[2]) * (a[0] + b[0]); nw[2] += (a[0] - b[0]) * (a[1] + b[1]); }
      const k = Math.hypot(...nw); n = k ? [nw[0] / k, nw[1] / k, nw[2] / k] : null;
    }
    if (!n) return;
    // the side seen now: the normal toward the viewer
    const r = rotNRef.current;
    if (r && r(n)[1] > 0) n = [-n[0], -n[1], -n[2]];
    const h = Math.hypot(n[0], n[1]);
    setCam((c) => ({ ...c, yaw: h > 1e-9 ? Math.atan2(n![0], n![1]) + Math.PI : c.yaw, pitch: Math.asin(Math.max(-1, Math.min(1, n![2]))), ox: 0, oy: 0 }));
  };
  return (
    <div className="uf-canvas">
      <canvas ref={cv} className={pick ? "is-pick" : ""}
        // left button: turn; right or middle button (or Shift): move
        onPointerDown={(e) => {
          // a double click with the middle button: the whole part in view again (the way it is turned stays)
          if (middleDouble3d(e)) { e.preventDefault(); drag.current = null; return; }
          drag.current = { x: e.clientX, y: e.clientY, moved: false, pan: e.button !== 0 || e.shiftKey }; (e.target as Element).setPointerCapture(e.pointerId);
        }}
        onContextMenu={(e) => e.preventDefault()}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d && (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3 || d.moved)) {
            d.moved = true;
            // the step is taken now: the state updates later, when d has moved on
            const dx = e.clientX - d.x, dy = e.clientY - d.y;
            d.x = e.clientX; d.y = e.clientY;
            if (d.pan) setCam((c) => ({ ...c, ox: c.ox + dx, oy: c.oy + dy }));
            else setCam((c) => ({ ...c, yaw: c.yaw + dx * 0.01, pitch: Math.max(-1.55, Math.min(1.55, c.pitch + dy * 0.01)) }));
            return;
          }
          if (pick === "measure3d") { const [x, y] = local(e); setHoverM(measureAt(x, y)); }
          else if (pick === "edge") { const [x, y] = local(e); setHoverP(edgePointAt(x, y, e.ctrlKey || e.metaKey)); }
          else if (pick === "deledge") { const [x, y] = local(e); setHoverCut(cutAt(x, y)); }
          else if (pick) { const [x, y] = local(e); setHover(faceAt(x, y)); }
        }}
        onPointerUp={(e) => {
          const d = drag.current; drag.current = null;
          if (d?.moved || !pick || e.button !== 0) return;
          const [x, y] = local(e);
          if (pick === "measure3d") { const m = measureAt(x, y); if (m) onMeasure(m); return; }
          if (pick === "edge") { const sp = edgePointAt(x, y, e.ctrlKey || e.metaKey); if (sp) onCorner?.(sp.p); return; }
          if (pick === "deledge") { const i = cutAt(x, y); if (i !== null) { setHoverCut(null); onDeleteCut?.(i); } return; }
          const f = faceAt(x, y);
          if (f === null) return;
          if (pick === "look") { lookAt(f); onLooked(); return; }
          onPick(f, solid.faces[f].surf.kind);
        }}
        onDoubleClick={(e) => { if (pick) return; const [x, y] = local(e); const f = faceAt(x, y); if (f !== null) lookAt(f); }}
        onPointerLeave={() => { setHover(null); setHoverM(null); setHoverP(null); setHoverCut(null); }}
        // zoom where the pointer is: the point under it stays there
        onWheel={(e) => {
          const c0 = cv.current;
          if (!c0) return;
          const [mx, my] = local(e as unknown as React.PointerEvent);
          const W = c0.clientWidth, H = c0.clientHeight;
          setCam((c) => {
            const zoom = Math.max(0.2, Math.min(40, c.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12))), k = zoom / c.zoom;
            return { ...c, zoom, ox: mx - W / 2 - (mx - W / 2 - c.ox) * k, oy: my - H / 2 - (my - H / 2 - c.oy) * k };
          });
        }}
      />
      {!stitchMode && u.skinFaces.length > 0 && <span className="uf-top">{flip ? "Top side: the other side (grey)" : "Top side: the green side"}</span>}
    </div>
  );
}

/** The 3D Extractor with no part open: its tools and panes, empty until a STEP file is dropped on its list. */
export function ExtractEmpty({ onPick }: { onPick: () => void }) {
  const tools: [string, string][] = [["stitch", "Stitch"], ["edge", "Add edge"], ["base", "Fixed face"], ["top", "Top side"], ["one", "One face"],
    ["measure3d", "Measure 3D"], ["look", "Face view"], ["measure", "Measure 2D"]];
  const t = ([id, label]: [string, string]) => (
    <button key={id} type="button" className="itool" aria-disabled title={`${label}: open a part first`}>
      <span className="itool-box">{ICONS[id]}</span><span className="itool-label">{label}</span>
    </button>
  );
  return (
    <div className="import uf uf-none">
      <div className="itools">
        {tools.map(t)}
        <span className="uf-sep" />
        {([["send", "Send to Import 2D"], ["dxf", "Export to DXF"]] as [string, string][]).map(t)}
      </div>
      <div className="uf-panes is-both">
        <section className="uf-pane"><h3>Part</h3>
          <div className="uf-empty"><p><b>No part open.</b><br />Drop STEP files (parts or assemblies) on the 3D Extractor list on the left,<br />then pick a part there.</p>
            <button type="button" className="btn btn-plain" onClick={onPick}>Show the list</button></div>
        </section>
        <section className="uf-pane"><h3>Flat pattern</h3><div className="uf-empty">The flat pattern shows here.</div></section>
      </div>
      <aside className="uf-panel" aria-label="Unfold"><header><h2>No part</h2></header>
        <div className="uf-body"><p className="uf-note">Its name, pieces, material and how it is unfolded show here once a part is open.</p></div></aside>
    </div>
  );
}

/** The 3D view's options: edge lines, solid or wireframe, face colors (a color per material). */
function ViewOptions({ view, onView, onClose, material, fileColor }: {
  view: ViewPrefs; onView: (p: Partial<ViewPrefs>) => void; onClose: () => void;
  /** the part's material, its color set here; and the file's own color */
  material: string; fileColor?: [number, number, number];
}) {
  const m = material.toLowerCase();
  const mats = [...new Set([...(m ? [m] : []), ...Object.keys(view.matColors)])];
  const setMat = (k: string, hex: string | null) => {
    const next = { ...view.matColors };
    if (hex) next[k] = hex; else delete next[k];
    onView({ matColors: next });
  };
  return (
    <div className="uf-viewopts" role="dialog" aria-label="View options">
      <div className="uf-vo-head"><b>View</b><button type="button" className="icon-btn uf-vo-close" onClick={onClose} aria-label="Close" title="Close">×</button></div>
      <div className="uf-row">
        <label htmlFor="uf-edge">Edge lines</label>
        <input id="uf-edge" type="range" min={0.5} max={4} step={0.25} value={view.edge} onChange={(e) => onView({ edge: Number(e.target.value) })} />
        <span className="uf-val">{view.edge}×</span>
      </div>
      <div className="uf-row">
        <span>Colors</span>
        <span className="cols-toggle uf-seg" role="radiogroup" aria-label="Face colors">
          {([["roles", "Unfold"], ["file", "STEP file"], ["material", "Material"]] as const).map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={view.colors === k} className={view.colors === k ? "is-on" : ""} onClick={() => onView({ colors: k })}
              title={k === "roles" ? "What unfolding does with each face (unfolded side, fixed face, stitched)" : k === "file" ? "The colors the STEP file gives the part (else its material's)" : "A color for each material, set below (else the file's)"}>{l}</button>
          ))}
        </span>
      </div>
      <p className="uf-note">{fileColor ? <>The STEP file colors this part <i className="uf-swatch" style={{ background: hexOf(fileColor) }} /> {hexOf(fileColor)}.</> : "The STEP file gives this part no color."}</p>
      <div className="uf-lbl">Material colors</div>
      {!mats.length && <p className="uf-note">No material: set the part's material (or the Import 2D one) to give it a color.</p>}
      {mats.map((k) => (
        <div className="uf-row uf-matcolor" key={k}>
          <input type="color" value={view.matColors[k] ?? (fileColor ? hexOf(fileColor) : "#b2c0c4")} onChange={(e) => setMat(k, e.target.value)} aria-label={`Color of ${k}`} />
          <span className="uf-val">{k}{k === m && <small> · this part</small>}</span>
          {view.matColors[k] && <button type="button" className="link" onClick={() => setMat(k, null)}>Remove</button>}
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ the flat pattern (SVG, measured)

/** What Measure 2D picked on the flat pattern: a point (snapped), a straight line, or an arc / circle. */
type FlatPick =
  | { kind: "point"; p: V2 }
  | { kind: "line"; a: V2; b: V2; at: V2 }
  | { kind: "round"; c: V2; r: number; at: V2; pts: V2[] };

function FlatView({ u: u0, st, measure }: { u: Unfolded; st: StepSettings; measure: boolean }) {
  // threaded holes: a cross and the thread instead of the hole (as it goes to Import 2D)
  const { u, lines: threadLines } = useMemo(() => applyThreads(u0, st), [u0, st]);
  const svg = useRef<SVGSVGElement>(null);
  // Measure 2D: two picks, each a point (snapped), a straight line, or an arc / circle (its center)
  const [picks, setPicks] = useState<FlatPick[]>([]);
  const [near, setNear] = useState<FlatPick | null>(null);
  useEffect(() => { setPicks([]); setNear(null); }, [measure, u]);
  const W = u.box.x1, H = u.box.y1;
  const pad = Math.max(W, H) * 0.09;
  const y = (v: number) => H - v;
  const marks = marksOf(u, st), marksDown = marksDownOf(u, st);
  const fs = Math.max(W, H) * 0.026;
  // zoom (wheel, + / −) and move (right or middle button, or left without Measure 2D); a new flat
  // pattern size: fitted again
  const fitBox = { x: -pad, y: -pad, w: W + 2 * pad, h: H + 2 * pad };
  const [vb, setVb] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const middleDoubleFlat = useMiddleDouble(() => setVb(null));
  useEffect(() => setVb(null), [W, H]);
  const box = vb ?? fitBox;
  // the svg's size on the screen: drawing units per screen pixel (marks and the dimension keep their size)
  const [px, setPx] = useState({ w: 1, h: 1 });
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPx({ w: el.clientWidth || 1, h: el.clientHeight || 1 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const upp = Math.max(box.w / px.w, box.h / px.h);
  const zoomAt = (k: number, at?: [number, number]) => setVb((prev) => {
    const b = prev ?? fitBox, cx = at ? at[0] : b.x + b.w / 2, cy = at ? at[1] : b.y + b.h / 2;
    const w = Math.min(fitBox.w * 4, Math.max(fitBox.w / 400, b.w / k)), f = w / b.w;
    return { x: cx - (cx - b.x) * f, y: cy - (cy - b.y) * f, w, h: b.h * f };
  });
  const svgPt = (clientX: number, clientY: number): [number, number] => {
    const m = svg.current!.getScreenCTM()!.inverse();
    const q = new DOMPoint(clientX, clientY).matrixTransform(m);
    return [q.x, q.y];
  };
  const pan = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  // Measure 2D snaps to points (corners, hole centers, middles of straight edges, bend line ends and
  // middles); else it picks the line under the pointer (a straight edge or a bend line), or an arc or a
  // circle (its center). Two picks: point to point straight (with its X and Y), point to line square to
  // the line, two parallel lines the distance between them.
  const snapPts = useMemo(() => {
    const out: V2[] = [];
    const mid = (a: V2, b: V2): V2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    for (const e of u.outline) {
      if (e.arc) out.push(e.arc.c);
      out.push(e.pts[0], e.pts[e.pts.length - 1]);
      if (!e.arc && e.pts.length === 2) out.push(mid(e.pts[0], e.pts[1]));
    }
    for (const [a, b] of u.bendLines) out.push(a, b, mid(a, b));
    return out;
  }, [u]);
  const runs = useMemo(() => [
    ...u.outline.map((e) => ({ pts: e.pts, arc: e.arc })),
    ...u.bendLines.map(([a, b]) => ({ pts: [a, b], arc: undefined })),
  ], [u]);
  const pickAt = (e: React.PointerEvent): FlatPick | null => {
    const [sx, sy] = svgPt(e.clientX, e.clientY);
    const p: V2 = [sx, H - sy];
    let best: V2 | null = null, bd = 10 * upp;
    for (const c of snapPts) { const d = Math.hypot(c[0] - p[0], c[1] - p[1]); if (d < bd) { bd = d; best = c; } }
    if (best) return { kind: "point", p: best };
    let hit: FlatPick | null = null, od = 8 * upp;
    for (const run of runs) for (let i = 1; i < run.pts.length; i++) {
      const a = run.pts[i - 1], b = run.pts[i], vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy;
      if (L2 < 1e-12) continue;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2));
      const q: V2 = [a[0] + vx * t, a[1] + vy * t], d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d >= od) continue;
      od = d;
      hit = run.arc ? { kind: "round", c: run.arc.c, r: run.arc.r, at: q, pts: run.pts }
        // a straight edge (a long polyline: the piece under the pointer)
        : { kind: "line", a: run.pts.length === 2 ? run.pts[0] : a, b: run.pts.length === 2 ? run.pts[1] : b, at: q };
    }
    return hit;
  };
  const asPick = (k: FlatPick): DimPick => {
    const P = (v: V2) => ({ x: v[0], y: v[1] });
    return k.kind === "point" ? { kind: "point", p: P(k.p) }
      : k.kind === "line" ? { kind: "line", id: "l", a: P(k.a), b: P(k.b), at: P(k.at) }
      : { kind: "round", id: "r", c: P(k.c), r: k.r, full: false, at: P(k.at) };
  };
  const result: Measure | string | null = picks.length === 2 ? (() => { const r = dimensionOf(asPick(picks[0]), asPick(picks[1])); return r.ok ? r.m : r.message; })() : null;
  const r = 4 * upp, tf = 13 * upp;
  const dim = (m: Measure) => {
    if (m.kind !== "distance") return null;
    const a: V2 = [m.from.x, m.from.y], b: V2 = [m.to.x, m.to.y];
    const xy = picks.every((k) => k.kind !== "line");
    return (
      <g className="uf-dim">
        {m.ext.map(([p, q], i) => <path key={i} className="is-ext" d={`M${p.x} ${y(p.y)} L${q.x} ${y(q.y)}`} />)}
        <path d={`M${a[0]} ${y(a[1])} L${b[0]} ${y(b[1])}`} />
        <circle cx={a[0]} cy={y(a[1])} r={r * 0.75} /><circle cx={b[0]} cy={y(b[1])} r={r * 0.75} />
        {/* the halo in drawing units too, so it stays round the letters at any zoom */}
        <text x={(a[0] + b[0]) / 2} y={y((a[1] + b[1]) / 2) - tf * 0.6} fontSize={tf} textAnchor="middle" style={{ strokeWidth: 3 * upp }}>
          {fmt(m.value)}{xy ? ` (X ${fmt(Math.abs(b[0] - a[0]))}, Y ${fmt(Math.abs(b[1] - a[1]))})` : ` · ${m.note}`}</text>
      </g>
    );
  };
  const pickMark = (q: FlatPick, k: string) => q.kind === "point"
    ? <circle key={k} className="uf-snap" cx={q.p[0]} cy={y(q.p[1])} r={r * 1.4} />
    : q.kind === "line"
      ? <path key={k} className="uf-snap is-line" d={`M${q.a[0]} ${y(q.a[1])} L${q.b[0]} ${y(q.b[1])}`} />
      : <g key={k}><path className="uf-snap is-line" d={`M${q.pts.map((p) => `${p[0]} ${y(p[1])}`).join(" L")}`} />
        <path className="uf-snap" d={`M${q.c[0] - r} ${y(q.c[1])} H${q.c[0] + r} M${q.c[0]} ${y(q.c[1]) - r} V${y(q.c[1]) + r}`} /></g>;
  return (
    <div className="uf-flatwrap">
    <svg ref={svg} className={`uf-svg${measure ? " is-measure" : ""}`} viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
      onWheel={(e) => zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, svgPt(e.clientX, e.clientY))}
      onContextMenu={(e) => e.preventDefault()}
      onPointerMove={(e) => {
        const pn = pan.current;
        if (pn) {
          const dx = e.clientX - pn.x, dy = e.clientY - pn.y;
          if (!pn.moved && Math.hypot(dx, dy) < 3) return;
          pn.moved = true; pn.x = e.clientX; pn.y = e.clientY;
          setVb((prev) => { const b = prev ?? fitBox; return { ...b, x: b.x - dx * upp, y: b.y - dy * upp }; });
          return;
        }
        if (measure) setNear(pickAt(e));
      }}
      onPointerDown={(e) => {
        // a double click with the middle button: Fit
        if (middleDoubleFlat(e)) { e.preventDefault(); pan.current = null; return; }
        // move: right or middle button, or the left one when not measuring
        if (e.button !== 0 || !measure) { pan.current = { x: e.clientX, y: e.clientY, moved: false }; (e.currentTarget as Element).setPointerCapture(e.pointerId); return; }
        const q = pickAt(e);
        if (!q) return;
        setPicks((l) => (l.length >= 2 ? [q] : [...l, q]));
      }}
      onPointerUp={() => { pan.current = null; }}
      onDoubleClick={() => { if (!measure) setVb(null); }}>
      {u.outline.map((e, i) => (e.arc && e.arc.a1 - e.arc.a0 >= 2 * Math.PI - 1e-9
        ? <circle key={i} className="uf-o" cx={e.arc.c[0]} cy={y(e.arc.c[1])} r={e.arc.r} />
        : <path key={i} className="uf-o" d={`M${e.pts.map((p) => `${p[0]} ${y(p[1])}`).join(" L")}`} />))}
      {u.bendLines.map(([a, b], i) => <path key={`b${i}`} className="uf-b" d={`M${a[0]} ${y(a[1])} L${b[0]} ${y(b[1])}`} />)}
      {marks.map(([a, b], i) => <path key={`m${i}`} className="uf-m" d={`M${a[0]} ${y(a[1])} L${b[0]} ${y(b[1])}`} />)}
      {marksDown.map(([a, b], i) => <path key={`md${i}`} className="uf-m is-down" d={`M${a[0]} ${y(a[1])} L${b[0]} ${y(b[1])}`} />)}
      {threadLines.map((r, i) => <path key={`th${i}`} className="uf-eng" d={`M${r.map((p) => `${p[0]} ${y(p[1])}`).join(" L")}`} />)}
      {st.annotate && st.engraveText && bendTexts(u, st).map((r, i) => <path key={`e${i}`} className="uf-eng" d={`M${r.map((p) => `${p[0]} ${y(p[1])}`).join(" L")}`} />)}
      {st.annotate && !st.engraveText && u.bendLines.map(([a, b], i) => {
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
      {measure && near && pickMark(near, "near")}
      {measure && picks.length === 1 && pickMark(picks[0], "p0")}
      {measure && picks.length === 2 && picks.map((k, i) => (k.kind !== "point" ? pickMark(k, `p${i}`) : null))}
      {result && typeof result !== "string" && dim(result)}
      {typeof result === "string" && picks[1] && (
        <text className="uf-dim-msg" x={picks[1].kind === "point" ? picks[1].p[0] : picks[1].at[0]} y={y(picks[1].kind === "point" ? picks[1].p[1] : picks[1].at[1]) - tf} fontSize={tf}
          textAnchor="middle" style={{ strokeWidth: 3 * upp }}>{result}</text>
      )}
    </svg>
    <div className="uf-zoom" role="group" aria-label="Zoom">
      <button type="button" className="icon-btn" onClick={() => zoomAt(1.4)} title="Zoom in (or the mouse wheel)" aria-label="Zoom in">+</button>
      <button type="button" className="icon-btn" onClick={() => zoomAt(1 / 1.4)} title="Zoom out (or the mouse wheel)" aria-label="Zoom out">−</button>
      <button type="button" className="icon-btn uf-zoom-fit" onClick={() => setVb(null)} title="Fit the whole flat pattern (or double-click)" aria-label="Fit">
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" /></svg>
      </button>
    </div>
    </div>
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
              <label className="chk"><input type="checkbox" checked={!!p.marksDown} onChange={(e) => setP({ marksDown: e.target.checked })} /> Down bends marked too (dashed)</label>
              <label className="chk"><input type="checkbox" checked={p.annotate} onChange={(e) => setP({ annotate: e.target.checked })} /> Show angle and UP / DOWN</label>
              <label className="chk"><input type="checkbox" checked={!!p.engraveText} disabled={!p.annotate} onChange={(e) => setP({ engraveText: e.target.checked })} /> … engraved (single-line text),</label>
              <div className="uf-row"><span>Text height</span><NumInput className="field uf-num" value={p.textMm ?? 6} min={1.5} aria-label="Text height (mm)" onCommit={(n) => setP({ textMm: n })} /><small>mm</small></div>
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

