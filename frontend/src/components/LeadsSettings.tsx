import { NumInput } from "./NumInput";
import { LeadIcon } from "./LeadIcon";
import { COMMON_LEADS, DEFAULT_LEAD_RULES, LEAD_TYPES, REMNANT_LEADS, leadRulesOf, type CommonLead, type LeadCorner, type LeadRules, type LeadType } from "../job/leads";
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
          <h3>Outline <small>outer contour · cut clockwise (as the machine sees it)</small></h3>
          <div className="lead-sub">On sharp corners</div>
          {picker("outCorner", false, "Outline, sharp corners")}
          <div className="lead-sub">Elsewhere <small>arcs, radii, round contours</small></div>
          {picker("outOther", true, "Outline, elsewhere")}
        </section>
        <section className="lead-sec">
          <h3>Holes <small>inner contours · cut counter-clockwise (as the machine sees it)</small></h3>
          <div className="lead-sub">On sharp corners <small>where the hole's edges meet inward</small></div>
          {picker("holeCorner", false, "Holes, sharp corners")}
          <div className="lead-sub">Elsewhere <small>arcs, radii, round holes, plain windows</small></div>
          {picker("holeOther", true, "Holes, elsewhere")}
          <label className="chk"><input type="checkbox" checked={r.holeShorten} onChange={(e) => set({ holeShorten: e.target.checked })} />
            A lead-in longer than the hole's radius is cut to the radius (starts at the center)</label>
          <p className="rule-help">Windows and slots (inner contours that are not round holes): the leads go in the middle of a radius (arc) if there is one, else on a straight side at least 2 × the lead-in from its corners (the middle of a side shorter than that).</p>
        </section>
        <section className="lead-sec">
          <h3>Remnant cut <small>open cuts of Process → Remnant · from the scrap side</small></h3>
          <div className="lead-pick" role="radiogroup" aria-label="Remnant cut">
            {REMNANT_LEADS.map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={r.remnant === t.id}
                className={`lead-card${r.remnant === t.id ? " is-on" : ""}`} onClick={() => set({ remnant: t.id })} title={t.settings}>
                <LeadIcon type={t.id} />
                <b>{t.label}</b>
                <small>{t.settings}</small>
              </button>
            ))}
          </div>
          <p className="rule-help">Lengths (0 = no lead), the gap in / out from the sheet edge and the distance to the parts: Technology → Remnant cut.</p>
        </section>
        <section className="lead-sec">
          <h3>Common cut <small>the shared line of two parts, cut once without kerf compensation</small></h3>
          <div className="lead-pick" role="radiogroup" aria-label="Common cut">
            {COMMON_LEADS.map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={r.common === t.id}
                className={`lead-card${r.common === t.id ? " is-on" : ""}`} onClick={() => set({ common: t.id })} title={t.settings}>
                <CommonLeadIcon type={t.id} />
                <b>{t.label}</b>
                <small>{t.settings}</small>
              </button>
            ))}
          </div>
          <p className="rule-help">From outside: pierced in the scrap beyond the block's edge, so no part gets a pierce mark. Lengths: the outline lead-in / lead-out of the Technology row, never longer than the room to the next part; angles: Angled leads (45° when empty). No lead: pierced right where the shared line meets the block's edge.</p>
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

/** A shared common cut line between two parts and how it starts (green) and ends (red). */
function CommonLeadIcon({ type }: { type: CommonLead }) {
  const IN = "#22a046", OUT = "#e0352b", LINE = "#1e8db5", PART = "rgba(27,42,48,.09)", EDGE = "var(--ink, #1b2a30)";
  const st = { fill: "none", strokeLinecap: "round" as const, strokeWidth: 3.4 };
  const dot = (x: number, y: number, c: string) => <circle cx={x} cy={y} r={3.6} fill="#fff" stroke={c} strokeWidth={2.4} />;
  return (
    <svg width={112} height={72} viewBox="0 0 112 72" aria-hidden="true">
      <rect x={14} y={12} width={38} height={46} fill={PART} /><rect x={60} y={12} width={38} height={46} fill={PART} />
      <path d="M52 12V58M60 12V58M14 12H52M60 12H98M14 58H52M60 58H98" stroke={EDGE} strokeWidth={1.6} opacity={0.5} fill="none" />
      <path d="M56 58V12" stroke={LINE} {...st} />
      {type === "inline" && <><path d="M56 67V58" stroke={IN} {...st} /><path d="M56 12V4" stroke={OUT} {...st} />{dot(56, 67, IN)}</>}
      {type === "angled" && <><path d="M46 67L56 58" stroke={IN} {...st} /><path d="M56 12L65 4" stroke={OUT} {...st} />{dot(46, 67, IN)}</>}
      {type === "none" && <>{dot(56, 58, IN)}{dot(56, 12, OUT)}</>}
    </svg>
  );
}
