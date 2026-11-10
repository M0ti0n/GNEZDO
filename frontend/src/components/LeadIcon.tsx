import type { LeadType } from "../job/leads";

// The lead types as small drawings: the part (shaded) and its edge, lead-in green, lead-out red,
// the gap blue along the edge, angles orange (in) and purple (out). Pierce point: a dot.
const IN = "#22a046", OUT = "#e0352b", GAP = "#1e8db5", AIN = "#f08a24", AOUT = "#9b59b6";
const EDGE = "var(--ink, #1b2a30)", PART = "rgba(27,42,48,.09)";

export function LeadIcon({ type, size = 1 }: { type: LeadType; size?: number }) {
  const w = 112 * size, h = 72 * size;
  const common = { fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const line = (d: string, c: string, sw = 3.4) => <path d={d} stroke={c} strokeWidth={sw} {...common} />;
  const dot = (x: number, y: number, c: string) => <circle cx={x} cy={y} r={3.6} fill="#fff" stroke={c} strokeWidth={2.4} />;
  let body;
  switch (type) {
    case "corner":
    case "cornerAngle": {
      const ang = type === "cornerAngle";
      body = (<>
        <rect x={8} y={6} width={52} height={34} fill={PART} />
        {line("M8 40H60V6", EDGE, 3)}
        {ang ? line("M60 40L92 22", IN) : line("M60 40H98", IN)}
        {ang ? line("M60 40L78 66", OUT) : line("M60 40V68", OUT)}
        {ang && line("M74 40A14 14 0 0 0 72.2 33.2", AIN, 2.2)}
        {ang && line("M60 54A14 14 0 0 0 68 51.5", AOUT, 2.2)}
        {ang ? dot(92, 22, IN) : dot(98, 40, IN)}
      </>);
      break;
    }
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
        {line("M6 52H106", EDGE, 3)}
        {line("M42 52H70", GAP, 5)}
        {line("M70 52L96 26", IN)}{line("M42 52L18 28", OUT)}
        {line("M84 52A14 14 0 0 0 80 42.2", AIN, 2.2)}
        {line("M28 52A14 14 0 0 1 32 42.2", AOUT, 2.2)}
        {dot(96, 26, IN)}
      </>);
      break;
  }
  return <svg width={w} height={h} viewBox="0 0 112 72" aria-hidden="true">{body}</svg>;
}
