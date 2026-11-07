import { useEffect, useState, type ReactNode } from "react";
import { auth, type Me, type UserRow } from "../api/auth";
import { ConfirmDialog } from "./ConfirmDialog";

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

const when = (s: string | null) => (s ? new Date(s).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : "never");

// User menu -> Users (admin): add people, give or take a password, admin rights; remove them.
export function UsersDialog({ me, onClose, onMe }: { me: Me; onClose: () => void; onMe: (m: Me) => void }) {
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [admin, setAdmin] = useState(false);
  const [pwFor, setPwFor] = useState<number | null>(null);
  const [newPw, setNewPw] = useState("");
  const [removing, setRemoving] = useState<UserRow | null>(null);
  const load = () => auth.users().then(setRows).catch((e) => setError((e as Error).message));
  useEffect(() => { void load(); }, []);
  const run = async (f: () => Promise<unknown>) => {
    setError(null);
    try { await f(); await load(); } catch (e) { setError((e as Error).message); }
  };
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    void run(async () => { await auth.addUser(name.trim(), password, admin); setName(""); setPassword(""); setAdmin(false); });
  };
  const patch = (u: UserRow, p: Parameters<typeof auth.updateUser>[1]) => run(async () => {
    const r = await auth.updateUser(u.id, p);
    if (u.id === me.id) onMe({ id: r.id, name: r.name, isAdmin: r.isAdmin, hasPassword: r.hasPassword });
  });
  return (
    <Dialog title="Users" sub="Who may sign in to GNEZDO on this server" onClose={onClose} wide
      foot={<><span className="proc-missing">{error}</span><button type="button" className="btn btn-plain" onClick={onClose}>Close</button></>}>
      <table className="users-table">
        <thead><tr><th>Name</th><th>Admin</th><th>Password</th><th>Last signed in</th><th /></tr></thead>
        <tbody>
          {(rows ?? []).map((u) => (
            <tr key={u.id}>
              <td className="users-name">{u.name}{u.id === me.id && <small> (you)</small>}</td>
              <td><input type="checkbox" checked={u.isAdmin} onChange={(e) => void patch(u, { isAdmin: e.target.checked })} aria-label={`${u.name} is an admin`} /></td>
              <td>
                {pwFor === u.id ? (
                  <form className="users-pw" onSubmit={(e) => { e.preventDefault(); if (newPw) void patch(u, { password: newPw }).then(() => { setPwFor(null); setNewPw(""); }); }}>
                    <input className="field" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoFocus placeholder="New password" autoComplete="new-password" aria-label={`New password for ${u.name}`} />
                    <button type="submit" className="btn btn-save" disabled={!newPw}>Set</button>
                    <button type="button" className="btn btn-plain" onClick={() => { setPwFor(null); setNewPw(""); }}>Cancel</button>
                  </form>
                ) : (
                  <span className="users-pw">
                    {u.hasPassword ? "Yes" : "No"}
                    <button type="button" className="btn btn-plain" onClick={() => { setPwFor(u.id); setNewPw(""); }}>{u.hasPassword ? "Change" : "Set"}</button>
                    {u.hasPassword && <button type="button" className="btn btn-plain" onClick={() => void patch(u, { clearPassword: true })}>Remove</button>}
                  </span>
                )}
              </td>
              <td className="users-when">{when(u.lastSignInAt)}</td>
              <td><button type="button" className="btn btn-plain users-del" disabled={u.id === me.id}
                title={u.id === me.id ? "You cannot remove yourself" : `Remove ${u.name}: signed out, can no longer sign in`}
                onClick={() => setRemoving(u)}>Remove</button></td>
            </tr>
          ))}
          {rows === null && !error && <tr><td colSpan={5}>Loading…</td></tr>}
        </tbody>
      </table>
      <form className="users-add" onSubmit={add}>
        <h3>Add a user</h3>
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" maxLength={100} aria-label="Name of the new user" />
        <input className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (optional)" autoComplete="new-password" aria-label="Password of the new user" />
        <label className="chk"><input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} /> Admin</label>
        <button type="submit" className="btn btn-save" disabled={!name.trim()}>Add</button>
      </form>
      {removing && (
        <ConfirmDialog title={`Remove ${removing.name}?`} confirmLabel="Remove"
          onCancel={() => setRemoving(null)} onConfirm={() => { const u = removing; setRemoving(null); void run(() => auth.removeUser(u.id)); }}>
          {removing.name} is signed out and can no longer sign in. Jobs and parts saved by {removing.name} stay as they are.
        </ConfirmDialog>
      )}
      <p className="rule-help">Without a password anyone who knows the name can sign in as that user: give admins a password. A changed password or
        admin right signs that user out everywhere.</p>
    </Dialog>
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
