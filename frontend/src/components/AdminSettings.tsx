import { useEffect, useState } from "react";
import { auth, type ApiKeyRow, type Me, type UserRow } from "../api/auth";
import { ConfirmDialog } from "./ConfirmDialog";

const when = (s: string | null) => (s ? new Date(s).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : "never");

// Settings -> Administration (admins of the server build): who may sign in, and the keys other apps read
// GNEZDO's status with. A new installation has one user, Admin, without a password.
export function AdminSettings({ me, onMe }: { me: Me; onMe: (m: Me) => void }) {
  return (
    <div className="settings-main">
      <header className="settings-head">
        <h2>Administration</h2>
        <p>Who may sign in to GNEZDO on this server, and which other apps may read its status. Only admins see this section.</p>
      </header>
      <UsersSection me={me} onMe={onMe} />
      <ApiKeysSection />
    </div>
  );
}

function UsersSection({ me, onMe }: { me: Me; onMe: (m: Me) => void }) {
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [admin, setAdmin] = useState(false);
  const [pwFor, setPwFor] = useState<number | null>(null);
  const [newPw, setNewPw] = useState("");
  const [renameFor, setRenameFor] = useState<number | null>(null);
  const [newName, setNewName] = useState("");
  const [removing, setRemoving] = useState<UserRow | null>(null);
  const load = () => auth.users().then(setRows).catch((e) => setError((e as Error).message));
  useEffect(() => { void load(); }, []);
  const run = async (f: () => Promise<unknown>) => {
    setError(null);
    try { await f(); await load(); return true; } catch (e) { setError((e as Error).message); return false; }
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
  const open = (rows ?? []).filter((u) => u.isAdmin && !u.hasPassword);
  return (
    <section className="rule">
      <h3>Users</h3>
      {open.length > 0 && (
        <p className="admin-warn" role="status">
          {open.length === 1
            ? <><b>{open[0].name}</b> is an admin with no password: anyone who opens GNEZDO can sign in as {open[0].name} and change everything here.</>
            : <><b>{open.map((u) => u.name).join(", ")}</b> are admins with no password: anyone who opens GNEZDO can sign in as one of them and change everything here.</>}
          {" "}Set a password (Password → Set).
        </p>
      )}
      <div className="admin-table">
        <table className="users-table">
          <thead><tr><th>Name</th><th>Admin</th><th>Password</th><th>Last signed in</th><th /></tr></thead>
          <tbody>
            {(rows ?? []).map((u) => (
              <tr key={u.id}>
                <td>
                  {renameFor === u.id ? (
                    <form className="users-pw" onSubmit={(e) => { e.preventDefault(); if (newName.trim()) void patch(u, { name: newName.trim() }).then((ok) => { if (ok) setRenameFor(null); }); }}>
                      <input className="field" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus maxLength={100} aria-label={`New name for ${u.name}`} />
                      <button type="submit" className="btn btn-save" disabled={!newName.trim() || newName.trim() === u.name}>Save</button>
                      <button type="button" className="btn btn-plain" onClick={() => setRenameFor(null)}>Cancel</button>
                    </form>
                  ) : (
                    <span className="users-pw">
                      <span className="users-name">{u.name}{u.id === me.id && <small> (you)</small>}</span>
                      <button type="button" className="btn btn-plain" onClick={() => { setRenameFor(u.id); setNewName(u.name); }} title={`Rename ${u.name}`}>Rename</button>
                    </span>
                  )}
                </td>
                <td><input type="checkbox" checked={u.isAdmin} onChange={(e) => void patch(u, { isAdmin: e.target.checked })} aria-label={`${u.name} is an admin`} /></td>
                <td>
                  {pwFor === u.id ? (
                    <form className="users-pw" onSubmit={(e) => { e.preventDefault(); if (newPw) void patch(u, { password: newPw }).then((ok) => { if (ok) { setPwFor(null); setNewPw(""); } }); }}>
                      <input className="field" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoFocus placeholder="New password" autoComplete="new-password" aria-label={`New password for ${u.name}`} />
                      <button type="submit" className="btn btn-save" disabled={!newPw}>Set</button>
                      <button type="button" className="btn btn-plain" onClick={() => { setPwFor(null); setNewPw(""); }}>Cancel</button>
                    </form>
                  ) : (
                    <span className="users-pw">
                      {u.hasPassword ? "Yes" : <span className={u.isAdmin ? "admin-nopw" : undefined}>No</span>}
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
      </div>
      {error && <p className="log-msg is-bad" role="alert">{error}</p>}
      <form className="users-add" onSubmit={add}>
        <h4>Add a user</h4>
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" maxLength={100} aria-label="Name of the new user" />
        <input className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (optional)" autoComplete="new-password" aria-label="Password of the new user" />
        <label className="chk"><input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} /> Admin</label>
        <button type="submit" className="btn btn-save" disabled={!name.trim()}>Add</button>
      </form>
      <p className="rule-help">Without a password anyone who knows the name can sign in as that user: give admins a password. A changed name,
        password or admin right signs that user out everywhere. Only an admin can change the machines, the shared settings and this section.</p>
      {removing && (
        <ConfirmDialog title={`Remove ${removing.name}?`} confirmLabel="Remove"
          onCancel={() => setRemoving(null)} onConfirm={() => { const u = removing; setRemoving(null); void run(() => auth.removeUser(u.id)); }}>
          {removing.name} is signed out and can no longer sign in. Jobs and parts saved by {removing.name} stay as they are.
        </ConfirmDialog>
      )}
    </section>
  );
}

// Keys for other apps (a BOM app, a workflow overview) to read which parts of an order are in GNEZDO, in
// jobs, nested and sent to a machine. Read only; docs/STATUS-API.md.
function ApiKeysSection() {
  const [rows, setRows] = useState<ApiKeyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [made, setMade] = useState<{ name: string; key: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [removing, setRemoving] = useState<ApiKeyRow | null>(null);
  const load = () => auth.apiKeys().then(setRows).catch((e) => setError((e as Error).message));
  useEffect(() => { void load(); }, []);
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    try {
      const r = await auth.addApiKey(name.trim());
      setMade({ name: r.info.name, key: r.key });
      setCopied(false);
      setName("");
      await load();
    } catch (er) { setError((er as Error).message); }
  };
  const copy = async () => {
    if (!made) return;
    try { await navigator.clipboard.writeText(made.key); setCopied(true); } catch { setCopied(false); }
  };
  const base = `${window.location.origin}/api/v1`;
  return (
    <section className="rule">
      <h3>Status API keys</h3>
      <p className="rule-help">Other apps read which parts of an order are in GNEZDO, nested and sent to a machine. Read only: nothing can be changed with a key.</p>
      {made && (
        <div className="apikey-made" role="status">
          <p>The key for <b>{made.name}</b>. Copy it now: GNEZDO does not keep it and cannot show it again.</p>
          <div className="apikey-row">
            <input className="field apikey-key" readOnly value={made.key} onFocus={(e) => e.target.select()} aria-label={`API key for ${made.name}`} />
            <button type="button" className="btn btn-save" onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</button>
          </div>
        </div>
      )}
      <div className="admin-table">
        <table className="users-table">
          <thead><tr><th>App</th><th>Key starts with</th><th>Made</th><th>Last used</th><th /></tr></thead>
          <tbody>
            {(rows ?? []).map((k) => (
              <tr key={k.id}>
                <td className="users-name">{k.name}</td>
                <td><code>{k.prefix}…</code></td>
                <td className="users-when">{when(k.createdAt)}{k.createdBy && <small> · {k.createdBy}</small>}</td>
                <td className="users-when">{when(k.lastUsedAt)}</td>
                <td><button type="button" className="btn btn-plain users-del" onClick={() => setRemoving(k)} title={`Remove: ${k.name} can no longer read the status`}>Remove</button></td>
              </tr>
            ))}
            {rows !== null && rows.length === 0 && <tr><td colSpan={5}>No keys yet.</td></tr>}
            {rows === null && !error && <tr><td colSpan={5}>Loading…</td></tr>}
          </tbody>
        </table>
      </div>
      {error && <p className="log-msg is-bad" role="alert">{error}</p>}
      <form className="users-add" onSubmit={(e) => void add(e)}>
        <h4>Make a key</h4>
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="The app that uses it, e.g. BOM app" maxLength={100} aria-label="Name of the app" />
        <button type="submit" className="btn btn-save" disabled={!name.trim()}>Make key</button>
      </form>
      {removing && (
        <ConfirmDialog title={`Remove the key for ${removing.name}?`} confirmLabel="Remove"
          onCancel={() => setRemoving(null)} onConfirm={() => { const k = removing; setRemoving(null); setError(null); void auth.removeApiKey(k.id).then(load).catch((e) => setError((e as Error).message)); }}>
          {removing.name} can no longer read GNEZDO's status. Make a new key to let it again.
        </ConfirmDialog>
      )}
      <div className="rule-help apikey-help">
        <p>The app sends the key in the header <code>X-Api-Key</code>.</p>
        <p><code>GET {base}/projects/26-0412</code>: every part of the project, in jobs, nested and sent to a machine.</p>
        <p><code>POST {base}/projects/26-0412/check</code> with the order's drawings
          (<code>{'{"drawings":[{"drawing":"1234-56-78","position":"P2","needed":6}]}'}</code>): each one found, or missing (never imported).</p>
        <p>Part names are read as drawing_position_pieces (1234-56-78_P2_3kos). More in docs/STATUS-API.md in GNEZDO's repository.</p>
      </div>
    </section>
  );
}
