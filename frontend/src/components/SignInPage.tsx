import { useState } from "react";
import { GnezdoIcon } from "./GnezdoIcon";
import { auth, type Me } from "../api/auth";

/** The user a new database starts with (the server's AuthEndpoints.DefaultAdmin). */
const DEFAULT_ADMIN = "Admin";

// The server build's first page: sign in with your name (and password, if you have one). A new
// installation has one user, Admin, without a password: the page says so until Admin has one.
export function SignInPage({ defaultAdmin = false, onSignedIn }: { defaultAdmin?: boolean; onSignedIn: (me: Me) => void }) {
  const [name, setName] = useState(defaultAdmin ? DEFAULT_ADMIN : "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true); setError(null);
    try { onSignedIn(await auth.signIn(name.trim(), password)); }
    catch (err) { setError((err as Error).message); setPassword(""); }
    finally { setBusy(false); }
  };
  return (
    <div className="signin">
      <form className="signin-card" onSubmit={submit}>
        <div className="signin-brand"><GnezdoIcon size={34} /><span>GNEZDO</span></div>
        <h1>Sign in</h1>
        <p className="signin-help">{defaultAdmin
          ? <>A new installation: sign in as <b>{DEFAULT_ADMIN}</b>, without a password. Then give {DEFAULT_ADMIN} a password and add the others in Settings → Administration.</>
          : "Your name as the admin added it. A password only if you have one."}</p>
        <label className="signin-field"><span>Name</span>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} autoFocus autoComplete="username" maxLength={100} />
        </label>
        <label className="signin-field"><span>Password</span>
          <input className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </label>
        {error && <p className="signin-error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-save signin-go" disabled={!name.trim() || busy}>{busy ? "…" : "Sign in"}</button>
      </form>
    </div>
  );
}
