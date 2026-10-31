import { useEffect, useState } from "react";
import { IconClose } from "./Icons";
import { api } from "../api/api";
import type { PartSummary, PartVersion } from "../api/types";
import { fullDate, when } from "./format";
import { PartThumb } from "./PartThumb";

interface Props {
  part: PartSummary;
  onClose: () => void;
  /** After a restore: the part as it is now. */
  onRestored: (p: PartSummary) => void;
}

// Versions of a part: every Replace (and Restore) keeps the version before it.
// Restoring makes an older version current; the current one is kept, so it can be undone.
export function PartHistoryDialog({ part, onClose, onRestored }: Props) {
  const [versions, setVersions] = useState<PartVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const load = () => api.partHistory(part.id).then(setVersions, (e: Error) => setError(e.message));
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [part.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const restore = async (v: PartVersion) => {
    setBusy(v.revision);
    setError(null);
    try {
      const now = await api.restorePart(part.id, v.revision);
      onRestored(now);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="dlg-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dlg hist" role="dialog" aria-modal="true" aria-labelledby="hist-title">
        <header className="dlg-head">
          <span className="dlg-icon hist-icon" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" /><path d="M3 3.5V8h4.5" /><path d="M12 7.5V12l3 2" />
            </svg>
          </span>
          <div className="dlg-title">
            <h2 id="hist-title">Versions</h2>
            <p>{part.name}{part.project ? ` · ${part.project}` : ""}</p>
          </div>
          <button type="button" className="icon-btn dlg-close" onClick={onClose} aria-label="Close" title="Close (Esc)"><IconClose size={16} /></button>
        </header>

        <div className="hist-body">
          {error && <p className="proc-error" role="alert">{error}</p>}
          {!versions && !error && <p className="state">Loading…</p>}
          <ol className="hist-list">
            {versions?.map((v) => (
              <li key={v.revision} className={`hist-row${v.current ? " is-current" : ""}`}>
                <PartThumb part={v} size={64} />
                <div className="hist-main">
                  <div className="hist-top">
                    <b>Version {v.revision}</b>
                    {v.current && <span className="hist-badge">in use</span>}
                    <span className="hist-when" title={fullDate(v.savedAt)}>saved {when(v.savedAt)}</span>
                  </div>
                  <div className="hist-meta">
                    <span>{v.material} {v.thicknessMm} mm</span>
                    <span>{Math.round(v.w)} × {Math.round(v.h)} mm</span>
                    <span>{v.rotations.length ? v.rotations.map((r) => `${r}°`).join(", ") : "no rotation"}{v.mirror ? " · mirror" : ""}{v.filler ? " · filler" : ""}</span>
                    {v.engraved && <span>tracing</span>}
                  </div>
                  {(v.description || v.sourceFile) && (
                    <div className="hist-desc">{[v.description, v.sourceFile].filter(Boolean).join(" · ")}</div>
                  )}
                </div>
                {!v.current && (
                  <button className="btn btn-plain hist-restore" disabled={busy !== null} onClick={() => restore(v)}
                    title="Make this version the one in use; the current version is kept">
                    {busy === v.revision ? "Restoring…" : "Restore"}
                  </button>
                )}
              </li>
            ))}
          </ol>
        </div>

        <footer className="dlg-foot">
          <span className="proc-missing">Every Replace keeps the version before it. Restore keeps the current one too, so it can be undone.</span>
          <button className="btn btn-plain" onClick={onClose}>Close</button>
        </footer>
      </div>
    </div>
  );
}
