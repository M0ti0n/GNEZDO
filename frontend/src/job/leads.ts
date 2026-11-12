// Lead-in / lead-out (always a pair). The rules here are what the automatic cut uses to place them;
// any lead can still be placed and changed by hand. Lengths, gaps, radii and angles come from the
// Technology row for the sheet's thickness.

import type { Machine } from "./machine";

export type LeadType = "corner" | "perp" | "perpGap" | "arc" | "cornerAngle" | "angled" | "cornerGap";

export const LEAD_TYPES: { id: LeadType; label: string; settings: string; cornerOnly?: boolean }[] = [
  { id: "corner", label: "Corner, in line", settings: "Lead-in · lead-out", cornerOnly: true },
  { id: "perp", label: "Perpendicular (90°)", settings: "Lead-in · lead-out" },
  { id: "perpGap", label: "Perpendicular with gap", settings: "Lead-in · lead-out · gap" },
  { id: "arc", label: "Arc", settings: "Radius · gap" },
  { id: "cornerAngle", label: "Corner, at an angle", settings: "Lead-in · lead-out · angles", cornerOnly: true },
  { id: "angled", label: "Angled with gap", settings: "Lead-in · lead-out · angles · gap" },
  { id: "cornerGap", label: "Corner in, gap out", settings: "Lead-in in line · gap · lead-out at an angle", cornerOnly: true },
];

/** The lead types with a gap (Break cut uses only these). */
export const GAP_TYPES: LeadType[] = ["perpGap", "arc", "angled", "cornerGap"];

/** Default angle of the angled types when the table leaves it empty [°] */
export const DEFAULT_ANGLE: Partial<Record<LeadType, number>> = { cornerAngle: 90, angled: 45, cornerGap: 90 };

export type LeadCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface LeadRules {
  /** Where on a contour the automatic cut puts the leads (nearest this corner of the part) */
  place: LeadCorner;
  /** A corner is sharp when the part's angle there is up to this [°] (holes: their reflex corners) */
  sharpMaxDeg: number;
  outCorner: LeadType;
  outOther: LeadType;
  holeCorner: LeadType;
  holeOther: LeadType;
  /** A hole's lead-in longer than its radius is cut to the radius (it starts at the center) */
  holeShorten: boolean;
  /** Slots narrower than 2 × the lead-in: the leads go in the middle of the end arc / short edge */
  slotMiddle: boolean;
  /** Remnant cuts (open lines): in line with the cut, at 90° or at an angle, from the scrap side */
  remnant: LeadType;
  /** Common cut, the shared lines: pierced outside the block coming in line or at an angle, or on the line's end */
  common: CommonLead;
}

export type CommonLead = "inline" | "angled" | "none";

/** How a shared common cut line starts and ends (lengths: the outline's lead-in / lead-out, angles: Angled leads). */
export const COMMON_LEADS: { id: CommonLead; label: string; settings: string }[] = [
  { id: "inline", label: "In line, from outside", settings: "Outline lead-in · lead-out" },
  { id: "angled", label: "At an angle, from outside", settings: "Outline lead-in · lead-out · angles" },
  { id: "none", label: "No lead, pierce on the line", settings: "Pierced at the line's end" },
];

/** The lead types a remnant cut can have (an open line: no corner of its own). */
export const REMNANT_LEADS: { id: LeadType; label: string; settings: string }[] = [
  { id: "corner", label: "In line", settings: "Lead-in · lead-out" },
  { id: "perp", label: "Perpendicular (90°)", settings: "Lead-in · lead-out" },
  { id: "angled", label: "At an angle", settings: "Lead-in · lead-out · angles" },
];

export const DEFAULT_LEAD_RULES: LeadRules = {
  place: "bottom-right", sharpMaxDeg: 160,
  outCorner: "corner", outOther: "perp", holeCorner: "corner", holeOther: "perp",
  holeShorten: true, slotMiddle: true, remnant: "perp", common: "inline",
};

export const leadRulesOf = (m: Machine | undefined): LeadRules => {
  const r = { ...DEFAULT_LEAD_RULES, ...(m?.leads ?? {}) };
  // a corner-only type cannot be used away from corners
  const ok = (t: LeadType, d: LeadType) => (LEAD_TYPES.find((x) => x.id === t)?.cornerOnly ? d : t);
  return {
    ...r, outOther: ok(r.outOther, "perp"), holeOther: ok(r.holeOther, "perp"),
    remnant: REMNANT_LEADS.some((x) => x.id === r.remnant) ? r.remnant : "perp",
    common: COMMON_LEADS.some((x) => x.id === r.common) ? r.common : "inline",
  };
};
