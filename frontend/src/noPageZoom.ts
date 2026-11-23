// The browser's own page zoom is kept off GNEZDO's UI: Ctrl + mouse wheel (and a touchpad's pinch, which
// arrives as Ctrl + wheel) and Ctrl + / Ctrl − zoomed the whole page, so the toolbars and panels grew or
// shrank by accident while a drawing was zoomed. Ctrl 0 (back to 100 %) still works.
//
// Only the browser's default is stopped (preventDefault, no stopPropagation): the drawing views' own wheel
// zoom (Import 2D, Manual nest, 3D Extractor …) still gets the event, Ctrl held or not.

export function blockPageZoom(): void {
  window.addEventListener("wheel", (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false, capture: true });
  window.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (e.key === "+" || e.key === "=" || e.key === "-" || e.key === "_" || e.code === "NumpadAdd" || e.code === "NumpadSubtract")
      e.preventDefault();
  }, { capture: true });
}
