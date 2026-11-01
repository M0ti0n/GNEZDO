import { useMemo, useRef, useState } from "react";
import type { JobPart, PartSummary } from "../api/types";
import { IconClose, IconLibrary } from "../components/Icons";
import { usePickLists } from "../components/pickLists";
import { NumInput } from "../components/NumInput";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { PartPropertiesDialog } from "../components/PartPropertiesDialog";
import { PartHistoryDialog } from "../components/PartHistoryDialog";
import { PARTS_MIME } from "../shell/Drawer";
import { readDxf } from "../import/dxf";
import { boxOf, checkGeometry, union, type Entity } from "../import/geometry";
import { loopPoints } from "../import/toPart";
import { SheetPropertiesDialog } from "../components/SheetPropertiesDialog";
import type { Machine, MachineList } from "../job/machine";
import { partColor } from "../job/nest";
import { MACHINE_LIMIT, STOCK_SOURCES, fitsMachine, newSheet, sheetKey, slotOf, type StockSettings, type StockSheet, type StockSource } from "../job/stock";

interface Props {
  title: string;
  parts: JobPart[] | undefined;                 // undefined = loading
  stock: StockSheet[];
  stockSettings: StockSettings;
  onStock: (stock: StockSheet[]) => void;
  onDropParts: (parts: PartSummary[]) => void;
  onPart: (partId: string, patch: Partial<Pick<JobPart, "qty" | "qtyMax" | "part">>) => void;
  onRemove: (partId: string) => void;
  onOpenParts: () => void;
  onNotice: (text: string) => void;
  /** The machine the job is nested for: gaps of new sheets, 0,0, cutting area. */
  machine: Machine;
  machines: MachineList;
  onMachine: (id: string) => void;
}

/** Nested count against the part's range: short of Qty req, within Qty req..Qty max, or over Qty max. */
function nestState(jp: JobPart): "short" | "ok" | "over" {
  const n = jp.nested ?? 0;
  if (!jp.qty || n < jp.qty) return "short";
  return n > (jp.qtyMax ?? jp.qty) ? "over" : "ok";
}

type Col = "no" | "project" | "name" | "material" | "thickness" | "qty" | "nested" | "qtyMax";
const COLS: { id: Col; label: string; num?: boolean; title?: string }[] = [
  { id: "no", label: "ID", num: true },
  { id: "project", label: "Project" },
  { id: "name", label: "Part name" },
  { id: "material", label: "Material" },
  { id: "thickness", label: "Thickness" },
  { id: "qty", label: "Qty req", num: true, title: "Requested: setting it also sets Qty max" },
  { id: "nested", label: "Qty nested", num: true, title: "On the nest now: green from Qty req up to Qty max, red below or above" },
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

// Work parts screen of a job: the job part list (left) and the stock sheets (right).
export function JobPage({ title, parts, stock, stockSettings, onStock, onDropParts, onPart, onRemove, onOpenParts, onNotice, machine, machines, onMachine }: Props) {
  const [over, setOver] = useState(false);

  // the part's pop-up (double-click its name), and its versions
  const [editing, setEditing] = useState<PartSummary | null>(null);
  const [history, setHistory] = useState<PartSummary | null>(null);
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
  const nestedTotal = (parts ?? []).reduce((s, jp) => s + (jp.nested ?? 0), 0);
  // the job is done when every part is nested at least Qty req and at most Qty max times
  const allNested = (parts ?? []).length > 0 && (parts ?? []).every((jp) => nestState(jp) === "ok");

  // Moving around the list as in a spreadsheet: arrows move from cell to cell (in a number field
  // left / right move once the caret is at its edge or all of it is selected), Enter moves down
  // (Shift+Enter up), Home / End to the row's first / last cell, Ctrl+Home / Ctrl+End to the corners.
  const onGridKey = (e: React.KeyboardEvent<HTMLTableSectionElement>) => {
    const target = e.target as HTMLElement;
    const td = target.closest<HTMLTableCellElement>("td[data-c]");
    if (!td || e.altKey || e.metaKey) return;
    const tr = td.parentElement as HTMLTableRowElement;
    const body = e.currentTarget;
    const nR = body.rows.length, nC = tr.cells.length;
    let r = tr.sectionRowIndex, c = td.cellIndex;
    const input = target instanceof HTMLInputElement ? target : null;
    const all = !!input && input.selectionStart === 0 && input.selectionEnd === input.value.length;
    const atStart = !input || all || (input.selectionStart === 0 && input.selectionEnd === 0);
    const atEnd = !input || all || input.selectionStart === input.value.length;
    switch (e.key) {
      case "ArrowUp": r--; break;
      case "ArrowDown": r++; break;
      case "ArrowLeft": if (!atStart) return; c--; break;
      case "ArrowRight": if (!atEnd) return; c++; break;
      case "Enter": r += e.shiftKey ? -1 : 1; break;
      case "Home": if (input && !all && !e.ctrlKey) return; c = 0; if (e.ctrlKey) r = 0; break;
      case "End": if (input && !all && !e.ctrlKey) return; c = nC - 1; if (e.ctrlKey) r = nR - 1; break;
      case "Escape": if (input) setTimeout(() => input.focus(), 0); return;
      default: return;
    }
    r = Math.max(0, Math.min(nR - 1, r));
    c = Math.max(0, Math.min(nC - 1, c));
    e.preventDefault();
    const cell = body.rows[r].cells[c];
    const el = cell.querySelector<HTMLElement>("input, button") ?? cell;
    el.focus({ preventScroll: true });
    cell.scrollIntoView({ block: "nearest", inline: "nearest" });
  };
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
          <span className="work-sum">{title}{parts && parts.length > 0 && ` · ${parts.length} ${parts.length === 1 ? "part" : "parts"}`}</span>
          <label className="work-machine" title="The machine this job is nested for">
            <span>Machine</span>
            <select className="field" value={machine.id} onChange={(e) => onMachine(e.target.value)} aria-label="Machine">
              {machines.list.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          {parts && parts.length > 0 && (
            <span className={`work-pcs ${allNested ? "is-done" : "is-short"}`}
              title="Pieces nested / pieces required (green when every part is between its Qty req and Qty max)">{nestedTotal} / {total} PCS</span>
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
        {parts && parts.length > 0 && (
          <div className="work-scroll">
            <table className="grid work-grid">
              <colgroup>
                {/* material and thickness narrow and side by side; the room goes to project and part name */}
                <col style={{ width: 68 }} /><col style={{ width: "16%" }} /><col />
                <col style={{ width: 104 }} /><col style={{ width: 76 }} />
                <col style={{ width: 84 }} /><col style={{ width: 92 }} /><col style={{ width: 84 }} /><col style={{ width: 42 }} />
              </colgroup>
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
              <tbody onKeyDown={onGridKey}>
                {rows.map((jp) => {
                  const nested = jp.nested ?? 0;
                  const max = jp.qtyMax ?? jp.qty;
                  return (
                    <tr key={jp.part.id}>
                      <td data-c={0} tabIndex={-1} className="num cell-no" title="ID; the colour shows this part on the nested sheets">
                        <span className="part-swatch" style={{ background: partColor(jp.no).fill, borderColor: partColor(jp.no).stroke }} />{jp.no}</td>
                      <td data-c={1} tabIndex={-1}>{jp.part.project}</td>
                      <td data-c={2} tabIndex={-1} className="cell-name" title={`${jp.part.name}: double-click for its properties`}
                        onDoubleClick={() => setEditing(jp.part)}>{jp.part.name}</td>
                      <td data-c={3} tabIndex={-1}>{jp.part.material}</td>
                      <td data-c={4} tabIndex={-1}>{jp.part.thicknessMm} mm</td>
                      <td data-c={5} className="num">
                        <NumInput className={`field qty${jp.qty ? "" : " is-required"}`} int min={0} value={jp.qty} placeholder="set"
                          title={jp.qty ? undefined : "Set the number of pieces needed"} aria-label={`Requested quantity of ${jp.part.name}`}
                          onCommit={(q) => onPart(jp.part.id, { qty: q, qtyMax: q })} />
                      </td>
                      <td data-c={6} tabIndex={-1} className={`num cell-nested ${nestState(jp) === "ok" ? "is-done" : "is-short"}`}
                        title={!jp.qty ? "Qty req is not set"
                          : nested < jp.qty ? `${jp.qty - nested} more to nest`
                          : nested > max ? `${nested - max} more than Qty max`
                          : "Between Qty req and Qty max"}>{nested}</td>
                      <td data-c={7} className="num">
                        <NumInput className="field qty" int min={jp.qty} value={max} aria-label={`Maximum quantity of ${jp.part.name}`}
                          title="At least the requested number" onCommit={(m) => onPart(jp.part.id, { qtyMax: m })} />
                      </td>
                      <td data-c={8}>
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

      {editing && (
        <PartPropertiesDialog part={editing} onClose={() => setEditing(null)}
          onSaved={(now) => onPart(now.id, { part: now })}
          onDeleted={(id) => onRemove(id)}
          onVersions={(p) => { setEditing(null); setHistory(p); }} />
      )}
      {history && (
        <PartHistoryDialog part={history} onClose={() => setHistory(null)}
          onRestored={(now) => { onPart(now.id, { part: now }); setHistory(now); }} />
      )}

      <StockPanel parts={parts ?? []} stock={stock} settings={stockSettings} onStock={onStock} onNotice={onNotice} machine={machine} />
    </div>
  );
}

const optionLabel = (id: StockSource, label: string, st: StockSettings) => {
  if (id === "parts") return `${label} (${st.globalLengthMm} × ${st.globalWidthMm})`;
  const sl = slotOf(st, id);
  if (!sl) return label;
  return `${label}: ${[sl.material.trim(), `${sl.lengthMm} × ${sl.widthMm}`].filter(Boolean).join(" ")}`;
};

function StockPanel({ parts, stock, settings, onStock, onNotice, machine }: {
  parts: JobPart[]; stock: StockSheet[]; settings: StockSettings; onStock: (s: StockSheet[]) => void; onNotice: (t: string) => void; machine: Machine;
}) {
  // a new sheet starts with the job's machine's gaps
  const gaps = { trims: { ...machine.trims }, partGapMm: machine.partGapMm, kerfMm: machine.kerfMm || undefined };
  const [props, setProps] = useState<number | null>(null);   // sheet shown in Sheet properties
  const [from, setFrom] = useState<StockSource>("parts");
  const file = useRef<HTMLInputElement>(null);
  const [tooBig, setTooBig] = useState<{ file: string; l: number; w: number } | null>(null);
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
      // one sheet per material and thickness of the list, at the global sheet size (Settings -> Stock)
      const l = settings.globalLengthMm, w = settings.globalWidthMm;
      onStock([...stock, ...missing.map((p) => newSheet({ ...gaps, source: "parts", ...p, lengthMm: l, widthMm: w, qty: 1, unlimited: true }))]);
      return;
    }
    if (from === "dxf") { file.current?.click(); return; }
    if (from === "remnant") {
      // until the remnant store exists: a sheet to fill in, one piece
      onStock([...stock, newSheet({ ...gaps, source: "remnant", ...nextPair(), lengthMm: 0, widthMm: 0, qty: 1, unlimited: false })]);
      return;
    }
    // a default slot: its size and material; the thickness from the part list (first one of that
    // material with no sheet yet), or empty to fill in
    const slot = slotOf(settings, from);
    if (!slot) return;
    let pair = nextPair();
    if (slot.material.trim()) {
      const same = jobPairs.filter((p) => p.material.trim().toLowerCase() === slot.material.trim().toLowerCase());
      const t = (same.find((p) => !covered.has(sheetKey(p.material, p.thicknessMm))) ?? same[0])?.thicknessMm ?? 0;
      pair = { material: slot.material.trim(), thicknessMm: t };
    }
    onStock([...stock, newSheet({ ...gaps, source: from, ...pair, lengthMm: slot.lengthMm, widthMm: slot.widthMm, qty: 1, unlimited: true })]);
  };

  const fromDxf = async (f: File) => {
    try {
      const { drawing } = readDxf(await f.text(), f.name);
      if (!drawing.entities.length) { onNotice(`${f.name}: no lines to take the sheet size from`); return; }
      const b = drawing.entities.map(boxOf).reduce(union);
      const r = (v: number) => Math.round(v * 10) / 10;
      const l = r(b.maxX - b.minX), w = r(b.maxY - b.minY);
      if (!fitsMachine(l, w)) { setTooBig({ file: f.name, l, w }); return; }
      onStock([...stock, newSheet({
        ...gaps, source: "dxf", ...nextPair(), lengthMm: l, widthMm: w, qty: 1, unlimited: false,
        fileName: f.name.replace(/\.dxf$/i, ""), outline: dxfOutline(drawing.entities, b),
      })]);
    } catch (e) {
      onNotice(`${f.name}: ${(e as Error).message}`);
    }
  };

  const set = (id: string, patch: Partial<StockSheet>) => onStock(stock.map((s) => (s.id === id ? { ...s, ...patch } : s)));


  return (
    <aside className="stock" aria-label="Stock">
      <h2>Stock</h2>
      <div className="stock-add">
        <select className="field" value={from} aria-label="Add from" title="Add from"
          onChange={(e) => setFrom(e.target.value as StockSource)}>
          {STOCK_SOURCES.map((s) => (
            <option key={s.id} value={s.id}>
              {optionLabel(s.id, s.label, settings)}
            </option>
          ))}
        </select>
        <button type="button" className="btn stock-add-btn" onClick={add}>Add</button>
        <input ref={file} type="file" accept=".dxf" hidden
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void fromDxf(f); }} />
      </div>

      {stock.length === 0 && <p className="stock-empty">No sheets yet. <b>Job part list</b> adds a sheet for every material and thickness of the parts.</p>}

      <div className="stock-list">
        {stock.map((s, i) => (
          <div key={s.id} className="sheet-card">
            <div className="sheet-row">
              <span className="sheet-name" onDoubleClick={() => setProps(i)} title={s.fileName ? `From ${s.fileName}.dxf` : s.source === "remnant" ? "Remnant" : undefined}>
                Sheet {i + 1}
                <button type="button" className="sheet-info" onClick={() => setProps(i)} aria-label={`Properties of sheet ${i + 1}`} title="Sheet properties">i</button>
              </span>
              <select className="field sheet-mat" value={s.material} aria-label={`Material of sheet ${i + 1}`}
                onChange={(e) => set(s.id, { material: e.target.value })}>
                {!materials.includes(s.material) && <option value={s.material}>{s.material || "–"}</option>}
                {materials.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <button type="button" className="sheet-del" onClick={() => onStock(stock.filter((x) => x.id !== s.id))}
                aria-label={`Remove sheet ${i + 1}`} title="Remove sheet"><IconClose size={15} /></button>
            </div>
            <div className={`sheet-row sheet-dims${s.lengthMm && s.widthMm && !fitsMachine(s.lengthMm, s.widthMm) ? " is-too-big" : ""}`}
              title={s.lengthMm && s.widthMm && !fitsMachine(s.lengthMm, s.widthMm) ? `Bigger than the machine can cut (${MACHINE_LIMIT.join(" × ")} mm)` : undefined}>
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
      {tooBig && (
        <ConfirmDialog title="Sheet too big for the machine" confirmLabel="OK" notice
          onConfirm={() => setTooBig(null)} onCancel={() => setTooBig(null)}>
          The sheet in <b>{tooBig.file}</b> is {tooBig.l} × {tooBig.w} mm. The machine cuts sheets up to{" "}
          {MACHINE_LIMIT.join(" × ")} mm, so it was not added.
        </ConfirmDialog>
      )}
      {props !== null && stock[props] && (
        <SheetPropertiesDialog sheet={stock[props]} index={props} machine={machine}
          onSave={(now) => onStock(stock.map((x) => (x.id === now.id ? now : x)))} onClose={() => setProps(null)} />
      )}
    </aside>
  );
}

/**
 * A DXF sheet's own shape: its closed contours, mm, y down from the top-left of its extents; the
 * largest is the outline, the others holes. Null for a plain rectangle (the size says it all).
 */
function dxfOutline(entities: Entity[], b: { minX: number; minY: number; maxX: number; maxY: number }): [number, number][][] | undefined {
  const byId = new Map(entities.map((e) => [e.id, e]));
  const area = (p: { x: number; y: number }[]) => Math.abs(p.reduce((a, q, i) => { const r = p[(i + 1) % p.length]; return a + q.x * r.y - r.x * q.y; }, 0)) / 2;
  const loops = checkGeometry(entities.map((e) => ({ ...e, role: "cut" as const }))).contours
    .filter((c) => c.closed).map((c) => loopPoints(c, byId)).filter((p) => p.length > 2)
    .sort((a, c) => area(c) - area(a));
  if (!loops.length) return undefined;
  const r = (v: number) => Math.round(v * 100) / 100;
  const out = loops.map((p) => p.map((q) => [r(q.x - b.minX), r(b.maxY - q.y)] as [number, number]));
  const rect = out.length === 1 && out[0].length === 4 && area(loops[0]) >= 0.999 * (b.maxX - b.minX) * (b.maxY - b.minY);
  return rect ? undefined : out;
}
