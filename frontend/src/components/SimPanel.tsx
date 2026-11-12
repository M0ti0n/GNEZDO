import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { liveContours, originPoint } from "../job/cutPath";
import type { Machine, Origin } from "../job/machine";
import type { NestedSheet } from "../job/nest";
import { RAPID_MM_MIN } from "../job/report";
import { clock, simAt, simTimeline } from "../job/simulation";
import { techRowFor } from "../job/technology";
import type { CutMode } from "./ManualNest";
import toolSimulation from "../shell/jobtools/tool-simulation.png";

// Process -> Simulation (after Fab's layout): the open sheet's cut path played back. The parts keep
// their colors until they are cut out, then turn see-through; the path and the rapids show as far as
// the head (a red crosshair) has come. PLAY / PAUSE, STOP (back to the start), the playback bar (drag to
// jump), a contour back / on, and the speed (1× to 100×).

type PartRef = { path: string; name?: string };

const SPEEDS = [1, 2, 5, 10, 20, 50, 100];
const KIND: Record<string, string> = { outer: "Outline", inner: "Hole", open: "Open cut", trace: "Marking" };

export function useSimulation({ index, single, sheets, parts, machine, origin }: {
  index: number;
  /** one sheet open (the simulation runs there) */
  single: boolean;
  sheets: NestedSheet[];
  parts: Map<string, PartRef>;
  machine: Machine;
  origin: Origin;
}): { panel: ReactNode; cut: CutMode } {
  const sheet = sheets[index] as NestedSheet | undefined;
  const from = useMemo(() => (sheet ? originPoint(sheet, origin) : ([0, 0] as [number, number])), [sheet, origin]);
  const tl = useMemo(() => {
    if (!sheet) return null;
    const row = techRowFor(machine.technologies, sheet.material, sheet.thicknessMm)?.row ?? null;
    return simTimeline(liveContours(sheet), from, row);
  }, [sheet, machine, from]);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedIx, setSpeedIx] = useState(3);
  const speed = SPEEDS[speedIx];
  const total = tl?.total ?? 0;
  const can = single && !!tl && tl.legs.length > 0;

  // a new sheet or a new cut path: from the start
  useEffect(() => { setT(0); setPlaying(false); }, [index, tl]);
  useEffect(() => { if (!single) setPlaying(false); }, [single]);

  // playing: the time runs at the speed (about 30 frames a second)
  const speedRef = useRef(speed);
  speedRef.current = speed;
  useEffect(() => {
    if (!playing) return;
    let last = performance.now(), raf = 0, acc = 0;
    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      acc += dt;
      if (acc >= 1 / 30) {
        const add = acc * speedRef.current;
        acc = 0;
        setT((x) => Math.min(total, x + add));
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, total]);

  // at the end: stopped there
  useEffect(() => { if (playing && t >= total) setPlaying(false); }, [playing, t, total]);

  const state = tl ? simAt(tl, t, from) : null;
  const n = tl?.contours.length ?? 0;
  const c = state && state.k < n ? tl!.contours[state.k] : undefined;
  const partName = (i: number | undefined) => (i === undefined ? "" : parts.get(sheet?.parts[i]?.partId ?? "")?.name ?? `Part ${i + 1}`);
  const cutOut = state?.done.size ?? 0, toCut = tl?.partDone.size ?? 0;
  const at = state?.phase === "done" ? n : state?.phase === "start" ? 0 : (state?.k ?? 0) + 1;

  const play = () => {
    if (!can) return;
    if (playing) { setPlaying(false); return; }
    if (t >= total) setT(0);
    setPlaying(true);
  };
  const stop = () => { setPlaying(false); setT(0); };
  const stepTo = (dir: 1 | -1) => {
    if (!tl) return;
    setPlaying(false);
    if (dir > 0) { const e = tl.end.find((x) => x > t + 1e-6); setT(e ?? total); }
    else { const e = [...tl.end].reverse().find((x) => x < t - 1e-6); setT(e ?? 0); }
  };

  const panel = (
    <aside className="mn-parts ac sim" aria-label="Simulation">
      <header className="sol-head ac-head"><span className="itool-box ac-icon-sm" aria-hidden="true"><img src={toolSimulation} alt="" draggable={false} /></span><h2>Simulation</h2></header>
      <div className="ac-body">
        <div className="sim-ctl">
          <button type="button" className={`btn btn-plain sim-play${playing ? " is-on" : ""}`} disabled={!can} onClick={play}
            title={playing ? "Pause" : t >= total && t > 0 ? "Play again from the start" : "Play"}>
            {playing
              ? <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4v16H6zM14 4h4v16h-4z" fill="currentColor" /></svg>
              : <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5v17l14-8.5z" fill="currentColor" /></svg>}
            {playing ? "Pause" : "Play"}
          </button>
          <button type="button" className="btn btn-plain sim-stop" disabled={!can || (t === 0 && !playing)} onClick={stop} title="Stop: back to the start, every part uncut">
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" fill="currentColor" /></svg>Stop
          </button>
        </div>
        <div className="ac-field"><span>Playback</span></div>
        <div className="sim-box is-main">
          <input type="range" className="sim-range" min={0} max={1000} step={1} disabled={!can} aria-label="Playback"
            value={total ? Math.round((t / total) * 1000) : 0}
            onChange={(e) => setT((Number(e.target.value) / 1000) * total)} />
          <div className="sim-row"><span><b>{clock(t)}</b> / {clock(total)}</span><span>contour <b>{at}</b> / {n}</span></div>
          <div className="sim-steps">
            <button type="button" className="btn btn-plain" disabled={!can || t <= 0} onClick={() => stepTo(-1)} title="Back one contour">◀ Contour</button>
            <button type="button" className="btn btn-plain" disabled={!can || t >= total} onClick={() => stepTo(1)} title="On one contour (to its end)">Contour ▶</button>
          </div>
        </div>
        <div className="ac-field"><span>Speed</span></div>
        <div className="sim-box">
          <input type="range" className="sim-range" min={0} max={SPEEDS.length - 1} step={1} value={speedIx} aria-label="Simulation speed"
            onChange={(e) => setSpeedIx(Number(e.target.value))} />
          <div className="sim-row sim-ticks">{SPEEDS.map((s, i) => <span key={s} className={i === speedIx ? "is-on" : ""}>{s}×</span>)}</div>
        </div>
        <div className="ac-field"><span>Now</span></div>
        <dl className="sim-now">
          <dt>Part</dt><dd title={c ? (c.parts ? c.parts.map(partName).join(", ") : partName(c.part)) : ""}>{c ? (c.parts ? `Common cut block (${c.parts.length})` : partName(c.part)) : "–"}</dd>
          <dt>Contour</dt><dd>{c ? `${KIND[c.kind] ?? c.kind}${state?.phase === "rapid" ? " · rapid to it" : state?.phase === "pierce" ? " · piercing" : ""}` : state?.phase === "done" ? "All cut" : "–"}</dd>
          <dt>Parts cut</dt><dd>{cutOut} / {toCut}</dd>
          <dt>Contours</dt><dd>{at} / {n}</dd>
        </dl>
        <div className="sim-legend">
          <span><i className="sim-key is-uncut" /> not cut yet</span>
          <span><i className="sim-key is-cut" /> cut</span>
          <span><i className="sim-key is-rapid" /> rapid</span>
          <span className="sim-key-head">⊕ head</span>
        </div>
        {!single ? <p className="ac-empty sim-msg">Open a sheet (VIEW / EDIT) to play its cut.</p>
          : !can ? <p className="tech-msg ac-msg is-bad">Process the sheet first (Auto cut).</p> : null}
        <p className="rule-help ac-help">Times {tl?.fromTech ? "from the Technology row's speeds and pierce time" : "with 2000 mm/min (no speed in the Technology row)"} and {Math.round(RAPID_MM_MIN / 1000)} m/min rapids: an estimate (no acceleration). Drag the playback bar to jump.</p>
      </div>
    </aside>
  );

  return {
    panel,
    cut: {
      picking: false, picked: [], onPick: () => { /* parts are not picked here */ }, panel,
      ...(can && state ? { sim: { shown: state.shown, current: state.current, rapids: state.rapids, done: state.done, head: state.head } } : {}),
      hint: !can ? (single ? "Process the sheet first (Auto cut), then play its cut here." : "Open a sheet to play its cut.")
        : `SIMULATION · contour ${at} / ${n} · parts cut ${cutOut} / ${toCut} · ${clock(t)} / ${clock(total)}`,
    },
  };
}
