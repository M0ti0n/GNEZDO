import { useEffect, useState } from "react";
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
  const fits = (j: OpenJob) => j.materials.some((m) => kinds.has(`${m.material.toLowerCase()}|${m.thicknessMm}`));
  const sorted = jobs ? [...jobs].sort((a, b) => Number(fits(b)) - Number(fits(a))) : null;
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
      <div className="dlg sp-dlg" role="dialog" aria-modal="true" aria-labelledby="sp-title">
        <header className="dlg-head">
          <span className="dlg-icon" aria-hidden="true"><SendIcon /></span>
          <div className="dlg-title"><h2 id="sp-title">Send to a job</h2><p>To someone who has the job open: they accept the parts into it, or refuse them.</p></div>
        </header>
        <div className="sp-body">
          <h3>Job</h3>
          {sorted === null && <p className="sp-empty">Looking for open jobs…</p>}
          {sorted?.length === 0 && !error && <p className="sp-empty">Nobody has a saved job open on another computer right now.</p>}
          {!!sorted?.length && (
            <ul className="sp-jobs" role="listbox" aria-label="Open jobs">
              {sorted.map((j) => (
                <li key={j.id} role="option" aria-selected={pick === j.id} className={`sp-job${pick === j.id ? " is-on" : ""}`} onClick={() => setPick(j.id)}>
                  <span className="sp-job-name">{j.name}</span>
                  <span className="sp-job-who">{j.user} · open since {timeOf(j.since)}</span>
                  <span className="sp-job-mats">
                    {fits(j) && <b className="sp-fit">Same material and thickness</b>}
                    {j.materials.length ? j.materials.map((m) => `${m.material} ${mm(m.thicknessMm)}`).join(", ") : "no saved parts yet"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <h3>Parts</h3>
          <table className="sp-parts">
            <thead><tr><th /><th>Part</th><th>Material</th><th>Qty</th></tr></thead>
            <tbody>
              {parts.map((p) => (
                <tr key={p.id}>
                  <td className="sp-thumb"><PartThumb part={p} size={34} marks={p.engraved} /></td>
                  <td><span className="sp-pname">{p.name}</span><span className="sp-proj">{p.project}</span></td>
                  <td>{p.material} {mm(p.thicknessMm)}</td>
                  <td><input className="sp-qty" type="number" min={0} step={1} value={qty[p.id] ?? 0} aria-label={`Quantity of ${p.name}`}
                    onChange={(e) => setQty((q) => ({ ...q, [p.id]: Math.max(0, Math.round(Number(e.target.value) || 0)) }))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <label className="sp-note"><span>Note (optional)</span>
            <input value={note} maxLength={300} placeholder="e.g. urgent, for the frame" onChange={(e) => setNote(e.target.value)} /></label>
          {error && <p className="log-msg is-bad" role="alert">{error}</p>}
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
            <h2 id="in-title">{offer.fromUser} is sending you {n === 1 ? "a part" : `${n} parts`}</h2>
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
                  <td className="sp-thumb"><PartThumb part={p} size={34} marks={p.engraved} /></td>
                  <td><span className="sp-pname">{p.name}</span><span className="sp-proj">{p.project}</span></td>
                  <td>{p.material} {mm(p.thicknessMm)}</td>
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
