import type { NestedSheet } from "../job/nest";
import { remnantValid } from "../job/remnant";

const line = (pts: [number, number][]) => pts.map(([x, y], k) => `${k ? "L" : "M"}${x} ${y}`).join("");
const loop = (pts: [number, number][]) => `${line(pts)}Z`;

/**
 * A sheet's remnant on the sheet (sheet frame, mm): the pieces hatched with their names, windows outlined,
 * the mode's cut lines red, the hand cuts magenta. `s`: screen pixels per mm (line widths); without it the
 * lines keep a fixed width (the small sheet pictures).
 */
export function RemnantOverlay({ sheet, s, names = true }: { sheet: NestedSheet; s?: number; names?: boolean }) {
  const rem = sheet.remnant;
  if (!rem || !remnantValid(sheet)) return null;
  const px = (n: number) => (s ? n / s : n);
  const fixed = s ? undefined : "non-scaling-stroke";
  const id = `rem-hatch-${sheet.sheetId ?? "s"}-${s ? "v" : "t"}`;
  return (
    <g className="rem-layer">
      <defs>
        <pattern id={id} patternUnits="userSpaceOnUse" width={px(9)} height={px(9)} patternTransform="rotate(45)">
          <line x1={0} y1={0} x2={0} y2={px(9)} className="rem-hatch-line" style={{ strokeWidth: px(2) }} />
        </pattern>
      </defs>
      {rem.pieces.map((p, k) => (
        <path key={`p${k}`} className={`rem-piece${p.window ? " is-window" : ""}${p.status ? ` is-${p.status}` : ""}`} fillRule="evenodd"
          d={[p.outline, ...(p.holes ?? [])].map(loop).join("")} style={{ fill: `url(#${id})`, strokeWidth: px(p.window ? 2 : 1) }} vectorEffect={fixed} />
      ))}
      {rem.lines.map((l, k) => <path key={`l${k}`} className="rem-line" d={line(l)} style={{ strokeWidth: px(2.4) }} vectorEffect={fixed} />)}
      {rem.cuts.map((c, k) => (
        <line key={`c${k}`} className="rem-cut" style={{ strokeWidth: px(2.4) }} vectorEffect={fixed}
          x1={c.axis === "v" ? c.at : c.from} y1={c.axis === "v" ? c.from : c.at} x2={c.axis === "v" ? c.at : c.to} y2={c.axis === "v" ? c.to : c.at} />
      ))}
      {names && s && rem.pieces.map((p, k) => (
        <text key={`n${k}`} className={`rem-name${p.status ? ` is-${p.status}` : ""}`} x={p.label[0]} y={p.label[1]} style={{ fontSize: px(14), strokeWidth: px(3) }}>
          {p.name}{p.status === "saved" ? " ✓" : p.status === "discarded" ? " ✗" : ""}
        </text>
      ))}
    </g>
  );
}
