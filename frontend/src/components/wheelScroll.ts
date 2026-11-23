// The report's pages lie in a row: the mouse wheel scrolls them sideways (no Shift needed), as a page row
// would be read. A trackpad's own sideways swipe and Shift + wheel still work as before.

import { useEffect, type RefObject } from "react";

export function useWheelSideways(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;   // Ctrl (page zoom, blocked: noPageZoom), or already sideways
      if (el.scrollWidth <= el.clientWidth) return;                         // nothing to scroll
      const by = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * el.clientWidth : e.deltaY;
      const before = el.scrollLeft;
      el.scrollLeft += by;
      if (el.scrollLeft !== before) e.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [ref]);
}
