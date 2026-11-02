// GNEZDO menu -> Settings -> Manual nest: how the JOB PARTS list shows the parts. Kept in this browser.

export interface ManualView {
  /** 2: two columns of tiles (names cut, the whole name on hover); 1: one column of wider tiles */
  tileColumns: 1 | 2;
}

export const DEFAULT_MANUAL_VIEW: ManualView = { tileColumns: 2 };

const STORE = "gnezdo.manualView";

export function loadManualView(): ManualView {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? "null") as Partial<ManualView> | null;
    return { tileColumns: v?.tileColumns === 1 ? 1 : 2 };
  } catch {
    return DEFAULT_MANUAL_VIEW;
  }
}

export function saveManualView(v: ManualView) {
  try { localStorage.setItem(STORE, JSON.stringify(v)); } catch { /* this session only */ }
}
