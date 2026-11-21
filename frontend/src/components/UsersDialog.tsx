import { useEffect, useState, type ReactNode } from "react";
import { auth, type Me } from "../api/auth";

function Dialog({ title, sub, onClose, children, foot, wide = false }: { title: string; sub?: string; onClose: () => void; children: ReactNode; foot?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="dlg-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`dlg users-dlg${wide ? " is-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="us-title">
        <header className="dlg-head">
          <span className="dlg-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.8c1.6.8 2.7 2.5 3 5.2" />
            </svg>
          </span>
          <div className="dlg-title"><h2 id="us-title">{title}</h2>{sub && <p>{sub}</p>}</div>
          <button type="button" className="dlg-close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeLinecap="round" /></svg>
          </button>
        </header>
        <div className="users-body">{children}</div>
        {foot && <footer className="dlg-foot">{foot}</footer>}
      </div>
    </div>
  );
}

// User menu -> Change password: one's own, set, changed or removed.
export function PasswordDialog({ me, onClose, onMe }: { me: Me; onClose: () => void; onMe: (m: Me) => void }) {
  const [current, setCurrent] = useState("");
  const [pw, setPw] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const save = async (remove: boolean) => {
    setError(null);
    try {
      const r = await auth.changePassword(current, remove ? "" : pw);
      onMe({ id: r.id, name: r.name, isAdmin: r.isAdmin, hasPassword: r.hasPassword });
      setDone(remove ? "Password removed." : "Password saved. Other browsers signed in as you are signed out.");
      setCurrent(""); setPw(""); setAgain("");
    } catch (e) { setError((e as Error).message); }
  };
  const bad = pw !== "" && again !== pw;
  return (
    <Dialog title={me.hasPassword ? "Change password" : "Set a password"} sub={me.name} onClose={onClose}
      foot={<>
        <span className="proc-missing">{error ?? done ?? (bad && again ? "The passwords are not the same." : "")}</span>
        {me.hasPassword && <button type="button" className="btn btn-plain" onClick={() => void save(true)} disabled={!current}>Remove password</button>}
        <button type="button" className="btn btn-plain" onClick={onClose}>Close</button>
        <button type="button" className="btn btn-save" disabled={!pw || bad || (me.hasPassword && !current)} onClick={() => void save(false)}>Save</button>
      </>}>
      <div className="users-form">
        {me.hasPassword && <label className="signin-field"><span>Current password</span>
          <input className="field" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" autoFocus /></label>}
        <label className="signin-field"><span>New password</span>
          <input className="field" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" autoFocus={!me.hasPassword} /></label>
        <label className="signin-field"><span>New password again</span>
          <input className="field" type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" /></label>
      </div>
    </Dialog>
  );
}
