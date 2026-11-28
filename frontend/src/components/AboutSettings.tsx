import { useState } from "react";

// Settings -> About: which build this is, where its guide and manual are, how to reach us, and whether
// a newer build is out (the GitHub release the builds are published as).

const REPO = "https://github.com/M0ti0n/GNEZDO";
const RELEASE = `${REPO}/releases/tag/test-build`;
const RELEASE_API = "https://api.github.com/repos/M0ti0n/GNEZDO/releases/tags/test-build";
const README = `${REPO}#readme`;
const MANUALS = `${REPO}/tree/main/docs`;
const MANUAL_EN = `${REPO}/blob/main/docs/GNEZDO_User_Manual-eng.pdf`;
const MANUAL_SL = `${REPO}/blob/main/docs/GNEZDO_Navodila_za_uporabo-slo.pdf`;
const CONTACT = "gnezdo.nest@proton.me";
/** The license GNEZDO is published under. */
const LICENSE = "GNU Affero General Public License v3.0 (AGPL-3.0)";
const LICENSE_URL = `${REPO}/blob/main/LICENSE`;
const NOTICES_URL = `${REPO}/blob/main/THIRD-PARTY-NOTICES.md`;

/** This build, as the build put it in (Windows / Linux test build); a page built by hand has none. */
const BUILD = {
  name: import.meta.env.VITE_BUILD_NAME?.trim() || "",
  time: import.meta.env.VITE_BUILD_TIME?.trim() || "",
  sha: import.meta.env.VITE_BUILD_SHA?.trim() || "",
};

const dateOf = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`;
};

type Check = { state: "idle" | "busy" } | { state: "done"; newer: boolean; name: string; at: string } | { state: "error"; text: string };

export function AboutSettings() {
  const [check, setCheck] = useState<Check>({ state: "idle" });
  const [copied, setCopied] = useState(false);

  const checkNow = async () => {
    setCheck({ state: "busy" });
    try {
      const r = await fetch(RELEASE_API, { headers: { Accept: "application/vnd.github+json" } });
      if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
      const j = (await r.json()) as { name?: string; published_at?: string; target_commitish?: string };
      const at = j.published_at ?? "";
      // the release is built from one commit: another one than this build's, published after it, is newer
      const same = !!BUILD.sha && !!j.target_commitish?.startsWith(BUILD.sha);
      const newer = !same && !!at && (!BUILD.time || new Date(at).getTime() > new Date(BUILD.time).getTime());
      setCheck({ state: "done", newer, name: j.name ?? "Test build", at });
    } catch (e) {
      setCheck({ state: "error", text: (e as Error).message || "no connection" });
    }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(CONTACT); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* select it by hand */ }
  };

  return (
    <div className="settings-main">
      <header className="settings-head">
        <h2>About</h2>
        <p>GNEZDO: nesting, cutting paths and NC programs for laser and plasma cutting.</p>
      </header>

      <section className="rule about">
        <h3>This version</h3>
        <dl className="about-list">
          <div><dt>Version</dt><dd>{BUILD.name || "Development build"}{BUILD.sha && <span className="about-sha"> · {BUILD.sha}</span>}</dd></div>
          <div><dt>Released</dt><dd>{BUILD.time ? dateOf(BUILD.time) : "—"}</dd></div>
          <div><dt>License</dt><dd><a href={LICENSE_URL} target="_blank" rel="noreferrer">{LICENSE}</a></dd></div>
          <div><dt>Source code</dt><dd><a href={REPO} target="_blank" rel="noreferrer">{REPO.replace("https://", "")}</a></dd></div>
        </dl>
        <p className="rule-help">Free software: you may use, change and pass it on. Whoever passes on a changed version, or offers one to
          others over a network, has to make its source code available under the same license. GNEZDO uses third-party software under its
          own licenses (the nesting engine PackingSolver: MIT): see the <a href={NOTICES_URL} target="_blank" rel="noreferrer">third-party notices</a>.</p>
      </section>

      <section className="rule about">
        <h3>Updates</h3>
        <div className="about-row">
          <button type="button" className="btn btn-plain" disabled={check.state === "busy"} onClick={checkNow}>
            {check.state === "busy" ? "Checking…" : "Check for updates"}
          </button>
          <a className="about-link" href={RELEASE} target="_blank" rel="noreferrer">Latest release page</a>
        </div>
        {check.state === "done" && (
          <p className={`rule-help${check.newer ? " about-new" : ""}`} role="status">
            {check.newer
              ? <>A newer build is out: {check.name}{check.at ? `, ${dateOf(check.at)}` : ""}. Download it from the <a href={RELEASE} target="_blank" rel="noreferrer">release page</a>.</>
              : `This is the latest build (${check.name}${check.at ? `, ${dateOf(check.at)}` : ""}).`}
          </p>
        )}
        {check.state === "error" && (
          <p className="rule-help about-bad" role="status">Could not reach GitHub ({check.text}). Open the <a href={RELEASE} target="_blank" rel="noreferrer">release page</a> to look.</p>
        )}
      </section>

      <section className="rule about">
        <h3>Guide and manual</h3>
        <ul className="about-links">
          <li><a href={README} target="_blank" rel="noreferrer">README on GitHub</a><span> · what GNEZDO does, installing and starting it</span></li>
          <li><a href={MANUAL_EN} target="_blank" rel="noreferrer">User manual (English, PDF)</a></li>
          <li><a href={MANUAL_SL} target="_blank" rel="noreferrer">Navodila za uporabo (Slovenian, PDF)</a></li>
          <li><a href={MANUALS} target="_blank" rel="noreferrer">All manuals</a></li>
        </ul>
      </section>

      <section className="rule about">
        <h3>Contact</h3>
        <div className="about-row">
          <span className="about-mail" title="Select to copy">{CONTACT}</span>
          <button type="button" className="btn btn-plain" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
        </div>
        <p className="rule-help">Questions, problems, ideas. With a problem, send the diagnostic log too (Settings → Diagnostic log).</p>
      </section>
    </div>
  );
}
