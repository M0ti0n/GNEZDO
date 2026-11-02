import { useRef, useState } from "react";

/**
 * Selecting items of a list as in Explorer: a click selects that item only, Ctrl+click adds or
 * removes one, Shift+click selects the range from the last item clicked, Ctrl+Shift+click adds
 * that range. `order` is the list as shown (the range follows it).
 */
export function useListSelection(order: string[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const click = (id: string, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    const add = e.ctrlKey || e.metaKey;
    const a = anchor.current ? order.indexOf(anchor.current) : -1;
    if (e.shiftKey && a >= 0) {
      const b = order.indexOf(id);
      const range = order.slice(Math.min(a, b), Math.max(a, b) + 1);
      setSelected((s) => new Set(add ? [...s, ...range] : range));
      return;   // the range keeps its start, as in Explorer
    }
    anchor.current = id;
    if (add) setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    else setSelected(new Set([id]));
  };
  return { selected, setSelected, click };
}
