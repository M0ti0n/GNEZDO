import { NumInput } from "./NumInput";
import { LeadIcon } from "./LeadIcon";
import { DEFAULT_LEAD_RULES, LEAD_TYPES, leadRulesOf, type LeadCorner, type LeadRules, type LeadType } from "../job/leads";
import type { Machine } from "../job/machine";

const CORNERS: { id: LeadCorner; label: string }[] = [
  { id: "top-left", label: "Top left" }, { id: "top-right", label: "Top right" },
  { id: "bottom-left", label: "Bottom left" }, { id: "bottom-right", label: "Bottom right" },
];

/** Settings -> Machines -> Leads & cutting: which lead pair the automatic cut uses where. */
export function LeadsSettings({ machine, onChange }: { machine: Machine; onChange: (r: LeadRules) => void }) {
  const r = leadRulesOf(machine);
  const set = (patch: Partial<LeadRules>) => onChange({ ...r, ...patch });
  const picker = (key: keyof LeadRules, anywhere: boolean, label: string) => (
    <div className="lead-pick" role="radiogroup" aria-label={label}>
      {LEAD_TYPES.map((t) => {
        const off = anywhere && !!t.cornerOnly;
        const on = r[key] === t.id;
        return (
          <button key={t.id} type="button" role="radio" aria-checked={on} disabled={off}
            className={`lead-card${on ? " is-on" : ""}`} onClick={() => set({ [key]: t.id as LeadType })}
            title={off ? "Only on sharp corners" : t.settings}>
            <LeadIcon type={t.id} />
            <b>{t.label}</b>
            <small>{off ? "Sharp corners only" : t.settings}</small>
          </button>
        );
      })}
    </div>
  );
  const isDefault = JSON.stringify(r) === JSON.stringify(DEFAULT_LEAD_RULES);
  return (
    <div className="leads">
      <section className="lead-top">
        <div>
          <b>Lead-in / lead-out are always a pair.</b>
          <span className="lead-legend">
            <span><i style={{ background: "#22a046" }} />lead-in</span><span><i style={{ background: "#e0352b" }} />lead-out</span>
            <span><i style={{ background: "#1e8db5" }} />gap</span><span><i style={{ background: "#f08a24" }} />in angle</span><span><i style={{ background: "#9b59b6" }} />out angle</span>
          </span>
          <p className="rule-help">What the automatic cut uses. Any lead can still be placed and changed by hand. Lengths, gaps, radii and angles come from the Technology row for the sheet's thickness.</p>
        </div>
        <div className="lead-place">
          <span>Place leads nearest</span>
          <span className="lead-corners" role="radiogroup" aria-label="Place leads nearest">
            {CORNERS.map((c) => (
              <button key={c.id} type="button" role="radio" aria-checked={r.place === c.id} aria-label={c.label} title={c.label}
                className={`lead-corner${r.place === c.id ? " is-on" : ""}`} onClick={() => set({ place: c.id })} />
            ))}
          </span>
          <b>{CORNERS.find((c) => c.id === r.place)?.label}</b>
        </div>
      </section>

      <div className="lead-grid">
        <section className="lead-sec">
          <h3>Outline <small>outer contour · cut clockwise</small></h3>
          <div className="lead-sub">On sharp corners</div>
          {picker("outCorner", false, "Outline, sharp corners")}
          <div className="lead-sub">Elsewhere <small>arcs, radii, round contours</small></div>
          {picker("outOther", true, "Outline, elsewhere")}
        </section>
        <section className="lead-sec">
          <h3>Holes <small>inner contours · cut counter-clockwise</small></h3>
          <div className="lead-sub">On sharp corners <small>where the hole's edges meet inward</small></div>
          {picker("holeCorner", false, "Holes, sharp corners")}
          <div className="lead-sub">Elsewhere <small>arcs, radii, round holes, plain windows</small></div>
          {picker("holeOther", true, "Holes, elsewhere")}
          <label className="chk"><input type="checkbox" checked={r.holeShorten} onChange={(e) => set({ holeShorten: e.target.checked })} />
            A lead-in longer than the hole's radius is cut to the radius (starts at the center)</label>
          <label className="chk"><input type="checkbox" checked={r.slotMiddle} onChange={(e) => set({ slotMiddle: e.target.checked })} />
            Slots narrower than 2 × the lead-in: in the middle of the end arc / short edge</label>
        </section>
      </div>

      <div className="lead-foot">
        <label className="lead-sharp">A corner is sharp when the part's angle there is up to
          <NumInput value={r.sharpMaxDeg} min={1} aria-label="Sharp corner angle (°)" onCommit={(n) => set({ sharpMaxDeg: Math.min(179, n) })} />°</label>
        <span className="tech-grow" />
        <button type="button" className="btn btn-plain" disabled={isDefault} onClick={() => onChange({ ...DEFAULT_LEAD_RULES })}>Back to the defaults</button>
      </div>
    </div>
  );
}
