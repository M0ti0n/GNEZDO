import { useEffect } from "react";

interface Props {
  name: string;
  /** Opens the Process pop-up for the part (the tab stays open). */
  onProcess: () => void;
  /** Closes the tab: the part goes back to how it was imported and its Undo history ends. */
  onDiscard: () => void;
  onCancel: () => void;
}

// Asked when the tab of an edited part is closed before the part is saved to the database.
export function CloseUnsavedDialog({ name, onProcess, onDiscard, onCancel }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="dlg-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="dlg close-dlg" role="alertdialog" aria-modal="true" aria-labelledby="cu-title" aria-describedby="cu-text">
        <header className="dlg-head">
          <span className="dlg-icon close-dlg-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3 2 20h20L12 3z" /><path d="M12 10v4" /><circle cx="12" cy="17" r=".6" fill="currentColor" />
            </svg>
          </span>
          <div className="dlg-title">
            <h2 id="cu-title">Close without saving?</h2>
            <p>{name}</p>
          </div>
        </header>
        <p id="cu-text" className="close-dlg-text">
          This part has changes that are not saved in the database. If you close it without saving, the changes
          are lost: the part goes back to how it was imported and Undo starts again.
        </p>
        <footer className="dlg-foot">
          <button type="button" className="btn btn-replace" onClick={onDiscard}>Close without saving</button>
          <span className="proc-missing" />
          <button type="button" className="btn btn-plain" onClick={onCancel} autoFocus>Cancel</button>
          <button type="button" className="btn btn-save" onClick={onProcess}>Process…</button>
        </footer>
      </div>
    </div>
  );
}
