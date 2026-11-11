import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { JobPart } from "../api/types";
import { PartThumb, sizeLabel } from "../components/PartThumb";
import { partColor, type NestedSheet } from "../job/nest";
import type { Machine, Origin } from "../job/machine";
import { hmsOf, labelPoint, mmss, parsePages, sheetReport, type SheetReport } from "../job/report";

// Nest report (toolbar -> Report -> Nest report), after Fab's layout: A4 pages side by side, a page
// per sheet (more when its part list is long); on the right GENERATE, PRINT and which pages to print.

const FIRST_ROWS = 5, MORE_ROWS = 16;

interface Page {
  key: string;            // sheet index : page of that sheet
  sheet: number;
  first: boolean;
  rows: SheetReport["parts"];
  rowFrom: number;
  signature: string;      // what is printed: changes when the sheet does
}

export interface ReportJob { id: string; title: string; machine: Machine; origin: Origin; solutionNo?: number; editedBy?: string; editedAt?: string }

const fmtKg = (n: number) => (n >= 100 ? n.toFixed(0) : n.toFixed(1));
const stamp = (d: Date) => `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}  ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const PRINTED_KEY = (job: string) => `gnezdo.nestReportPrinted.${job}`;

function loadPrinted(job: string): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(PRINTED_KEY(job)) ?? "{}"); } catch { return {}; }
}
function savePrinted(job: string, v: Record<string, string>) {
  try { localStorage.setItem(PRINTED_KEY(job), JSON.stringify(v)); } catch { /* not kept */ }
}

export function NestReportPage({ job, sheets, jobParts }: { job: ReportJob; sheets: NestedSheet[]; jobParts: JobPart[] }) {
  // what the pages show: taken when GENERATE is pressed (and when the report opens)
  const [snap, setSnap] = useState(() => ({ sheets, jobParts, at: new Date() }));
  const live = JSON.stringify(sheets.map((s) => [s.parts, s.material, s.thicknessMm, s.lengthMm, s.widthMm, s.cutNumber]));
  const shown = JSON.stringify(snap.sheets.map((s) => [s.parts, s.material, s.thicknessMm, s.lengthMm, s.widthMm, s.cutNumber]));
  const outdated = live !== shown;
  const reports = useMemo(() => snap.sheets.map((s) => sheetReport(s, snap.jobParts, job.machine, job.origin)), [snap, job.machine, job.origin]);
  const pages = useMemo<Page[]>(() => {
    const out: Page[] = [];
    snap.sheets.forEach((sh, i) => {
      const rows = reports[i].parts;
      const sig = JSON.stringify([sh.parts, sh.material, sh.thicknessMm, sh.lengthMm, sh.widthMm, sh.cutNumber, sh.trims]);
      out.push({ key: `${i}:0`, sheet: i, first: true, rows: rows.slice(0, FIRST_ROWS), rowFrom: 0, signature: sig });
      for (let k = FIRST_ROWS, n = 1; k < rows.length; k += MORE_ROWS, n++)
        out.push({ key: `${i}:${n}`, sheet: i, first: false, rows: rows.slice(k, k + MORE_ROWS), rowFrom: k, signature: `${sig}#${k}` });
    });
    return out;
  }, [snap, reports]);

  const [mode, setMode] = useState<"all" | "changes" | "pages">("all");
  const [pageText, setPageText] = useState("");
  const [printed, setPrinted] = useState(() => loadPrinted(job.id));
  const changed = pages.map((p, i) => ({ p, no: i + 1 })).filter(({ p }) => printed[p.key] !== p.signature).map((x) => x.no);
  const chosen = mode === "all" ? pages.map((_, i) => i + 1) : mode === "changes" ? changed : parsePages(pageText, pages.length);
  const [printing, setPrinting] = useState<number[] | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!printing) return;
    const done = () => {
      setPrinting(null);
      const next = { ...printed };
      for (const no of printing) next[pages[no - 1].key] = pages[no - 1].signature;
      setPrinted(next); savePrinted(job.id, next);
    };
    window.addEventListener("afterprint", done, { once: true });
    const t = setTimeout(() => window.print(), 50);
    return () => { clearTimeout(t); window.removeEventListener("afterprint", done); };
  }, [printing]); // eslint-disable-line react-hooks/exhaustive-deps

  const print = () => {
    if (!chosen.length) { setNote(mode === "changes" ? "No page changed since it was last printed" : "No pages to print: type them like 3,4,8 or 2-5"); return; }
    setNote(null);
    setPrinting(chosen);
  };

  const pageEls = (list: number[]) => list.map((no) => {
    const p = pages[no - 1];
    return <ReportPage key={p.key} page={p} no={no} total={pages.length} job={job} sheet={snap.sheets[p.sheet]} rep={reports[p.sheet]} at={snap.at} />;
  });

  // previews scaled to the height there is
  const area = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.6);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.max(0.3, Math.min(1, (el.clientHeight - 40) / 1123))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="report">
      <div className="report-pages pane-scroll" ref={area}>
        {!snap.sheets.length && <p className="report-empty">Nothing nested yet: nest the job, then GENERATE.</p>}
        {pages.map((p, i) => (
          <div key={p.key} className={`report-thumb${chosen.includes(i + 1) ? " is-chosen" : ""}`} style={{ width: 794 * scale, height: 1123 * scale }}>
            <div style={{ transform: `scale(${scale})`, transformOrigin: "0 0" }}>{pageEls([i + 1])}</div>
          </div>
        ))}
      </div>
      <aside className="report-panel">
        <h2>Nest report</h2>
        <div className="report-actions">
          <button type="button" className="btn btn-plain" onClick={() => { setSnap({ sheets, jobParts, at: new Date() }); setNote(null); }}>Generate</button>
          <button type="button" className="btn btn-primary" disabled={!pages.length} onClick={print}>Print</button>
        </div>
        {outdated && <p className="report-warn">The nest changed since this report was made: Generate again.</p>}
        <div className="report-opts" role="radiogroup" aria-label="Pages to print">
          <label className="chk"><input type="radio" name="nrp" checked={mode === "all"} onChange={() => setMode("all")} /> Print all <small>{pages.length} pages</small></label>
          <label className="chk"><input type="radio" name="nrp" checked={mode === "changes"} onChange={() => setMode("changes")} /> Print only changes <small>{changed.length ? `pages ${changed.join(", ")}` : "none"}</small></label>
          <label className="chk"><input type="radio" name="nrp" checked={mode === "pages"} onChange={() => setMode("pages")} /> Print pages:</label>
          <input className="field report-pages-in" value={pageText} placeholder="3,4,8 or 2-5" onFocus={() => setMode("pages")} onChange={(e) => setPageText(e.target.value)} />
        </div>
        {note && <p className="report-warn">{note}</p>}
        <p className="report-help">{pages.length} pages: one per sheet, more when a sheet has many parts. Times are estimated from the machine's Technology table until the cut path is generated.</p>
      </aside>
      {printing && createPortal(<div className="print-root">{pageEls(printing)}</div>, document.body)}
    </div>
  );
}

function ReportPage({ page, no, total, job, sheet, rep, at }: {
  page: Page; no: number; total: number; job: ReportJob; sheet: NestedSheet; rep: SheetReport; at: Date;
}) {
  const st = rep.stats;
  const t = sheet.trims;
  const qty = sheet.parts.length;
  const head = (
    <header className="rp-head">
      <div className="rp-hcell"><span>Machine</span><b>{job.machine.name}</b></div>
      <div className="rp-hcell rp-job"><span>Job</span><b>{job.title}</b></div>
      <div className="rp-hcell rp-page"><span>Page</span><b>{no} / {total}</b></div>
      <div className="rp-hcell"><span>Date and hour</span><b>{stamp(at)}</b></div>
      <div className="rp-hcell"><span>Solution</span><b>{job.solutionNo ? `Solution ${job.solutionNo}` : "—"}</b></div>
      <div className="rp-hcell"><span>Last edited by</span><b>{job.editedBy || "—"}</b></div>
    </header>
  );
  return (
    <section className="rp" aria-label={`Page ${no}`}>
      {head}
      {page.first ? (<>
        <div className="rp-grid">
          <F k="Sheet No" v={`${page.sheet + 1}`} /><F k="Job file name" v={job.title} /><F k="Qty parts" v={`${qty}`} />
          <F k="Material" v={sheet.material} /><F k="Sheet size" v={`${sheet.lengthMm} × ${sheet.widthMm}`} /><F k="Cutting number" v={`${sheet.cutNumber ?? 1}`} />
          <F k="Thickness" v={`${sheet.thicknessMm} mm`} /><F k="Cut area" v={`${Math.round(st.cutX)} × ${Math.round(st.cutY)}`} />
          <F k="Trims" v={t ? `X− ${t.xMinus}  X+ ${t.xPlus}  Y− ${t.yMinus}  Y+ ${t.yPlus}` : "—"} />
          <F k="Time rapid" v={hmsOf(rep.rapidS)} est /><F k="Time cutting" v={hmsOf(rep.cutS)} est /><F k="Time total" v={hmsOf(rep.totalS)} est strong />
          <F k="Sheet (kg)" v={fmtKg(st.sheetKg)} /><F k="Parts (kg)" v={fmtKg(st.partsKg)} /><F k="Scrap (kg)" v={fmtKg(st.scrapKg)} />
          <F k="Remnant (kg)" v={fmtKg(st.remnantKg)} /><F k="Remnant (%)" v={st.remnantPct.toFixed(0)} /><F k="Unused (%)" v={st.unusedPct.toFixed(0)} />
        </div>
        <SheetDrawing sheet={sheet} rep={rep} />
      </>) : (
        <div className="rp-grid rp-grid-more">
          <F k="Sheet No" v={`${page.sheet + 1}`} /><F k="Job file name" v={job.title} /><F k="Qty parts" v={`${qty}`} />
        </div>
      )}
      <table className="rp-table">
        <thead><tr><th>ID</th><th>Part info</th><th className="num">Qty</th><th className="num">Weight<br /><small>kg</small></th><th className="num">Cut time<br /><small>m:s</small></th><th>Part</th></tr></thead>
        <tbody>
          {page.rows.map((r) => {
            const c = partColor(r.jp?.no);
            return (
              <tr key={r.partId}>
                <td className="rp-id"><i style={{ background: c.fill, borderColor: c.stroke }} />{r.jp?.no ?? ""}</td>
                <td className="rp-info">
                  <b>{r.jp ? `${r.jp.part.project ? r.jp.part.project + " / " : ""}${r.jp.part.name}` : r.partId}</b>
                  <span>{r.jp ? sizeLabel(r.jp.part) : ""}{r.jp?.part.description ? ` · ${r.jp.part.description}` : ""}</span>
                </td>
                <td className="num"><b>{r.qty}</b></td>
                <td className="num">{r.kg.toFixed(2)}</td>
                <td className="num">{mmss(r.cutS)}</td>
                <td className="rp-thumb">{r.jp && <PartThumb part={r.jp.part} size={40} />}</td>
              </tr>
            );
          })}
          {/* empty rows keep the table its height */}
          {Array.from({ length: Math.max(0, (page.first ? FIRST_ROWS : MORE_ROWS) - page.rows.length) }, (_, i) => (
            <tr key={`e${i}`} className="rp-empty"><td>&nbsp;</td><td /><td /><td /><td /><td /></tr>
          ))}
        </tbody>
      </table>
      <footer className="rp-foot">
        <span>GNEZDO · {job.title} · sheet {page.sheet + 1}</span>
        {!rep.row && <span>No Technology row for {sheet.material} {sheet.thicknessMm} mm on {job.machine.name}: no times</span>}
        {rep.row && <span>Times: estimate from the Technology table</span>}
      </footer>
    </section>
  );
}

function F({ k, v, est, strong }: { k: string; v: string; est?: boolean; strong?: boolean }) {
  return <div className={`rp-f${strong ? " is-strong" : ""}`}><span>{k}{est && v !== "—" ? <i> est.</i> : null}</span><b>{v}</b></div>;
}

/** The sheet to scale with its parts numbered (small ones by a line from the margin), and rulers. */
function SheetDrawing({ sheet, rep }: { sheet: NestedSheet; rep: SheetReport }) {
  const W = 690, H = 360;                  // drawing area in page px (the rulers outside it)
  const s = Math.min(W / sheet.lengthMm, H / sheet.widthMm);
  const w = sheet.lengthMm * s, h = sheet.widthMm * s;
  const byId = new Map(rep.parts.map((p) => [p.partId, p.jp]));
  const marks = sheet.parts.map((p) => {
    const jp = byId.get(p.partId);
    if (!jp) return null;
    // the number on the part's material (not in a hole, not over a neighbour in an L's corner)
    const lp = labelPoint(jp.part.path);
    const a = (p.angle * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
    const lx = p.mirror ? -lp.x : lp.x;
    const cx = (lx * c - lp.y * sn + p.x) * s, cy = (lx * sn + lp.y * c + p.y) * s;
    // room enough at that point, or a part big enough that the number stays on it (thin frames, rings)
    const big = lp.room * s >= 11 || (jp.part.w * s >= 34 && jp.part.h * s >= 26 && lp.room * s >= 3);
    return { jp, p, cx, cy, big };
  }).filter((m): m is NonNullable<typeof m> => !!m);
  // small parts: numbered above the sheet, a line down to the part (at most 40)
  const small = marks.filter((m) => !m.big).sort((a, b) => a.cx - b.cx).slice(0, 40);
  let lastX = -99;
  const callouts = small.map((m) => { const x = Math.max(m.cx, lastX + 21); lastX = x; return { ...m, lx: Math.min(w, x) }; });
  const step = [50, 100, 200, 250, 500, 1000].find((d) => d * s >= 36) ?? 1000;
  const ticks = (len: number) => Array.from({ length: Math.floor(len / step) + 1 }, (_, i) => i * step);
  const PAD = 32, TOP = small.length ? 27 : 4;
  return (
    <svg className="rp-sheet" width={w + PAD + 6} height={h + TOP + PAD + 2} viewBox={`${-PAD} ${-TOP} ${w + PAD + 6} ${h + TOP + PAD + 2}`}>
      {sheet.outline?.length
        ? <path className="rp-plate" fillRule="evenodd" d={sheet.outline.map((lp) => lp.map(([x, y], i) => `${i ? "L" : "M"}${x * s} ${y * s}`).join("") + "Z").join("")} />
        : <rect className="rp-plate" x={0} y={0} width={w} height={h} />}
      <g transform={`scale(${s})`}>
        {sheet.parts.map((p, i) => {
          const jp = byId.get(p.partId);
          if (!jp) return null;
          const c = partColor(jp.no);
          return <path key={i} d={jp.part.path} fillRule="evenodd" transform={`translate(${p.x} ${p.y}) rotate(${p.angle})${p.mirror ? " scale(-1 1)" : ""}`}
            style={{ fill: c.fill, stroke: c.stroke }} strokeWidth={0.8 / s} />;
        })}
      </g>
      {marks.filter((m) => m.big).map((m, i) => <text key={i} className="rp-no" x={m.cx} y={m.cy + 5.5}>{m.jp.no}</text>)}
      {callouts.map((m, i) => (
        <g key={`c${i}`}>
          <line className="rp-lead" x1={m.lx} y1={-6} x2={m.cx} y2={m.cy} />
          <text className="rp-no rp-no-out" x={m.lx} y={-11}>{m.jp.no}</text>
        </g>
      ))}
      {/* rulers: along the bottom and the left side */}
      <g className="rp-ruler">
        <line x1={0} y1={h + 5} x2={w} y2={h + 5} />
        {ticks(sheet.lengthMm).map((d) => <g key={`x${d}`}><line x1={d * s} y1={h + 2} x2={d * s} y2={h + 9} /><text x={d * s} y={h + 18}>{d}</text></g>)}
        <line x1={-5} y1={0} x2={-5} y2={h} />
        {ticks(sheet.widthMm).map((d) => <g key={`y${d}`}><line x1={-9} y1={h - d * s} x2={-2} y2={h - d * s} /><text x={-12} y={h - d * s + 3} style={{ textAnchor: "end" }}>{d}</text></g>)}
      </g>
    </svg>
  );
}
