import { useMemo, useRef, useState } from "react";
import type { JobPart, PartSummary } from "../api/types";
import { IconClose, IconLibrary } from "../components/Icons";
import { usePickLists } from "../components/pickLists";
import { PARTS_MIME } from "../shell/Drawer";
import { readDxf } from "../import/dxf";
import { boxOf, union } from "../import/geometry";
import { DEFAULT_SIZES, STOCK_SOURCES, newSheet, sheetKey, type StockSheet, type StockSource } from "../job/stock";

interface Props {
  title: string;
  parts: JobPart[] | undefined;                 // undefined = loading
  stock: StockSheet[];
  onStock: (stock: StockSheet[]) => void;
  onDropParts: (parts: PartSummary[]) => void;
  onPart: (partId: string, patch: Partial<Pick<JobPart, "qty" | "qtyMax">>) => void;
  onRemove: (partId: string) => void;
  onOpenParts: () => void;
  onNotice: (text: string) => void;
}

type Col = "no" | "project" | "name" | "material" | "thickness" | "qty" | "nested" | "qtyMax";
const COLS: { id: Col; label: string; num?: boolean; title?: string }[] = [
  { id: "no", label: "ID", num: true },
  { id: "project", label: "Project" },
  { id: "name", label: "Part name" },
  { id: "material", label: "Material" },
  { id: "thickness", label: "Thickness", num: true },
  { id: "qty", label: "Qty req", num: true, title: "Requested: setting it also sets Qty max" },
  { id: "nested", label: "Qty nested", num: true, title: "On the nest now: green when the requested number is reached" },
  { id: "qtyMax", label: "Qty max", num: true, title: "Nesting may add copies up to this into space that would be scrap" },
];

const value = (jp: JobPart, c: Col): string | number => {
  switch (c) {
    case "no": return jp.no ?? 0;
    case "project": return jp.part.project;
    case "name": return jp.part.name;
    case "material": return jp.part.material;
    case "thickness": return jp.part.thicknessMm;
    case "qty": return jp.qty;
    case "nested": return jp.nested ?? 0;
    case "qtyMax": return jp.qtyMax ?? jp.qty;
  }
};

/** A number field that is edited freely and checked when it is left (Enter or leaving the field). */
function NumInput({ value, min = 0, int = false, onCommit, className = "field", ...rest }: {
  value: number; min?: number; int?: boolean; onCommit: (n: number) => void; className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "min">) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = Number(draft.replace(",", "."));
    onCommit(Number.isFinite(n) && draft.trim() !== "" ? Math.max(min, int ? Math.round(n) : n) : value);
    setDraft(null);
  };
  return (
    <input {...rest} className={className} inputMode={int ? "numeric" : "decimal"}
      value={draft ?? (value ? String(value) : "")}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setDraft(null); (e.target as HTMLInputElement).blur(); } }} />
  );
}

// Work parts screen of a job: the job part list (left) and the stock sheets (right).
export function JobPage({ title, parts, stock, onStock, onDropParts, onPart, onRemove, onOpenParts, onNotice }: Props) {
  const [over, setOver] = useState(false);
  const [sort, setSort] = useState<{ col: Col; dir: 1 | -1 }>({ col: "no", dir: 1 });

  const rows = useMemo(() => {
    const list = [...(parts ?? [])];
    list.sort((a, b) => {
      const x = value(a, sort.col), y = value(b, sort.col);
      const r = typeof x === "number" && typeof y === "number" ? x - y
        : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: "base" });
      return (r || (a.no ?? 0) - (b.no ?? 0)) * sort.dir;
    });
    return list;
  }, [parts, sort]);

  const total = (parts ?? []).reduce((s, jp) => s + jp.qty, 0);
  const accepts = (e: React.DragEvent) => e.dataTransfer.types.includes(PARTS_MIME);

  return (
    <div className="work">
      <section
        className={`work-list${over ? " is-drop-target" : ""}`}
        aria-label="Job part list"
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
        <header className="work-head">
          <h2>Job part list</h2>
          <span className="work-sum">{title}{parts && parts.length > 0 && ` · ${parts.length} parts, ${total} pieces`}</span>
        </header>

        {parts === undefined && <p className="state">Loading parts…</p>}
        {parts && parts.length === 0 && (
          <div className="drop-empty">
            <IconLibrary size={40} />
            <p><b>Drag parts here</b> from Imported parts on the left.</p>
            <button className="btn btn-primary" onClick={onOpenParts}>Show imported parts</button>
          </div>
        )}
        {parts && parts.length > 0 && (
          <div className="work-scroll">
            <table className="grid work-grid">
              <thead>
                <tr>
                  {COLS.map((c) => (
                    <th key={c.id} className={c.num ? "num" : undefined} title={c.title}
                      aria-sort={sort.col === c.id ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
                      <button type="button" className={`th-sort${sort.col === c.id ? " is-on" : ""}`}
                        onClick={() => setSort((s) => ({ col: c.id, dir: s.col === c.id ? (-s.dir as 1 | -1) : 1 }))}>
                        {c.label}{sort.col === c.id && <span aria-hidden="true">{sort.dir === 1 ? " ▲" : " ▼"}</span>}
                      </button>
                    </th>
                  ))}
                  <th aria-label="Remove" />
                </tr>
              </thead>
              <tbody>
                {rows.map((jp) => {
                  const nested = jp.nested ?? 0;
                  const max = jp.qtyMax ?? jp.qty;
                  return (
                    <tr key={jp.part.id}>
                      <td className="num cell-no">{jp.no}</td>
                      <td>{jp.part.project}</td>
                      <td className="cell-name">{jp.part.name}</td>
                      <td>{jp.part.material}</td>
                      <td className="num">{jp.part.thicknessMm} mm</td>
                      <td className="num">
                        <NumInput className="field qty" int min={1} value={jp.qty} aria-label={`Requested quantity of ${jp.part.name}`}
                          onCommit={(q) => onPart(jp.part.id, { qty: q, qtyMax: q })} />
                      </td>
                      <td className={`num cell-nested ${nested >= jp.qty ? "is-done" : "is-short"}`}
                        title={nested >= jp.qty ? "Requested number nested" : `${jp.qty - nested} more to nest`}>{nested}</td>
                      <td className="num">
                        <NumInput className="field qty" int min={jp.qty} value={max} aria-label={`Maximum quantity of ${jp.part.name}`}
                          title="At least the requested number" onCommit={(m) => onPart(jp.part.id, { qtyMax: m })} />
                      </td>
                      <td>
                        <button className="icon-btn" onClick={() => onRemove(jp.part.id)} aria-label={`Remove ${jp.part.name}`} title="Remove from job">
                          <IconClose size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {over && <div className="drop-veil" aria-hidden="true"><span>Drop to add to {title}</span></div>}
      </section>

      <StockPanel parts={parts ?? []} stock={stock} onStock={onStock} onNotice={onNotice} />
    </div>
  );
}

function StockPanel({ parts, stock, onStock, onNotice }: {
  parts: JobPart[]; stock: StockSheet[]; onStock: (s: StockSheet[]) => void; onNotice: (t: string) => void;
}) {
  const [from, setFrom] = useState<StockSource>("parts");
  const file = useRef<HTMLInputElement>(null);
  const lists = usePickLists("");
  const materials = useMemo(() => [...new Set([...parts.map((p) => p.part.material), ...lists.materials.map((m) => m.value)])]
    .filter(Boolean).sort((a, b) => a.localeCompare(b)), [parts, lists.materials]);

  // material / thickness pairs of the part list, and the first one with no sheet yet
  const jobPairs = useMemo(() => {
    const m = new Map<string, { material: string; thicknessMm: number }>();
    for (const jp of parts) m.set(sheetKey(jp.part.material, jp.part.thicknessMm), { material: jp.part.material, thicknessMm: jp.part.thicknessMm });
    return [...m.values()];
  }, [parts]);
  const covered = new Set(stock.map((s) => sheetKey(s.material, s.thicknessMm)));
  const nextPair = () => jobPairs.find((p) => !covered.has(sheetKey(p.material, p.thicknessMm))) ?? jobPairs[0] ?? { material: "", thicknessMm: 0 };

  const add = () => {
    if (from === "parts") {
      const missing = jobPairs.filter((p) => !covered.has(sheetKey(p.material, p.thicknessMm)));
      if (!jobPairs.length) { onNotice("The job part list is empty: add parts first"); return; }
      if (!missing.length) { onNotice("Every material and thickness of the part list has a sheet already"); return; }
      const [l, w] = DEFAULT_SIZES.default1;
      onStock([...stock, ...missing.map((p) => newSheet({ source: "parts", ...p, lengthMm: l, widthMm: w, qty: 1, unlimited: true }))]);
      return;
    }
    if (from === "dxf") { file.current?.click(); return; }
    if (from === "remnant") {
      // until the remnant store exists: a sheet to fill in, one piece
      onStock([...stock, newSheet({ source: "remnant", ...nextPair(), lengthMm: 0, widthMm: 0, qty: 1, unlimited: false })]);
      return;
    }
    const [l, w] = DEFAULT_SIZES[from];
    onStock([...stock, newSheet({ source: from, ...nextPair(), lengthMm: l, widthMm: w, qty: 1, unlimited: true })]);
  };

  const fromDxf = async (f: File) => {
    try {
      const { drawing } = readDxf(await f.text(), f.name);
      if (!drawing.entities.length) { onNotice(`${f.name}: no lines to take the sheet size from`); return; }
      const b = drawing.entities.map(boxOf).reduce(union);
      const r = (v: number) => Math.round(v * 10) / 10;
      onStock([...stock, newSheet({
        source: "dxf", ...nextPair(), lengthMm: r(b.maxX - b.minX), widthMm: r(b.maxY - b.minY), qty: 1, unlimited: false,
        fileName: f.name.replace(/\.dxf$/i, ""),
      })]);
    } catch (e) {
      onNotice(`${f.name}: ${(e as Error).message}`);
    }
  };

  const set = (id: string, patch: Partial<StockSheet>) => onStock(stock.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const details = () => onNotice("Sheet properties: coming next");

  return (
    <aside className="stock" aria-label="Stock">
      <h2>Stock</h2>
      <div className="stock-add">
        <select className="field" value={from} aria-label="Add from" title="Add from"
          onChange={(e) => setFrom(e.target.value as StockSource)}>
          {STOCK_SOURCES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.id.startsWith("default") ? `${s.label} (${DEFAULT_SIZES[s.id as keyof typeof DEFAULT_SIZES].join(" × ")})` : s.label}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-quiet stock-add-btn" onClick={add}>Add</button>
        <input ref={file} type="file" accept=".dxf" hidden
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void fromDxf(f); }} />
      </div>

      {stock.length === 0 && <p className="stock-empty">No sheets yet. <b>Job part list</b> adds a sheet for every material and thickness of the parts.</p>}

      <div className="stock-list">
        {stock.map((s, i) => (
          <div key={s.id} className="sheet-card">
            <div className="sheet-row">
              <span className="sheet-name" onDoubleClick={details} title={s.fileName ? `From ${s.fileName}.dxf` : s.source === "remnant" ? "Remnant" : undefined}>
                Sheet {i + 1}
                <button type="button" className="sheet-info" onClick={details} aria-label={`Properties of sheet ${i + 1}`} title="Sheet properties">i</button>
              </span>
              <select className="field sheet-mat" value={s.material} aria-label={`Material of sheet ${i + 1}`}
                onChange={(e) => set(s.id, { material: e.target.value })}>
                {!materials.includes(s.material) && <option value={s.material}>{s.material || "–"}</option>}
                {materials.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <button type="button" className="sheet-del" onClick={() => onStock(stock.filter((x) => x.id !== s.id))}
                aria-label={`Remove sheet ${i + 1}`} title="Remove sheet">×</button>
            </div>
            <div className="sheet-row sheet-dims">
              <NumInput className="field sheet-t" value={s.thicknessMm} placeholder="t" aria-label={`Thickness of sheet ${i + 1} (mm)`}
                title="Thickness [mm]" onCommit={(n) => set(s.id, { thicknessMm: n })} />
              <span className="sheet-x">×</span>
              <NumInput value={s.lengthMm} placeholder="length" aria-label={`Length of sheet ${i + 1} (mm)`}
                title="Length [mm]" onCommit={(n) => set(s.id, { lengthMm: n })} />
              <span className="sheet-x">×</span>
              <NumInput value={s.widthMm} placeholder="width" aria-label={`Width of sheet ${i + 1} (mm)`}
                title="Width [mm]" onCommit={(n) => set(s.id, { widthMm: n })} />
            </div>
            <div className="sheet-row sheet-qty">
              <label>Qty:
                <NumInput int min={1} value={s.qty} disabled={s.unlimited} aria-label={`Quantity of sheet ${i + 1}`}
                  onCommit={(n) => set(s.id, { qty: n })} />
              </label>
              <label className="chk sheet-unl">
                <input type="checkbox" checked={s.unlimited} onChange={(e) => set(s.id, { unlimited: e.target.checked })} />
                Unlimited
              </label>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
