import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { JobPart } from "../api/types";
import { PartThumb, sizeLabel } from "../components/PartThumb";
import { NumInput } from "../components/NumInput";
import { partCutSeconds, partKg } from "../job/report";
import { techRowFor } from "../job/technology";
import { rowAsCut } from "../job/machine";
import { GROSS_MAX_PCT, priceFor, withPrice, type CostPrices } from "../job/costPrices";
import type { ReportJob } from "./NestReportPage";
import { useWheelSideways } from "../components/wheelScroll";

// Cost report (toolbar -> Report -> Cost report), after Fab's layout: on the right who it is for, the
// project and its parts, prices per material (per kg, per minute of cutting) and a fixed cost; the
// pages list each part with its price per piece and the sum.

const ROWS_FIRST = 12, ROWS_MORE = 14;

const money = (n: number, cur: string) => `${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
const day = (d: Date) => `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`;

export function CostReportPage({ job, jobParts, userName, prices: shared, onPrices }: {
  job: ReportJob; jobParts: JobPart[]; userName: string;
  /** the shared prices (Settings → Data: in the settings file too) */
  prices: CostPrices;
  /** changes the shared prices (an admin); missing: changes are for this report only */
  onPrices?: (p: CostPrices) => void;
}) {
  const [who, setWho] = useState(() => { try { return localStorage.getItem(`gnezdo.costFor.${job.id}`) ?? ""; } catch { return ""; } });
  useEffect(() => { try { localStorage.setItem(`gnezdo.costFor.${job.id}`, who); } catch { /* not kept */ } }, [who, job.id]);
  const projects = useMemo(() => [...new Set(jobParts.map((jp) => jp.part.project).filter(Boolean))].sort(), [jobParts]);
  const [project, setProject] = useState<string>("");          // "" = all projects
  const inProject = jobParts.filter((jp) => !project || jp.part.project === project);
  const [off, setOff] = useState<Set<string>>(new Set());     // parts left out
  const picked = inProject.filter((jp) => !off.has(jp.part.id));
  const allOn = inProject.length > 0 && picked.length === inProject.length;
  // not an admin: the shared prices, changed for this report only
  const [own, setOwn] = useState<CostPrices | null>(null);
  const prices = own ?? shared;
  const setPrices = (p: CostPrices) => { if (onPrices) onPrices(p); else setOwn(p); };
  // one row per material whatever its spelling ("S355", "s355")
  const mats = [...new Map(picked.map((jp) => [jp.part.material.trim().toLowerCase(), jp.part.material.trim()])).values()].sort();
  const priceOf = (m: string) => priceFor(prices, m) ?? { kg: 0, min: 0 };
  const setMat = (m: string, patch: Partial<{ kg: number; min: number }>) => setPrices(withPrice(prices, m, patch));
  const unpriced = mats.filter((m) => !(priceFor(prices, m)?.kg));

  // what the pages show: taken with GENERATE (and when the report opens)
  const build = () => ({
    at: new Date(), who, project, currency: prices.currency, fixed: prices.fixed, grossPct: prices.grossPct,
    rows: picked.map((jp) => {
      const r0 = techRowFor(job.machine.technologies, jp.part.material, jp.part.thicknessMm)?.row;
      const row = r0 ? rowAsCut(job.machine, r0) : null;
      const net = partKg(jp.part);
      // the material priced on the gross weight: the net weight plus the share set (0: net only)
      const kg = net * (1 + prices.grossPct / 100);
      const cutS = partCutSeconds(jp.part.path, row, false, job.machine.technology === "laser");
      const pm = priceOf(jp.part.material);
      const each = kg * pm.kg + ((cutS ?? 0) / 60) * pm.min;
      return { jp, net, kg, cutS, each };
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
  // the pages in a row: the mouse wheel scrolls them sideways
  useWheelSideways(area);
  const [scale, setScale] = useState(0.6);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    // the height there is less the padding and the outline
    const ro = new ResizeObserver(() => setScale(Math.max(0.3, Math.min(1, (el.clientHeight - 18) / 1123))));
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
                <span title={snap.grossPct > 0 ? `Net ${r.net.toFixed(2)} kg + ${snap.grossPct} %` : undefined}>
                  {r.kg.toFixed(2)} kg/pcs{snap.grossPct > 0 ? " gross" : ""}</span>
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
          <label className="cp-fixed" title="The material is priced on the parts' net weight plus this share of it (offcuts, skeleton). 0: the net weight only">
            <span>Gross weight</span><NumInput value={prices.grossPct} min={0} aria-label="Gross weight, % added to the net weight"
              onCommit={(n) => setPrices({ ...prices, grossPct: Math.min(GROSS_MAX_PCT, Math.max(0, n)) })} /><span>% of net</span></label>
          <label className="cp-fixed"><span>Fixed cost</span><NumInput value={prices.fixed} min={0} aria-label="Fixed cost" onCommit={(n) => setPrices({ ...prices, fixed: n })} /><span>{prices.currency}</span></label>
        </div>
        {unpriced.length > 0 && <p className="report-warn">No price per kg for {unpriced.join(", ")}: {unpriced.length === 1 ? "its" : "their"} material is counted as 0.</p>}
        {noTime > 0 && <p className="report-warn">{noTime} {noTime === 1 ? "part has" : "parts have"} no Technology row on {job.machine.name}: no cutting cost.</p>}
        <p className="report-help">Price per piece = weight × price per kg + cutting minutes × cut cost (estimated from the Technology table). The weight is the net weight{prices.grossPct > 0 ? ` + ${prices.grossPct} % (gross weight)` : " (Gross weight 0 %)"}. {onPrices ? "The prices are shared: everyone's cost reports use them." : own ? "Your changes are for this report only (only an admin changes the shared prices)." : "The shared prices; changes here are for this report only (only an admin changes the shared ones)."} Generate after changes.</p>
      </aside>
      {printing && createPortal(<div className="print-root">{pageEls()}</div>, document.body)}
    </div>
  );
}
