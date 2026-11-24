import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, type IncomingOffer, type OpenJob } from "../api/api";
import type { PartSummary } from "../api/types";
import { PartThumb } from "./PartThumb";

// Server build: parts sent to a job someone else has open. The sender picks the job (Send to job…), the
// one with the job open accepts the parts into its work parts or refuses them; the sender is told which.

const SendIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 11.5 21 3l-6.5 18-3-7.5L3 11.5z" /><path d="m11.5 13.5 4-4" />
  </svg>
);

const mm = (n: number) => `${Number(n.toFixed(2))} mm`;
/** A material and thickness as a bubble (like Used in jobs in Projects and parts); green: the same as the parts sent. */
const MatChip = ({ material, thicknessMm, fit = false }: { material: string; thicknessMm: number; fit?: boolean }) => (
  <span className={`sp-mat${fit ? " is-fit" : ""}`} title={fit ? "The same material and thickness as parts you are sending" : undefined}>{material} · {mm(thicknessMm)}</span>
);
/** Each user's own color, the same on every computer (from the name). */
const USER_COLORS = ["#2f7fc1", "#c0392b", "#8e44ad", "#d35400", "#138d75", "#34495e", "#b7950b", "#c2185b", "#6d4c41", "#3f8f2a", "#5c6bc0", "#00838f"];
export const userColor = (name: string) => {
  let h = 0;
  for (const c of name.trim().toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return USER_COLORS[h % USER_COLORS.length];
};
export const UserTag = ({ name }: { name: string }) => (
  <span className="sp-user" style={{ background: userColor(name) }}><UserIcon />{name}</span>
);
const UserIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
  </svg>
);
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** Send to job…: the jobs open on other computers (those with the parts' material and thickness first), how many of each, a note. */
export function SendPartsDialog({ parts, qtyOf, onClose, onSent }: {
  parts: PartSummary[];
  /** the quantity a part starts with */
  qtyOf: (p: PartSummary) => number;
  onClose: () => void;
  onSent: (text: string) => void;
}) {
  const [jobs, setJobs] = useState<OpenJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(parts.map((p) => [p.id, qtyOf(p)])));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.openJobs().then(setJobs).catch((e) => { setJobs([]); setError((e as Error).message); });
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);
  const kinds = new Set(parts.map((p) => `${p.material.toLowerCase()}|${p.thicknessMm}`));
  const same = (m: { material: string; thicknessMm: number }) => kinds.has(`${m.material.toLowerCase()}|${m.thicknessMm}`);
  const mats = new Set(parts.map((p) => p.material.toLowerCase()));
  // the most relevant first: more of the parts' materials and thicknesses in it, then the same materials
  // (other thicknesses), then jobs with nothing saved yet, then the rest; by name within each
  const score = (j: OpenJob) => {
    if (!j.materials.length) return 1;
    const exact = new Set(j.materials.filter(same).map((m) => `${m.material.toLowerCase()}|${m.thicknessMm}`)).size;
    const near = new Set(j.materials.filter((m) => mats.has(m.material.toLowerCase())).map((m) => m.material.toLowerCase())).size;
    return exact * 100 + near * 10;
  };
  const sorted = jobs ? [...jobs].sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name)) : null;
  // four jobs show, the rest scroll
  const list = useRef<HTMLUListElement>(null);
  const [listMax, setListMax] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const el = list.current;
    if (!el || el.children.length <= 4) { setListMax(undefined); return; }
    const fourth = el.children[3] as HTMLElement;
    setListMax(fourth.offsetTop + fourth.offsetHeight + 2);   // (the list is the offset parent)
  }, [sorted?.length]);
  const send = async () => {
    const job = jobs?.find((j) => j.id === pick);
    if (!job) return;
    setBusy(true); setError(null);
    try {
      await api.sendParts(job.id, parts.map((p) => ({ partId: p.id, qty: Math.max(0, Math.round(qty[p.id] ?? 0)) })), note);
      onSent(`Sent ${parts.length} ${parts.length === 1 ? "part" : "parts"} to ${job.user} for ${job.name}: you are told when they answer`);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  };
  return (
    <div className="dlg-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="dlg sp-dlg is-two" role="dialog" aria-modal="true" aria-labelledby="sp-title">
        <header className="dlg-head">
          <span className="dlg-icon" aria-hidden="true"><SendIcon /></span>
          <div className="dlg-title"><h2 id="sp-title">Send to a job</h2><p>To someone who has the job open: they accept the parts into it, or refuse them.</p></div>
        </header>
        <div className="sp-body sp-cols">
          <section className="sp-col">
          <h3>Job to send to</h3>
          {sorted === null && <p className="sp-empty">Looking for open jobs…</p>}
          {sorted?.length === 0 && !error && <p className="sp-empty">Nobody has a saved job open on another computer right now.</p>}
          {!!sorted?.length && (
            <ul ref={list} className="sp-jobs" role="listbox" aria-label="Open jobs" style={listMax ? { maxHeight: listMax } : undefined}>
              {sorted.map((j) => (
                <li key={j.id} role="option" aria-selected={pick === j.id} className={`sp-job${pick === j.id ? " is-on" : ""}`} onClick={() => setPick(j.id)}>
                  <span className="sp-job-name">{j.name}</span>
                  <span className="sp-job-who" title={`Open since ${timeOf(j.since)}`}><UserTag name={j.user} /></span>
                  <span className="sp-job-mats">
                    {j.materials.length
                      ? j.materials.map((m) => <MatChip key={`${m.material}|${m.thicknessMm}`} {...m} fit={same(m)} />)
                      : <span className="sp-none">no saved parts yet</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          </section>
          <section className="sp-col">
          <h3>Parts to send ({parts.length})</h3>
          <table className="sp-parts">
            <thead><tr><th /><th>Part</th><th>Material</th><th>Qty</th></tr></thead>
            <tbody>
              {parts.map((p) => (
                <tr key={p.id}>
                  <td className="sp-part-thumb"><PartThumb part={p} size={34} marks={p.engraved} /></td>
                  <td><span className="sp-pname">{p.name}</span><span className="sp-proj">{p.project}</span></td>
                  <td><MatChip material={p.material} thicknessMm={p.thicknessMm} /></td>
                  <td><input className="sp-qty" type="number" min={0} step={1} value={qty[p.id] ?? 0} aria-label={`Quantity of ${p.name}`}
                    onChange={(e) => setQty((q) => ({ ...q, [p.id]: Math.max(0, Math.round(Number(e.target.value) || 0)) }))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <label className="sp-send-note"><span>Note (optional)</span>
            <input value={note} maxLength={300} placeholder="e.g. urgent, for the frame" onChange={(e) => setNote(e.target.value)} /></label>
          {error && <p className="log-msg is-bad" role="alert">{error}</p>}
          </section>
        </div>
        <footer className="dlg-foot">
          <span className="proc-missing" />
          <button type="button" className="btn btn-plain" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-save" disabled={busy || !pick} onClick={() => void send()}>{busy ? "Sending…" : "Send"}</button>
        </footer>
      </div>
    </div>
  );
}

/** The receiving side: "Mia is sending you 3 parts to nest in 26-0412". */
export function IncomingPartsDialog({ offer, more, busy, onAnswer }: {
  offer: IncomingOffer;
  /** offers waiting after this one */
  more: number;
  busy: boolean;
  onAnswer: (accept: boolean) => void;
}) {
  const n = offer.parts.length;
  const pieces = offer.parts.reduce((s, x) => s + x.qty, 0);
  return (
    <div className="dlg-backdrop" role="presentation">
      <div className="dlg sp-dlg" role="alertdialog" aria-modal="true" aria-labelledby="in-title">
        <header className="dlg-head">
          <span className="dlg-icon" aria-hidden="true"><SendIcon /></span>
          <div className="dlg-title">
            <h2 id="in-title"><UserTag name={offer.fromUser} /> is sending you {n === 1 ? "a part" : `${n} parts`}</h2>
            <p>To nest in your job {offer.jobName} · {pieces} {pieces === 1 ? "piece" : "pieces"} · sent at {timeOf(offer.at)}{more ? ` · ${more} more waiting` : ""}</p>
          </div>
        </header>
        <div className="sp-body">
          {offer.note && <p className="sp-msg">“{offer.note}”</p>}
          <table className="sp-parts">
            <thead><tr><th /><th>Part</th><th>Material</th><th>Qty</th></tr></thead>
            <tbody>
              {offer.parts.map(({ part: p, qty }) => (
                <tr key={p.id}>
                  <td className="sp-part-thumb"><PartThumb part={p} size={34} marks={p.engraved} /></td>
                  <td><span className="sp-pname">{p.name}</span><span className="sp-proj">{p.project}</span></td>
                  <td><MatChip material={p.material} thicknessMm={p.thicknessMm} /></td>
                  <td className="sp-n">{qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="rule-help">Accept adds them to the job's work parts (a part already there gets the quantity added). {offer.fromUser} is told your answer.</p>
        </div>
        <footer className="dlg-foot">
          <span className="proc-missing" />
          <button type="button" className="btn btn-plain" disabled={busy} onClick={() => onAnswer(false)}>Refuse</button>
          <button type="button" className="btn btn-save" disabled={busy} onClick={() => onAnswer(true)} autoFocus>Accept</button>
        </footer>
      </div>
    </div>
  );
}
