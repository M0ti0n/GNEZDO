import type { LeadType } from "../job/leads";

// The lead types as small drawings: the part (shaded) and its edge, lead-in green, lead-out red,
// the gap blue along the edge, angles orange (in) and purple (out). Pierce point: a dot.
const IN = "#22a046", OUT = "#e0352b", GAP = "#1e8db5", AIN = "#f08a24", AOUT = "#9b59b6";
const EDGE = "var(--ink, #1b2a30)", PART = "rgba(27,42,48,.09)";

const xy = (cx: number, cy: number, r: number, deg: number): [number, number] =>
  [+(cx + r * Math.cos((deg * Math.PI) / 180)).toFixed(2), +(cy + r * Math.sin((deg * Math.PI) / 180)).toFixed(2)];
const pt = (cx: number, cy: number, r: number, deg: number) => xy(cx, cy, r, deg).join(" ");
/** An arc path from direction a0 to a1 [° on screen, y down] */
const arcOf = (cx: number, cy: number, r: number, a0: number, a1: number) =>
  `M${pt(cx, cy, r, a0)}A${r} ${r} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} ${a1 > a0 ? 1 : 0} ${pt(cx, cy, r, a1)}`;

export function LeadIcon({ type, size = 1 }: { type: LeadType; size?: number }) {
  const w = 112 * size, h = 72 * size;
  const common = { fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const line = (d: string, c: string, sw = 3.4) => <path d={d} stroke={c} strokeWidth={sw} {...common} />;
  // an angle: a light filled sector with its arc
  const wedge = (cx: number, cy: number, arc: string, c: string) => {
    const m = /^M(-?[\d.]+) (-?[\d.]+)/.exec(arc)!;
    return (<g>
      <path d={`M${cx} ${cy}L${m[1]} ${m[2]}${arc.slice(m[0].length)}Z`} fill={c} opacity={0.22} />
      <path d={arc} stroke={c} strokeWidth={2.6} fill="none" strokeLinecap="round" />
    </g>);
  };
  const dot = (x: number, y: number, c: string) => <circle cx={x} cy={y} r={3.6} fill="#fff" stroke={c} strokeWidth={2.4} />;
  let body;
  switch (type) {
    case "corner":
      body = (<>
        <rect x={8} y={6} width={52} height={34} fill={PART} />
        {line("M8 40H60V6", EDGE, 3)}
        {line("M60 40H98", IN)}{line("M60 40V68", OUT)}
        {dot(98, 40, IN)}
      </>);
      break;
    case "cornerAngle":
      // as in the key: the lead-in's angle is from the edge going up, the lead-out's from the edge going
      // left (90° = in line, as Corner, in line); drawn at 65° here so the angles show
      body = (<>
        <rect x={8} y={6} width={52} height={34} fill={PART} />
        {wedge(60, 40, arcOf(60, 40, 20, -90, -25), AIN)}
        {wedge(60, 40, arcOf(60, 40, 20, 180, 115), AOUT)}
        <path d="M60 40H100M60 40V70" stroke={EDGE} strokeWidth={1.4} strokeDasharray="3 3" opacity={0.4} fill="none" />
        {line("M8 40H60V6", EDGE, 3)}
        {line(`M60 40L${pt(60, 40, 38, -25)}`, IN)}{line(`M60 40L${pt(60, 40, 31, 115)}`, OUT)}
        {dot(...xy(60, 40, 38, -25), IN)}
      </>);
      break;
    case "perp":
      body = (<>
        <rect x={6} y={48} width={100} height={20} fill={PART} />
        {line("M6 48H106", EDGE, 3)}
        {line("M60 48V12", IN)}{line("M53 48V16", OUT)}
        {dot(60, 12, IN)}
      </>);
      break;
    case "perpGap":
      body = (<>
        <rect x={6} y={48} width={100} height={20} fill={PART} />
        {line("M6 48H106", EDGE, 3)}
        {line("M42 48H70", GAP, 5)}
        {line("M70 48V12", IN)}{line("M42 48V14", OUT)}
        {dot(70, 12, IN)}
      </>);
      break;
    case "arc":
      body = (<>
        <rect x={6} y={48} width={100} height={20} fill={PART} />
        {line("M6 48H106", EDGE, 3)}
        {line("M42 48H70", GAP, 5)}
        {line("M70 48A14 14 0 0 0 84 34A14 14 0 0 0 70 20", IN)}
        {line("M42 48A14 14 0 0 1 28 34A14 14 0 0 1 42 20", OUT)}
        {dot(70, 20, IN)}
      </>);
      break;
    case "angled":
      body = (<>
        <rect x={6} y={52} width={100} height={16} fill={PART} />
        {wedge(70, 52, arcOf(70, 52, 22, 0, -45), AIN)}
        {wedge(42, 52, arcOf(42, 52, 22, 180, 225), AOUT)}
        {line("M6 52H106", EDGE, 3)}
        {line("M42 52H70", GAP, 5)}
        {line("M70 52L96 26", IN)}{line("M42 52L16 26", OUT)}
        {dot(96, 26, IN)}
      </>);
      break;
  }
  return <svg width={w} height={h} viewBox="0 0 112 72" aria-hidden="true">{body}</svg>;
}
