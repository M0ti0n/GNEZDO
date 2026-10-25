import type { ReactNode } from "react";

// Tools of the import screen, drawn after Fab's icon sheet.
// Black = existing geometry, red = what the tool changes or measures, green = laser / direction.

const K = "#1b1b1b";
const R = "#e3262b";
const G = "#9acd32";

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
    id: "properties", label: "Properties", wide: true,
    icon: (
      <Ico w={80}>
        <rect x="14" y="5" width="30" height="38" stroke={K} strokeWidth="2.4" />
        <circle cx="21" cy="14" r="2.6" fill="#22b14c" /><rect x="26" y="11.5" width="13" height="5" fill={K} />
        <circle cx="21" cy="24" r="2.6" fill="#22b14c" /><rect x="26" y="21.5" width="13" height="5" fill={K} />
        <circle cx="21" cy="34" r="2.6" fill={R} /><rect x="26" y="31.5" width="13" height="5" fill={K} />
        <g transform="rotate(35 58 24)">
          <rect x="54" y="4" width="8" height="6" fill={R} stroke={K} strokeWidth="1.8" />
          <rect x="54" y="10" width="8" height="26" fill="#fff" stroke={K} strokeWidth="1.8" />
          <path d="M54 36L58 44L62 36" fill="#fff" stroke={K} strokeWidth="1.8" />
        </g>
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
    icon: <Ico><path d="M9 9L39 39" stroke={K} strokeWidth="3.4" /></Ico>,
  },
  {
    id: "align", label: "Align",
    icon: (
      <Ico>
        <path d="M18 6L40 37" stroke={K} strokeWidth="3.2" />
        <path d="M7 38H40" stroke={R} strokeWidth="2.6" strokeDasharray="4 3" />
        <path d="M22 12Q8 20 10 33" stroke={G} strokeWidth="2.4" />
        <Arrow x={10.3} y={34.5} angle={95} color={G} />
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
        <path d="M9 39L39 9" stroke={R} strokeWidth="2" />
        <Arrow x={39.5} y={8.5} angle={-45} color={R} />
        <Arrow x={8.5} y={39.5} angle={135} color={R} />
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
    id: "dimension", label: "Dimension",
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
    id: "trace", label: "Trace",
    icon: <Ico><Nozzle beam={G} /><path d="M7 33L42 41" stroke={G} strokeWidth="4" /></Ico>,
  },
  {
    id: "openCut", label: "Open cut",
    icon: <Ico><Nozzle beam={R} /><path d="M7 41L42 32" stroke={R} strokeWidth="4" /></Ico>,
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

export function ImportToolStrip({ active, onTool }: { active: string | null; onTool: (id: string) => void }) {
  return (
    <div className="itools" role="toolbar" aria-label="Import tools">
      {IMPORT_TOOLS.map((t) => (
        <button key={t.id} className={`itool${t.wide ? " is-wide" : ""}${active === t.id ? " is-on" : ""}`}
          aria-pressed={active === t.id} title={t.label} onClick={() => onTool(t.id)}>
          <span className="itool-box">{t.icon}</span>
          <span className="itool-label">{t.label}</span>
        </button>
      ))}
    </div>
  );
}
