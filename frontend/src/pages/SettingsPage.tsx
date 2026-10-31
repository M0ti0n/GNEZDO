import { useMemo, useState } from "react";
import { Combobox } from "../components/Combobox";
import { NumInput } from "../components/NumInput";
import { usePickLists } from "../components/pickLists";
import { DEFAULT_STOCK_SETTINGS, MACHINE_LIMIT, fitsMachine, type StockSettings } from "../job/stock";

type Section = "stock" | "machine";
const SECTIONS: { id: Section; label: string; ready: boolean }[] = [
  { id: "stock", label: "Stock", ready: true },
  { id: "machine", label: "Machine", ready: false },
];

// GNEZDO menu -> Settings. Stock: the global sheet size and the three default sheet slots.
export function SettingsPage({ stock, onStock }: { stock: StockSettings; onStock: (s: StockSettings) => void }) {
  const [section, setSection] = useState<Section>("stock");
  const lists = usePickLists("");
  const materials = useMemo(() => lists.materials, [lists.materials]);
  const set = (patch: Partial<StockSettings>) => onStock({ ...stock, ...patch });
  const setSlot = (i: number, patch: Partial<StockSettings["slots"][number]>) =>
    set({ slots: stock.slots.map((s, j) => (j === i ? { ...s, ...patch } : s)) as StockSettings["slots"] });
  const tooBig = (l: number, w: number) => l > 0 && w > 0 && !fitsMachine(l, w);

  return (
    <div className="settings">
      <nav className="settings-nav" aria-label="Settings">
        <h1>Settings</h1>
        {SECTIONS.map((s) => (
          <button key={s.id} className={`settings-link${section === s.id ? " is-on" : ""}`} disabled={!s.ready}
            onClick={() => setSection(s.id)} title={s.ready ? undefined : "Not built yet"}>
            {s.label}
          </button>
        ))}
      </nav>

      <div className="settings-main">
        <header className="settings-head">
          <h2>Stock</h2>
          <p>Sheet sizes the STOCK panel of a job adds. Sizes are length × width in millimeters.</p>
        </header>

        <section className="rule">
          <h3>Global sheet size</h3>
          <p className="rule-help"><b>Add from: Job part list</b> adds a sheet of this size for every material and thickness in the job.</p>
          <div className={`size-row${tooBig(stock.globalLengthMm, stock.globalWidthMm) ? " is-too-big" : ""}`}>
            <NumInput value={stock.globalLengthMm} min={1} aria-label="Global sheet length (mm)" onCommit={(n) => set({ globalLengthMm: n })} />
            <span>×</span>
            <NumInput value={stock.globalWidthMm} min={1} aria-label="Global sheet width (mm)" onCommit={(n) => set({ globalWidthMm: n })} />
            <span className="size-unit">mm</span>
          </div>
        </section>

        <section className="rule">
          <h3>Default sheets</h3>
          <p className="rule-help">The three <b>Default</b> choices of <b>Add from</b>. Material can stay empty: the sheet then takes a material of the job.</p>
          <div className="slot-table" role="table" aria-label="Default sheets">
            <div className="slot-head" role="row"><span /><span>Material</span><span>Size (length × width)</span></div>
            {stock.slots.map((s, i) => (
              <div key={i} className={`slot-row${tooBig(s.lengthMm, s.widthMm) ? " is-too-big" : ""}`} role="row">
                <b>Default {i + 1}</b>
                <Combobox value={s.material} options={materials} placeholder="Any (from the job)" ariaLabel={`Material of default ${i + 1}`}
                  onChange={(v) => setSlot(i, { material: v })} />
                <div className="size-row">
                  <NumInput value={s.lengthMm} min={1} aria-label={`Length of default ${i + 1} (mm)`} onCommit={(n) => setSlot(i, { lengthMm: n })} />
                  <span>×</span>
                  <NumInput value={s.widthMm} min={1} aria-label={`Width of default ${i + 1} (mm)`} onCommit={(n) => setSlot(i, { widthMm: n })} />
                  <span className="size-unit">mm</span>
                </div>
              </div>
            ))}
          </div>
          <p className="rule-help">Red: bigger than the machine can cut ({MACHINE_LIMIT.join(" × ")} mm).</p>
        </section>

        <footer className="settings-foot">
          Saved in this browser.{" "}
          <button className="link" onClick={() => onStock(DEFAULT_STOCK_SETTINGS)}>Reset to defaults</button>
        </footer>
      </div>
    </div>
  );
}
