import { useState } from "react";
import { NavClose } from "./NavClose";
import { NumInput } from "../components/NumInput";
import { DEFAULT_RULES, ROTATIONS, type ImportRules } from "../import/rules";
import { ColourLists } from "./ColourLists";
import { DEFAULT_NESTING_RULES, SEARCH_GROWTH_MAX, SEARCH_GROWTH_MIN, loadNestingRules, saveNestingRules, type NestingRules } from "../job/nestRules";

type Section = "import" | "nesting";

const SECTIONS: { id: Section; label: string; ready: boolean }[] = [
  { id: "import", label: "Import rules", ready: true },
  { id: "nesting", label: "Nesting rules", ready: true },
];


// GNEZDO menu -> Rules. Import rules decide how new drawings are read; nesting rules how parts are nested.
export function RulesPage({ rules, onChange, onClose }: { rules: ImportRules; onChange: (r: ImportRules) => void; onClose?: () => void }) {
  const [section, setSection] = useState<Section>("import");
  const set = (patch: Partial<ImportRules>) => onChange({ ...rules, ...patch });

  return (
    <div className="settings">
      <nav className="settings-nav" aria-label="Rules">
        <h1>Rules</h1>
        {SECTIONS.map((s) => (
          <button key={s.id} className={`settings-link${section === s.id ? " is-on" : ""}`} disabled={!s.ready}
            onClick={() => setSection(s.id)} title={s.ready ? undefined : "Not built yet"}>
            {s.label}
          </button>
        ))}
        {onClose && <NavClose onClose={onClose} />}
      </nav>

      {section === "nesting" ? <NestingRulesPane /> : <div className="settings-main">
        <header className="settings-head">
          <h2>Import rules</h2>
          <p>How new drawings are read. Changes apply to files imported from now on; parts already in the import list keep their lines.</p>
        </header>

        <section className="rule">
          <label className="rule-check">
            <input type="checkbox" checked={rules.mirrorWithoutOpenCut} onChange={(e) => set({ mirrorWithoutOpenCut: e.target.checked })} />
            <span><b>Allow mirror for parts without open cut</b>
              <small>Mirror is ticked by default on import. Parts that have open cut lines are never mirrored.</small></span>
          </label>
        </section>

        <section className="rule">
          <label className="rule-check">
            <input type="checkbox" checked={rules.qtyFromName} onChange={(e) => set({ qtyFromName: e.target.checked })} />
            <span><b>Take the number of pieces from the file name</b>
              <small>The last number in the file name is the number of pieces needed, e.g. <code>1625-25-01_P1_3pcs</code> → 3. It is shown
                in Parts and becomes Qty req when the part is added to a job. Off: nothing is taken from the name, and Qty req starts at 0
                in the job, to be set by hand.</small></span>
          </label>
        </section>

        <section className="rule">
          <h3>Default rotations</h3>
          <p className="rule-help">Ticked in the import Properties for every new list. Can be changed per import.</p>
          <div className="rule-row">
            {ROTATIONS.map((r) => (
              <label key={r} className="chk chk-box">
                <input type="checkbox" checked={rules.defaultRotations.includes(r)}
                  onChange={(e) => set({
                    defaultRotations: e.target.checked
                      ? ROTATIONS.filter((x) => x === r || rules.defaultRotations.includes(x))
                      : rules.defaultRotations.filter((x) => x !== r),
                  })} />
                {r}°
              </label>
            ))}
          </div>
        </section>

        <section className="rule">
          <label className="rule-check">
            <input type="checkbox" checked={rules.defaultFiller} onChange={(e) => set({ defaultFiller: e.target.checked })} />
            <span><b>Filler ticked by default</b>
              <small>Fillers are parts cut often and in bulk, not for one project and quantity. Nesting puts them only into gaps
                left among the other parts, so material is not wasted, but never adds a sheet for them or fills the empty end of the last sheet.
                Can be changed per import and per part.</small></span>
          </label>
        </section>

        <section className="rule">
          <label className="rule-check">
            <input type="checkbox" checked={rules.commonOnOutline} onChange={(e) => set({ commonOnOutline: e.target.checked })} />
            <span><b>Common cut on every straight outline line</b>
              <small>Each straight line of a part&apos;s outline becomes a common cut line, and Common cut is ticked in the import Properties,
                so parts can share an edge with their neighbours without marking lines by hand. Holes are left out. Common cut is still chosen
                job by job (Custom nest, or the snapping key in Manual nest). Lines can be unmarked per part with the Common cut tool.</small></span>
          </label>
        </section>

        <section className="rule">
          <label className="rule-check">
            <input type="checkbox" checked={rules.allLayersAsOne} onChange={(e) => set({ allLayersAsOne: e.target.checked })} />
            <span><b>Treat all layers as one layer</b>
              <small>Layer names are ignored. If a part is drawn on different layers, mark the tracing and open cut lines by hand.</small></span>
          </label>
          {!rules.allLayersAsOne && (
            <div className="rule-sub">
              <label className="rule-field">
                <span>Tracing layers</span>
                <input className="field" value={rules.traceLayers} onChange={(e) => set({ traceLayers: e.target.value })} />
              </label>
              <label className="rule-field">
                <span>Open cut layers</span>
                <input className="field" value={rules.openCutLayers} onChange={(e) => set({ openCutLayers: e.target.value })} />
              </label>
              <p className="rule-help">Parts of layer names, separated by commas, upper or lower case. A layer called <code>MARKING_1</code> matches <code>MARK</code>. Layer names win over colors.</p>
            </div>
          )}
        </section>

        <section className="rule">
          <label className="rule-check">
            <input type="checkbox" checked={rules.coloursAsCuts} onChange={(e) => set({ coloursAsCuts: e.target.checked })} />
            <span><b>Treat different colors as different cuts</b>
              <small>Line colors from the drawing decide what the laser does: each list below says which colors mean what.
                Layer names (above) win over colors.</small></span>
          </label>
          {rules.coloursAsCuts && (
            <div className="rule-sub">
              <ColourLists value={rules.colours} onChange={(colours) => set({ colours })} />
            </div>
          )}
        </section>

        <section className="rule rule-fixed">
          <h3>Always checked before processing</h3>
          <ul>
            <li>Cutting contours are closed: outside and inside (windows, holes).</li>
            <li>Tracing and open cut lines lie inside the part, not outside it and not inside a window.</li>
          </ul>
        </section>

        <footer className="settings-foot">
          Saved in this browser.{" "}
          <button className="link" onClick={() => onChange(DEFAULT_RULES)}>Reset to defaults</button>
        </footer>
      </div>}
    </div>
  );
}

function NestingRulesPane() {
  const [r, setR] = useState<NestingRules>(loadNestingRules);
  const set = (n: NestingRules) => { setR(n); saveNestingRules(n); };
  return (
    <div className="settings-main">
      <header className="settings-head">
        <h2>Nesting rules</h2>
        <p>How parts are nested. Changes apply from the next use.</p>
      </header>

      <section className="rule">
        <h3>Manual nest</h3>
        <label className="rule-check">
          <input type="checkbox" checked={r.arrangeToOrigin} onChange={(e) => set({ ...r, arrangeToOrigin: e.target.checked })} />
          <span><b>Arrange moves the parts towards the machine's 0,0</b>
            <small>On: the selected parts are nested into the free space nearest 0,0, also into gaps among other parts, so they may
              move across the sheet. Off: they are packed together where they are, from the corner of the selection nearest 0,0.</small></span>
        </label>
      </section>

      <section className="rule">
        <h3>Automatic nest</h3>
        <label className="rule-field">
          <span>Search step</span>
          <span className="rule-num">
            {/* taken when the field is left (Enter): clamping every keystroke turned "1.33" into 1.23 */}
            <NumInput className="field" value={r.searchGrowth} min={SEARCH_GROWTH_MIN} aria-label="Search step"
              onCommit={(n) => set({ ...r, searchGrowth: Math.min(SEARCH_GROWTH_MAX, Math.max(SEARCH_GROWTH_MIN, Math.round(n * 100) / 100)) })} /> ×
          </span>
        </label>
        <p className="rule-help">The nest searches in rounds, each this many times wider than the last. Smaller: more, shorter rounds, so
          better layouts show up more often and less time is spent in a round that is still unfinished at the end; but the widest rounds
          come later. Larger: the widest rounds sooner, in fewer, longer steps. The last round is always sized to finish in the time
          left. Default 1.5 (PackingSolver's own); on the test job 1.33 gave the same layouts.</p>
      </section>

      <section className="rule">
        <h3>Custom nest: blocks (experimental)</h3>
        <label className="rule-field">
          <span>Block margin</span>
          <span className="rule-num">
            <input className="field" type="number" min={0} max={30} step={1} value={r.blockMarginPct}
              onChange={(e) => { const n = Math.round(Number(e.target.value)); if (Number.isFinite(n)) set({ ...r, blockMarginPct: Math.min(30, Math.max(0, n)) }); }} /> %
          </span>
        </label>
        <p className="rule-help">Before nesting, every big part with pockets (an L, a comb, a slanted plate) gets other parts into its bounding
          box, the biggest that fit first, so it nests as a near-rectangle block. The box may grow by this share of its width or height
          when that fits a bigger part and makes the block fuller. 0: the block stays within the part's own box. Only for a Custom nest
          with Blocks chosen; Fast and Thorough make no blocks.</p>
      </section>

      <footer className="settings-foot">
        Saved in this browser.{" "}
        <button className="link" onClick={() => set(DEFAULT_NESTING_RULES)}>Reset to defaults</button>
      </footer>
    </div>
  );
}
