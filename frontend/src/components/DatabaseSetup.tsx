import { useState } from "react";
import { GnezdoIcon } from "./GnezdoIcon";
import { data, type DbCheck, type DbForm } from "../api/data";

const EMPTY: DbForm = { server: "", database: "gnezdo", windowsLogin: true, user: "", password: "", trustCertificate: true };

// The SQL Server connection: test it, then save. Used on the server's first start (DatabaseSetupPage)
// and by an admin in Settings -> Data (then used after a restart).
export function DatabaseForm({ start, onSaved, saveLabel }: { start?: Partial<DbForm>; onSaved: (message: string, restart: boolean) => void; saveLabel: string }) {
  const [f, setF] = useState<DbForm>({ ...EMPTY, ...start });
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<DbCheck | null>(null);
  const set = (p: Partial<DbForm>) => { setF((x) => ({ ...x, ...p })); setCheck(null); };
  const run = async (save: boolean) => {
    setBusy(true); setCheck(null);
    try {
      if (!save) { setCheck(await data.test(f)); return; }
      const r = await data.save(f);
      if (r.ok) onSaved(r.message, !!r.restart); else setCheck({ ok: false, message: r.message });
    } catch (e) { setCheck({ ok: false, message: (e as Error).message }); }
    finally { setBusy(false); }
  };
  const ready = f.server.trim() !== "" && f.database.trim() !== "" && (f.windowsLogin || f.user.trim() !== "");
  return (
    <form className="db-form" onSubmit={(e) => { e.preventDefault(); if (ready && !busy) void run(true); }}>
      <label className="signin-field"><span>SQL Server</span>
        <input className="field" value={f.server} onChange={(e) => set({ server: e.target.value })} placeholder="SERVERNAME\SQLEXPRESS" autoFocus spellCheck={false} />
      </label>
      <label className="signin-field"><span>Database (GNEZDO's own: it is created if it does not exist)</span>
        <input className="field" value={f.database} onChange={(e) => set({ database: e.target.value })} spellCheck={false} maxLength={100} />
      </label>
      <div className="db-login" role="radiogroup" aria-label="Sign-in to SQL Server">
        <label className="chk"><input type="radio" checked={f.windowsLogin} onChange={() => set({ windowsLogin: true })} /> Windows sign-in (the user GNEZDO runs as)</label>
        <label className="chk"><input type="radio" checked={!f.windowsLogin} onChange={() => set({ windowsLogin: false })} /> SQL login</label>
      </div>
      {!f.windowsLogin && (
        <div className="db-pair">
          <label className="signin-field"><span>Login</span>
            <input className="field" value={f.user} onChange={(e) => set({ user: e.target.value })} autoComplete="off" spellCheck={false} />
          </label>
          <label className="signin-field"><span>Password</span>
            <input className="field" type="password" value={f.password} onChange={(e) => set({ password: e.target.value })} autoComplete="new-password" />
          </label>
        </div>
      )}
      <label className="chk db-trust"><input type="checkbox" checked={f.trustCertificate} onChange={(e) => set({ trustCertificate: e.target.checked })} />
        {" "}Trust the server's certificate (usual for a SQL Server in the company network)</label>
      {check && <p className={check.ok ? "db-ok" : "signin-error"} role="status">{check.message}</p>}
      <div className="db-buttons">
        <button type="button" className="btn btn-plain" disabled={!ready || busy} onClick={() => void run(false)}>Test connection</button>
        <button type="submit" className="btn btn-save" disabled={!ready || busy || check?.ok === false}>{busy ? "…" : saveLabel}</button>
      </div>
    </form>
  );
}

// The server's first start with no database: asked here instead of editing config.json.
export function DatabaseSetupPage({ onDone }: { onDone: () => void }) {
  return (
    <div className="signin">
      <div className="signin-card db-card">
        <div className="signin-brand"><GnezdoIcon size={34} /><span>GNEZDO</span></div>
        <h1>Set up the database</h1>
        <p className="signin-help">GNEZDO keeps parts, jobs and settings in a Microsoft SQL Server database of its own (Express is enough).
          Never use the database of another program (an ERP, other nesting software): GNEZDO refuses one that is not empty.</p>
        <DatabaseForm saveLabel="Save and continue" onSaved={() => onDone()} />
      </div>
    </div>
  );
}
