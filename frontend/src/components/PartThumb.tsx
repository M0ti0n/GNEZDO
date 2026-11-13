import type { PartSummary } from "../api/types";
import { MarkPaths, usePartMarks } from "./PartMarks";

/** Part outline with holes, scaled to fit the box; with `marks`, its tracing and open cut lines too (read from its drawing). */
export function PartThumb({ part, size = 64, marks = false }: { part: Pick<PartSummary, "w" | "h" | "path"> & { id?: string }; size?: number; marks?: boolean }) {
  const m = usePartMarks(marks && part.id ? [part.id] : []);
  const pad = Math.max(part.w, part.h) * 0.06;
  return (
    <svg className="part-thumb" width={size} height={size}
      viewBox={`${-pad} ${-pad} ${part.w + 2 * pad} ${part.h + 2 * pad}`}
      preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <path d={part.path} fillRule="evenodd" vectorEffect="non-scaling-stroke" />
      <MarkPaths marks={part.id ? m.get(part.id) : undefined} />
    </svg>
  );
}

export const sizeLabel = (p: Pick<PartSummary, "w" | "h">) => `${Math.round(p.w)} × ${Math.round(p.h)}`;
