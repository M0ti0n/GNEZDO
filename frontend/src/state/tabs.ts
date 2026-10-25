// Open tabs, like a browser: Home is always first and cannot be closed.
// Each job opens in its own tab; the other pages open once and are re-used.

export type TabKind = "home" | "import" | "jobSearch" | "projects" | "settings" | "library" | "stock" | "technology" | "job" | "project";

export interface Tab {
  id: string;
  kind: TabKind;
  title: string;
  jobId?: string;
}

export interface TabsState {
  tabs: Tab[];
  activeId: string;
}

export type TabsAction =
  | { type: "open"; tab: Tab }
  | { type: "activate"; id: string }
  | { type: "close"; id: string };

export const HOME: Tab = { id: "home", kind: "home", title: "Home" };

export const initialTabs: TabsState = { tabs: [HOME], activeId: HOME.id };

export const pageTab = (kind: Exclude<TabKind, "home" | "job" | "project">): Tab => ({
  id: kind,
  kind,
  title: {
    import: "Import",
    jobSearch: "Job search",
    projects: "Projects",
    settings: "Settings",
    library: "Parts library",
    stock: "Stock & remnants",
    technology: "Technology table",
  }[kind],
});

export const jobTab = (jobId: string, name: string): Tab => ({
  id: `job:${jobId}`,
  kind: "job",
  title: name,
  jobId,
});

export const projectTab = (code: string): Tab => ({
  id: `project:${code}`,
  kind: "project",
  title: code,
});

export function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  switch (action.type) {
    case "open": {
      const exists = state.tabs.some((t) => t.id === action.tab.id);
      return {
        tabs: exists ? state.tabs : [...state.tabs, action.tab],
        activeId: action.tab.id,
      };
    }
    case "activate":
      return { ...state, activeId: action.id };
    case "close": {
      if (action.id === HOME.id) return state;
      const i = state.tabs.findIndex((t) => t.id === action.id);
      if (i < 0) return state;
      const tabs = state.tabs.filter((t) => t.id !== action.id);
      const activeId =
        state.activeId === action.id ? tabs[Math.min(i, tabs.length - 1)].id : state.activeId;
      return { tabs, activeId };
    }
  }
}
