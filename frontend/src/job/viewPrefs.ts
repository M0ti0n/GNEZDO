// How the cut path is drawn (Settings -> Personal -> Cut path): kept in this browser.

import { useEffect, useState } from "react";

export interface ViewPrefs {
  /** arrows on the rapid moves (dashed), the way the head travels */
  rapidArrows: boolean;
  /** small arrows on the cut contours, the cutting direction */
  cutArrows: boolean;
}

const KEY = "gnezdo.viewPrefs";
const EVENT = "gnezdo-viewprefs";
export const DEFAULT_VIEW_PREFS: ViewPrefs = { rapidArrows: true, cutArrows: true };

export function loadViewPrefs(): ViewPrefs {
  try { return { ...DEFAULT_VIEW_PREFS, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<ViewPrefs>) }; } catch { return { ...DEFAULT_VIEW_PREFS }; }
}

export function saveViewPrefs(p: ViewPrefs) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* not kept */ }
  window.dispatchEvent(new Event(EVENT));
}

/** The prefs, kept up to date when Settings changes them. */
export function useViewPrefs(): ViewPrefs {
  const [p, setP] = useState(loadViewPrefs);
  useEffect(() => {
    const on = () => setP(loadViewPrefs());
    window.addEventListener(EVENT, on);
    window.addEventListener("storage", on);
    return () => { window.removeEventListener(EVENT, on); window.removeEventListener("storage", on); };
  }, []);
  return p;
}
