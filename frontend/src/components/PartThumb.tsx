import type { PartSummary } from "../api/types";

/** Part outline with holes, scaled to fit the box. */
export function PartThumb({ part, size = 64 }: { part: Pick<PartSummary, "w" | "h" | "path">; size?: number }) {
  const pad = Math.max(part.w, part.h) * 0.06;
  return (
    <svg className="part-thumb" width={size} height={size}
      viewBox={`${-pad} ${-pad} ${part.w + 2 * pad} ${part.h + 2 * pad}`}
      preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <path d={part.path} fillRule="evenodd" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export const sizeLabel = (p: Pick<PartSummary, "w" | "h">) => `${Math.round(p.w)} × ${Math.round(p.h)}`;
