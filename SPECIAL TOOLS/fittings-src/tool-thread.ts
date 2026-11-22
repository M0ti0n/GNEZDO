import { THREADS, threadFlangeFor, threadFlangePieces, threadFlangeProblems, threadSize, type ThreadFlangeValues } from "./flange";
import { g, toParts, type Tool } from "./common";
import { pieceFields, sizeNote } from "./tool-flange";

interface V { table: boolean; a: number; b: number; m: string; e: number; n: number; mark: number; whole: boolean; divided: boolean }
const values = (v: V): ThreadFlangeValues => {
  const std = threadFlangeFor(v.a, v);
  return v.table ? std : { ...std, b: v.b, m: v.m, e: v.e, n: v.n };
};

export const tool: Tool<V> = {
  manifest: {
    id: "threaded-flange", name: "Threaded flange", countLabel: "Flanges",
    description: "A flat ring whose N holes on the B circle are drilled and tapped after cutting (X marks, tracing), sizes from its own table. From the HVAC Fittings workbench.",
    fields: [
      { key: "table", type: "check", label: "Sizes from the table", group: "Size", default: true, note: sizeNote },
      { key: "m", type: "choice", label: "Thread", title: "M: thread (not from the table)", group: "Size", default: "M8",
        options: Object.keys(THREADS).map((m) => ({ value: m, label: m })) },
      { key: "a", type: "number", label: "A", title: "A: inner (nominal) diameter", unit: "mm", default: 400, min: 0, at: [37, 58], color: "blue" },
      { key: "b", type: "number", label: "B", title: "B: diameter the holes lie on (not from the table)", unit: "mm", default: 435, min: 0, at: [64, 22], color: "green" },
      { key: "e", type: "number", label: "E", title: "E: ring width (not from the table)", unit: "mm", default: 30, min: 0, at: [84, 51], color: "brown" },
      { key: "n", type: "int", label: "N", title: "N: number of holes (not from the table)", unit: "holes", default: 10, min: 0, at: [84, 70], color: "dark" },
      { key: "mark", type: "number", label: "X mark size", unit: "mm", group: "Marks", default: 10, min: 1, note: "Only the ring is cut; the holes are drilled and tapped after cutting." },
      ...pieceFields("hole"),
    ],
    note: "D = A + 2E. The parts' label says the thread's tap drill and the thickness the table recommends.",
  },
  problems: (v) => threadFlangeProblems(values(v)),
  title: (v) => `TFL A${g(v.a)} ${values(v).m}`,
  parts: (v, gz) => {
    const f = values(v), ts = threadSize(f.m);
    return toParts(threadFlangePieces(f), gz, (p) => `${p.label}, ${f.m} drill ${ts ? g(ts.drill) : "?"}, T ${g(f.t)} recommended`);
  },
};
