import { useRef, useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { addTool, loadTools, removeTool, setToolOn, toolEntries, useToolStore, type ToolEntry } from "../tools/toolStore";
import { readToolZip, svgUrl, toolFileName, toolZip, TOOL_FORMAT_VERSION } from "../tools/toolFormat";
import { pluginIcon } from "../import/ImportTools";
import { demoMode } from "../api/api";

const GUIDE = "https://github.com/M0ti0n/GNEZDO/tree/main/SPECIAL%20TOOLS";

// Settings -> Special tools: the plug-in tools of Special tools. Added ones (a .gnezdo-tool.zip) are kept
// in GNEZDO's database; on the desktop, the tools folder's are read again with Reload (for writing one).
export function ToolsSettings({ isAdmin }: { isAdmin: boolean }) {
  const store = useToolStore();
  const entries = toolEntries(store);
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<ToolEntry | null>(null);
  const desktop = !!store.folder;

  const run = async (what: () => Promise<string | void>) => {
    setBusy(true); setMsg(null);
    try { const t = await what(); if (t) setMsg({ text: t }); }
    catch (e) { setMsg({ text: (e as Error).message, bad: true }); }
    finally { setBusy(false); }
  };
  const add = (f: File | undefined) => {
    if (!f) return;
    void run(async () => {
      try {
        const pkg = await readToolZip(await f.arrayBuffer());
        const how = await addTool(pkg);
        return `${pkg.manifest.name} ${how === "replaced" ? "replaced (the newer one is used)" : "added"}: it is in Special tools now.`;
      } catch (e) { throw new Error(`Could not add ${f.name}: ${(e as Error).message}`); }
      finally { if (file.current) file.current.value = ""; }
    });
  };
  const exportTool = (e: ToolEntry) => {
    const url = URL.createObjectURL(new Blob([toolZip(e.pkg).slice()], { type: "application/zip" }));
    const a = document.createElement("a");
    a.href = url; a.download = toolFileName(e.pkg); a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const openFolder = () => void run(async () => {
    const res = await fetch("/api/tools/open-folder", { method: "POST", credentials: "same-origin" });
    if (!res.ok) { let m = `${res.status} ${res.statusText}`; try { m = ((await res.json()) as { message?: string }).message ?? m; } catch { /* not JSON */ } throw new Error(m); }
  });
  const reload = () => void run(async () => {
    await loadTools();
    return "Read again.";
  });

  return (
    <div className="settings-main">
      <header className="settings-head">
        <h2>Special tools</h2>
        <p>Tools that make parts from values, added without a new GNEZDO build. They sit in Special tools beside the fittings.</p>
      </header>

      <section className="rule">
        <h3>Tools</h3>
        {!store.loaded && <p className="rule-help">Loading…</p>}
        {store.loaded && !entries.length && <p className="rule-help">No tools added yet. A tool comes as a <b>.gnezdo-tool.zip</b>{desktop ? <>, or as a folder in the tools folder</> : null}.</p>}
        {entries.length > 0 && (
          <ul className="tl-list">
            {entries.map((e) => {
              const m = e.pkg.manifest;
              return (
                <li key={`${e.source}:${m.id}`} className={`tl-row${e.on && !e.hidden ? "" : " is-off"}`}>
                  <span className="tl-ic">{pluginIcon(e.pkg.icon ? svgUrl(e.pkg.icon) : null)}</span>
                  <div className="tl-text">
                    <b>{m.name}</b>{m.toolVersion && <span className="tl-ver"> {m.toolVersion}</span>}
                    <span className={`tl-src is-${e.source}`}>{e.source === "folder" ? `tools folder: ${e.where}` : "added"}</span>
                    {m.description && <p>{m.description}</p>}
                    <small>{m.id}{m.author ? ` · ${m.author}` : ""}{e.hidden ? " · the tools folder's copy is used" : ""}</small>
                  </div>
                  <div className="tl-act">
                    <label className="tl-on" title={e.on ? "In Special tools" : "Kept, but not in Special tools"}>
                      <input type="checkbox" checked={e.on} disabled={busy || !isAdmin}
                        onChange={(ev) => void run(() => setToolOn(m.id, ev.target.checked))} /> On
                    </label>
                    <button type="button" className="btn btn-plain" onClick={() => exportTool(e)} title="Save it as a .gnezdo-tool.zip (to pass on, or change)">Export</button>
                    {e.source === "added" && <button type="button" className="btn btn-danger-plain" disabled={busy || !isAdmin} onClick={() => setAsk(e)}>Remove</button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {!isAdmin && <p className="admin-only">Only an admin can add, remove or switch tools (everyone gets them).</p>}
        <div className="rule-row">
          <button type="button" className="btn btn-save" disabled={busy || !isAdmin} onClick={() => file.current?.click()} title="A .gnezdo-tool.zip">Add tool…</button>
          <input ref={file} type="file" accept=".zip" hidden onChange={(e) => add(e.target.files?.[0])} />
          {desktop && <button type="button" className="btn btn-plain" disabled={busy} onClick={openFolder}>Open tools folder</button>}
          <button type="button" className="btn btn-plain" disabled={busy} onClick={reload} title={desktop ? "Reads the tools folder again (after changing a tool there)" : "Loads the tools again"}>Reload</button>
        </div>
        {store.error && <p className="log-msg is-bad" role="status">{store.error}</p>}
        {store.folder?.problems.map((p) => <p key={p.name} className="log-msg is-bad">{p.name}: {p.message}</p>)}
        {msg && <p className={`log-msg${msg.bad ? " is-bad" : ""}`} role="status">{msg.text}</p>}
      </section>

      <section className="rule">
        <h3>Writing a tool</h3>
        <p className="rule-help">A tool is a folder with <b>tool.json</b> (its name and the values it asks for), <b>tool.js</b> (the math: <code>function parts(v, gz)</code> returns the parts&apos; lines
          and arcs) and, if wanted, <b>icon.svg</b> and <b>diagram.svg</b>. Its script runs in a sandbox in the browser: it cannot reach the network, your data or the page,
          and is stopped if it takes too long. Tool format {TOOL_FORMAT_VERSION}.</p>
        {desktop
          ? <p className="rule-help">To write one: put its folder in the tools folder ({store.folder?.dir}), change the files, click <b>Reload</b> and look at it in Special tools. When it is done, <b>Export</b> makes the .zip to pass on.</p>
          : <p className="rule-help">{demoMode ? "In the demo, added tools stay in this browser only." : "Added tools are kept in GNEZDO's database: everyone gets them, and backups carry them."}</p>}
        <p className="rule-help">The guide, with an example tool to start from: <a href={GUIDE} target="_blank" rel="noreferrer">SPECIAL TOOLS on GitHub</a>.</p>
      </section>

      {ask && (
        <ConfirmDialog title={`Remove ${ask.pkg.manifest.name}?`} confirmLabel="Remove" onCancel={() => setAsk(null)}
          onConfirm={() => { const id = ask.pkg.manifest.id; setAsk(null); void run(async () => { await removeTool(id); return `${ask.pkg.manifest.name} removed.`; }); }}>
          It goes from Special tools for everyone. Parts already made with it stay as they are.
        </ConfirmDialog>
      )}
    </div>
  );
}
