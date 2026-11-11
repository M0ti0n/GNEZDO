import { useMemo, useRef, useState } from "react";
import { GENERIC_POSTPROCESSOR, runPostprocessor, sampleProgram, type Postprocessor } from "../job/postprocessor";
import type { Machine } from "../job/machine";
import { saveNcFile } from "../job/ncFile";

/** Settings -> Machines -> NC output: the machine's postprocessor (a .js file) and a try-out on a sample sheet. */
export function NcOutputSettings({ machine, onChange }: { machine: Machine; onChange: (p: Postprocessor | undefined) => void }) {
  const pp = machine.postprocessor;
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [tryMsg, setTryMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  // the sample is cut with the machine's first technology row, if it has one
  const tech = useMemo(() => {
    const t = machine.technologies?.find((x) => x.rows.length);
    const row = t?.rows.find((r) => r.thicknessMm >= 10) ?? t?.rows[0];
    return row ? { thickness: row.thicknessMm, tech: { ...row, name: t!.name } } : { thickness: 10, tech: { speed: 2000, smallHoleSpeed: 1000, smallHoleMm: 20, pierceS: 0.5 } };
  }, [machine.technologies]);
  const result = useMemo(() => (pp ? runPostprocessor(pp.source, sampleProgram(tech.tech, tech.thickness)) : null), [pp, tech]);

  const load = async (f: File | undefined) => {
    if (!f) return;
    try {
      const source = await f.text();
      const test = runPostprocessor(source, sampleProgram(tech.tech, tech.thickness));
      if (!test.ok) { setMsg({ text: `${f.name}: ${test.error}`, bad: true }); return; }
      const name = /^\/\/\s*GNEZDO postprocessor:\s*(.+)$/m.exec(source)?.[1]?.trim() || f.name.replace(/\.js$/i, "");
      onChange({ name, extension: pp?.extension ?? ".nc", source });
      setMsg({ text: `${name} loaded` });
    } catch (e) { setMsg({ text: `Could not read ${f.name}: ${(e as Error).message}`, bad: true }); }
    finally { if (file.current) file.current.value = ""; }
  };
  const download = (name: string, text: string, type: string) => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="ncout">
      <section className="rule">
        <h3>Postprocessor</h3>
        <p className="rule-help">Writes the NC program the machine reads. It is a small JavaScript file the machine carries
          (with Export / Import machine): <code>function postprocess(program)</code> gets the sheet's cut path and returns the NC text.</p>
        <div className="mc-row">
          <span className="ncout-name">{pp ? pp.name : "None: this machine writes no NC programs yet"}</span>
        </div>
        <div className="mc-row">
          <button type="button" className="btn btn-plain" onClick={() => file.current?.click()}>{pp ? "Replace…" : "Load postprocessor…"}</button>
          <input ref={file} type="file" accept=".js,text/javascript" hidden onChange={(e) => load(e.target.files?.[0])} />
          {!pp && <button type="button" className="btn btn-plain" onClick={() => { onChange({ ...GENERIC_POSTPROCESSOR }); setMsg({ text: "Generic ISO postprocessor set: change it to suit the machine" }); }}>Start from the generic ISO one</button>}
          {pp && <button type="button" className="btn btn-plain" onClick={() => download(`${pp.name.replace(/[\\/:*?"<>|]+/g, "_")}.js`, pp.source, "text/javascript")}>Download .js</button>}
          {pp && <button type="button" className="btn btn-danger-plain" onClick={() => { onChange(undefined); setMsg({ text: "Postprocessor removed" }); }}>Remove</button>}
        </div>
        {pp && (
          <label className="ncout-ext"><span>File extension</span>
            <input className="field" value={pp.extension} spellCheck={false}
              onChange={(e) => onChange({ ...pp, extension: e.target.value.trim() ? (e.target.value.trim().startsWith(".") ? e.target.value.trim() : "." + e.target.value.trim()) : "" })} />
          </label>
        )}
        {msg && <p className={`tech-msg${msg.bad ? " is-bad" : ""}`} role="status">{msg.text}</p>}
      </section>

      {pp && result && (
        <section className="rule">
          <h3>Try it</h3>
          <p className="rule-help">A 200 × 100 mm plate with a Ø30 hole and a slot, cut with {"name" in tech.tech && tech.tech.name ? `${tech.tech.name}, ${tech.thickness} mm` : "sample values"}.</p>
          {result.ok
            ? <pre className="ncout-pre">{result.text}</pre>
            : <p className="tech-msg is-bad">{result.error}</p>}
          <div className="mc-row">
            {result.ok && <button type="button" className="btn btn-plain" onClick={() => download(`SAMPLE${pp.extension}`, result.text, "text/plain")}>Download the sample</button>}
            {result.ok && <button type="button" className="btn btn-plain" title="As a real NC program goes: to the machine's NC folder (Machine → Folders)"
              onClick={() => saveNcFile(machine, `SAMPLE${pp.extension}`, result.text).then((t) => setTryMsg({ text: t }), (e: Error) => setTryMsg({ text: e.message, bad: true }))}>Save to the NC folder</button>}
            <button type="button" className="btn btn-plain" onClick={() => setShowSource((v) => !v)}>{showSource ? "Hide the source" : "Show the source"}</button>
          </div>
          {tryMsg && <p className={`tech-msg${tryMsg.bad ? " is-bad" : ""}`} role="status">{tryMsg.text}</p>}
          {showSource && <pre className="ncout-pre is-src">{pp.source}</pre>}
        </section>
      )}
    </div>
  );
}
