import { useState } from "react";
import { COLOUR_ROLES, DEFAULT_RULES, ROTATIONS, type ImportRules } from "../import/rules";

type Section = "import" | "nesting";

const SECTIONS: { id: Section; label: string; ready: boolean }[] = [
  { id: "import", label: "Import rules", ready: true },
  { id: "nesting", label: "Nesting rules", ready: false },
];

const ROLE_NAME = { cut: "Cutting", trace: "Tracing", openCut: "Open cut" } as const;

// GNEZDO menu -> Rules. Import rules decide how new drawings are read.
export function RulesPage({ rules, onChange }: { rules: ImportRules; onChange: (r: ImportRules) => void }) {
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
      </nav>

      <div className="settings-main">
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
              <p className="rule-help">Parts of layer names, separated by commas, upper or lower case. A layer called <code>MARKING_1</code> matches <code>MARK</code>. Layer names win over colours.</p>
            </div>
          )}
        </section>

        <section className="rule">
          <label className="rule-check">
            <input type="checkbox" checked={rules.coloursAsCuts} onChange={(e) => set({ coloursAsCuts: e.target.checked })} />
            <span><b>Treat different colours as different cuts</b>
              <small>Line colours from the drawing decide what the laser does.</small></span>
          </label>
          {rules.coloursAsCuts && (
            <div className="rule-sub">
              <ul className="colour-map">
                <li>
                  <span className="shades"><i style={{ background: "#1b1b1b" }} /><i style={{ background: "#fff" }} /><i style={{ background: "#8c8c8c" }} /></span>
                  <span>Black, white and greys</span><span className="arrow">→</span><b>Cutting</b>
                </li>
                {COLOUR_ROLES.map((c) => (
                  <li key={c.name}>
                    <span className="shades">
                      {(rules.exactColours ? c.shades.slice(0, 1) : c.shades).map((css) => <i key={css} style={{ background: css }} />)}
                    </span>
                    <span>{rules.exactColours ? `${c.name.split(" ")[0].replace(/s$/, "")} (colour ${c.aci}) only` : `${c.name}, any shade`}</span>
                    <span className="arrow">→</span>
                    <b className={`role-${c.role}`}>{ROLE_NAME[c.role]}</b>
                  </li>
                ))}
                <li className="colour-other">
                  <span className="shades"><i /></span>
                  <span>Other colours (blue, yellow …)</span><span className="arrow">→</span><b>Cutting</b>
                </li>
              </ul>
              <label className="rule-check rule-check-small">
                <input type="checkbox" checked={rules.exactColours} onChange={(e) => set({ exactColours: e.target.checked })} />
                <span><b>Exact colours only</b>
                  <small>Only the basic colours red (1), green (3) and cyan (4) count. Off: dark, light and True Color (RGB) shades count too, e.g. a darker green that plots better on paper.</small></span>
              </label>
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
      </div>
    </div>
  );
}
