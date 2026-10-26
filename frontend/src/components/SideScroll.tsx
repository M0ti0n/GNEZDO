import { useEffect, useRef, useState, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Class of the scrolling row itself (its own layout stays as it was). */
  className: string;
  /** Class of the wrapper around the row and the arrows. */
  wrapClassName?: string;
  role?: string;
  label: string;
  /** What the arrows show more of, for their tooltip: "tools", "tabs". */
  more: string;
  /** Changing this brings the element marked .is-active into view (a tab just opened or chosen). */
  activeKey?: string | null;
}

const Chevron = ({ left }: { left?: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <path d={left ? "M10 3 5 8l5 5" : "M6 3l5 5-5 5"} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Room the arrow buttons cover at each end, kept clear when bringing something into view. */
const ARROW = 44;

// A row that scrolls sideways when not everything fits: arrows at the ends, the mouse wheel
// scrolls sideways and the row can be dragged with the mouse (a drag is not a click).
// Touch screens swipe as usual.
export function SideScroll({ children, className, wrapClassName = "", role, label, more, activeKey }: Props) {
  const row = useRef<HTMLDivElement>(null);
  const [ends, setEnds] = useState({ left: false, right: false });
  const update = () => {
    const el = row.current;
    if (el) setEnds({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
  };

  useEffect(() => {
    const el = row.current;
    if (!el) return;
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    // children coming and going (tabs opened or closed) change the width too
    const mo = new MutationObserver(update);
    mo.observe(el, { childList: true, subtree: true });
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!d) return;
      e.preventDefault();
      el.scrollLeft += d;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => { ro.disconnect(); mo.disconnect(); el.removeEventListener("wheel", onWheel); };
  }, []);

  // the chosen element is scrolled into view, clear of the arrows
  useEffect(() => {
    const el = row.current;
    const item = el?.querySelector<HTMLElement>(".is-active");
    if (!el || !item) return;
    const box = el.getBoundingClientRect();
    const r = item.getBoundingClientRect();
    if (r.left < box.left + ARROW) el.scrollLeft -= box.left + ARROW - r.left;
    else if (r.right > box.right - ARROW) el.scrollLeft += r.right - (box.right - ARROW);
    update();
  }, [activeKey]);

  const page = (dir: 1 | -1) => row.current?.scrollBy({ left: dir * row.current.clientWidth * 0.7, behavior: "smooth" });

  // mouse drag (touch scrolls natively)
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const dragged = useRef(false);
  const [dragging, setDragging] = useState(false);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || e.button !== 0 || !row.current) return;
    drag.current = { x: e.clientX, left: row.current.scrollLeft, moved: false };
    dragged.current = false;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !row.current) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) > 5) { d.moved = true; setDragging(true); row.current.setPointerCapture(e.pointerId); }
    if (d.moved) row.current.scrollLeft = d.left - dx;
  };
  const onPointerUp = () => { dragged.current = !!drag.current?.moved; drag.current = null; setDragging(false); };
  // the click that ends a drag does not press whatever is under the mouse
  const onClickCapture = (e: React.MouseEvent) => {
    if (!dragged.current) return;
    dragged.current = false;
    e.stopPropagation();
    e.preventDefault();
  };

  return (
    <div className={`sidescroll ${wrapClassName}`}>
      {ends.left && (
        <button type="button" className="sidescroll-more is-left" onClick={() => page(-1)} aria-label={`More ${more} to the left`} title={`More ${more}`}>
          <span className="sidescroll-btn"><Chevron left /></span>
        </button>
      )}
      <div ref={row} className={`${className}${dragging ? " is-dragging" : ""}`} role={role} aria-label={label} onScroll={update}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onClickCapture={onClickCapture}>
        {children}
      </div>
      {ends.right && (
        <button type="button" className="sidescroll-more is-right" onClick={() => page(1)} aria-label={`More ${more} to the right`} title={`More ${more}`}>
          <span className="sidescroll-btn"><Chevron /></span>
        </button>
      )}
    </div>
  );
}
