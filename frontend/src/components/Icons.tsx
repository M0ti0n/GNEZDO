// Line icons drawn for this app (24×24 grid, stroke = currentColor).
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 20, children, ...rest }: P & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export const IconHome = (p: P) => (
  <Svg {...p}><path d="M3.5 11 12 4l8.5 7" /><path d="M6 9.5V20h12V9.5" /><path d="M10 20v-5h4v5" /></Svg>
);

// Drawing sheet with an arrow coming in
export const IconImport = (p: P) => (
  <Svg {...p}><path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z" /><path d="M14 3v5h5" /><path d="M12 10.5v6" /><path d="m9.5 14 2.5 2.5 2.5-2.5" /></Svg>
);

// Plate with a corner chamfer and a plus
export const IconNewJob = (p: P) => (
  <Svg {...p}><path d="M3 5h14l4 4v10H3z" /><path d="M12 9.5v6M9 12.5h6" /></Svg>
);

export const IconSearch = (p: P) => (
  <Svg {...p}><circle cx="10.5" cy="10.5" r="6" /><path d="m15 15 5.5 5.5" /><path d="M8 10.5h5" /></Svg>
);

export const IconSettings = (p: P) => (
  <Svg {...p}><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" /><circle cx="15" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="18" r="2" /></Svg>
);

// Three nested part outlines
export const IconLibrary = (p: P) => (
  <Svg {...p}><rect x="3" y="3" width="8" height="8" rx="0.5" /><path d="M13 3h8v8h-8z" /><circle cx="7" cy="17" r="4" /><path d="M13 13h8l-4 8z" /></Svg>
);

// Stacked sheets
export const IconStock = (p: P) => (
  <Svg {...p}><path d="M3 15.5 12 20l9-4.5" /><path d="M3 11.5 12 16l9-4.5" /><path d="M3 7.5 12 3l9 4.5L12 12z" /></Svg>
);

// Cutting head with beam
export const IconTechnology = (p: P) => (
  <Svg {...p}><path d="M8 3h8v5l-2 4h-4L8 8z" /><path d="M12 12v5" /><path d="M5 20h14" /><path d="M9.5 17.5 12 20l2.5-2.5" /></Svg>
);

export const IconChevronRight = (p: P) => <Svg {...p}><path d="m9 5 7 7-7 7" /></Svg>;
export const IconChevronLeft = (p: P) => <Svg {...p}><path d="m15 5-7 7 7 7" /></Svg>;
export const IconClose = (p: P) => <Svg {...p}><path d="M6 6l12 12M18 6 6 18" /></Svg>;
export const IconFolder = (p: P) => (
  <Svg {...p}><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" /></Svg>
);
export const IconLayers = (p: P) => (
  <Svg {...p}><path d="M4 8h16M4 12h10M4 16h13" /><circle cx="18" cy="12" r="1.5" /></Svg>
);
export const IconNest = (p: P) => (
  <Svg {...p}><rect x="3" y="4" width="18" height="16" /><path d="M6 7h5v5H6zM13 7h5v3h-5zM13 12h5v5h-5zM6 14h5v3H6z" /></Svg>
);
export const IconLock = (p: P) => (
  <Svg {...p}><rect x="5" y="10.5" width="14" height="10" rx="1" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></Svg>
);
export const IconReport = (p: P) => (
  <Svg {...p}><path d="M6 3h12v18H6z" /><path d="M9 8h6M9 12h6M9 16h3" /></Svg>
);
// Folder with an order tag
export const IconProject = (p: P) => (
  <Svg {...p}><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" /><path d="M8 13h8M8 16.5h5" /></Svg>
);
export const IconClock = (p: P) => (
  <Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></Svg>
);
// Ruler with a tick list: rules
export const IconRules = (p: P) => (
  <Svg {...p}><path d="M4 5h16M4 10h10M4 15h7" /><path d="m14 17 2 2 4-5" /></Svg>
);
