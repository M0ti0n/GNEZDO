import { useCallback, useRef } from "react";

// Double click with the middle button (the wheel), as in CAD: Fit. Browsers send dblclick for the left
// button only, so two middle presses close together in time and place count as one.

const MS = 450, PX = 8;

/** Call the returned function on every pointer down; it calls onDouble on a middle double click (and says so). */
export function useMiddleDouble(onDouble: () => void) {
  const last = useRef<{ t: number; x: number; y: number } | null>(null);
  const cb = useRef(onDouble);
  cb.current = onDouble;
  return useCallback((e: { button: number; clientX: number; clientY: number }) => {
    if (e.button !== 1) return false;
    const now = performance.now(), l = last.current;
    if (l && now - l.t < MS && Math.hypot(e.clientX - l.x, e.clientY - l.y) < PX) {
      last.current = null;
      cb.current();
      return true;
    }
    last.current = { t: now, x: e.clientX, y: e.clientY };
    return false;
  }, []);
}
