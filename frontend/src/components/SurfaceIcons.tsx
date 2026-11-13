// The part's surface: grain direction (three lines along it) and protective foil / finish on the top side.

/** Grain along X (horizontal lines) or Y (vertical lines). */
export function GrainIcon({ dir, size = 22 }: { dir: "x" | "y"; size?: number }) {
  const lines = [6, 11, 16];
  return (
    <svg viewBox="0 0 22 22" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      {lines.map((v) => (dir === "x" ? <path key={v} d={`M4 ${v}h14`} /> : <path key={v} d={`M${v} 4v14`} />))}
    </svg>
  );
}

/** A sheet with its foil peeling off one corner. */
export function FoilIcon({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 22 22" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 4.5h15v13h-9" />
      <path d="M3.5 4.5v8" />
      <path d="M3.5 12.5c2.5 0 5 1.2 6 5-2.6-.6-4.6-2.4-6-5z" fill="currentColor" fillOpacity=".25" />
    </svg>
  );
}

/** The badges for a part: grain and foil, as small chips. */
export function SurfaceBadges({ grain, foil }: { grain?: "x" | "y"; foil?: boolean }) {
  if (!grain && !foil) return null;
  return (
    <span className="surf-badges">
      {grain && <span className="surf-badge is-grain" title={`Grain along ${grain === "x" ? "X (the sheet's length)" : "Y"}: nesting keeps it so (turned only 180°)`}><GrainIcon dir={grain} /></span>}
      {foil && <span className="surf-badge is-foil" title="Protective foil / finish on the top side: never mirrored"><FoilIcon /></span>}
    </span>
  );
}
