// A part's tracing and open cut lines drawn over its outline wherever the part is shown before it is
// processed (thumbnails, the parts beside a sheet, the parts on it): the outline path holds only the
// closed contours, the marks come from the part's saved drawing.
import { useEffect, useState } from "react";
import { partMarks, type Marks } from "../job/cutPath";
import type { Pt } from "../job/manualGeom";

const EMPTY: Marks = { trace: [], open: [] };

/** The marks of these parts (only the ones that have any), as they come in. */
export function usePartMarks(ids: string[]): Map<string, Marks> {
  const key = [...new Set(ids)].sort().join("|");
  const [marks, setMarks] = useState<Map<string, Marks>>(() => new Map());
  useEffect(() => {
    let live = true;
    const list = key ? key.split("|") : [];
    void Promise.all(list.map((id) => partMarks(id).catch(() => EMPTY).then((m) => [id, m] as const))).then((r) => {
      if (live) setMarks(new Map(r.filter(([, m]) => m.trace.length || m.open.length)));
    });
    return () => { live = false; };
  }, [key]);
  return marks;
}

const d = (run: Pt[], f?: (p: Pt) => Pt) => run.map((p, j) => { const [x, y] = f ? f(p) : p; return `${j ? "L" : "M"}${x} ${y}`; }).join("");

/** The marks as paths (part frame, or through `f` onto a sheet); `width` in drawing units, else 1.4 px. */
export function MarkPaths({ marks, f, width }: { marks?: Marks; f?: (p: Pt) => Pt; width?: number }) {
  if (!marks) return null;
  const style = width ? { strokeWidth: width } : undefined;
  return (<>
    {marks.trace.map((r, k) => <path key={`t${k}`} className={`part-mark is-trace${width ? "" : " is-px"}`} d={d(r, f)} style={style} />)}
    {marks.open.map((r, k) => <path key={`o${k}`} className={`part-mark is-open${width ? "" : " is-px"}`} d={d(r, f)} style={style} />)}
  </>);
}
