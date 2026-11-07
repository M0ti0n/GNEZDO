import { useState } from "react";
import { GnezdoIcon } from "./GnezdoIcon";
import { auth, type Me } from "../api/auth";

// The server build's first page: sign in with your name (and password, if you have one), or on the
// very first start, create the first admin.
export function SignInPage({ setupNeeded, onSignedIn }: { setupNeeded: boolean; onSignedIn: (me: Me) => void }) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mismatch = setupNeeded && password !== "" && again !== password;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || mismatch || busy) return;
    setBusy(true); setError(null);
    try { onSignedIn(setupNeeded ? await auth.setup(name.trim(), password) : await auth.signIn(name.trim(), password)); }
    catch (err) { setError((err as Error).message); setPassword(""); setAgain(""); }
    finally { setBusy(false); }
  };
  return (
    <div className="signin">
      <form className="signin-card" onSubmit={submit}>
        <div className="signin-brand"><GnezdoIcon size={34} /><span>GNEZDO</span></div>
        <h1>{setupNeeded ? "Create the first admin" : "Sign in"}</h1>
        <p className="signin-help">{setupNeeded
          ? "No users yet. This first user is an admin, who adds the others (Users, in the menu under your name)."
          : "Your name as the admin added it. A password only if you have one."}</p>
        <label className="signin-field"><span>Name</span>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} autoFocus autoComplete="username" maxLength={100} />
        </label>
        <label className="signin-field"><span>Password{setupNeeded ? " (optional, recommended for an admin)" : ""}</span>
          <input className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={setupNeeded ? "new-password" : "current-password"} />
        </label>
        {setupNeeded && password !== "" && (
          <label className="signin-field"><span>Password again</span>
            <input className="field" type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" />
          </label>
        )}
        {mismatch && again !== "" && <p className="signin-error">The passwords are not the same.</p>}
        {error && <p className="signin-error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-save signin-go" disabled={!name.trim() || mismatch || busy}>
          {busy ? "…" : setupNeeded ? "Create and sign in" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
