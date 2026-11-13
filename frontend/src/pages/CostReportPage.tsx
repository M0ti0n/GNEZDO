import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { JobPart } from "../api/types";
import { PartThumb, sizeLabel } from "../components/PartThumb";
import { NumInput } from "../components/NumInput";
import { partCutSeconds, partKg } from "../job/report";
import { techRowFor } from "../job/technology";
import type { ReportJob } from "./NestReportPage";

// Cost report (toolbar -> Report -> Cost report), after Fab's layout: on the right who it is for, the
// project and its parts, prices per material (per kg, per minute of cutting) and a fixed cost; the
// pages list each part with its price per piece and the sum.

const ROWS_FIRST = 12, ROWS_MORE = 14;
const PRICES_KEY = "gnezdo.costPrices";

interface Prices { currency: string; materials: Record<string, { kg: number; min: number }>; fixed: number }

function loadPrices(): Prices {
  try { return { currency: "€", materials: {}, fixed: 0, ...JSON.parse(localStorage.getItem(PRICES_KEY) ?? "{}") }; }
  catch { return { currency: "€", materials: {}, fixed: 0 }; }
}

const money = (n: number, cur: string) => `${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
const day = (d: Date) => `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`;

export function CostReportPage({ job, jobParts, userName }: { job: ReportJob; jobParts: JobPart[]; userName: string }) {
  const [who, setWho] = useState(() => { try { return localStorage.getItem(`gnezdo.costFor.${job.id}`) ?? ""; } catch { return ""; } });
  useEffect(() => { try { localStorage.setItem(`gnezdo.costFor.${job.id}`, who); } catch { /* not kept */ } }, [who, job.id]);
  const projects = useMemo(() => [...new Set(jobParts.map((jp) => jp.part.project).filter(Boolean))].sort(), [jobParts]);
  const [project, setProject] = useState<string>("");          // "" = all projects
  const inProject = jobParts.filter((jp) => !project || jp.part.project === project);
  const [off, setOff] = useState<Set<string>>(new Set());     // parts left out
  const picked = inProject.filter((jp) => !off.has(jp.part.id));
  const allOn = inProject.length > 0 && picked.length === inProject.length;
  const [prices, setPricesState] = useState<Prices>(loadPrices);
  const setPrices = (p: Prices) => { setPricesState(p); try { localStorage.setItem(PRICES_KEY, JSON.stringify(p)); } catch { /* not kept */ } };
  const mats = [...new Set(picked.map((jp) => jp.part.material))].sort();
  const priceOf = (m: string) => prices.materials[m] ?? { kg: 0, min: 0 };
  const setMat = (m: string, patch: Partial<{ kg: number; min: number }>) => setPrices({ ...prices, materials: { ...prices.materials, [m]: { ...priceOf(m), ...patch } } });

  // what the pages show: taken with GENERATE (and when the report opens)
  const build = () => ({
    at: new Date(), who, project, currency: prices.currency, fixed: prices.fixed,
    rows: picked.map((jp) => {
      const row = techRowFor(job.machine.technologies, jp.part.material, jp.part.thicknessMm)?.row ?? null;
      const kg = partKg(jp.part);
      const cutS = partCutSeconds(jp.part.path, row);
      const pm = priceOf(jp.part.material);
      const each = kg * pm.kg + ((cutS ?? 0) / 60) * pm.min;
      return { jp, kg, cutS, each };
    }),
  });
  const [snap, setSnap] = useState(build);
  const pages = useMemo(() => {
    const out: (typeof snap.rows)[] = [];
    out.push(snap.rows.slice(0, ROWS_FIRST));
    for (let k = ROWS_FIRST; k < snap.rows.length; k += ROWS_MORE) out.push(snap.rows.slice(k, k + ROWS_MORE));
    return out;
  }, [snap]);
  const sum = snap.rows.reduce((a, r) => a + r.each * r.jp.qty, 0) + snap.fixed;
  const noTime = snap.rows.filter((r) => r.cutS === null).length;

  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    if (!printing) return;
    const done = () => setPrinting(false);
    window.addEventListener("afterprint", done, { once: true });
    const t = setTimeout(() => window.print(), 50);
    return () => { clearTimeout(t); window.removeEventListener("afterprint", done); };
  }, [printing]);

  const area = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.6);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.max(0.3, Math.min(1, (el.clientHeight - 40) / 1123))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pageEls = () => pages.map((rows, i) => (
    <section key={i} className="rp cp" aria-label={`Page ${i + 1}`}>
      {i === 0 ? (
        <header className="cp-head">
          <div className="cp-for"><b>{snap.who || "—"}</b><span>{snap.project ? `Project: ${snap.project}` : "All projects"} · {job.title}</span></div>
          <div className="cp-by"><span>Created by</span><b>{userName}</b><span>Date</span><b>{day(snap.at)}</b></div>
        </header>
      ) : (
        <header className="cp-head cp-head-more"><span>{snap.who || "—"} · {snap.project || "All projects"}</span><span>Page {i + 1} / {pages.length}</span></header>
      )}
      <div className="cp-rows">
        {rows.map((r) => (
          <div key={r.jp.part.id} className="cp-row">
            <div className="cp-thumb"><PartThumb part={r.jp.part} size={52} marks /></div>
            <div className="cp-main">
              <div className="cp-line1"><b>{r.jp.part.name}</b><span className="cp-qty">{r.jp.qty} pcs</span><span className="cp-each">{money(r.each, snap.currency)} / pcs</span></div>
              <div className="cp-line2">
                <span className="cp-mat">{r.jp.part.material} {r.jp.part.thicknessMm} × {sizeLabel(r.jp.part)}</span>
                <span>{r.kg.toFixed(2)} kg/pcs</span>
                <span>{r.cutS === null ? "no cutting time" : `${(r.cutS / 60).toFixed(2)} min/pcs`}</span>
                <span className="cp-line">{money(r.each * r.jp.qty, snap.currency)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      {i === pages.length - 1 && (
        <div className="cp-sum">
          {snap.fixed > 0 && <div><span>Fixed cost</span><b>{money(snap.fixed, snap.currency)}</b></div>}
          <div className="cp-total"><span>Σ Sum</span><b>{money(sum, snap.currency)}</b></div>
        </div>
      )}
      <footer className="rp-foot"><span>GNEZDO · cost report · {job.title}</span><span>Page {i + 1} / {pages.length}</span></footer>
    </section>
  ));

  return (
    <div className="report">
      <div className="report-pages pane-scroll" ref={area}>
        {pages.map((_, i) => (
          <div key={i} className="report-thumb" style={{ width: 794 * scale, height: 1123 * scale }}>
            <div style={{ transform: `scale(${scale})`, transformOrigin: "0 0" }}>{pageEls()[i]}</div>
          </div>
        ))}
      </div>
      <aside className="report-panel">
        <h2>Cost report</h2>
        <div className="report-actions">
          <button type="button" className="btn btn-plain" onClick={() => setSnap(build())}>Generate</button>
          <button type="button" className="btn btn-primary" disabled={!snap.rows.length} onClick={() => setPrinting(true)}>Print</button>
        </div>
        <input className="field" value={who} placeholder="Person / company / alias" aria-label="Person, company or alias" onChange={(e) => setWho(e.target.value)} />
        <select className="field" value={project} aria-label="Project" onChange={(e) => { setProject(e.target.value); setOff(new Set()); }}>
          <option value="">All projects</option>
          {projects.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <label className="chk"><input type="checkbox" checked={allOn} onChange={() => setOff(allOn ? new Set(inProject.map((jp) => jp.part.id)) : new Set())} /> Select all <small>{picked.length} of {inProject.length}</small></label>
        <div className="cp-list pane-scroll">
          {inProject.map((jp) => (
            <label key={jp.part.id} className="chk" title={jp.part.description}>
              <input type="checkbox" checked={!off.has(jp.part.id)} onChange={() => { const n = new Set(off); if (n.has(jp.part.id)) n.delete(jp.part.id); else n.add(jp.part.id); setOff(n); }} />
              <span className="cp-li">{jp.part.name}</span><small>{jp.qty} pcs</small>
            </label>
          ))}
          {!inProject.length && <p className="report-help">No parts in this job{project ? ` for ${project}` : ""}.</p>}
        </div>
        <div className="cp-prices">
          <div className="cp-ph"><span>Material</span><label>Currency <input className="field cp-cur" value={prices.currency} onChange={(e) => setPrices({ ...prices, currency: e.target.value })} /></label></div>
          {mats.map((m) => (
            <div key={m} className="cp-mprice">
              <b>{m}</b>
              <label><NumInput value={priceOf(m).kg} min={0} aria-label={`${m} price per kg`} onCommit={(n) => setMat(m, { kg: n })} /><span>{prices.currency} / kg</span></label>
              <label><span className="cp-cl">Cut cost</span><NumInput value={priceOf(m).min} min={0} aria-label={`${m} cut cost per minute`} onCommit={(n) => setMat(m, { min: n })} /><span>{prices.currency} / min</span></label>
            </div>
          ))}
          <label className="cp-fixed"><span>Fixed cost</span><NumInput value={prices.fixed} min={0} aria-label="Fixed cost" onCommit={(n) => setPrices({ ...prices, fixed: n })} /><span>{prices.currency}</span></label>
        </div>
        {noTime > 0 && <p className="report-warn">{noTime} {noTime === 1 ? "part has" : "parts have"} no Technology row on {job.machine.name}: no cutting cost.</p>}
        <p className="report-help">Price per piece = weight × price per kg + cutting minutes × cut cost (estimated from the Technology table). Prices are kept in this browser. Generate after changes.</p>
      </aside>
      {printing && createPortal(<div className="print-root">{pageEls()}</div>, document.body)}
    </div>
  );
}
