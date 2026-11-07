import { useEffect } from "react";
import type { DraftRow } from "../api/drafts";
import { browserId } from "../job/diag";

const when = (s: string) => {
  const d = new Date(s);
  const today = new Date().toDateString() === d.toDateString();
  return today ? `today ${d.toLocaleTimeString(undefined, { timeStyle: "short" })}` : d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
};
const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;

// On start: jobs that had unsaved changes when GNEZDO or the browser was last closed (or crashed).
// Restore opens each as it was (still unsaved: SAVE keeps it); Discard drops the copy; Later keeps it
// for the next start.
export function RestoreDialog({ rows, onRestore, onDiscard, onLater }: {
  rows: DraftRow[];
  onRestore: (ids: string[]) => void;
  onDiscard: (ids: string[]) => void;
  onLater: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onLater(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onLater]);
  const all = rows.map((r) => r.id);
  return (
    <div className="dlg-backdrop" role="presentation">
      <div className="dlg restore-dlg" role="dialog" aria-modal="true" aria-labelledby="rs-title">
        <header className="dlg-head">
          <span className="dlg-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /><path d="M12 7v5l3 2" />
            </svg>
          </span>
          <div className="dlg-title">
            <h2 id="rs-title">Restore unsaved work</h2>
            <p>{rows.length === 1 ? "A job had" : `${rows.length} jobs had`} changes that were not saved when GNEZDO was last closed.</p>
          </div>
        </header>
        <ul className="restore-list">
          {rows.map((r) => (
            <li key={r.id}>
              <div className="restore-what">
                <strong>{r.name || "Job"}</strong>
                <small>
                  {r.jobId ? "changes to a saved job" : "a new job, never saved"} · {n(r.parts, "part", "parts")}
                  {r.solutions ? ` · ${n(r.solutions, "solution", "solutions")}` : ""} · {when(r.savedAt)}
                  {r.browser && r.browser !== browserId ? " · from another browser" : ""}
                </small>
              </div>
              <button type="button" className="btn btn-plain" onClick={() => onDiscard([r.id])}>Discard</button>
              <button type="button" className="btn btn-save" onClick={() => onRestore([r.id])}>Restore</button>
            </li>
          ))}
        </ul>
        <p className="rule-help restore-note">A nest that was still running is not in the copy: nest it again after restoring.</p>
        <footer className="dlg-foot">
          <span className="proc-missing" />
          <button type="button" className="btn btn-plain" onClick={onLater} title="Keep the copies; asked again at the next start">Later</button>
          {rows.length > 1 && <button type="button" className="btn btn-plain" onClick={() => onDiscard(all)}>Discard all</button>}
          {rows.length > 1 && <button type="button" className="btn btn-save" onClick={() => onRestore(all)} autoFocus>Restore all</button>}
        </footer>
      </div>
    </div>
  );
}
