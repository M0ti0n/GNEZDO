import type { ReactNode } from "react";
import type { PageKind } from "../state/tabs";
import {
  IconFolder, IconImport, IconLayers, IconLibrary, IconLock, IconNest, IconNewJob,
  IconReport, IconStock,
} from "../components/Icons";

export interface Tool {
  id: string;
  label: string;
  icon: ReactNode;
  tone?: Tone;          // color shared with the matching home tile
  disabled?: boolean;   // not built yet
  count?: number;       // a small number on the button (files waiting in Import)
}

export type Tone = "blue" | "green" | "yellow" | "plum" | "brown";

export type ToolAction = (toolId: string) => void;

// Tools shown under the tabs, one set per kind of tab.
// Tools that are not built yet are shown disabled so the layout is already final.
export const toolsFor = (kind: PageKind): Tool[] => {
  switch (kind) {
    case "home":
      return [
        { id: "import", label: "Import", icon: <IconImport />, tone: "blue" },
        { id: "newJob", label: "New job", icon: <IconNewJob />, tone: "green" },
      ];
    case "import":
      return [
        { id: "chooseFolder", label: "Choose folder", icon: <IconFolder />, disabled: true },
        { id: "layerRules", label: "Layer rules", icon: <IconLayers />, disabled: true },
      ];
    case "job":
      return [
        { id: "addParts", label: "Add parts", icon: <IconLibrary />, tone: "brown" },
        { id: "sheets", label: "Stock sheets", icon: <IconStock />, disabled: true },
        { id: "nest", label: "Auto nest", icon: <IconNest />, disabled: true },
        { id: "lock", label: "Lock sheet", icon: <IconLock />, disabled: true },
        { id: "report", label: "Report", icon: <IconReport />, disabled: true },
      ];
    default:
      return [];
  }
};

export function ToolStrip({ tools, onTool }: { tools: Tool[]; onTool: ToolAction }) {
  return (
    <div className="toolstrip" role="toolbar" aria-label="Tools">
      {tools.length === 0 && <span className="toolstrip-empty">No tools on this page yet</span>}
      {tools.map((t) => (
        <button
          key={t.id}
          className={`tool${t.tone ? ` tone-${t.tone}` : ""}`}
          disabled={t.disabled}
          title={t.disabled ? `${t.label} (not built yet)` : t.label}
          onClick={() => onTool(t.id)}
        >
          {t.icon}
          <span>{t.label}</span>
          {!!t.count && <span className="tool-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
