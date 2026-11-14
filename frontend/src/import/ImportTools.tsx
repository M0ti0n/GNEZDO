import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { SideScroll } from "../components/SideScroll";

// Tools of the import screen, drawn after Fab's icon sheet.
// Black = existing geometry, red = what the tool changes or measures, green = laser / direction.

const K = "#1b1b1b";
const R = "#e3262b";
const G = "#9acd32";
const GA = "#1d9641";   // align arrows: the top bar green
const BL = "#1ea0e6";   // drawing tools: the points clicked

const Ico = ({ w = 48, children }: { w?: number; children: ReactNode }) => (
  <svg viewBox={`0 0 ${w} 48`} width={w} height={48} fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

const Arrow = ({ x, y, angle, color }: { x: number; y: number; angle: number; color: string }) => (
  <path d="M0 0L-6 -3.2L-6 3.2Z" fill={color} transform={`translate(${x} ${y}) rotate(${angle})`} />
);

/** Gear outline as a path: n teeth between radius r (root) and R (tip). */
const gear = (cx: number, cy: number, r: number, Rr: number, n: number) => {
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const w = Math.PI / n;
    for (const [rad, da] of [[r, -w * 0.62], [Rr, -w * 0.32], [Rr, w * 0.32], [r, w * 0.62]] as const)
      pts.push(`${(cx + rad * Math.cos(a + da)).toFixed(2)} ${(cy + rad * Math.sin(a + da)).toFixed(2)}`);
  }
  return `M${pts.join("L")}Z`;
};

const Nozzle = ({ beam }: { beam: string }) => (
  <>
    <rect x="20.5" y="3" width="7" height="9" fill={K} />
    <path d="M17 12H31L24 21Z" fill={K} />
    <path d="M24 21V33" stroke={beam} strokeWidth="2.4" strokeDasharray={beam === G ? "3 2.5" : undefined} />
  </>
);

export const IMPORT_TOOLS: { id: string; label: string; wide?: boolean; icon: ReactNode }[] = [
  {
    id: "properties", label: "Properties",
    icon: (
      <Ico>
        <rect x="2" y="5" width="30" height="38" stroke={K} strokeWidth="2.4" />
        <circle cx="9" cy="14" r="2.6" fill="#22b14c" /><rect x="14" y="11.5" width="13" height="5" fill={K} />
        <circle cx="9" cy="24" r="2.6" fill="#22b14c" /><rect x="14" y="21.5" width="13" height="5" fill={K} />
        <circle cx="9" cy="34" r="2.6" fill={R} /><rect x="14" y="31.5" width="13" height="5" fill={K} />
        <rect x="37" y="4" width="8" height="6" fill={R} stroke={K} strokeWidth="1.8" />
        <rect x="37" y="10" width="8" height="26" fill="#fff" stroke={K} strokeWidth="1.8" />
        <path d="M37 36L41 44L45 36" fill="#fff" stroke={K} strokeWidth="1.8" />
      </Ico>
    ),
  },
  {
    id: "extend", label: "Extend",
    icon: (
      <Ico>
        <path d="M22 5L43 21" stroke={K} strokeWidth="3.2" />
        <path d="M7 42L19 28" stroke={K} strokeWidth="3.2" />
        <path d="M19 28L31 14" stroke={R} strokeWidth="3" strokeDasharray="3.5 3" />
      </Ico>
    ),
  },
  {
    id: "trim", label: "Trim",
    icon: (
      <Ico>
        <path d="M8 42L25 24" stroke={K} strokeWidth="3.2" />
        <path d="M25 24L40 8" stroke={R} strokeWidth="3" strokeDasharray="3.5 3" />
        <path d="M12 14L36 40" stroke={K} strokeWidth="3.2" />
      </Ico>
    ),
  },
  {
    id: "line", label: "Line",
    icon: <Ico><path d="M9 14L39 34" stroke={K} strokeWidth="3.4" /><circle cx="9" cy="14" r="3.6" fill={BL} /><circle cx="39" cy="34" r="3.6" fill={BL} /></Ico>,
  },
  {
    id: "circle", label: "Circle",
    icon: <Ico><circle cx="24" cy="24" r="14" stroke={K} strokeWidth="3.4" /><circle cx="24" cy="24" r="3.6" fill={BL} /></Ico>,
  },
  {
    id: "arc", label: "Arc",
    icon: <Ico><path d="M9 33A16 16 0 0 1 39 36" stroke={K} strokeWidth="3.4" /><circle cx="9" cy="33" r="3.6" fill={BL} /><circle cx="27" cy="14.5" r="3.6" fill={BL} /><circle cx="39" cy="36" r="3.6" fill={BL} /></Ico>,
  },
  {
    id: "rect", label: "Rect.",
    icon: <Ico><rect x="9" y="12" width="30" height="24" stroke={K} strokeWidth="3.4" /><circle cx="9" cy="36" r="3.6" fill={BL} /><circle cx="39" cy="12" r="3.6" fill={BL} /></Ico>,
  },
  {
    id: "slot", label: "Slot",
    icon: <Ico><path d="M15 15H33A9 9 0 0 1 33 33H15A9 9 0 0 1 15 15Z" stroke={K} strokeWidth="3.4" /><path d="M15 24H33" stroke={BL} strokeWidth="1.8" strokeDasharray="3 2.5" /><circle cx="15" cy="24" r="3.4" fill={BL} /><circle cx="33" cy="24" r="3.4" fill={BL} /><circle cx="33" cy="15" r="3.4" fill={BL} /></Ico>,
  },
  {
    id: "xline", label: "Aid line",
    icon: <Ico><path d="M4 41L44 7" stroke={BL} strokeWidth="2.6" strokeDasharray="5 3.5" /><circle cx="14" cy="32.5" r="3.6" fill={BL} /><circle cx="34" cy="15.5" r="3.6" fill={BL} /></Ico>,
  },
  {
    id: "offset", label: "Offset",
    icon: <Ico><path d="M8 32L32 8" stroke={K} strokeWidth="3.4" /><path d="M16 40L40 16" stroke={K} strokeWidth="3.4" /><path d="M21 20.5L27 26.5" stroke={BL} strokeWidth="2" /><path d="M27.5 27l-1-4.6-3.6 3.6z" fill={BL} /><circle cx="20" cy="20" r="2.8" fill={BL} /></Ico>,
  },
  {
    id: "fillet", label: "Radius",
    icon: <Ico><path d="M10 40V24A14 14 0 0 1 24 10H40" stroke={K} strokeWidth="3.4" /><path d="M10 10L18 18" stroke={BL} strokeWidth="1.8" strokeDasharray="3 2.5" /><circle cx="10" cy="10" r="3.6" fill={BL} /></Ico>,
  },
  {
    id: "chamfer", label: "Chamfer",
    icon: <Ico><path d="M10 40V22L22 10H40" stroke={K} strokeWidth="3.4" /><path d="M10 22V10H22" stroke={BL} strokeWidth="1.8" strokeDasharray="3 2.5" /><circle cx="10" cy="10" r="3.6" fill={BL} /></Ico>,
  },
  {
    id: "alignH", label: "Align H",
    icon: (
      <Ico>
        <path d="M18 6L40 37" stroke={K} strokeWidth="3.2" />
        <path d="M7 38H40" stroke={R} strokeWidth="2.6" strokeDasharray="4 3" />
        <path d="M22 12Q8 20 10 33" stroke={GA} strokeWidth="2.4" />
        <Arrow x={10.3} y={34.5} angle={95} color={GA} />
      </Ico>
    ),
  },
  {
    // Fab's sketch: the line leaning right, the dashed vertical it turns to, the CCW arrow
    id: "alignV", label: "Align V",
    icon: (
      <Ico>
        <path d="M10 40L37 13" stroke={K} strokeWidth="3.2" />
        <path d="M9 39V7" stroke={R} strokeWidth="2.6" strokeDasharray="4 3" />
        <path d="M33 16Q24 7 14 7" stroke={GA} strokeWidth="2.4" />
        <Arrow x={12.5} y={7} angle={180} color={GA} />
      </Ico>
    ),
  },
  {
    id: "erase", label: "Erase",
    icon: (
      <Ico>
        <g transform="rotate(28 22 22)">
          <rect x="11" y="6" width="20" height="24" rx="1.5" fill="#8a8a8a" stroke={K} strokeWidth="2" />
          <rect x="11" y="27" width="20" height="6" fill={R} stroke={K} strokeWidth="2" />
        </g>
        <path d="M24 40H44" stroke={K} strokeWidth="3.2" />
      </Ico>
    ),
  },
  {
    id: "diameter", label: "Diameter",
    icon: (
      <Ico>
        <circle cx="24" cy="24" r="14" stroke={K} strokeWidth="2.6" />
        <path d="M6 42L42 6" stroke={R} strokeWidth="2" />
        {/* arrows from outside, tips on the circle */}
        <Arrow x={33.2} y={14.8} angle={135} color={R} />
        <Arrow x={14.8} y={33.2} angle={-45} color={R} />
      </Ico>
    ),
  },
  {
    id: "radius", label: "Radius",
    icon: (
      <Ico>
        <path d="M10 8A30 30 0 0 1 40 38" stroke={K} strokeWidth="3" />
        <path d="M9 37L30 16" stroke={R} strokeWidth="2.4" />
        <Arrow x={31} y={15} angle={-45} color={R} />
      </Ico>
    ),
  },
  {
    id: "dimension", label: "Length",
    icon: (
      <Ico>
        <path d="M6 34H42" stroke={K} strokeWidth="3.4" />
        <path d="M7 10V30M41 10V30" stroke={R} strokeWidth="1.8" />
        <path d="M12 15H36" stroke={R} strokeWidth="1.8" />
        <Arrow x={7.5} y={15} angle={180} color={R} />
        <Arrow x={40.5} y={15} angle={0} color={R} />
      </Ico>
    ),
  },
  {
    // Fab's sketch: a leaning line meeting a horizontal one, a red arc with arrows between them
    id: "angle", label: "Angle",
    icon: (
      <Ico>
        <path d="M8 8L18 37H43" stroke={K} strokeWidth="3.4" />
        {/* an arc around the corner (18,37), tips touching both lines */}
        <path d="M14.94 15.21A22 22 0 0 1 39.44 32.05" stroke={R} strokeWidth="2.2" />
        <Arrow x={11.94} y={15.85} angle={164} color={R} />
        <Arrow x={39.92} y={35.08} angle={85} color={R} />
      </Ico>
    ),
  },
  {
    // Fab's icon: the part (black) grows into the bigger red outline, a green arrow corner to corner
    id: "scale", label: "Scale",
    icon: (
      <Ico>
        <path d="M3.4 21V6.6H44.4V40.6H28.6" stroke={R} strokeWidth="3.2" strokeLinecap="butt" strokeLinejoin="miter" />
        <rect x="3.4" y="25.6" width="20.8" height="15" stroke={K} strokeWidth="3.2" strokeLinejoin="miter" />
        <path d="M26.6 22.5L37.6 13.2" stroke="#22b14c" strokeWidth="2.6" strokeLinecap="butt" />
        <path d="M43 8.6L39.4 16.3L34.9 11Z" fill="#22b14c" stroke="#22b14c" strokeWidth="1" />
      </Ico>
    ),
  },
  {
    id: "rotate", label: "Rotate",
    icon: (
      <Ico>
        <path d="M12 38H40V26H12" stroke={R} strokeWidth="2" strokeDasharray="3 3" strokeLinecap="butt" />
        <path d="M12 38L33.4 20L25.7 10.8L4.3 28.8Z" stroke={K} strokeWidth="3.2" strokeLinejoin="miter" />
        <path d="M45.7 33.3A34 34 0 0 0 41.6 21.3" stroke="#22b14c" strokeWidth="2.6" strokeLinecap="butt" />
        <path d="M38.7 16.6L44.6 19.4L38.6 23.2Z" fill="#22b14c" stroke="#22b14c" strokeWidth="1" />
        <circle cx="12" cy="38" r="3.8" fill={BL} />
      </Ico>
    ),
  },
  {
    id: "trace", label: "Trace",
    icon: <Ico><Nozzle beam={G} /><path d="M7 33L42 41" stroke={G} strokeWidth="4" /></Ico>,
  },
  {
    id: "openCut", label: "Open cut",
    icon: <Ico><Nozzle beam={R} /><path d="M7 41L42 32" stroke={R} strokeWidth="4" /></Ico>,
  },
  {
    // Fab's icon: a section through the plate, material hatched, the hole's walls in orange
    id: "hole", label: "Hole",
    icon: (
      <Ico>
        <rect x="7" y="11" width="10" height="26" stroke={K} strokeWidth="2" />
        <rect x="31" y="11" width="10" height="26" stroke={K} strokeWidth="2" />
        <path d="M17 11H31M17 37H31" stroke={K} strokeWidth="1.4" />
        <path d="M9 19L15 14M9 27L15 22M9 35L15 30M33 19L39 14M33 27L39 22M33 35L39 30" stroke={K} strokeWidth="1.8" />
        <path d="M18.6 11V37M29.4 11V37" stroke="#f47c20" strokeWidth="2.6" strokeLinecap="butt" />
      </Ico>
    ),
  },
  {
    // Fab's icon: two parts (green, blue) sharing a cut with a plate (black, with a window);
    // the shared cut lines in red
    id: "commonCut", label: "Common cut",
    icon: (
      <Ico>
        <path d="M7 7.2H22.8L25.6 10V22L23.3 24.3H7Z" fill="#22b14c" />
        <circle cx="14.3" cy="14.4" r="2.8" fill="#fff" />
        <path d="M7 25.6H23.3L25.6 27.9V38.8L23 42.5H13.9V34.5H7Z" fill="#00a2e8" />
        <rect x="7" y="23.6" width="16.3" height="2.2" fill={R} />
        <rect x="26.5" y="5.5" width="14.3" height="37" fill={K} />
        <rect x="34.7" y="14.1" width="4.1" height="19.4" fill="#fff" />
        <path d="M35.2 14.1V33H38.8" stroke={R} strokeWidth="1.1" strokeLinecap="butt" />
        <path d="M26.2 5.5V42.5" stroke={R} strokeWidth="0.9" strokeLinecap="butt" />
        <rect x="25.2" y="10.4" width="2.3" height="10.9" rx="1.15" fill={R} />
        <rect x="25.2" y="28.3" width="2.3" height="10.5" rx="1.15" fill={R} />
      </Ico>
    ),
  },
  {
    // Fab's icon: four colored bars
    id: "colourLines", label: "Color lines",
    icon: (
      <Ico>
        <rect x="10" y="9" width="28" height="7.4" fill="#404bd0" />
        <rect x="10" y="16.9" width="28" height="7.4" fill="#b5e61d" />
        <rect x="10" y="24.8" width="28" height="7.4" fill="#ed1c24" />
        <rect x="10" y="32.7" width="28" height="7.4" fill={K} />
      </Ico>
    ),
  },
  {
    // Fab's sketch: a rake (broom) sweeping, red line underneath
    id: "sweep", label: "Sweep",
    icon: (
      <Ico>
        <path d="M37 4L27.5 27" stroke={K} strokeWidth="3.6" />
        <path d="M15.5 25.5L37.5 33.5" stroke={K} strokeWidth="4.2" />
        {[0, 1, 2, 3, 4, 5, 6].map((k) => {
          const x = 15.2 + k * 3.25, y = 29.6 + k * 1.18;
          return <path key={k} d={`M${x} ${y}L${x - 1.4} ${y + 3.6}`} stroke={K} strokeWidth="1.9" />;
        })}
        <path d="M9 42H36" stroke={R} strokeWidth="3.2" strokeLinecap="butt" />
      </Ico>
    ),
  },
  {
    id: "checkLines", label: "Check lines",
    icon: (
      <Ico>
        <circle cx="19" cy="19" r="12.5" stroke={K} strokeWidth="3.2" />
        <path d="M10 15H19V24" stroke="#b9b9b9" strokeWidth="1.3" />
        <circle cx="19" cy="15" r="1.4" fill={R} />
        <path d="M28.5 28.5L42 42" stroke={K} strokeWidth="5" />
      </Ico>
    ),
  },
  {
    id: "process", label: "Process",
    icon: (
      <Ico>
        <path d={gear(15, 14, 7.5, 11, 8)} fill={K} />
        <circle cx="15" cy="14" r="3.2" fill="#fff" />
        <path d={gear(31, 31, 10, 14, 10)} fill={K} />
        <circle cx="31" cy="31" r="4.5" fill="#fff" />
      </Ico>
    ),
  },
];

/** Tools shown together under one button: it opens them below the strip (open until another group or this one is clicked). */
export const TOOL_GROUPS: { id: string; label: string; tone: "draw" | "dim"; tools: string[]; icon: ReactNode }[] = [
  {
    id: "drawGroup", label: "Drawing", tone: "draw", tools: ["line", "circle", "arc", "rect", "slot", "xline", "offset", "fillet", "chamfer"],
    icon: <Ico><path d="M12 10L37 37" stroke={K} strokeWidth="3.4" /><circle cx="12" cy="10" r="3.8" fill={BL} /><circle cx="37" cy="37" r="3.8" fill={BL} /></Ico>,
  },
  {
    id: "dimGroup", label: "Dimension", tone: "dim", tools: ["dimension", "diameter", "radius", "angle"],
    icon: (
      <Ico>
        <path d="M6 34H42" stroke={K} strokeWidth="3.4" />
        <path d="M7 10V30M41 10V30" stroke={R} strokeWidth="1.8" />
        <path d="M12 15H36" stroke={R} strokeWidth="1.8" />
        <Arrow x={7.5} y={15} angle={180} color={R} />
        <Arrow x={40.5} y={15} angle={0} color={R} />
      </Ico>
    ),
  },
];

/** The strip's order: single tools and groups (a group stands where its first tool stood). */
const STRIP: string[] = ["properties", "extend", "trim", "drawGroup", "alignH", "alignV", "erase", "dimGroup",
  ...IMPORT_TOOLS.map((t) => t.id).filter((id) => !["properties", "extend", "trim", "alignH", "alignV", "erase"].includes(id) && !TOOL_GROUPS.some((g) => g.tools.includes(id)))];

/** blocked: tools that cannot be used now, with the reason shown on hover (greyed out). */
/** lit: switches that are on besides the active tool (Check lines while the Geometry check panel is open). */
export function ImportToolStrip({ active, onTool, blocked = {}, lit = {} }: {
  active: string | null; onTool: (id: string) => void; blocked?: Record<string, string>; lit?: Record<string, boolean>;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const tool = (t: (typeof IMPORT_TOOLS)[number], onPick?: () => void) => (
    <button key={t.id} className={`itool${t.wide ? " is-wide" : ""}${active === t.id || lit[t.id] ? " is-on" : ""}`}
      aria-pressed={active === t.id || !!lit[t.id]} aria-disabled={blocked[t.id] ? true : undefined}
      // greyed out but still hoverable, so the tooltip can say why it is blocked
      title={blocked[t.id] ? `${t.label}: ${blocked[t.id]}` : t.label}
      onClick={() => { if (!blocked[t.id]) { onTool(t.id); onPick?.(); } }}>
      <span className="itool-box">{t.icon}</span>
      <span className="itool-label">{t.label}</span>
    </button>
  );
  // when not all tools fit (smaller screens) the strip scrolls sideways: arrows, wheel, drag, swipe
  return (
    <SideScroll className="itools" wrapClassName="itools-wrap" role="toolbar" label="Import tools" more="tools">
      {STRIP.map((id) => {
        const g = TOOL_GROUPS.find((x) => x.id === id);
        if (!g) { const t = IMPORT_TOOLS.find((x) => x.id === id); return t ? tool(t) : null; }
        return <ToolGroup key={g.id} group={g} active={active} open={open === g.id}
          onOpen={(v) => setOpen(v ? g.id : null)} renderTool={(t) => tool(t)} />;
      })}
    </SideScroll>
  );
}

/** A group's button: lit while one of its tools is on (showing that tool's icon). A click opens its tools below,
 *  and they stay open while tools are picked and used; another group's button or this one again closes them. */
function ToolGroup({ group, active, open, onOpen, renderTool }: {
  group: (typeof TOOL_GROUPS)[number]; active: string | null; open: boolean;
  onOpen: (v: boolean) => void; renderTool: (t: (typeof IMPORT_TOOLS)[number]) => ReactNode;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const cur = group.tools.includes(active ?? "") ? IMPORT_TOOLS.find((t) => t.id === active) : undefined;
  // kept below its button: also when the strip scrolls sideways or the window is resized
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (!btn.current) return;
      const r = btn.current.getBoundingClientRect();
      const w = pop.current?.offsetWidth ?? 0;
      setAt({ left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)), top: r.bottom + 6 });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);
  return (
    <>
      <button ref={btn} className={`itool itool-group is-${group.tone}${cur ? " is-on" : ""}${open ? " is-open" : ""}`}
        aria-haspopup="true" aria-expanded={open} title={cur ? `${group.label}: ${cur.label}` : `${group.label}: ${group.tools.map((id) => IMPORT_TOOLS.find((t) => t.id === id)?.label).join(", ")}`}
        onClick={() => onOpen(!open)}>
        <span className="itool-box">{cur ? cur.icon : group.icon}<span className="itool-caret" aria-hidden="true" /></span>
        <span className="itool-label">{cur ? cur.label : group.label}</span>
      </button>
      {open && createPortal(
        <div ref={pop} className={`itool-pop is-${group.tone}`} role="toolbar" aria-label={group.label}
          style={at ? { left: at.left, top: at.top } : { visibility: "hidden", left: 0, top: 0 }}>
          {group.tools.map((id) => { const t = IMPORT_TOOLS.find((x) => x.id === id); return t ? renderTool(t) : null; })}
        </div>, document.body)}
    </>
  );
}
