import { useState } from "react";
import {
  ACI_RGB, LINE_ROLES, SHADE_WIDTHS, colourConflicts, hexOf, hsvHex, parseHex, rgbHsv, shadeSwatch,
  type ColourEntry, type ColourRules, type LineRole,
} from "../import/rules";

const ROLE_LABEL: Record<LineRole, string> = { cut: "Cut contour", trace: "Trace", openCut: "Open cut" };
const ROLE_HELP: Record<LineRole, string> = {
  cut: "Cut through: outside contours, windows and holes.",
  trace: "Marked, not cut through (engraving, bend lines, labels).",
  openCut: "Cut along an open line (a slit), not a closed contour.",
};

/** A color's everyday name from its hue (for "any shade of" ranges). */
function hueName(h: number): string {
  const names: [number, string][] = [[15, "red"], [40, "orange"], [65, "yellow"], [95, "lime"], [150, "green"], [170, "teal"],
    [195, "cyan"], [225, "light blue"], [255, "blue"], [285, "violet"], [320, "magenta"], [345, "pink"], [360, "red"]];
  return names.find(([to]) => h < to)?.[1] ?? "red";
}

/** What an entry looks like: a swatch and a name. */
function describe(x: ColourEntry): { swatch: string[]; text: string } {
  if (x.kind === "exact") return { swatch: [hexOf(x.rgb)], text: hexOf(x.rgb).toUpperCase() };
  if (x.kind === "aci") return { swatch: [hexOf(ACI_RGB[x.aci])], text: `AutoCAD color ${x.aci}` };
  if (x.kind === "grays") return { swatch: ["#1b1b1b", "#8c8c8c", "#ffffff"], text: "Black, white and grays" };
  return { swatch: shadeSwatch(x), text: `Any ${hueName(x.hue)}` };
}

// Settings -> Rules -> Import rules -> Line colors: which colors mean cutting, tracing and open cut.
export function ColourLists({ value, onChange }: { value: ColourRules; onChange: (c: ColourRules) => void }) {
  const [adding, setAdding] = useState<LineRole | null>(null);
  const conflicts = colourConflicts(value);
  const setList = (r: LineRole, list: ColourEntry[]) => onChange({ ...value, [r]: list });
  return (
    <div className="colour-lists">
      {LINE_ROLES.map((r) => (
        <div key={r} className={`colour-list role-${r}`}>
          <div className="colour-list-head"><b>{ROLE_LABEL[r]}</b><small>{ROLE_HELP[r]}</small></div>
          <ul>
            {value[r].map((x, i) => {
              const d = describe(x);
              return (
                <li key={i} className="colour-chip">
                  <span className={`chip-swatch${x.kind === "shade" ? " is-range" : ""}`}
                    style={x.kind === "shade" ? { background: `linear-gradient(90deg, ${d.swatch.join(", ")})` } : undefined}>
                    {x.kind !== "shade" && d.swatch.map((c) => <i key={c} style={{ background: c }} />)}
                  </span>
                  <span className="chip-text">{d.text}</span>
                  {x.kind === "shade" && (
                    <select className="field chip-width" value={x.width} aria-label="How wide a range of shades"
                      onChange={(e) => setList(r, value[r].map((y, j) => (j === i ? { ...x, width: Number(e.target.value) } : y)))}>
                      {SHADE_WIDTHS.map((s) => <option key={s.deg} value={s.deg}>{s.label} ±{s.deg}°</option>)}
                      {!SHADE_WIDTHS.some((s) => s.deg === x.width) && <option value={x.width}>±{x.width}°</option>}
                    </select>
                  )}
                  <button type="button" className="chip-del" aria-label={`Remove ${d.text} from ${ROLE_LABEL[r]}`}
                    onClick={() => setList(r, value[r].filter((_, j) => j !== i))}>×</button>
                </li>
              );
            })}
            {value[r].length === 0 && <li className="colour-none">No colors</li>}
          </ul>
          {adding === r
            ? <AddColour onAdd={(x) => { setList(r, [...value[r], x]); setAdding(null); }} onCancel={() => setAdding(null)} hasGrays={LINE_ROLES.some((q) => value[q].some((y) => y.kind === "grays"))} />
            : <button type="button" className="link colour-add" onClick={() => setAdding(r)}>+ Add a color</button>}
        </div>
      ))}
      <label className="rule-field colour-other">
        <span>Colors in no list</span>
        <select className="field" value={value.other} onChange={(e) => onChange({ ...value, other: e.target.value as LineRole })}>
          {LINE_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
      </label>
      {conflicts.length > 0 && (
        <div className="sp-warn colour-conflicts" role="alert">
          <b>In two lists:</b>
          <ul>{conflicts.map((c) => <li key={c}>{c}</li>)}</ul>
          Then an exact color goes to the first of its lists (Cut contour, Trace, Open cut), and overlapping ranges to the closer one:
          better to keep each color in one list.
        </div>
      )}
      <p className="rule-help">An exact color (a HEX code, or an AutoCAD color number) wins over a range: one shade can be taken out of
        a range by adding it to another list. A range (any shade) takes darker, lighter, stronger and paler versions of the color; colors
        so gray or dark that they have no clear color go with black, white and grays. AutoCAD colors and their HEX codes are the same color
        (AutoCAD 3 is #00FF00).</p>
    </div>
  );
}

type Kind = "exact" | "shade" | "grays";

function AddColour({ onAdd, onCancel, hasGrays }: { onAdd: (x: ColourEntry) => void; onCancel: () => void; hasGrays: boolean }) {
  const [kind, setKind] = useState<Kind>("exact");
  const [text, setText] = useState("#00ff00");
  const [width, setWidth] = useState<number>(25);
  // a HEX code, or an AutoCAD color number 1-255
  const aci = /^\s*\d{1,3}\s*$/.test(text) ? Number(text) : null;
  const rgb = aci !== null ? (aci >= 1 && aci <= 255 ? ACI_RGB[aci] : null) : parseHex(text);
  const hue = rgb !== null ? rgbHsv(rgb)[0] : 0;
  const tooGray = rgb !== null && (rgbHsv(rgb)[1] < 0.25 || rgbHsv(rgb)[2] < 0.14);
  const ok = kind === "grays" || (rgb !== null && !(kind === "shade" && tooGray));
  const add = () => {
    if (!ok) return;
    if (kind === "grays") onAdd({ kind: "grays" });
    else if (kind === "shade") onAdd({ kind: "shade", hue: Math.round(hue), width });
    else onAdd(aci !== null ? { kind: "aci", aci } : { kind: "exact", rgb: rgb! });
  };
  return (
    <div className="colour-adder">
      <div className="seg colour-kind" role="radiogroup" aria-label="Kind of color">
        <button type="button" role="radio" aria-checked={kind === "exact"} className={kind === "exact" ? "is-on" : ""} onClick={() => setKind("exact")}>Exact color</button>
        <button type="button" role="radio" aria-checked={kind === "shade"} className={kind === "shade" ? "is-on" : ""} onClick={() => setKind("shade")}>Any shade</button>
        <button type="button" role="radio" aria-checked={kind === "grays"} className={kind === "grays" ? "is-on" : ""} disabled={hasGrays && kind !== "grays"}
          title={hasGrays ? "Black, white and grays are already in a list" : undefined} onClick={() => setKind("grays")}>Black, white, grays</button>
      </div>
      {kind !== "grays" && (
        <div className="colour-pick">
          <input type="color" value={rgb !== null ? hexOf(rgb) : "#000000"} aria-label="Pick the color"
            onChange={(e) => setText(e.target.value)} />
          <input className="field" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false}
            aria-label="HEX code or AutoCAD color number" placeholder="#00FF00 or 3"
            onKeyDown={(e) => { if (e.key === "Enter") add(); if (e.key === "Escape") onCancel(); }} />
          {kind === "shade" && (
            <select className="field" value={width} onChange={(e) => setWidth(Number(e.target.value))} aria-label="How wide a range of shades">
              {SHADE_WIDTHS.map((s) => <option key={s.deg} value={s.deg}>{s.label} ±{s.deg}°</option>)}
            </select>
          )}
        </div>
      )}
      {kind === "shade" && rgb !== null && !tooGray && (
        // what the range takes: across its hues, full / darker / paler
        <div className="colour-preview" aria-label="The shades this takes">
          {[[1, 1], [1, 0.6], [0.45, 1]].map(([s, v]) => (
            <span key={`${s}-${v}`} style={{ background: `linear-gradient(90deg, ${[-1, -0.5, 0, 0.5, 1].map((k) => hsvHex((hue + k * width + 360) % 360, s, v)).join(", ")})` }} />
          ))}
        </div>
      )}
      <p className="colour-adder-note">
        {kind === "grays" ? "Black, white and all grays, and colors so dark or pale they have no clear color."
          : rgb === null ? "Enter a HEX code (#00FF00) or an AutoCAD color number (1-255)."
          : kind === "shade" && tooGray ? "This color is too gray or dark to have a clear color: use Exact color, or Black, white and grays."
          : aci !== null ? `AutoCAD color ${aci} = ${hexOf(rgb).toUpperCase()}` : null}
      </p>
      <div className="colour-adder-buttons">
        <button type="button" className="btn btn-plain" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn-save" disabled={!ok} onClick={add}>Add</button>
      </div>
    </div>
  );
}
