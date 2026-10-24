import type { ReactNode } from "react";
import type { Tone } from "../shell/ToolStrip";

interface Props {
  icon: ReactNode;
  title: string;
  description: string;
  tone: Tone;
  onClick: () => void;
}

// A home-page shortcut drawn like a cut part: coloured plate, chamfered
// corner and a pierce hole.
export function Tile({ icon, title, description, tone, onClick }: Props) {
  return (
    <button className={`tile tone-${tone}`} onClick={onClick}>
      <span className="tile-hole" aria-hidden="true" />
      <span className="tile-icon">{icon}</span>
      <span className="tile-title">{title}</span>
      <span className="tile-desc">{description}</span>
    </button>
  );
}
