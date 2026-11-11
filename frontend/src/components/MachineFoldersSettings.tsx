import { useState } from "react";
import { api } from "../api/api";
import { foldersOf, type Machine, type MachineFolders } from "../job/machine";

/** Settings -> Machines -> Machine -> Folders: where the server writes the machine's NC programs and job files. */
export function MachineFoldersSettings({ machine, onChange }: { machine: Machine; onChange: (f: MachineFolders) => void }) {
  const f = foldersOf(machine);
  const set = (patch: Partial<MachineFolders>) => {
    const next = { ...f, ...patch };
    if (!next.jobs.trim()) next.jobFile = false;   // a job file needs its folder
    onChange(next);
  };
  const [checked, setChecked] = useState<Record<string, { ok: boolean; message: string } | undefined>>({});
  const check = async (key: "nc" | "jobs") => {
    try { setChecked((c) => ({ ...c, [key]: undefined })); const r = await api.checkFolder(f[key]); setChecked((c) => ({ ...c, [key]: r })); }
    catch (e) { setChecked((c) => ({ ...c, [key]: { ok: false, message: (e as Error).message } })); }
  };
  const row = (key: "nc" | "jobs", label: string, placeholder: string) => (
    <>
      <div className="mc-row mc-folder">
        <label className="mc-field"><span>{label}</span>
          <input className="field" value={f[key]} placeholder={placeholder} spellCheck={false}
            onChange={(e) => { set({ [key]: e.target.value }); setChecked((c) => ({ ...c, [key]: undefined })); }} />
        </label>
        <button type="button" className="btn btn-plain" disabled={!f[key].trim() || !api.hasServer} onClick={() => check(key)}
          title={api.hasServer ? "Can the server write there?" : "The demo has no server"}>Check</button>
      </div>
      {checked[key] && <p className={`tech-msg${checked[key]!.ok ? "" : " is-bad"}`} role="status">{checked[key]!.message}</p>}
    </>
  );
  return (
    <section className="rule">
      <h3>Folders</h3>
      <p className="rule-help">Where the GNEZDO server writes this machine's files: a folder on the server's PC (on the desktop, this PC) or a network share it can reach, as a full path. Not in an exported machine file.</p>
      {row("nc", "NC programs", "e.g. \\\\server\\NC\\Plasma or D:\\NC\\Plasma")}
      {!f.nc.trim() && !f.ncDownload && <p className="tech-msg is-bad">Required: without an NC folder this machine's NC programs cannot be written.</p>}
      <label className="chk"><input type="checkbox" checked={f.ncDownload} onChange={(e) => set({ ncDownload: e.target.checked })} /> No NC folder: download the NC program in the browser instead</label>
      {row("jobs", "Job files", "e.g. \\\\server\\Jobs\\Plasma")}
      <label className="chk" title={f.jobs.trim() ? undefined : "Set the job folder first"}>
        <input type="checkbox" checked={f.jobFile} disabled={!f.jobs.trim()} onChange={(e) => set({ jobFile: e.target.checked })} /> Also write every saved job as a file here (with its parts' drawings); the database stays the main copy
      </label>
    </section>
  );
}
