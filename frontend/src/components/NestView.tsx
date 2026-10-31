import { useEffect, useMemo, useState } from "react";
import type { JobPart } from "../api/types";
import { NEST_MODE_LABEL, clockOf, isFinished, type JobNest, type NestedSheet } from "../job/nest";

const STAGE: Record<string, string> = {
  waiting: "waiting", prepare: "preparing", nest: "nesting", improve: "improving", done: "done", error: "failed",
};

/** Above the job: the nest going on (with Stop and keep best) or how the last one ended. */
export function NestBar({ nest, parts, view, onView, onStop, onClose }: {
  nest: JobNest; parts: JobPart[]; view: "parts" | "sheets"; onView: (v: "parts" | "sheets") => void;
  onStop: () => void; onClose: () => void;
}) {
  const run = nest.run;
  const finished = isFinished(run) || !!nest.error;
  // the clock runs here between the server's answers
  const [, tick] = useState(0);
  useEffect(() => {
    if (finished) return;
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [finished]);
  const seconds = finished ? run?.seconds ?? 0 : (Date.now() - nest.startedAt) / 1000;
  const name = (id: string) => parts.find((jp) => jp.part.id === id)?.part.name ?? id;
  const result = run?.result;
  const until = nest.mode === "custom" && nest.custom
    ? nest.custom.minutes === null ? "until you stop it" : `for ${nest.custom.minutes} min` : "";

  if (!finished) {
    return (
      <div className="nest-bar is-running" role="status">
        <span className="nest-spin" aria-hidden="true" />
        <b>{NEST_MODE_LABEL[nest.mode]}</b>
        <span className="nest-time">{run?.state === "queued" ? "waiting for a free slot" : clockOf(seconds)}{until && ` · ${until}`}</span>
        <span className="nest-groups">
          {(run?.groups ?? []).map((g, i) => (
            <span key={i} className="nest-group">
              {g.material} {g.thicknessMm} mm: {STAGE[g.stage] ?? g.stage}
              {g.sheets ? ` · best ${g.sheets} ${g.sheets === 1 ? "sheet" : "sheets"}` : ""}
            </span>
          ))}
          {!run && <span className="nest-group">starting…</span>}
        </span>
        <button type="button" className="btn btn-save nest-stop" onClick={onStop} disabled={!run || run.stopAsked}
          title="End the nest now and keep the best layout found so far">
          {run?.stopAsked ? "Stopping…" : "Stop and keep best"}
        </button>
      </div>
    );
  }

  const error = nest.error ?? run?.error ?? (run?.state === "stopped" && !result ? "Stopped before a layout was found." : null);
  const sheets = result?.sheets.length ?? 0;
  const skipped = result?.skipped ?? [];
  return (
    <div className={`nest-bar ${error ? "is-error" : "is-done"}`} role="status">
      <b>{NEST_MODE_LABEL[nest.mode]}</b>
      {error ? <span className="nest-msg">{error}</span> : (
        <span className="nest-msg">
          {run?.state === "stopped" ? "stopped" : "done"} in {clockOf(seconds)} · <b>{sheets} {sheets === 1 ? "sheet" : "sheets"}</b>
          {result && !result.valid && <span className="nest-warn"> · layout check failed: {result.errors[0]}</span>}
          {skipped.length > 0 && (
            <span className="nest-warn" title={skipped.map((s) => `${name(s.partId)}: ${s.reason}`).join("\n")}>
              {" "}· {skipped.length} {skipped.length === 1 ? "part" : "parts"} not nested ({skipped[0].reason}{skipped.length > 1 ? ", …" : ""})
            </span>
          )}
        </span>
      )}
      {sheets > 0 && (
        <span className="nest-views" role="tablist" aria-label="Show">
          <button type="button" role="tab" aria-selected={view === "parts"} className={view === "parts" ? "is-on" : ""} onClick={() => onView("parts")}>Parts list</button>
          <button type="button" role="tab" aria-selected={view === "sheets"} className={view === "sheets" ? "is-on" : ""} onClick={() => onView("sheets")}>Sheets ({sheets})</button>
        </span>
      )}
      <button type="button" className="nest-x" onClick={onClose} title="Hide this message" aria-label="Hide">×</button>
    </div>
  );
}

const transformOf = (p: { x: number; y: number; angle: number; mirror: boolean }) =>
  `translate(${p.x} ${p.y}) rotate(${p.angle})${p.mirror ? " scale(-1 1)" : ""}`;

function SheetSvg({ sheet, parts, big }: { sheet: NestedSheet; parts: Map<string, JobPart>; big?: boolean }) {
  return (
    <svg className="sheet-svg" viewBox={`-2 -2 ${sheet.lengthMm + 4} ${sheet.widthMm + 4}`} preserveAspectRatio="xMidYMid meet" aria-hidden={!big}>
      <rect className="sheet-plate" x={0} y={0} width={sheet.lengthMm} height={sheet.widthMm} />
      {sheet.parts.map((p, i) => {
        const jp = parts.get(p.partId);
        if (!jp) return null;
        return (
          <path key={i} className="sheet-part" d={jp.part.path} transform={transformOf(p)} fillRule="evenodd">
            {big && <title>{jp.part.name}</title>}
          </path>
        );
      })}
    </svg>
  );
}

/** The nested sheets: a list on the left, the chosen sheet large. */
export function SheetsView({ sheets, parts }: { sheets: NestedSheet[]; parts: JobPart[] }) {
  const byId = useMemo(() => new Map(parts.map((jp) => [jp.part.id, jp])), [parts]);
  const [sel, setSel] = useState(0);
  const cur = sheets[Math.min(sel, sheets.length - 1)];
  const use = (s: NestedSheet) => s.parts.reduce((a, p) => a + (byId.get(p.partId)?.part.areaMm2 ?? 0), 0) / (s.lengthMm * s.widthMm);
  if (!cur) return null;
  return (
    <div className="sheets-view">
      <ol className="sheet-list" aria-label="Sheets">
        {sheets.map((s, i) => (
          <li key={i}>
            <button type="button" className={`sheet-card${i === sel ? " is-on" : ""}`} onClick={() => setSel(i)}>
              <SheetSvg sheet={s} parts={byId} />
              <span className="sheet-card-text">
                <b>Sheet {i + 1}</b>
                <span>{s.material} {s.thicknessMm} mm · {s.lengthMm} × {s.widthMm}</span>
                <span>{s.parts.length} pcs · {Math.round(use(s) * 100)} % used</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      <section className="sheet-big" aria-label={`Sheet ${sel + 1}`}>
        <header>
          <b>Sheet {sel + 1} of {sheets.length}</b>
          <span>{cur.material} {cur.thicknessMm} mm · {cur.lengthMm} × {cur.widthMm} mm · {cur.parts.length} pcs · {Math.round(use(cur) * 100)} % used</span>
        </header>
        <div className="sheet-big-frame"><SheetSvg sheet={cur} parts={byId} big /></div>
      </section>
    </div>
  );
}
