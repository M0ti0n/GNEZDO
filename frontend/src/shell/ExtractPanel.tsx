import { useMemo, useRef, useState } from "react";
import { PanelHead } from "../components/FilterFields";
import { droppedFiles } from "../import/dropped";
import { KIND_LABEL, KIND_ORDER, type BodyKind, type X3Part } from "../import/step/extract";
import { isStepName } from "../import/step/stepPart";

// 3D EXTRACTOR (left panel): the parts read from STEP files, by kind, with a search. Nothing is saved
// from here: a part's flat pattern is sent to IMPORT 2D (its bubble counts what waits there).

export interface ExtractPanelProps {
  parts: X3Part[];
  /** files being read */
  reading: number;
  onFiles: (files: File[]) => void;
  onOpen: (id: string) => void;
  onRemove: (ids: string[]) => void;
  /** send these parts' flat patterns to IMPORT 2D */
  onSend: (ids: string[]) => void;
  openId: string | null;
}

const HIDE_KEY = "gnezdo.x3HideHardware";
const loadHide = () => { try { return localStorage.getItem(HIDE_KEY) !== "0"; } catch { return true; } };

/** A small picture of the kind. */
function KindIcon({ kind }: { kind: BodyKind }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      {kind === "sheet" && <path {...p} d="M3 15l6-3 12 4-6 3zM9 12V6l12 4v6" />}
      {kind === "surface" && <path {...p} strokeDasharray="2.5 2" d="M3 15l6-3 12 4-6 3zM9 12V6l12 4v6" />}
      {kind === "tube" && <><ellipse {...p} cx="6" cy="12" rx="3" ry="5" /><path {...p} d="M6 7h13M6 17h13" /><ellipse {...p} cx="19" cy="12" rx="3" ry="5" /></>}
      {kind === "profile" && <path {...p} d="M4 6h6v3H7v6h3v3H4zM10 6l10-2v3l-7 1.5M10 18l10-2v-3" />}
      {kind === "other" && <path {...p} d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9" />}
      {kind === "hardware" && <><path {...p} d="M8 3h8l2 3-2 3H8L6 6z" /><path {...p} d="M10 9v11M14 9v11M10 12l4-1M10 15l4-1M10 18l4-1" /></>}
    </svg>
  );
}

export function ExtractPanel(p: ExtractPanelProps & { onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [hide, setHideState] = useState(loadHide);
  const setHide = (v: boolean) => { setHideState(v); try { localStorage.setItem(HIDE_KEY, v ? "1" : "0"); } catch { /* this session */ } };
  const [closed, setClosed] = useState<Set<BodyKind>>(new Set());
  const [over, setOver] = useState(false);
  const [skipped, setSkipped] = useState(0);
  const take = (list: File[]) => {
    const files = list.filter((f) => isStepName(f.name));
    setSkipped(list.length - files.length);
    if (files.length) p.onFiles(files);
  };

  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = useMemo(() => p.parts.filter((x) => words.every((w) => `${x.name} ${x.fileName}`.toLowerCase().includes(w))), [p.parts, q]);
  const hardware = shown.filter((x) => x.kind === "hardware").length;
  const files = new Set(p.parts.map((x) => x.fileName)).size;
  const sheetToSend = p.parts.filter((x) => x.kind === "sheet" && x.step.info.ok && !x.sentTo);
  const waiting = p.parts.filter((x) => x.sentTo).length;

  return (
    <>
      <PanelHead title="3D Extractor" onClose={p.onClose} />
      <div className="imp-body">
        <div className="imp-pick">
          <button type="button" className="btn imp-btn" onClick={() => folderInput.current?.click()} title="Choose a folder: every STEP file in it is read">
            <svg className="imp-pick-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 7.5V18a1.5 1.5 0 0 0 1.5 1.5h15A1.5 1.5 0 0 0 21 18V9a1.5 1.5 0 0 0-1.5-1.5h-7.2L10.4 5H4.5A1.5 1.5 0 0 0 3 6.5Z" />
            </svg>
            Folder
          </button>
          <button type="button" className="btn imp-btn" onClick={() => input.current?.click()} title="Choose STEP files (parts or assemblies), or drop them on the list">
            <svg className="imp-pick-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9" />
            </svg>
            STEP files
          </button>
        </div>
        <input ref={input} type="file" hidden multiple accept=".step,.stp" onChange={(e) => { take([...(e.target.files ?? [])]); e.target.value = ""; }} />
        <input ref={folderInput} type="file" hidden multiple {...{ webkitdirectory: "", directory: "" }} onChange={(e) => { take([...(e.target.files ?? [])]); e.target.value = ""; }} />
        <input className="field x3-search" type="search" placeholder="Search parts" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search parts" />
        <div className="x3-opts">
          <label className="chk" title="Bolts, nuts, washers, pins: by their names (DIN, ISO, M8x20 …) and their shape (small turned parts, small flat rings)">
            <input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} /> Hide hardware{hardware ? ` (${hardware})` : ""}
          </label>
        </div>
      </div>
      <div className="imp-actions x3-actions">
        <button className="btn imp-btn imp-btn-go" disabled={!sheetToSend.length} onClick={() => p.onSend(sheetToSend.map((x) => x.id))}
          title="Send the flat pattern of every sheet metal part not sent yet to IMPORT 2D, with its quantity">
          Send sheet metal to Import 2D{sheetToSend.length > 0 && <span className="imp-btn-count">{sheetToSend.length}</span>}
        </button>
      </div>
      <div className={`imp-drop${over ? " is-over" : ""}`}
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setOver(true); } }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }}
        onDrop={(e) => { e.preventDefault(); setOver(false); void droppedFiles(e.dataTransfer).then(take); }}>
        {skipped > 0 && <p className="imp-note is-skipped">{skipped} {skipped === 1 ? "file was" : "files were"} not STEP and {skipped === 1 ? "was" : "were"} left out.</p>}
        {(p.parts.length > 0 || p.reading > 0) && (
          <div className="result-bar">
            <span className="result-count">
              {p.parts.length} {p.parts.length === 1 ? "part" : "parts"} from {files} {files === 1 ? "file" : "files"}
              {waiting > 0 && <> · <span className="t-ok">{waiting} sent</span></>}
              {p.reading > 0 && <> · reading {p.reading}…</>}
            </span>
            <span className="result-actions"><button className="link" onClick={() => p.onRemove(p.parts.map((x) => x.id))}>Clear list</button></span>
          </div>
        )}
        <div className="imp-list x3-list" role="list" aria-label="3D parts">
          {p.parts.length === 0 && p.reading === 0 && (
            <div className="imp-empty">
              <button type="button" className="imp-choose" onClick={() => input.current?.click()}>
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9" />
                </svg>
                <b>Drop STEP parts or assemblies here</b>
                <span>or click to choose files</span>
              </button>
              <span className="imp-empty-note">Each part of an assembly is listed with its quantity; flat patterns go to Import 2D.</span>
            </div>
          )}
          {KIND_ORDER.map((kind) => {
            if (kind === "hardware" && hide) return null;
            const list = shown.filter((x) => x.kind === kind).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
            if (!list.length) return null;
            const open = !closed.has(kind);
            return (
              <section key={kind} className={`x3-group is-${kind}`}>
                <button type="button" className="x3-ghead" aria-expanded={open}
                  onClick={() => setClosed((s) => { const n = new Set(s); if (n.has(kind)) n.delete(kind); else n.add(kind); return n; })}>
                  <svg className="x3-caret" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
                  <KindIcon kind={kind} /><span>{KIND_LABEL[kind]}</span><span className="x3-gcount">{list.length}</span>
                </button>
                {open && list.map((x) => {
                  const i = x.step.info;
                  const note = [
                    i.thickness ? `${i.thickness} mm` : "",
                    i.ok && i.w ? `${Math.round(i.w)} × ${Math.round(i.h)}` : "",
                    i.bends ? `${i.bends} ${i.bends === 1 ? "bend" : "bends"}` : "",
                    kind === "surface" && !i.ok ? "stitch faces" : "",
                    kind === "sheet" && !i.ok ? "check it" : "",
                    files > 1 ? x.fileName : "",
                  ].filter(Boolean).join(" · ");
                  return (
                    <div key={x.id} role="listitem" className={`imp-row x3-row${p.openId === x.id ? " is-open" : ""}${x.sentTo ? " is-sent" : ""}`}>
                      <button className="imp-main" onDoubleClick={() => p.onOpen(x.id)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); p.onOpen(x.id); } }}
                        title={`${KIND_LABEL[kind]}${x.sentTo ? " · sent to Import 2D" : ""} · double-click to open`}>
                        <span className={`x3-kind${x.sentTo ? " is-sent" : ""}`}>{x.sentTo ? "✓" : <KindIcon kind={kind} />}</span>
                        <span className="imp-name">{x.name}</span>
                        <span className="imp-qty">×{x.qty}</span>
                        {note && <span className="imp-notes">{note}</span>}
                      </button>
                      <button className="icon-btn imp-remove" onClick={() => p.onRemove([x.id])} aria-label={`Remove ${x.name}`} title="Remove from list">×</button>
                    </div>
                  );
                })}
              </section>
            );
          })}
          {hide && hardware > 0 && <p className="imp-note">{hardware} hardware {hardware === 1 ? "part" : "parts"} hidden</p>}
        </div>
        {over && <div className="imp-drop-hint" aria-hidden="true"><b>Drop to read the STEP files</b></div>}
      </div>
    </>
  );
}
