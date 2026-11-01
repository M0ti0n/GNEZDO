import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { JobPart } from "../api/types";
import type { Origin } from "../job/machine";
import { partColor, type NestedSheet, type PlacedPart, type Solution } from "../job/nest";
import { Lock } from "./NestView";
import { actionOf, loadKeys, type KeyAction } from "../job/manualKeys";
import {
  inMaterial, partLoops, placed, problems, rotateGroup, slideDistance, unionBox, usableBox,
  type Box, type Dir, type Placed, type Pt,
} from "../job/manualGeom";

type PartRef = { path: string; areaMm2: number; name: string; no?: number };

// Manual nesting of one sheet (EDIT / VIEW on a sheet card). The parts on the sheet are moved with
// the mouse or the keys (Settings -> Manual nest), parts come from the JOB PARTS panel by drag and
// drop, overlapping parts glow red. Every finished change goes to the solution at once; FINISH
// goes back to the sheets.
export function ManualNest({ sol, index, sheets, jobParts, parts: byId, edit, origin, counts, onIndex, onClose, onChange, onInfo, locked, onToggleLock }: {
  locked: boolean; onToggleLock: () => void;
  sol: Solution; index: number; sheets: NestedSheet[]; jobParts: JobPart[]; parts: Map<string, PartRef>;
  /** false: the sheet is locked (VIEW): look only */
  edit: boolean;
  origin: Origin;
  /** pieces per part nested in the solution (every sheet, times its cut number) */
  counts: Record<string, number>;
  onIndex: (i: number) => void; onClose: () => void;
  onChange: (index: number, parts: PlacedPart[]) => void;
  onInfo: (index: number) => void;
}) {
  const sheet = sheets[index];
  const keys = useMemo(loadKeys, []);
  const gap = sheet.partGapMm ?? 5;
  const usable = useMemo(() => usableBox(sheet, origin), [sheet, origin]);
  const outline = sheet.outline?.length ? (sheet.outline as Pt[][]) : undefined;
  const edgeGap = sheet.trims ? Math.max(sheet.trims.xMinus, sheet.trims.xPlus, sheet.trims.yMinus, sheet.trims.yPlus) : 0;

  // the sheet's parts as being edited; a finished change goes to the solution (onChange)
  const [items, setItems] = useState<PlacedPart[]>(sheet.parts);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [sel, setSel] = useState<Set<number>>(new Set());
  const selRef = useRef(sel);
  selRef.current = sel;
  const undo = useRef<{ back: PlacedPart[][]; fwd: PlacedPart[][] }>({ back: [], fwd: [] });
  useEffect(() => { setItems(sheet.parts); setSel(new Set()); undo.current = { back: [], fwd: [] }; }, [index]);   // another sheet
  useEffect(() => { if (sheet.parts !== itemsRef.current && !dragging.current) setItems(sheet.parts); }, [sheet.parts]);

  const commit = useCallback((next: PlacedPart[], before: PlacedPart[]) => {
    undo.current.back.push(before);
    undo.current.fwd = [];
    setItems(next);
    onChange(index, next);
  }, [index, onChange]);

  const geo = useMemo(() => items.map((p) => { const r = byId.get(p.partId); return r ? placed(r.path, p) : null; }), [items, byId]);
  const bad = useMemo(() => {
    const idx: number[] = [];
    geo.forEach((g, i) => g && idx.push(i));
    const b = problems(idx.map((i) => geo[i]!), usable, gap, outline);
    return new Set([...b].map((k) => idx[k]));
  }, [geo, usable, gap, outline]);

  // -- view: mm -> screen px, fitted to the canvas; wheel zooms, middle / right button pans --------
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  const [view, setViewState] = useState<{ s: number; tx: number; ty: number } | null>(null);
  // zoom: from the whole sheet (furthest out) to MAX_ZOOM px per mm (a 20 x 20 mm part about 200 px)
  const MAX_ZOOM = 10, PAD = 24;
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const fitScale = (w: number, h: number) => Math.min((w - 2 * PAD) / sheet.lengthMm, (h - 2 * PAD) / sheet.widthMm);
  /** Keeps the zoom between the whole sheet and MAX_ZOOM, and the sheet in view. */
  const clampView = useCallback((v: { s: number; tx: number; ty: number }) => {
    const { w, h } = sizeRef.current;
    const lo = fitScale(w, h);
    const s = Math.min(Math.max(v.s, lo), Math.max(lo, MAX_ZOOM));
    const k = s / v.s;
    let { tx, ty } = v;
    if (k !== 1) { tx = w / 2 - (w / 2 - tx) * k; ty = h / 2 - (h / 2 - ty) * k; }
    const L = sheet.lengthMm * s, W = sheet.widthMm * s;
    tx = L + 2 * PAD <= w ? (w - L) / 2 : Math.min(PAD, Math.max(w - L - PAD, tx));
    ty = W + 2 * PAD <= h ? (h - W) / 2 : Math.min(PAD, Math.max(h - W - PAD, ty));
    return { s, tx, ty };
  }, [sheet.lengthMm, sheet.widthMm]);   // eslint-disable-line react-hooks/exhaustive-deps
  const setView = useCallback((f: ((v: { s: number; tx: number; ty: number } | null) => { s: number; tx: number; ty: number } | null) | { s: number; tx: number; ty: number }) =>
    setViewState((v) => { const n = typeof f === "function" ? f(v) : f; return n && clampView(n); }), [clampView]);
  const fit = useCallback((w: number, h: number) => {
    const s = fitScale(w, h);
    sizeRef.current = { w, h };
    setView({ s, tx: (w - sheet.lengthMm * s) / 2, ty: (h - sheet.widthMm * s) / 2 });
  }, [sheet.lengthMm, sheet.widthMm, setView]);   // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { const r = el.getBoundingClientRect(); setSize({ w: r.width, h: r.height }); fit(r.width, r.height); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);
  useEffect(() => { fit(size.w, size.h); }, [index]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      setView((v) => {
        if (!v) return v;
        // the zoom limits first, so the point under the pointer stays where it is
        const lo = fitScale(sizeRef.current.w, sizeRef.current.h);
        const s = Math.min(Math.max(v.s * Math.exp(-e.deltaY * 0.0015), lo), Math.max(lo, MAX_ZOOM));
        const k = s / v.s;
        return { s, tx: mx - (mx - v.tx) * k, ty: my - (my - v.ty) * k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [setView]);   // eslint-disable-line react-hooks/exhaustive-deps
  const toMm = (px: number, py: number): Pt => (view ? [(px - view.tx) / view.s, (py - view.ty) / view.s] : [0, 0]);
  const local = (e: { clientX: number; clientY: number }) => {
    const r = host.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const hit = (x: number, y: number): number => {
    for (let i = geo.length - 1; i >= 0; i--) if (geo[i] && inMaterial(geo[i]!, x, y)) return i;
    return -1;
  };

  // -- moving the selection -------------------------------------------------------------------
  const moved = (list: PlacedPart[], ids: Set<number>, dx: number, dy: number) =>
    list.map((p, i) => (ids.has(i) ? { ...p, x: p.x + dx, y: p.y + dy } : p));
  const geoOf = (list: PlacedPart[], i: number) => { const r = byId.get(list[i].partId); return r ? placed(r.path, list[i]) : null; };
  /** How far the selection can slide in a direction (to the next part or the edge, with the gaps). */
  const slide = (list: PlacedPart[], ids: Set<number>, dir: Dir) => {
    const group = [...ids].map((i) => geoOf(list, i)).filter((g): g is Placed => !!g);
    const others = list.map((_, i) => (ids.has(i) ? null : geoOf(list, i))).filter((g): g is Placed => !!g);
    if (!group.length) return list;
    const t = slideDistance(group, others, usable, gap, dir, outline, edgeGap);
    if (t <= 0) return list;
    const [dx, dy] = dir === "up" ? [0, -t] : dir === "down" ? [0, t] : dir === "left" ? [-t, 0] : [t, 0];
    return moved(list, ids, dx, dy);
  };
  /** Ctrl + drop on a part: the selection goes next to it, on the side it was dropped, with the gap. */
  const snapTo = (list: PlacedPart[], ids: Set<number>, target: number) => {
    const g = unionBox([...ids].map((i) => geoOf(list, i)?.box).filter((b): b is Box => !!b));
    const t = geoOf(list, target)?.box;
    if (!t || !isFinite(g.x0)) return list;
    const dx = (g.x0 + g.x1) / 2 - (t.x0 + t.x1) / 2, dy = (g.y0 + g.y1) / 2 - (t.y0 + t.y1) / 2;
    const horiz = Math.abs(dx) / (g.x1 - g.x0 + t.x1 - t.x0 || 1) >= Math.abs(dy) / (g.y1 - g.y0 + t.y1 - t.y0 || 1);
    // first just outside the part on that side, then slide back towards it until the gap
    let ox = 0, oy = 0;
    if (horiz) ox = dx >= 0 ? t.x1 + gap + 2 - g.x0 : t.x0 - gap - 2 - g.x1;
    else oy = dy >= 0 ? t.y1 + gap + 2 - g.y0 : t.y0 - gap - 2 - g.y1;
    // and along the part, inside the usable area
    if (horiz) oy = Math.min(Math.max(0, usable.y0 - g.y0), usable.y1 - g.y1 < 0 ? usable.y1 - g.y1 : 0) || oy;
    else ox = Math.min(Math.max(0, usable.x0 - g.x0), usable.x1 - g.x1 < 0 ? usable.x1 - g.x1 : 0) || ox;
    const out = moved(list, ids, ox, oy);
    const dir: Dir = horiz ? (dx >= 0 ? "left" : "right") : (dy >= 0 ? "up" : "down");
    return slide(out, ids, dir);
  };

  const step = (list: PlacedPart[], a: KeyAction): PlacedPart[] => {
    const ids = selRef.current;
    if (!ids.size) return list;
    switch (a) {
      case "up": return moved(list, ids, 0, -1);
      case "down": return moved(list, ids, 0, 1);
      case "left": return moved(list, ids, -1, 0);
      case "right": return moved(list, ids, 1, 0);
      default: {
        const deg = a === "rotCw1" ? 1 : a === "rotCw45" ? 45 : a === "rotCcw1" ? -1 : -45;
        const idx = [...ids];
        const boxes = idx.map((i) => geoOf(list, i)?.box).filter((b): b is Box => !!b);
        const turned = rotateGroup(idx.map((i) => list[i]), boxes, deg);
        const next = list.slice();
        idx.forEach((i, k) => { next[i] = turned[k]; });
        return next;
      }
    }
  };

  // -- keys: a press moves 1 mm / turns 1°; held, 10 steps a second; Ctrl + direction slides -------
  const hold = useRef<{ code: string; before: PlacedPart[]; timer: number } | null>(null);
  useEffect(() => {
    const busy = (e: KeyboardEvent) => !!document.querySelector(".dlg") || !!(e.target as HTMLElement)?.closest("input, select, textarea");
    const onDown = (e: KeyboardEvent) => {
      if (busy(e)) return;
      if (e.key === "Escape") { setSel(new Set()); return; }
      if (!edit) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z") && !e.shiftKey) {
        e.preventDefault();
        const prev = undo.current.back.pop();
        if (prev) { undo.current.fwd.push(itemsRef.current); setItems(prev); setSel(new Set()); onChange(index, prev); }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || e.key === "Y" || ((e.key === "z" || e.key === "Z") && e.shiftKey))) {
        e.preventDefault();
        const nxt = undo.current.fwd.pop();
        if (nxt) { undo.current.back.push(itemsRef.current); setItems(nxt); setSel(new Set()); onChange(index, nxt); }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "a" || e.key === "A")) {
        e.preventDefault();
        setSel(new Set(itemsRef.current.map((_, i) => i)));
        return;
      }
      if (e.key === "Delete" && selRef.current.size) {
        e.preventDefault();
        const before = itemsRef.current;
        commit(before.filter((_, i) => !selRef.current.has(i)), before);
        setSel(new Set());
        return;
      }
      const a = actionOf(keys, e.code);
      if (!a || !selRef.current.size) return;
      e.preventDefault();
      if (e.repeat || hold.current) return;
      const before = itemsRef.current;
      if ((e.ctrlKey || e.metaKey) && (a === "up" || a === "down" || a === "left" || a === "right")) {
        const next = slide(before, selRef.current, a);
        if (next !== before) commit(next, before);
        return;
      }
      setItems((l) => step(l, a));
      // held: after a moment, 10 steps a second until the key is let go
      const start = window.setTimeout(() => {
        if (!hold.current) return;
        hold.current.timer = window.setInterval(() => setItems((l) => step(l, a)), 100);
      }, 300);
      hold.current = { code: e.code, before, timer: start };
    };
    const end = () => {
      const h = hold.current;
      if (!h) return;
      window.clearTimeout(h.timer);
      window.clearInterval(h.timer);
      hold.current = null;
      if (itemsRef.current !== h.before) commit(itemsRef.current, h.before);
    };
    const onUp = (e: KeyboardEvent) => { if (hold.current && e.code === hold.current.code) end(); };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", end);
    return () => { window.removeEventListener("keydown", onDown); window.removeEventListener("keyup", onUp); window.removeEventListener("blur", end); };
  });   // every render: the handlers see the current sheet and selection

  // -- mouse: click / drag parts, window selection, pan ---------------------------------------
  const dragging = useRef<{ start: Pt; before: PlacedPart[]; ids: Set<number>; moved: boolean; px: { x: number; y: number } } | null>(null);
  const pan = useRef<{ x: number; y: number } | null>(null);
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [hover, setHover] = useState(-1);
  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const p = local(e);
    if (e.button === 1 || e.button === 2) { pan.current = { x: e.clientX, y: e.clientY }; return; }
    if (e.button !== 0) return;
    const [x, y] = toMm(p.x, p.y);
    const i = hit(x, y);
    if (i >= 0) {
      let ids = sel;
      if (e.shiftKey) { ids = new Set(sel); if (ids.has(i)) ids.delete(i); else ids.add(i); }
      else if (!sel.has(i)) ids = new Set([i]);
      setSel(ids);
      if (edit && ids.has(i)) dragging.current = { start: [x, y], before: items, ids, moved: false, px: p };
      return;
    }
    setBox({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    if (!e.shiftKey) setSel(new Set());
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = local(e);
    if (pan.current) {
      const dx = e.clientX - pan.current.x, dy = e.clientY - pan.current.y;
      pan.current = { x: e.clientX, y: e.clientY };
      setView((v) => v && { ...v, tx: v.tx + dx, ty: v.ty + dy });
      return;
    }
    if (box) { setBox((b) => b && { ...b, x1: p.x, y1: p.y }); return; }
    const d = dragging.current;
    const [x, y] = toMm(p.x, p.y);
    if (d) {
      if (!d.moved && Math.hypot(p.x - d.px.x, p.y - d.px.y) < 3) return;
      d.moved = true;
      setItems(moved(d.before, d.ids, x - d.start[0], y - d.start[1]));
      return;
    }
    setHover(hit(x, y));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (pan.current) { pan.current = null; return; }
    if (box) {
      const b = box;
      setBox(null);
      if (Math.abs(b.x1 - b.x0) < 3 && Math.abs(b.y1 - b.y0) < 3) return;
      // left to right: window (parts wholly inside); right to left: crossing (parts touched)
      const crossing = b.x1 < b.x0;
      const [ax, ay] = toMm(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1));
      const [bx, by] = toMm(Math.max(b.x0, b.x1), Math.max(b.y0, b.y1));
      const ids = new Set(e.shiftKey ? sel : []);
      geo.forEach((g, i) => {
        if (!g) return;
        const q = g.box;
        const inside = q.x0 >= ax && q.x1 <= bx && q.y0 >= ay && q.y1 <= by;
        const touched = q.x1 >= ax && q.x0 <= bx && q.y1 >= ay && q.y0 <= by &&
          (g.samples.some(([x, y]) => x >= ax && x <= bx && y >= ay && y <= by) || inMaterial(g, (ax + bx) / 2, (ay + by) / 2));
        if (crossing ? touched : inside) ids.add(i);
      });
      setSel(ids);
      return;
    }
    const d = dragging.current;
    dragging.current = null;
    if (!d || !d.moved) return;
    let next = itemsRef.current;
    if (e.ctrlKey || e.metaKey) {
      const p = local(e);
      const [x, y] = toMm(p.x, p.y);
      // the part under the pointer that is not being dragged
      let target = -1;
      for (let i = geo.length - 1; i >= 0; i--) if (!d.ids.has(i) && geoOf(next, i) && inMaterial(geoOf(next, i)!, x, y)) { target = i; break; }
      if (target < 0) {
        // or the nearest one around the dropped group
        const g = unionBox([...d.ids].map((i) => geoOf(next, i)?.box).filter((b): b is Box => !!b));
        let best = Infinity;
        next.forEach((_, i) => {
          if (d.ids.has(i)) return;
          const q = geoOf(next, i)?.box;
          if (!q) return;
          const dd = Math.max(0, q.x0 - g.x1, g.x0 - q.x1) + Math.max(0, q.y0 - g.y1, g.y0 - q.y1);
          if (dd < best) { best = dd; target = i; }
        });
      }
      if (target >= 0) next = snapTo(next, d.ids, target);
    }
    commit(next, d.before);
  };

  // -- parts from the JOB PARTS panel -----------------------------------------------------------
  const onDrop = (e: React.DragEvent) => {
    const id = e.dataTransfer.getData("text/gnezdo-part");
    const ref = id ? byId.get(id) : undefined;
    if (!edit || !ref) return;
    e.preventDefault();
    const p = local(e);
    const [x, y] = toMm(p.x, p.y);
    const lp = partLoops(ref.path)[0] ?? [];
    const cx = (Math.min(...lp.map((q) => q[0])) + Math.max(...lp.map((q) => q[0]))) / 2;
    const cy = (Math.min(...lp.map((q) => q[1])) + Math.max(...lp.map((q) => q[1]))) / 2;
    const before = items;
    let next = [...items, { partId: id, x: x - cx, y: y - cy, angle: 0, mirror: false }];
    const me = new Set([next.length - 1]);
    if (e.ctrlKey || e.metaKey) {
      // the part it was dropped on, else the nearest one
      let target = -1;
      for (let i = geo.length - 1; i >= 0; i--) if (geo[i] && inMaterial(geo[i]!, x, y)) { target = i; break; }
      if (target < 0) {
        let best = Infinity;
        geo.forEach((g, i) => {
          if (!g) return;
          const d = Math.max(0, g.box.x0 - x, x - g.box.x1) + Math.max(0, g.box.y0 - y, y - g.box.y1);
          if (d < best) { best = d; target = i; }
        });
      }
      if (target >= 0) next = snapTo(next, me, target);
    }
    commit(next, before);
    setSel(me);
  };

  // -- what is selected ---------------------------------------------------------------------------
  const selInfo = (() => {
    const idx = [...sel].filter((i) => geo[i]);
    if (!idx.length) return null;
    const b = unionBox(idx.map((i) => geo[i]!.box));
    const f = (v: number) => (Math.round(v * 10) / 10).toFixed(1);
    if (idx.length > 1) return { title: `${idx.length} parts selected`, sub: "", size: `${f(b.x1 - b.x0)} × ${f(b.y1 - b.y0)} mm`, qty: "" };
    const p = items[idx[0]];
    const jp = jobParts.find((x) => x.part.id === p.partId);
    return {
      title: jp?.part.project ?? "", sub: jp?.part.name ?? byId.get(p.partId)?.name ?? "",
      size: `${f(b.x1 - b.x0)} × ${f(b.y1 - b.y0)} mm${p.angle ? ` · ${Math.round(p.angle * 10) / 10}°` : ""}${p.mirror ? " · mirrored" : ""}`,
      qty: jp ? `${counts[p.partId] ?? 0} / ${jp.qty} nested` : "",
    };
  })();

  const pathOf = (lp: Pt[][]) => lp.map((l) => l.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join("") + "Z").join("");
  const v = view ?? { s: 1, tx: 0, ty: 0 };
  const right = origin.endsWith("right"), bottom = origin.startsWith("bottom");

  return (
    <div className="mn">
      <div className="mn-top">
        <button type="button" className="mn-nav" disabled={index === 0} onClick={() => onIndex(index - 1)} aria-label="Previous sheet" title="Previous sheet">
          <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="M17 4 6 12l11 8z" fill="currentColor" /></svg>
        </button>
        <div className="mn-title">
          <span>Solution {sol.no} <span className="slash">/</span> Sheet {index + 1}</span>
          <button type="button" className="sheet-info" onClick={() => onInfo(index)} aria-label={`Properties of sheet ${index + 1}`} title="Sheet properties">i</button>
          <span className="mn-sheet">{sheet.material} {sheet.thicknessMm}x{sheet.lengthMm}x{sheet.widthMm}</span>
          <span className="mn-gap" />
          {!edit && <span className="mn-locked" title={locked ? "The sheet is locked: unlock it to change it" : "Look only"}>VIEW</span>}
          <button type="button" className="btn btn-save mn-finish" onClick={onClose} title="Back to the sheets (Automatic nest)">BACK</button>
          <button type="button" className={`nest-lock mn-lock${locked ? " is-locked" : ""}`} aria-pressed={locked}
            title={locked ? "Locked: kept as it is. Click to unlock (then it can be changed)" : "Unlocked: can be changed. Click to lock"}
            onClick={onToggleLock}><Lock open={!locked} /></button>
        </div>
        <button type="button" className="mn-nav" disabled={index === sheets.length - 1} onClick={() => onIndex(index + 1)} aria-label="Next sheet" title="Next sheet">
          <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="M7 4l11 8-11 8z" fill="currentColor" /></svg>
        </button>
        <div className="mn-info" aria-live="polite">
          {selInfo ? (<>
            <div><b>{selInfo.title}</b><span>{selInfo.size}</span></div>
            <div><span className="mn-info-name">{selInfo.sub}</span><span>{selInfo.qty}</span></div>
          </>) : <div className="mn-info-none">{edit ? "Click a part, or drag a window, to select. Drag parts in from JOB PARTS." : "Locked sheet: look only."}</div>}
        </div>
      </div>

      <div className="mn-stage">
        <Ruler axis="y" view={v} size={size} />
        <div ref={host} className={`mn-canvas${hover >= 0 && edit ? " is-over" : ""}`}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
          onContextMenu={(e) => e.preventDefault()}
          onDragOver={(e) => { if (edit && e.dataTransfer.types.includes("text/gnezdo-part")) e.preventDefault(); }}
          onDrop={onDrop}>
          <svg width={size.w} height={size.h} aria-label={`Sheet ${index + 1}`}>
            <g transform={`translate(${v.tx} ${v.ty}) scale(${v.s})`}>
              {outline ? <path className="mn-plate" fillRule="evenodd" d={pathOf(outline)} />
                : <rect className="mn-plate" x={0} y={0} width={sheet.lengthMm} height={sheet.widthMm} />}
              {!outline && <rect className="mn-trim" x={usable.x0} y={usable.y0} width={usable.x1 - usable.x0} height={usable.y1 - usable.y0}
                style={{ strokeWidth: 1 / v.s }} />}
              {items.map((p, i) => {
                const g = geo[i];
                const r = byId.get(p.partId);
                if (!g || !r) return null;
                const c = partColor(r.no);
                return (
                  <path key={i} d={pathOf(g.loops)} fillRule="evenodd"
                    className={`mn-part${sel.has(i) ? " is-sel" : ""}${bad.has(i) ? " is-bad" : ""}`}
                    style={{ fill: c.fill, stroke: sel.has(i) ? undefined : c.stroke, strokeWidth: (sel.has(i) ? 2.2 : 1) / v.s }}>
                    <title>{r.name}</title>
                  </path>
                );
              })}
              <circle cx={right ? sheet.lengthMm : 0} cy={bottom ? sheet.widthMm : 0} r={6 / v.s} className="mn-origin" />
            </g>
            {box && (
              <rect className={`sel-box${box.x1 < box.x0 ? " is-crossing" : ""}`}
                x={Math.min(box.x0, box.x1)} y={Math.min(box.y0, box.y1)} width={Math.abs(box.x1 - box.x0)} height={Math.abs(box.y1 - box.y0)} />
            )}
          </svg>
          {bad.size > 0 && <div className="mn-warn">{bad.size} {bad.size === 1 ? "part overlaps or is" : "parts overlap or are"} too close (red)</div>}
        </div>
        <span />
        <Ruler axis="x" view={v} size={size} />
      </div>

      <PartsPanel jobParts={jobParts} sheet={sheet} counts={counts} edit={edit} />
    </div>
  );
}

/** Rulers along the canvas (mm), following zoom and pan. */
function Ruler({ axis, view, size }: { axis: "x" | "y"; view: { s: number; tx: number; ty: number }; size: { w: number; h: number } }) {
  const len = axis === "x" ? size.w : size.h;
  const off = axis === "x" ? view.tx : view.ty;
  // a labelled tick at least ~70 px apart: 10, 20, 50, 100, 200, 500 ... mm
  const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000];
  const major = steps.find((s) => s * view.s >= 70) ?? 5000;
  const minor = major / (String(major).startsWith("2") ? 4 : 5);
  const from = Math.floor(-off / view.s / minor) * minor, to = (len - off) / view.s;
  const ticks: { mm: number; big: boolean }[] = [];
  for (let mm = from; mm <= to; mm += minor) ticks.push({ mm: Math.round(mm * 1000) / 1000, big: Math.abs(mm / major - Math.round(mm / major)) < 1e-6 });
  const W = axis === "x" ? size.w : 26, H = axis === "x" ? 24 : size.h;
  return (
    <svg className={`mn-ruler is-${axis}`} width={W} height={H} aria-hidden="true">
      {ticks.map(({ mm, big }) => {
        const p = mm * view.s + off;
        return axis === "x" ? (
          <g key={mm}><line x1={p} x2={p} y1={0} y2={big ? 10 : 5} />{big && <text x={p + 3} y={20}>{mm}</text>}</g>
        ) : (
          <g key={mm}><line y1={p} y2={p} x1={26} x2={big ? 16 : 21} />{big && <text x={13} y={p - 3} transform={`rotate(-90 13 ${p - 3})`}>{mm}</text>}</g>
        );
      })}
    </svg>
  );
}

type SortBy = "area" | "size" | "project";

/** JOB PARTS: the job's parts as tiles to drag onto the sheet; nested / required on each. */
function PartsPanel({ jobParts, sheet, counts, edit }: { jobParts: JobPart[]; sheet: NestedSheet; counts: Record<string, number>; edit: boolean }) {
  const [sortBy, setSortBy] = useState<SortBy>("area");
  const [dir, setDir] = useState<1 | -1>(-1);
  const [all, setAll] = useState(false);
  const [menu, setMenu] = useState(false);
  const same = (jp: JobPart) => jp.part.material.trim().toLowerCase() === sheet.material.trim().toLowerCase() && Math.abs(jp.part.thicknessMm - sheet.thicknessMm) < 1e-6;
  const list = useMemo(() => {
    const l = jobParts.filter((jp) => all || same(jp));
    const key = (jp: JobPart) => sortBy === "area" ? jp.part.areaMm2 : sortBy === "size" ? Math.max(jp.part.w, jp.part.h) : jp.part.project;
    // parts with their required number nested go last, whatever the sort
    const done = (jp: JobPart) => (jp.qty > 0 && (counts[jp.part.id] ?? 0) >= jp.qty ? 1 : 0);
    return l.slice().sort((a, b) => {
      const d = done(a) - done(b);
      if (d) return d;
      const ka = key(a), kb = key(b);
      return (ka < kb ? -1 : ka > kb ? 1 : 0) * dir;
    });
  }, [jobParts, all, sortBy, dir, counts, sheet.material, sheet.thicknessMm]);   // eslint-disable-line react-hooks/exhaustive-deps
  const nested = jobParts.reduce((n, jp) => n + (counts[jp.part.id] ?? 0), 0);
  const total = jobParts.reduce((n, jp) => n + jp.qty, 0);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);
  return (
    <aside className="mn-parts" aria-label="Job parts">
      <header className="mn-parts-head">
        <h2>Job parts</h2>
        <span className={nested >= total ? "is-done" : ""} title="Pieces nested in this solution / pieces required">{nested}/{total}</span>
      </header>
      <div className="mn-parts-tools">
        <select className="field" value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)} aria-label="Sort by">
          <option value="area">Sort by: Area</option>
          <option value="size">Sort by: XY size</option>
          <option value="project">Sort by: Project</option>
        </select>
        <button type="button" className="mn-sortdir" onClick={() => setDir((d) => (d === 1 ? -1 : 1))}
          title={dir === 1 ? "Ascending: click for descending" : "Descending: click for ascending"} aria-label="Sort direction">
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
            <path d="M5 3 9 10H1z" fill={dir === 1 ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.3" />
            <path d="M15 17l4-7h-8z" fill={dir === -1 ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.3" />
          </svg>
        </button>
        <span className="mn-menu-wrap">
          <button type="button" className={`mn-filter${menu ? " is-open" : ""}`} onClick={(e) => { e.stopPropagation(); setMenu((m) => !m); }}
            aria-haspopup="menu" aria-expanded={menu} title={all ? "Showing all parts" : "Showing the parts of this sheet's material and thickness"}>
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><rect x="2.5" y="2.5" width="15" height="15" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <path d="M6 7h8M6 10h8M6 13h8" stroke="currentColor" strokeWidth="1.4" /></svg>
          </button>
          {menu && (
            <span className="mn-menu" role="menu">
              <button type="button" role="menuitemradio" aria-checked={all} onClick={() => setAll(true)}>{all ? "● " : "○ "}All parts</button>
              <button type="button" role="menuitemradio" aria-checked={!all} onClick={() => setAll(false)}>{!all ? "● " : "○ "}Same material and thickness as this sheet</button>
            </span>
          )}
        </span>
      </div>
      <div className="mn-tiles">
        {!list.length && <p className="mn-none">{all ? "No parts in the job." : `No parts of ${sheet.material} ${sheet.thicknessMm} mm. The menu shows all parts.`}</p>}
        {list.map((jp) => {
          const n = counts[jp.part.id] ?? 0;
          const lp = partLoops(jp.part.path);
          const xs = lp[0]?.map((p) => p[0]) ?? [0], ys = lp[0]?.map((p) => p[1]) ?? [0];
          const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0 || 1, h = Math.max(...ys) - y0 || 1;
          const c = partColor(jp.no);
          return (
            <div key={jp.part.id} className={`mn-tile${jp.qty > 0 && n >= jp.qty ? " is-done" : ""}${edit ? "" : " is-off"}`} draggable={edit}
              title={`${jp.part.name}: drag onto the sheet (Ctrl on a part: next to it)`}
              onDragStart={(e) => { e.dataTransfer.setData("text/gnezdo-part", jp.part.id); e.dataTransfer.effectAllowed = "copy"; }}>
              <svg viewBox={`${x0 - w * 0.08} ${y0 - h * 0.08} ${w * 1.16} ${h * 1.16}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
                <path d={jp.part.path} fillRule="evenodd" style={{ fill: c.fill, stroke: c.stroke }} vectorEffect="non-scaling-stroke" />
              </svg>
              <span className="mn-tile-name">{jp.part.name}</span>
              <span className="mn-tile-qty">{n} / {jp.qty}</span>
              <span className="mn-tile-size">{Math.round(jp.part.w)} × {Math.round(jp.part.h)}</span>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
