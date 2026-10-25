import { useMemo, useState } from "react";
import { materialKey } from "../api/api";
import type { JobPart, PartSummary } from "../api/types";
import { IconClose, IconLibrary } from "../components/Icons";
import { PartThumb, sizeLabel } from "../components/PartThumb";
import { PARTS_MIME } from "../shell/Drawer";

interface Props {
  title: string;
  parts: JobPart[] | undefined;                 // undefined = loading
  onDropParts: (parts: PartSummary[]) => void;
  onQty: (partId: string, qty: number) => void;
  onRemove: (partId: string) => void;
  onOpenParts: () => void;
}

// Job tab, first version: the part list of the job. Parts are dropped in
// from the Imported parts panel. Nesting, processing and report follow.
export function JobPage({ title, parts, onDropParts, onQty, onRemove, onOpenParts }: Props) {
  const [over, setOver] = useState(false);

  const groups = useMemo(() => {
    const m = new Map<string, JobPart[]>();
    for (const jp of parts ?? []) {
      const k = materialKey(jp.part.material, jp.part.thicknessMm);
      m.set(k, [...(m.get(k) ?? []), jp]);
    }
    return [...m.entries()];
  }, [parts]);

  const total = (parts ?? []).reduce((s, jp) => s + jp.qty, 0);

  const accepts = (e: React.DragEvent) => e.dataTransfer.types.includes(PARTS_MIME);

  return (
    <div
      className={`job${over ? " is-drop-target" : ""}`}
      onDragEnter={(e) => { if (accepts(e)) { e.preventDefault(); setOver(true); } }}
      onDragOver={(e) => { if (accepts(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }}
      onDrop={(e) => {
        setOver(false);
        const raw = e.dataTransfer.getData(PARTS_MIME);
        if (!raw) return;
        e.preventDefault();
        onDropParts(JSON.parse(raw) as PartSummary[]);
      }}
    >
      <header className="job-head">
        <h1>{title}</h1>
        {parts && parts.length > 0 && (
          <span className="job-sum">{parts.length} part types, {total} parts, {groups.length} {groups.length === 1 ? "material" : "materials"}</span>
        )}
      </header>

      {parts === undefined && <p className="state">Loading parts…</p>}

      {parts && parts.length === 0 && (
        <div className="drop-empty">
          <IconLibrary size={40} />
          <p><b>Drag parts here</b> from Imported parts on the left.</p>
          <button className="btn btn-primary" onClick={onOpenParts}>Show imported parts</button>
        </div>
      )}

      {groups.map(([mat, rows]) => (
        <section key={mat} className="job-group">
          <h2>{mat} <span>{rows.length} types, {rows.reduce((s, r) => s + r.qty, 0)} parts</span></h2>
          <table className="grid">
            <thead>
              <tr><th aria-label="Shape" /><th>Part</th><th>Project</th><th className="num">Size [mm]</th><th className="num">Qty</th><th aria-label="Remove" /></tr>
            </thead>
            <tbody>
              {rows.map(({ part, qty }) => (
                <tr key={part.id}>
                  <td className="cell-thumb"><PartThumb part={part} size={36} /></td>
                  <td className="cell-name">{part.name}</td>
                  <td>{part.project}</td>
                  <td className="num">{sizeLabel(part)}</td>
                  <td className="num">
                    <input className="qty" type="number" min={1} value={qty} aria-label={`Quantity of ${part.name}`}
                      onChange={(e) => onQty(part.id, Math.max(1, Number(e.target.value) || 1))} />
                  </td>
                  <td>
                    <button className="icon-btn" onClick={() => onRemove(part.id)} aria-label={`Remove ${part.name}`} title="Remove from job">
                      <IconClose size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      {over && <div className="drop-veil" aria-hidden="true"><span>Drop to add to {title}</span></div>}
    </div>
  );
}
