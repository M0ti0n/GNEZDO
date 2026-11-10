// Lead-in / lead-out (always a pair). The rules here are what the automatic cut uses to place them;
// any lead can still be placed and changed by hand. Lengths, gaps, radii and angles come from the
// Technology row for the sheet's thickness.

import type { Machine } from "./machine";

export type LeadType = "corner" | "perp" | "perpGap" | "arc" | "cornerAngle" | "angled";

export const LEAD_TYPES: { id: LeadType; label: string; settings: string; cornerOnly?: boolean }[] = [
  { id: "corner", label: "Corner, in line", settings: "Lead-in · lead-out", cornerOnly: true },
  { id: "perp", label: "Perpendicular (90°)", settings: "Lead-in · lead-out" },
  { id: "perpGap", label: "Perpendicular with gap", settings: "Lead-in · lead-out · gap" },
  { id: "arc", label: "Arc", settings: "Radius · gap" },
  { id: "cornerAngle", label: "Corner, at an angle", settings: "Lead-in · lead-out · angles", cornerOnly: true },
  { id: "angled", label: "Angled with gap", settings: "Lead-in · lead-out · angles · gap" },
];

/** Default angle of the angled types when the table leaves it empty [°] */
export const DEFAULT_ANGLE: Partial<Record<LeadType, number>> = { cornerAngle: 90, angled: 45 };

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
}

export const DEFAULT_LEAD_RULES: LeadRules = {
  place: "bottom-right", sharpMaxDeg: 160,
  outCorner: "corner", outOther: "perp", holeCorner: "corner", holeOther: "perp",
  holeShorten: true, slotMiddle: true,
};

export const leadRulesOf = (m: Machine | undefined): LeadRules => {
  const r = { ...DEFAULT_LEAD_RULES, ...(m?.leads ?? {}) };
  // a corner-only type cannot be used away from corners
  const ok = (t: LeadType, d: LeadType) => (LEAD_TYPES.find((x) => x.id === t)?.cornerOnly ? d : t);
  return { ...r, outOther: ok(r.outOther, "perp"), holeOther: ok(r.holeOther, "perp") };
};
