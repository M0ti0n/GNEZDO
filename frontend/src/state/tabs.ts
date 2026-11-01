// The main area shows either a *view* (Home, Job search, Import, Settings ...), chosen from the
// side rail or the GNEZDO menu, or an open *document tab* (a job, later a part) from the green bar.

export type ViewKind = "home" | "jobSearch" | "import" | "projects" | "settings" | "rules" | "stock" | "technology";
export type TabKind = "job" | "part" | "drawing";   // drawing = an imported file being checked
export type PageKind = ViewKind | TabKind;

export interface Tab {
  id: string;
  kind: TabKind;
  title: string;
  jobId?: string;
  drawingId?: string;
}

export interface ShellState {
  view: ViewKind;
  tabs: Tab[];
  activeId: string | null;   // null = the view is shown
}

export type ShellAction =
  | { type: "view"; view: ViewKind }
  | { type: "open"; tab: Tab }
  | { type: "activate"; id: string }
  | { type: "close"; id: string }
  | { type: "rename"; id: string; title: string };

export const initialShell: ShellState = { view: "home", tabs: [], activeId: null };

export const VIEW_TITLE: Record<ViewKind, string> = {
  home: "Home",
  jobSearch: "Job search",
  import: "Import",
  projects: "Projects",
  settings: "Settings",
  rules: "Rules",
  stock: "Stock & remnants",
  technology: "Technology table",
};

export const jobTab = (jobId: string, name: string): Tab => ({
  id: `job:${jobId}`,
  kind: "job",
  title: name,
  jobId,
});

export const drawingTab = (drawingId: string, fileName: string): Tab => ({
  id: `drawing:${drawingId}`,
  kind: "drawing",
  title: fileName,
  drawingId,
});

export function shellReducer(state: ShellState, action: ShellAction): ShellState {
  switch (action.type) {
    case "view":
      return { ...state, view: action.view, activeId: null };
    case "open": {
      const exists = state.tabs.some((t) => t.id === action.tab.id);
      return { ...state, tabs: exists ? state.tabs : [...state.tabs, action.tab], activeId: action.tab.id };
    }
    case "activate":
      return { ...state, activeId: action.id };
    case "rename":
      return { ...state, tabs: state.tabs.map((t) => (t.id === action.id ? { ...t, title: action.title } : t)) };
    case "close": {
      const i = state.tabs.findIndex((t) => t.id === action.id);
      if (i < 0) return state;
      const tabs = state.tabs.filter((t) => t.id !== action.id);
      // closing the shown tab shows its neighbour, or the view when it was the last one
      const activeId = state.activeId !== action.id
        ? state.activeId
        : tabs.length ? tabs[Math.min(i, tabs.length - 1)].id : null;
      return { ...state, tabs, activeId };
    }
  }
}
