import { useEffect, type ReactNode } from "react";

interface Props {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** A notice with one button (no Cancel): confirmLabel closes it. */
  notice?: boolean;
}

// A short question before something that loses work (red button = go ahead, Cancel = keep).
export function ConfirmDialog({ title, children, confirmLabel, onConfirm, onCancel, notice = false }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="dlg-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="dlg close-dlg" role="alertdialog" aria-modal="true" aria-labelledby="cf-title" aria-describedby="cf-text">
        <header className="dlg-head">
          <span className="dlg-icon close-dlg-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3 2 20h20L12 3z" /><path d="M12 10v4" /><circle cx="12" cy="17" r=".6" fill="currentColor" />
            </svg>
          </span>
          <div className="dlg-title"><h2 id="cf-title">{title}</h2></div>
        </header>
        <p id="cf-text" className="close-dlg-text">{children}</p>
        <footer className="dlg-foot">
          <span className="proc-missing" />
          {notice
            ? <button type="button" className="btn btn-save" onClick={onConfirm} autoFocus>{confirmLabel}</button>
            : <>
                <button type="button" className="btn btn-plain" onClick={onCancel} autoFocus>Cancel</button>
                <button type="button" className="btn btn-replace" onClick={onConfirm}>{confirmLabel}</button>
              </>}
        </footer>
      </div>
    </div>
  );
}
