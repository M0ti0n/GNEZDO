// Process -> Manual cut: contours of a processed sheet picked one by one take the places they had in
// the cut path, in the order picked (the rest stays where it is). Picking every contour sets the whole
// order. A part's outline must still come after its own holes, marking and open cuts.

import type { CutContour, SheetCut } from "./cutPath";
import type { Pt } from "./manualGeom";

const distPoly = (pts: Pt[], p: Pt) => {
  let d = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], ex = pts[i][0] - a[0], ey = pts[i][1] - a[1], L2 = ex * ex + ey * ey;
    const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / L2)) : 0;
    d = Math.min(d, Math.hypot(a[0] + t * ex - p[0], a[1] + t * ey - p[1]));
  }
  return pts.length === 1 ? Math.hypot(pts[0][0] - p[0], pts[0][1] - p[1]) : d;
};

/** The contour (index in cut.contours) nearest the point, within `reach` mm; -1: none. */
export function pickContour(cut: SheetCut, live: Set<CutContour>, p: Pt, reach: number): number {
  let k = -1, best = Infinity;
  cut.contours.forEach((c, i) => {
    if (!live.has(c)) return;
    const d = Math.min(distPoly(c.pts, p), c.leadIn.length > 1 ? distPoly(c.leadIn, p) : Infinity, c.leadOut.length > 1 ? distPoly(c.leadOut, p) : Infinity);
    if (d < best) { best = d; k = i; }
  });
  return best <= reach ? k : -1;
}

/** What a contour is, in words. */
export function contourKind(c: CutContour): string {
  if (c.common) return "Common cut line";
  if (c.kind === "outer") return c.parts ? "Block outline" : "Outline";
  if (c.kind === "inner") return c.parts ? "Block hole" : "Hole";
  return c.kind === "trace" ? "Marking" : "Open cut";
}

/**
 * The cut with the picked contours (indexes) in the places they had, in the order picked; an error text
 * when a part's outline would come before something of the part itself.
 */
export function reorderCut(cut: SheetCut, picked: number[], nameOf: (part: number) => string): SheetCut | string {
  const slots = picked.slice().sort((a, b) => a - b);
  const out = cut.contours.slice();
  slots.forEach((s, j) => { out[s] = cut.contours[picked[j]]; });
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    if (c.kind !== "outer") continue;
    const own = new Set(c.parts ?? [c.part]);
    for (let j = i + 1; j < out.length; j++) {
      const d = out[j];
      if (d.kind === "outer") continue;
      if ((d.parts ?? [d.part]).some((x) => own.has(x))) {
        return `${c.parts ? "A common cut block" : nameOf(c.part)}: its outline would be cut before its ${contourKind(d).toLowerCase()} (the part would fall out first). Pick the ${contourKind(d).toLowerCase()} before the outline.`;
      }
    }
  }
  return { ...cut, contours: out, rule: "manual", at: new Date().toISOString() };
}
