import { ALL_SNAPS, SNAP_KINDS, snapsOn } from "../import/draw";
import { useState } from "react";
import { NumInput } from "../components/NumInput";
import { DEFAULT_RULES, ROTATIONS, SPLINE_TOL_DEFAULT, SPLINE_TOL_MAX, SPLINE_TOL_MIN, splineTolOf, type ImportRules } from "../import/rules";
import { ColourLists } from "./ColourLists";
import { DEFAULT_NESTING_RULES, SEARCH_GROWTH_MAX, SEARCH_GROWTH_MIN, type LastSheetGoal, type NestingRules } from "../job/nestRules";

type Tab = "import" | "nesting";

const TABS: { id: Tab; label: string }[] = [
  { id: "import", label: "Import rules" },
  { id: "nesting", label: "Nesting rules" },
];

const TAB_KEY = "gnezdo.rulesTab";

// Settings -> Rules, a tab each: Import rules decide how new drawings are read; Nesting rules how parts are nested.
/** shared: on the server, for everyone (else this browser: the demo); isAdmin: may change them */
export function RulesTabs({ rules, onChange, nesting, onNesting, shared, isAdmin }: {
  rules: ImportRules; onChange: (r: ImportRules) => void; nesting: NestingRules; onNesting: (r: NestingRules) => void; shared: boolean; isAdmin: boolean;
}) {
  const [tab, setTabState] = useState<Tab>(() => { try { return localStorage.getItem(TAB_KEY) === "nesting" ? "nesting" : "import"; } catch { return "import"; } });
  const setTab = (t: Tab) => { setTabState(t); try { localStorage.setItem(TAB_KEY, t); } catch { /* not kept */ } };
  const set = (patch: Partial<ImportRules>) => onChange({ ...rules, ...patch });

  return (
    <div className="settings-main rules-main">
      <header className="settings-head">
        <h2>Rules</h2>
        <div className="rules-tabs" role="tablist" aria-label="Rules">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? "is-on" : ""} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </div>
        {!isAdmin && <p className="admin-only">Only an admin can change the rules.</p>}
      </header>

      <fieldset className="admin-lock" disabled={!isAdmin}>
      {tab === "nesting" ? <NestingRulesPane r={nesting} set={onNesting} shared={shared} /> : <>
        <p className="rules-lead">How new drawings are read. Changes apply to files imported from now on; parts already in the import list keep their lines.</p>

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
            <span><b>Common cut ticked for new parts</b>
              <small>Common cut is ticked in the import Properties: every straight line of a part&apos;s outline may then be shared with a
                neighbour and cut once (holes and arcs are left out). Lines can be left out per part with the importer&apos;s Common cut tool.
                Common cut is still chosen job by job (Custom nest, the Common cut button or the snapping key in Manual nest). Off by default.</small></span>
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
              <p className="rule-help">Words at the start of a word in the layer name, separated by commas, upper or lower case: <code>MARK</code> matches <code>MARK</code>, <code>MARKING_1</code> and <code>LASER-MARK</code>, but not <code>REMARKS</code>; <code>SIGN</code> does not match <code>DESIGN</code>. Layer names win over colors.</p>
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

        <section className="rule">
          <h3>Splines and short lines to polyline</h3>
          <label className="rule-field">
            <span>Tolerance</span>
            <span className="rule-num">
              <NumInput className="field" value={splineTolOf(rules)} min={SPLINE_TOL_MIN} aria-label="Splines to polyline tolerance (mm)"
                onCommit={(n) => set({ splineTolMm: Math.min(SPLINE_TOL_MAX, Math.max(SPLINE_TOL_MIN, Math.round(n * 1000) / 1000)) })} /> mm
            </span>
          </label>
          <p className="rule-help">Geometry check → Splines → <b>To polyline</b> turns splines into lines and arcs that stay at most this far
            from the spline. The 3D Extractor uses it too, for curves of a flat pattern that come as many short lines (round reliefs across bends): they are joined into lines and arcs. Smaller: closer to the curve, more pieces. Larger: fewer, longer pieces. {SPLINE_TOL_MIN} to {SPLINE_TOL_MAX} mm,
            default {SPLINE_TOL_DEFAULT} mm.</p>
        </section>

        <section className="rule">
          <h3>Snapping while drawing</h3>
          <p className="rule-help">What points snap to on the import canvas (drawing tools, dimensions, offset). Perpendicular and tangent work from the last point placed.</p>
          <div className="rule-row">
            {SNAP_KINDS.map((k) => {
              const now = snapsOn(rules.snaps, rules.snapsKnown), on = now.includes(k.id);
              return (
                <label key={k.id} className="chk chk-box" title={k.tip}>
                  <input type="checkbox" checked={on}
                    onChange={(e) => set({ snaps: e.target.checked ? ALL_SNAPS.filter((x) => x === k.id || now.includes(x)) : now.filter((x) => x !== k.id), snapsKnown: ALL_SNAPS })} />
                  {k.label}
                </label>
              );
            })}
          </div>
        </section>

        <section className="rule rule-fixed">
          <h3>Always checked before processing</h3>
          <ul>
            <li>Cutting contours are closed: outside and inside (windows, holes).</li>
            <li>Tracing and open cut lines lie inside the part, not outside it and not inside a window.</li>
          </ul>
        </section>

        <footer className="settings-foot">
          {shared ? "Saved on the server, for everyone." : "Saved in this browser."}{" "}
          <button className="link" onClick={() => onChange(DEFAULT_RULES)}>Reset to defaults</button>
        </footer>
      </>}
      </fieldset>
    </div>
  );
}

function NestingRulesPane({ r, set, shared }: { r: NestingRules; set: (n: NestingRules) => void; shared: boolean }) {
  return (
    <>
      <p className="rules-lead">How parts are nested. Changes apply from the next use.</p>

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
          <span>Last sheet</span>
          <select className="field" value={r.lastSheet} aria-label="Last sheet" onChange={(e) => set({ ...r, lastSheet: e.target.value as LastSheetGoal })}>
            <option value="box">Smallest box at 0,0</option>
            <option value="x">Shortest along X</option>
            <option value="y">Shortest along Y</option>
          </select>
        </label>
        <p className="rule-help">How the parts of the last sheet (or of the only one) are packed once the nest is done. Smallest box at 0,0: into
          the smallest rectangle from the machine's 0,0, so the rest of the sheet stays usable both ways (as Arrange packs). Shortest along
          X: as short as they can be along X, over the sheet's whole width, leaving a strip of the full width. Shortest along Y: the same
          along Y. Thorough gives this the time its nest did not need.</p>
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
        {shared ? "Saved on the server, for everyone." : "Saved in this browser."}{" "}
        <button className="link" onClick={() => set(DEFAULT_NESTING_RULES)}>Reset to defaults</button>
      </footer>
    </>
  );
}
