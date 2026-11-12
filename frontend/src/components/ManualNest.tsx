import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { JobPart } from "../api/types";
import type { Origin } from "../job/machine";
import { partColor, unlocked, type NestedSheet, type PlacedPart, type Solution } from "../job/nest";
import { diag } from "../job/diag";
import { Lock } from "./NestView";
import { actionOf, loadKeys, type KeyAction } from "../job/manualKeys";
import {
  inMaterial, partLoops, placed, problems, rotateGroup, slideDistance, unionBox, usableBox,
  type Box, type Dir, type Placed, type Pt,
} from "../job/manualGeom";
import { arrange, arrangeAgain, mirrorGroup, partRules, stack, type PartRules } from "../job/manualTools";
import { loadNestingRules } from "../job/nestRules";
import { loadManualView } from "../job/manualView";
import { liveContours, originPoint, processedParts, rapidsOf, type CutContour } from "../job/cutPath";
import { useViewPrefs } from "../job/viewPrefs";
import { RemnantOverlay } from "./RemnantOverlay";
import { commonEdges, commonLayout, partCommonLines, placedEdges, sharedLines, snapMove, type CommonEdge, type CommonLayout } from "../job/commonCut";

/** Ctrl+C: the copied parts, around the middle of their box (kept across sheets of the job). */
let clipboard: PlacedPart[] | null = null;

type PartRef = { path: string; areaMm2: number; name: string; no?: number };

/** The sheet in Process (Auto cut): nothing moves; clicks pick parts (while picking), the panel on the right is the tool's. */
export interface CutMode {
  picking: boolean;
  /** picked parts in cutting order */
  picked: number[];
  onPick: (i: number) => void;
  panel: ReactNode;
  hint: string;
  /** a tool that clicks on the sheet (Remnant: CUT V / CUT H / DELETE CUT): the point in mm */
  onPoint?: (x: number, y: number, scale: number) => void;
  /** the pointer over the sheet while that tool is on */
  cursor?: string;
  /** contours shown picked (Lead in / out) */
  highlight?: Set<CutContour>;
  /** contours with a glow (Manual cut: the picked ones), `strong` with a stronger one (chosen in the list) */
  glow?: { all: Set<CutContour>; strong?: CutContour };
  /** Simulation: the path as far as the head has come, the parts cut out so far, the head */
  sim?: { shown: CutContour[]; current?: CutContour; rapids: [Pt, Pt][]; done: Set<number>; head: Pt };
}

// Manual nesting of one sheet (EDIT / VIEW on a sheet card). The parts on the sheet are moved with
// the mouse or the keys (Settings -> Manual nest), parts come from the JOB PARTS panel by drag and
// drop, overlapping parts glow red. Every finished change goes to the solution at once; FINISH
// goes back to the sheets.
/** A small open arrowhead at p pointing along d (unit), `size` long (sheet mm): its path. */
const arrowHead = (p: [number, number], d: [number, number], size: number) => {
  const n: [number, number] = [-d[1], d[0]];
  const tip: [number, number] = [p[0] + (d[0] * size) / 2, p[1] + (d[1] * size) / 2];
  const w = (s: number): string => `${(tip[0] - d[0] * size + n[0] * size * 0.55 * s).toFixed(2)} ${(tip[1] - d[1] * size + n[1] * size * 0.55 * s).toFixed(2)}`;
  return `M${w(1)}L${tip[0].toFixed(2)} ${tip[1].toFixed(2)}L${w(-1)}`;
};

/** Arrows along a cut contour, about one per `every` mm (at least one), as [point, direction]. */
function arrowsAlong(pts: [number, number][], every: number, minLen: number): [[number, number], [number, number]][] {
  const segs: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); segs.push(l); total += l; }
  if (total < minLen) return [];
  const count = Math.max(1, Math.min(8, Math.floor(total / every)));
  const out: [[number, number], [number, number]][] = [];
  for (let k = 0; k < count; k++) {
    let at = ((k + 0.5) / count) * total;
    for (let i = 0; i < segs.length; i++) {
      if (at <= segs[i] || i === segs.length - 1) {
        const a = pts[i], b = pts[i + 1], l = segs[i] || 1, f = Math.min(1, at / l);
        out.push([[a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], [(b[0] - a[0]) / l, (b[1] - a[1]) / l]]);
        break;
      }
      at -= segs[i];
    }
  }
  return out;
}

export function ManualNest({ sol, index, sheets, jobParts, parts: byId, edit, origin, counts, onIndex, onClose, onChange, onInfo, locked, onToggleLock, tool, commonCut = false, cut }: {
  cut?: CutMode;
  locked: boolean; onToggleLock: () => void;
  /** Common cut (Manual nest toolbar): Arrange makes blocks (snapping: the Common cut snapping key held while dragging) */
  commonCut?: boolean;
  /** a Manual nest tool clicked on the toolbar (a new n each click) */
  tool?: { tool: string; n: number };
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
  // keys held down now (the Common cut snapping key is held while dragging)
  const held = useRef(new Set<string>());
  useEffect(() => {
    const down = (e: KeyboardEvent) => { held.current.add(e.code); };
    const up = (e: KeyboardEvent) => { held.current.delete(e.code); };
    const clear = () => held.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", clear); };
  }, []);
  const commonHeld = () => keys.commonSnap.some((c) => !!c && held.current.has(c));
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

  // common cut lines of the parts (those with the Common cut nesting rule), part frame
  const kerf = sheet.kerfMm ?? 0;
  const [edgesById, setEdgesById] = useState<Map<string, CommonEdge[]>>(new Map());
  const partIdsKey = [...new Set([...items.map((p) => p.partId), ...jobParts.map((jp) => jp.part.id)])].sort().join(",");
  useEffect(() => {
    let alive = true;
    const ids = partIdsKey ? partIdsKey.split(",") : [];
    Promise.all(ids.map((id) => partCommonLines(id).then((lines) => [id, lines] as const))).then((got) => {
      if (!alive) return;
      const m = new Map<string, CommonEdge[]>();
      for (const [id, lines] of got) { const path = byId.get(id)?.path; if (path && lines.length) m.set(id, commonEdges(path, lines)); }
      setEdgesById(m);
    });
    return () => { alive = false; };
  }, [partIdsKey, byId]);
  const edgesOf = (list: PlacedPart[], i: number) => { const e = edgesById.get(list[i].partId); return e ? placedEdges(list[i], e) : []; };
  // parts that share a common cut line: closer than the gap there, the line drawn blue
  const shared = useMemo(() => {
    if (!edgesById.size) return { pairs: new Set<string>(), lines: [] as [Pt, Pt][] };
    return sharedLines(items.map((_, i) => ({ edges: geo[i] ? edgesOf(items, i) : [], box: geo[i]?.box ?? { x0: 0, y0: 0, x1: 0, y1: 0 } })), kerf);
  }, [items, geo, edgesById, kerf]);   // eslint-disable-line react-hooks/exhaustive-deps
  // parts reaching past the usable area (e.g. left outside when the sheet was made smaller)
  const outside = useMemo(() => new Set(geo.flatMap((g, i) => (g && (g.box.x0 < usable.x0 - 0.05 || g.box.y0 < usable.y0 - 0.05
    || g.box.x1 > usable.x1 + 0.05 || g.box.y1 > usable.y1 + 0.05) ? [i] : []))), [geo, usable]);
  const bad = useMemo(() => {
    const idx: number[] = [];
    geo.forEach((g, i) => g && idx.push(i));
    // shared pairs in the numbering of the parts checked
    const at = new Map(idx.map((i, k) => [i, k]));
    const sh = new Set([...shared.pairs].map((key) => { const [i, j] = key.split("|").map(Number); const a = at.get(i)!, b = at.get(j)!; return a < b ? `${a}|${b}` : `${b}|${a}`; }));
    const b = problems(idx.map((i) => geo[i]!), usable, gap, outline, sh);
    return new Set([...b].map((k) => idx[k]));
  }, [geo, usable, gap, outline, shared]);

  // -- view: mm -> screen px, fitted to the canvas; wheel zooms, middle / right button pans --------
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  const [view, setViewState] = useState<{ s: number; tx: number; ty: number } | null>(null);
  // zoom: from 6000 x 3000 mm in view (furthest out: parts bigger than the sheet, or left outside it
  // when the sheet was made smaller) to MAX_ZOOM px per mm (a 20 x 20 mm part about 200 px); Fit: the whole sheet
  const MAX_ZOOM = 10, PAD = 24, FAR_X = 6000, FAR_Y = 3000;
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const fitScale = (w: number, h: number) => Math.min((w - 2 * PAD) / sheet.lengthMm, (h - 2 * PAD) / sheet.widthMm);
  const minScale = (w: number, h: number) => Math.min(fitScale(w, h), (w - 2 * PAD) / FAR_X, (h - 2 * PAD) / FAR_Y);
  // what may be looked at: the sheet and every part on it (also parts outside it) [mm]
  const worldRef = useRef<Box>({ x0: 0, y0: 0, x1: sheet.lengthMm, y1: sheet.widthMm });
  worldRef.current = unionBox([{ x0: 0, y0: 0, x1: sheet.lengthMm, y1: sheet.widthMm }, ...geo.flatMap((g) => (g ? [g.box] : []))]);
  /** Keeps the zoom within its limits and the sheet and its parts in view. */
  const clampView = useCallback((v: { s: number; tx: number; ty: number }) => {
    const { w, h } = sizeRef.current;
    const lo = minScale(w, h);
    const s = Math.min(Math.max(v.s, lo), Math.max(lo, MAX_ZOOM));
    const k = s / v.s;
    let { tx, ty } = v;
    if (k !== 1) { tx = w / 2 - (w / 2 - tx) * k; ty = h / 2 - (h / 2 - ty) * k; }
    // smaller than the view: kept wholly in it; bigger: the view stays on it
    const W0 = worldRef.current;
    const ax = PAD - W0.x0 * s, bx = w - PAD - W0.x1 * s, ay = PAD - W0.y0 * s, by = h - PAD - W0.y1 * s;
    tx = Math.min(Math.max(ax, bx), Math.max(Math.min(ax, bx), tx));
    ty = Math.min(Math.max(ay, by), Math.max(Math.min(ay, by), ty));
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
        const lo = minScale(sizeRef.current.w, sizeRef.current.h);
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
    // the selected parts are drawn on top: over another part, the click goes to them first
    for (let i = geo.length - 1; i >= 0; i--) if (sel.has(i) && geo[i] && inMaterial(geo[i]!, x, y)) return i;
    for (let i = geo.length - 1; i >= 0; i--) if (geo[i] && inMaterial(geo[i]!, x, y)) return i;
    return -1;
  };

  // -- moving the selection -------------------------------------------------------------------
  // locked parts keep their place and angle: drag, arrow keys, turning, slides, mirroring, Align edge
  // and Arrange leave them (copying, stacking and deleting still work)
  const moved = (list: PlacedPart[], ids: Set<number>, dx: number, dy: number) =>
    list.map((p, i) => (ids.has(i) && !p.lock ? { ...p, x: p.x + dx, y: p.y + dy } : p));
  const movable = (list: PlacedPart[], ids: Set<number>) => new Set([...ids].filter((i) => list[i] && !list[i].lock));
  const geoOf = (list: PlacedPart[], i: number) => { const r = byId.get(list[i].partId); return r ? placed(r.path, list[i]) : null; };
  /** How far the selection can slide in a direction (to the next part or the edge, with the gaps). */
  const slide = (list: PlacedPart[], all: Set<number>, dir: Dir) => {
    const ids = movable(list, all);
    const group = [...ids].map((i) => geoOf(list, i)).filter((g): g is Placed => !!g);
    const others = list.map((_, i) => (ids.has(i) ? null : geoOf(list, i))).filter((g): g is Placed => !!g);
    if (!group.length) return list;
    const t = slideDistance(group, others, usable, gap, dir, outline, edgeGap);
    if (t <= 0) return list;
    const [dx, dy] = dir === "up" ? [0, -t] : dir === "down" ? [0, t] : dir === "left" ? [-t, 0] : [t, 0];
    return moved(list, ids, dx, dy);
  };
  /** Ctrl + drop on a part: the selection goes next to it, on the side it was dropped, with the gap. */
  const snapTo = (list: PlacedPart[], all: Set<number>, target: number) => {
    const ids = movable(list, all);
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
    const all = selRef.current;
    if (!all.size) return list;
    switch (a) {
      case "up": case "down": case "left": case "right": {
        const ids = movable(list, all);
        if (!ids.size) return list;
        // 1 mm, but not past the edge of the usable area (trims): up to it at most; parts may overlap
        const g = unionBox([...ids].map((i) => geoOf(list, i)?.box).filter((b): b is Box => !!b));
        if (!isFinite(g.x0)) return list;
        const room = a === "up" ? g.y0 - usable.y0 : a === "down" ? usable.y1 - g.y1 : a === "left" ? g.x0 - usable.x0 : usable.x1 - g.x1;
        const d = Math.min(1, room);
        if (d <= 1e-6) return list;
        return a === "up" ? moved(list, ids, 0, -d) : a === "down" ? moved(list, ids, 0, d) : a === "left" ? moved(list, ids, -d, 0) : moved(list, ids, d, 0);
      }
      default: {
        const deg = a === "rotCw1" ? 1 : a === "rotCw45" ? 45 : a === "rotCcw1" ? -1 : -45;
        const idx = [...movable(list, all)];   // locked parts keep their angle too
        if (!idx.length) return list;
        const boxes = idx.map((i) => geoOf(list, i)?.box).filter((b): b is Box => !!b);
        const turned = rotateGroup(idx.map((i) => list[i]), boxes, deg);
        const next = list.slice();
        idx.forEach((i, k) => { next[i] = turned[k]; });
        return next;
      }
    }
  };

  // a key step; while parts are dragged, the drag goes on from the stepped parts (a turn is kept
  // when the mouse moves on)
  const stepNow = (a: KeyAction) => {
    const next = step(itemsRef.current, a);
    itemsRef.current = next;
    const d = dragging.current;
    if (d) {
      d.before = next;
      if (lastPt.current) d.start = lastPt.current;
    }
    setItems(next);
  };

  // -- keys: a press moves 1 mm / turns 1°; held, 10 steps a second; Ctrl + direction slides -------
  const hold = useRef<{ code: string; before: PlacedPart[]; timer: number } | null>(null);
  useEffect(() => {
    const busy = (e: KeyboardEvent) => !!document.querySelector(".dlg") || !!(e.target as HTMLElement)?.closest("input, select, textarea");
    const onDown = (e: KeyboardEvent) => {
      if (busy(e) || workingRef.current) return;
      if (e.key === "Escape") {
        if (alignRef.current) { setAlign(null); setEdgeHover(null); setNote(null); return; }
        if (pasteRef.current) { setPaste(null); return; }
        setSel(new Set());
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyC" && selRef.current.size) {
        e.preventDefault();
        copySel();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyV") {
        e.preventDefault();
        if (edit) startPaste();
        return;
      }
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
      stepNow(a);
      // held: after a moment, 10 steps a second until the key is let go
      const start = window.setTimeout(() => {
        if (!hold.current) return;
        hold.current.timer = window.setInterval(() => stepNow(a), 100);
      }, 300);
      hold.current = { code: e.code, before, timer: start };
    };
    const end = () => {
      const h = hold.current;
      if (!h) return;
      window.clearTimeout(h.timer);
      window.clearInterval(h.timer);
      hold.current = null;
      // while parts are dragged the drop saves it all (one undo step)
      if (itemsRef.current !== h.before && !dragging.current) commit(itemsRef.current, h.before);
    };
    const onUp = (e: KeyboardEvent) => { if (hold.current && e.code === hold.current.code) end(); };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", end);
    return () => { window.removeEventListener("keydown", onDown); window.removeEventListener("keyup", onUp); window.removeEventListener("blur", end); };
  });   // every render: the handlers see the current sheet and selection

  // -- mouse: click / drag parts, window selection, pan ---------------------------------------
  // before: the parts the drag offset applies to (turned by a key while held: the turned parts, from
  // where the mouse is then); orig: the sheet when the drag started (for undo)
  const dragging = useRef<{ start: Pt; before: PlacedPart[]; orig: PlacedPart[]; ids: Set<number>; moved: boolean; px: { x: number; y: number } } | null>(null);
  // Ctrl+click on a selected part takes it out of the selection, when the click did not move it
  const unpick = useRef<{ i: number; px: { x: number; y: number } } | null>(null);
  const pan = useRef<{ x: number; y: number; from: { x: number; y: number }; button: number } | null>(null);
  // right click (no drag) on a part: Lock / Unlock it, or the selection it is in
  const [menu, setMenu] = useState<{ x: number; y: number; ids: number[] } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => { if (!(e.target as HTMLElement)?.closest?.(".mn-ctx")) setMenu(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", esc, true);
    return () => { window.removeEventListener("pointerdown", close, true); window.removeEventListener("keydown", esc, true); };
  }, [menu]);
  useEffect(() => { setMenu(null); }, [index]);
  const lockParts = (ids: number[]) => {
    diag("manual", `Sheet ${index + 1}: lock ${ids.length} parts`);
    const before = itemsRef.current;
    const group = Date.now();
    commit(before.map((p, i) => (ids.includes(i) ? { ...p, lock: group } : p)), before);
    setNote(`Locked ${ids.length} ${ids.length === 1 ? "part" : "parts"}: they stay where they are`);
  };
  const unlockParts = (ids: number[]) => {
    diag("manual", `Sheet ${index + 1}: unlock (${ids.length} clicked)`);
    const before = itemsRef.current;
    // a part locked with others: they all come free
    const groups = new Set(ids.map((i) => before[i]?.lock).filter((g): g is number => g !== undefined));
    let n = 0;
    commit(before.map((p) => (p.lock !== undefined && groups.has(p.lock) ? (n++, unlocked(p)) : p)), before);
    setNote(`Unlocked ${n} ${n === 1 ? "part" : "parts"}`);
  };
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [hover, setHover] = useState(-1);
  const [moving, setMoving] = useState(false);   // selected parts being dragged
  const onPointerDown = (e: React.PointerEvent) => {
    if (working) return;
    if (paste) {
      if (e.button === 0) placePaste(toMm(local(e).x, local(e).y));
      else setPaste(null);
      return;
    }
    if (align && e.button === 0) { alignClick(toMm(local(e).x, local(e).y)); return; }
    if (align && e.button === 2) { setAlign(null); setEdgeHover(null); setNote(null); return; }
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const p = local(e);
    if (e.button === 1 || e.button === 2) { pan.current = { x: e.clientX, y: e.clientY, from: { x: e.clientX, y: e.clientY }, button: e.button }; return; }
    if (e.button !== 0) return;
    if (cut) {
      if (cut.onPoint) { const [cx, cy] = toMm(p.x, p.y); cut.onPoint(cx, cy, view?.s ?? 1); }
      else if (cut.picking) { const [cx, cy] = toMm(p.x, p.y); const i = hit(cx, cy); if (i >= 0) cut.onPick(i); }
      return;
    }
    const [x, y] = toMm(p.x, p.y);
    const i = hit(x, y);
    if (i >= 0) {
      // Ctrl+click adds a part to the selection, or (if it does not move) takes it out again;
      // Ctrl held while dragging still snaps on drop
      let ids = sel;
      const ctrl = e.ctrlKey || e.metaKey;
      unpick.current = ctrl && sel.has(i) ? { i, px: p } : null;
      if (ctrl) { if (!sel.has(i)) ids = new Set([...sel, i]); }
      else if (!sel.has(i)) ids = new Set([i]);
      setSel(ids);
      if (edit && ids.has(i)) dragging.current = { start: [x, y], before: items, orig: items, ids, moved: false, px: p };
      return;
    }
    setBox({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    if (!(e.ctrlKey || e.metaKey)) setSel(new Set());
  };
  const onPointerMove = (e: React.PointerEvent) => {
    { const q = local(e); lastPt.current = toMm(q.x, q.y); }
    if (paste) { setPaste((pp) => pp && { ...pp, at: lastPt.current! }); return; }
    if (align && !pan.current) { const q = lastPt.current!; setEdgeHover(edgeAt(q[0], q[1], !align.fixed)); return; }
    const p = local(e);
    if (pan.current) {
      const dx = e.clientX - pan.current.x, dy = e.clientY - pan.current.y;
      pan.current = { ...pan.current, x: e.clientX, y: e.clientY };
      setView((v) => v && { ...v, tx: v.tx + dx, ty: v.ty + dy });
      return;
    }
    if (box) { setBox((b) => b && { ...b, x1: p.x, y1: p.y }); return; }
    const d = dragging.current;
    const [x, y] = toMm(p.x, p.y);
    if (d) {
      if (!d.moved && Math.hypot(p.x - d.px.x, p.y - d.px.y) < 3) return;
      if (!d.moved) setMoving(true);
      d.moved = true;
      let dx = x - d.start[0], dy = y - d.start[1];
      // the Common cut snapping key held: a marked line of the dragged parts snaps onto one of a still part
      if (commonHeld() && edgesById.size && view) {
        const trial = moved(d.before, d.ids, dx, dy);
        const mine = [...d.ids].flatMap((i) => edgesOf(trial, i));
        if (mine.length) {
          const still = trial.flatMap((_, i) => (d.ids.has(i) ? [] : edgesOf(trial, i)));
          const v = snapMove(mine, still, kerf, 12 / view.s);
          if (v) { dx += v[0]; dy += v[1]; }
        }
      }
      setItems(moved(d.before, d.ids, dx, dy));
      return;
    }
    setHover(hit(x, y));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (pan.current) {
      const pn = pan.current;
      pan.current = null;
      // a right click that did not pan: the lock menu for the part under it (or its selection)
      if (pn.button === 2 && edit && Math.hypot(e.clientX - pn.from.x, e.clientY - pn.from.y) < 4) {
        const q = local(e);
        const [x, y] = toMm(q.x, q.y);
        const i = hit(x, y);
        if (i >= 0) {
          const ids = sel.has(i) ? [...sel] : [i];
          if (!sel.has(i)) setSel(new Set([i]));
          setMenu({ x: e.clientX, y: e.clientY, ids });
        }
      }
      return;
    }
    if (box) {
      const b = box;
      setBox(null);
      if (Math.abs(b.x1 - b.x0) < 3 && Math.abs(b.y1 - b.y0) < 3) return;
      // left to right: window (parts wholly inside); right to left: crossing (parts touched)
      const crossing = b.x1 < b.x0;
      const [ax, ay] = toMm(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1));
      const [bx, by] = toMm(Math.max(b.x0, b.x1), Math.max(b.y0, b.y1));
      const ids = new Set(e.ctrlKey || e.metaKey ? sel : []);
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
    setMoving(false);
    const up = unpick.current;
    unpick.current = null;
    if (up && !d?.moved) {
      const q = local(e);
      if (Math.hypot(q.x - up.px.x, q.y - up.px.y) < 3) { setSel((s) => { const n = new Set(s); n.delete(up.i); return n; }); return; }
    }
    // held without moving, but turned by a key meanwhile: that turn is saved now
    if (d && !d.moved && itemsRef.current !== d.orig) { commit(itemsRef.current, d.orig); return; }
    if (!d || !d.moved) return;
    let next = itemsRef.current;
    // Ctrl: the gap snap (not while common cut snapping is held: that one placed it already)
    if ((e.ctrlKey || e.metaKey) && !commonHeld()) {
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
    commit(next, d.orig);
  };

  // -- parts from the JOB PARTS panel -----------------------------------------------------------
  const onDrop = (e: React.DragEvent) => {
    const id = e.dataTransfer.getData("text/gnezdo-part");
    const ref = id ? byId.get(id) : undefined;
    if (!edit || !ref || working) return;
    e.preventDefault();
    // not beyond the part's max (or required) number
    const over = overLimit([{ partId: id, x: 0, y: 0, angle: 0, mirror: false }], "Not added");
    if (over) { setNote(over); return; }
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

  // -- Ctrl+C / Ctrl+V: the copy hangs on the pointer (see-through) until a click puts it down ----------
  const [paste, setPaste] = useState<{ parts: PlacedPart[]; at: Pt } | null>(null);
  const pasteRef = useRef(paste);
  pasteRef.current = paste;
  const lastPt = useRef<Pt | null>(null);
  const copySel = () => {
    const ids = [...selRef.current].filter((i) => itemsRef.current[i] && geoOf(itemsRef.current, i));
    if (!ids.length) return;
    const g = unionBox(ids.map((i) => geoOf(itemsRef.current, i)!.box));
    const cx = (g.x0 + g.x1) / 2, cy = (g.y0 + g.y1) / 2;
    clipboard = ids.map((i) => ({ ...unlocked(itemsRef.current[i]), x: itemsRef.current[i].x - cx, y: itemsRef.current[i].y - cy }));
    setNote(`Copied ${ids.length} ${ids.length === 1 ? "part" : "parts"}: Ctrl+V to paste`);
  };
  /** Why the copy may not go on this sheet: a part would go over its required (or max) number. */
  const overLimit = (parts: PlacedPart[], what = "Not pasted"): string | null => {
    const per = sheet.cutNumber ?? 1;
    const n = new Map<string, number>();
    for (const p of parts) n.set(p.partId, (n.get(p.partId) ?? 0) + per);
    for (const [id, k] of n) {
      const jp = jobParts.find((x) => x.part.id === id);
      if (!jp) continue;
      const limit = Math.max(jp.qty, jp.qtyMax ?? 0);
      if (!jp.qty) return `${what}: set the Qty req of ${jp.part.name} in Work parts first.`;
      if ((counts[id] ?? 0) + k > limit) {
        return `${what}: ${jp.part.name} would be ${(counts[id] ?? 0) + k} of ${limit}${jp.qtyMax && jp.qtyMax > jp.qty ? " (max)" : " required"}.`;
      }
    }
    return null;
  };
  const startPaste = () => {
    if (!clipboard?.length || working) return;
    const why = overLimit(clipboard);
    if (why) { setNote(why); return; }
    const at = lastPt.current ?? [sheet.lengthMm / 2, sheet.widthMm / 2];
    setPaste({ parts: clipboard, at });
    setNote("Click to put the copy down, Esc to cancel");
  };
  const placePaste = (at: Pt) => {
    const pp = pasteRef.current;
    if (!pp) return;
    setPaste(null);
    const why = overLimit(pp.parts);
    if (why) { setNote(why); return; }
    const before = itemsRef.current;
    const add = pp.parts.map((p) => ({ ...p, x: p.x + at[0], y: p.y + at[1] }));
    const next = [...before, ...add];
    commit(next, before);
    setSel(new Set(add.map((_, k) => before.length + k)));
    setNote(`Pasted ${add.length} ${add.length === 1 ? "part" : "parts"}`);
  };
  useEffect(() => { setPaste(null); }, [index]);
  const ghost = useMemo(() => paste?.parts.flatMap((p) => {
    const path = byId.get(p.partId)?.path;
    return path ? [{ p, g: placed(path, { ...p, x: p.x + paste.at[0], y: p.y + paste.at[1] }) }] : [];
  }) ?? [], [paste, byId]);

  // -- Align edge: the edge that stays (a part's or the sheet's), then an edge of the part to turn -----
  type Edge = { a: Pt; b: Pt; part: number };   // part -1: the sheet
  const [align, setAlign] = useState<{ fixed: Edge | null } | null>(null);
  const alignRef = useRef(align);
  alignRef.current = align;
  const [edgeHover, setEdgeHover] = useState<Edge | null>(null);
  useEffect(() => { setAlign(null); setEdgeHover(null); }, [index]);
  /** The edge nearest the point (within a few pixels): of a part, or (sheet = true) of the sheet too. */
  const edgeAt = (x: number, y: number, sheetToo: boolean): Edge | null => {
    const tol = 8 / (view?.s ?? 1);
    let best: Edge | null = null, bd = tol;
    const seg = (a: Pt, b: Pt, part: number) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
      if (l2 < 1e-9) return;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2));
      const d = Math.hypot(a[0] + t * dx - x, a[1] + t * dy - y);
      if (d < bd) { bd = d; best = { a, b, part }; }
    };
    geo.forEach((g, i) => {
      if (!g || x < g.box.x0 - tol || x > g.box.x1 + tol || y < g.box.y0 - tol || y > g.box.y1 + tol) return;
      for (const lp of g.loops) for (let k = 0; k < lp.length; k++) seg(lp[k], lp[(k + 1) % lp.length], i);
    });
    if (sheetToo) {
      const loops: Pt[][] = outline ?? [[[0, 0], [sheet.lengthMm, 0], [sheet.lengthMm, sheet.widthMm], [0, sheet.widthMm]]];
      for (const lp of loops) for (let k = 0; k < lp.length; k++) seg(lp[k], lp[(k + 1) % lp.length], -1);
    }
    return best;
  };
  const isLocked = (i: number) => itemsRef.current[i]?.lock !== undefined;
  const alignClick = (pt: Pt) => {
    const al = alignRef.current;
    if (!al) return;
    if (!al.fixed) {
      const e = edgeAt(pt[0], pt[1], true);
      if (!e) return;
      setAlign({ fixed: e });
      setNote("Now click an edge of the part to turn (Esc: cancel)");
      return;
    }
    const e = edgeAt(pt[0], pt[1], false);
    if (!e || e.part < 0) return;
    if (e.part === al.fixed.part) { setNote("Pick an edge of another part: that part stays as it is"); return; }
    const ang = (q: Edge) => (Math.atan2(q.b[1] - q.a[1], q.b[0] - q.a[0]) * 180) / Math.PI;
    // the smallest turn that makes them parallel (an edge has no direction: modulo 180°)
    let d = ang(al.fixed) - ang(e);
    d = ((d % 180) + 180) % 180;
    if (d > 90) d -= 180;
    setAlign(null);
    setEdgeHover(null);
    if (Math.abs(d) < 0.01) { setNote("Already parallel"); return; }
    const before = itemsRef.current;
    // the part, or the selection it is in, turned about the middle of its box
    if (isLocked(e.part)) { setNote("That part is locked: unlock it to turn it"); return; }
    const ids = (selRef.current.has(e.part) ? [...selRef.current] : [e.part]).filter((i) => !isLocked(i));
    const boxes = ids.map((i) => geoOf(before, i)?.box).filter((b): b is Box => !!b);
    const turned = rotateGroup(ids.map((i) => before[i]), boxes, d);
    const next = before.slice();
    ids.forEach((i, k) => { next[i] = turned[k]; });
    commit(next, before);
    setNote(`Turned ${Math.abs(d).toFixed(1)}° ${d > 0 ? "clockwise" : "counter-clockwise"}`);
  };

  // -- toolbar tools on the selection: Mirror V / H, Stack V / H / grid, Arrange -----------------------
  const [note, setNote] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  // the busy pointer everywhere while Arrange runs
  useEffect(() => {
    if (!working) return;
    document.documentElement.classList.add("is-busy");
    return () => document.documentElement.classList.remove("is-busy");
  }, [working]);
  useEffect(() => { if (!note || working) return; const t = window.setTimeout(() => setNote(null), 4000); return () => window.clearTimeout(t); }, [note, working]);
  const toolSeen = useRef(tool?.n ?? 0);
  // Arrange again: the parts and layout of the last Arrange (cleared when the selection is cleared)
  const arrangeMemo = useRef<{ key: string; items: PlacedPart[]; round: number } | null>(null);
  useEffect(() => { if (!sel.size) arrangeMemo.current = null; }, [sel]);
  const alive = useRef<{ index: number } | null>({ index });
  alive.current = { index };
  useEffect(() => () => { alive.current = null; }, []);
  const workingRef = useRef(false);
  workingRef.current = working;   // a click from before this screen opened is not for it
  const partPath = (id: string) => byId.get(id)?.path;
  const nameOf = (id: string) => byId.get(id)?.name ?? id;
  const runTool = async (t: string) => {
    diag("manual", `Sheet ${index + 1}: ${t} with ${selRef.current.size} selected of ${itemsRef.current.length} parts`);
    if (working) return;
    if (!edit) { setNote("The sheet is locked: unlock it to change it."); return; }
    if (t === "alignEdge") {
      setPaste(null);
      setAlign({ fixed: null });
      setNote("Align edge: click the edge that stays, a part's or the sheet's (Esc: cancel)");
      return;
    }
    const before = itemsRef.current;
    const ids = [...selRef.current].filter((i) => before[i] && partPath(before[i].partId)).sort((a, b) => a - b);
    if (!ids.length) { setNote("Select parts first: click a part, or drag a window."); return; }
    if (t === "mirrorV" || t === "mirrorH" || t === "arrange") {
      // locked parts are left as they are; the others go on (Arrange works around the locked ones)
      const free = ids.filter((i) => !before[i].lock);
      if (!free.length) { setNote("Locked parts stay as they are: unlock them first."); return; }
      if (free.length < ids.length) { ids.length = 0; ids.push(...free); }
    }
    const uniq = [...new Set(ids.map((i) => before[i].partId))];
    if (t === "mirrorV" || t === "mirrorH") {
      const rules = await Promise.all(uniq.map(partRules));
      const no = uniq.filter((_, k) => !rules[k].mirror);
      if (no.length) { setNote(`Not mirrored: ${no.map(nameOf).join(", ")} may not be mirrored (part settings).`); return; }
      if (itemsRef.current !== before) return;
      const box = unionBox(ids.map((i) => geoOf(before, i)!.box));
      commit(mirrorGroup(before, ids, box, t === "mirrorV" ? "v" : "h"), before);
      return;
    }
    if (t === "stackV" || t === "stackH" || t === "stackGrid") {
      // no more pieces than required: per part, required less nested in the solution
      const left = new Map<string, number>();
      for (const id of uniq) { const jp = jobParts.find((x) => x.part.id === id); if (jp) left.set(id, Math.max(0, jp.qty - (counts[id] ?? 0))); }
      const r = stack(before, ids, t === "stackV" ? "v" : t === "stackH" ? "h" : "grid", partPath, usable, gap, origin, outline, left, sheet.cutNumber ?? 1);
      if (!r.added) { setNote(r.full ? "Required number already nested: no copies added." : "No room for a copy: the edge or another part is in the way."); return; }
      commit(r.list, before);
      setNote(`${r.added} ${r.added === 1 ? "copy" : "copies"} added${r.full ? ": required number reached" : ""}`);
      return;
    }
    if (t === "arrange") {
      // a small nest: up to 20 parts in 1.5 s, up to 50 in 3 s; more is a job for Automatic nest
      if (ids.length > 50) { setNote(`Arrange takes up to 50 parts (${ids.length} selected): select fewer, or use Automatic nest.`); return; }
      const limit = ids.length <= 20 ? 1500 : 3000;
      // the same parts again, nothing changed since: the search goes on from this layout
      const key = ids.join(",");
      const memo = arrangeMemo.current;
      const again = memo && memo.key === key && memo.items === before ? memo.round + 1 : 0;
      const t0 = performance.now();
      setWorking(true);
      setNote(`Arranging ${ids.length} ${ids.length === 1 ? "part" : "parts"}…`);
      try {
        const got = await Promise.all(uniq.map(partRules));
        const rules = new Map<string, PartRules>(uniq.map((id, k) => [id, got[k]]));
        // Common cut on: the kinds that join become blocks
        const common = new Map<string, CommonLayout>();
        if (commonCut) for (const id of uniq) {
          const ed = edgesById.get(id), path = partPath(id);
          if (!ed?.length || !path || ids.filter((i) => before[i].partId === id).length < 2) continue;
          const lay = commonLayout(path, ed, kerf, gap);
          // a turned pair needs the part to be allowed to turn 180 degrees
          if (lay && !(lay.kind === "pair" && !(rules.get(id)?.rotations ?? []).some((r) => r > 0 && 180 % r === 0))) common.set(id, lay);
        }
        // the note and the spinning ring show before the work starts (the ring keeps turning on its own while it runs)
        await new Promise((r) => window.setTimeout(r, 50));
        if (itemsRef.current !== before) { setNote(null); return; }
        // Rules -> Nesting rules: towards 0,0, or packed where they are (from the selection's corner nearest 0,0)
        const toOrigin = loadNestingRules().arrangeToOrigin;
        let area = usable;
        if (!toOrigin) {
          const g = unionBox(ids.map((i) => geoOf(before, i)!.box));
          area = {
            x0: origin.endsWith("right") ? usable.x0 : Math.max(usable.x0, g.x0), x1: origin.endsWith("right") ? Math.min(usable.x1, g.x1) : usable.x1,
            y0: origin.startsWith("bottom") ? usable.y0 : Math.max(usable.y0, g.y0), y1: origin.startsWith("bottom") ? Math.min(usable.y1, g.y1) : usable.y1,
          };
        }
        const input = { list: before, ids, pathOf: partPath, rules, lengthMm: sheet.lengthMm, widthMm: sheet.widthMm, usable: area, outline, edgeGap, gap, origin,
          budgetMs: limit - 60 - (performance.now() - t0), common: common.size ? common : undefined };
        // Arrange again moves parts one by one: blocks are arranged afresh instead
        const out = !(area.x1 > area.x0 && area.y1 > area.y0) ? null
          : again && !common.size ? await arrangeAgain({ ...input, round: again }) : await arrange(input);
        // left the sheet, or it changed meanwhile: not used
        if (!alive.current || alive.current.index !== index || itemsRef.current !== before) { setNote(null); return; }
        if (!out) { setNote(toOrigin ? "No room to arrange these parts on this sheet." : "No room to arrange these parts where they are."); return; }
        if (out === before) {
          arrangeMemo.current = { key, items: before, round: again };
          setNote(`Try ${again + 1}: nothing better found, kept as it is`);
          return;
        }
        commit(out, before);
        arrangeMemo.current = { key, items: out, round: again };
        const boxArea = (l: PlacedPart[]) => { const u = unionBox(ids.map((i) => geoOf(l, i)!.box)); return (u.x1 - u.x0) * (u.y1 - u.y0); };
        setNote(again ? `Try ${again + 1}: box ${(100 * (1 - boxArea(out) / boxArea(before))).toFixed(1)} % smaller` : `Arranged ${ids.length} ${ids.length === 1 ? "part" : "parts"} (Arrange again to try for better)`);
      } finally {
        setWorking(false);
      }
    }
  };
  useEffect(() => {
    if (!tool || tool.n === toolSeen.current) return;
    toolSeen.current = tool.n;
    void runTool(tool.tool);
  }, [tool?.n]);   // eslint-disable-line react-hooks/exhaustive-deps

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

  // processed parts (Process): their cut path, here too; a part moved since is not processed any more
  const shownSheet = useMemo(() => ({ ...sheet, parts: items }), [sheet, items]);
  const cutDone = useMemo(() => processedParts(shownSheet), [shownSheet]);
  const cutLive = useMemo(() => liveContours(shownSheet), [shownSheet]);
  const cutRapids = useMemo(() => rapidsOf(cutLive, originPoint(sheet, origin)), [cutLive, sheet, origin]);
  const viewPrefs = useViewPrefs();
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
          {!edit && !cut && <span className="mn-locked" title={locked ? "The sheet is locked: unlock it to change it" : "Look only"}>VIEW</span>}
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
          </>) : <div className="mn-info-none">{cut ? cut.hint : edit ? "Click a part, or drag a window, to select (Ctrl: add or remove). Drag parts in from JOB PARTS." : "Locked sheet: look only."}</div>}
        </div>
      </div>

      <div className="mn-stage">
        <Ruler axis="y" view={v} size={size} />
        <div ref={host} className={`mn-canvas${hover >= 0 && edit ? " is-over" : ""}${paste ? " is-paste" : ""}${align ? " is-align" : ""}`}
          style={cut?.cursor ? { cursor: cut.cursor } : undefined}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
          onContextMenu={(e) => e.preventDefault()}
          // the browser's own drag and drop of the sheet picture (a faded copy of the whole sheet
          // following the mouse next to the parts being moved): never from here
          onDragStart={(e) => e.preventDefault()}
          onMouseDown={(e) => { if (e.button === 0) { e.preventDefault(); (document.activeElement as HTMLElement | null)?.blur?.(); } }}
          onDragOver={(e) => { if (edit && e.dataTransfer.types.includes("text/gnezdo-part")) e.preventDefault(); }}
          onDrop={onDrop}>
          <svg width={size.w} height={size.h} aria-label={`Sheet ${index + 1}`}>
            <g transform={`translate(${v.tx} ${v.ty}) scale(${v.s})`}>
              {outline ? <path className="mn-plate" fillRule="evenodd" d={pathOf(outline)} />
                : <rect className="mn-plate" x={0} y={0} width={sheet.lengthMm} height={sheet.widthMm} />}
              {!outline && <rect className="mn-trim" x={usable.x0} y={usable.y0} width={usable.x1 - usable.x0} height={usable.y1 - usable.y0}
                style={{ strokeWidth: 1 / v.s }} />}
              {/* the selected parts last, on top: dragged over others they stay in sight (and see-through) */}
              {[...items.keys()].sort((a, b) => Number(sel.has(a)) - Number(sel.has(b))).map((i) => {
                const p = items[i];
                const g = geo[i];
                const r = byId.get(p.partId);
                if (!g || !r) return null;
                const c = partColor(r.no);
                if (cut) {
                  const done = cut.sim ? cut.sim.done.has(i) : cutDone.has(i), pick = cut.picked.includes(i);
                  return (
                    <path key={i} d={pathOf(g.loops)} fillRule="evenodd" className={`mn-part is-process${done ? " is-cut" : ""}${pick ? " is-picked" : ""}`}
                      style={done ? { strokeWidth: 1.2 / v.s } : { fill: c.fill, stroke: c.stroke, strokeWidth: 1 / v.s }}>
                      <title>{r.name}</title>
                    </path>
                  );
                }
                const done = cutDone.has(i) && !(sel.has(i) && moving);
                return (
                  <path key={i} d={pathOf(g.loops)} fillRule="evenodd"
                    className={`mn-part${done ? " is-cut" : ""}${sel.has(i) ? " is-sel" : ""}${bad.has(i) ? " is-bad" : ""}${sel.has(i) && moving ? " is-moving" : ""}${p.lock ? " is-locked" : ""}`}
                    style={{ fill: done ? undefined : c.fill, stroke: sel.has(i) || done ? undefined : c.stroke, strokeWidth: (sel.has(i) ? 2.2 : 1) / v.s }}>
                    <title>{r.name}</title>
                  </path>
                );
              })}
              {shared.lines.map(([a, b], k) => (
                <line key={`cc${k}`} className="mn-common" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} style={{ strokeWidth: 3 / v.s }}>
                  <title>Common cut: one cut for both parts</title>
                </line>
              ))}
              {align?.fixed && <line className="mn-edge is-fixed" x1={align.fixed.a[0]} y1={align.fixed.a[1]} x2={align.fixed.b[0]} y2={align.fixed.b[1]} style={{ strokeWidth: 5 / v.s }} />}
              {align && edgeHover && <line className="mn-edge" x1={edgeHover.a[0]} y1={edgeHover.a[1]} x2={edgeHover.b[0]} y2={edgeHover.b[1]} style={{ strokeWidth: 5 / v.s }} />}
              {ghost.map(({ p, g }, k) => {
                const r = byId.get(p.partId)!;
                const c = partColor(r.no);
                return <path key={`g${k}`} className="mn-ghost" d={pathOf(g.loops)} fillRule="evenodd" style={{ fill: c.fill, stroke: c.stroke, strokeWidth: 1 / v.s }} />;
              })}
              {(cut || cutLive.length > 0) && (() => {
                const line = (pts: [number, number][]) => pts.map(([x, y], k) => `${k ? "L" : "M"}${x} ${y}`).join("");
                return (
                  <g className="cut-path">
                    {(cut?.sim ? cut.sim.rapids : cutRapids).map(([a, b], k) => <line key={`r${k}`} className="cut-rapid" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} style={{ strokeWidth: 0.8 / v.s, strokeDasharray: `${4 / v.s} ${3 / v.s}` }} />)}
                    {viewPrefs.rapidArrows && (cut?.sim ? cut.sim.rapids : cutRapids).map(([a, b], k) => {
                      // the way the head travels: an arrow in the middle of the rapid move
                      const l = Math.hypot(b[0] - a[0], b[1] - a[1]), size = 5 / v.s;
                      if (l < 4 * size) return null;
                      return <path key={`ra${k}`} className="cut-rapid cut-arrow" d={arrowHead([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], [(b[0] - a[0]) / l, (b[1] - a[1]) / l], size)} style={{ strokeWidth: 0.7 / v.s }} />;
                    })}
                    {(cut?.sim ? cut.sim.shown : cutLive).map((c, k) => {
                      const pierce = c.leadIn[0] ?? c.pts[0];
                      const now = c === cut?.sim?.current;
                      const end = c.leadOut.length || now ? undefined : c.pts[c.pts.length - 1];
                      const hl = cut?.highlight?.has(c);
                      const gl = cut?.glow?.strong === c ? 2 : cut?.glow?.all.has(c) ? 1 : 0;
                      return (
                        <g key={k}>
                          {hl && <path className="cut-hl" d={line([...c.leadIn, ...c.pts, ...c.leadOut])} style={{ strokeWidth: 7 / v.s }} />}
                          {gl > 0 && <path className={`cut-glow${gl === 2 ? " is-strong" : ""}`} d={line([...c.leadIn, ...c.pts, ...c.leadOut])} style={{ strokeWidth: (gl === 2 ? 9 : 6) / v.s }} />}
                          <path className={`cut-${c.kind}${c.common ? " cut-common" : ""}${now ? " cut-now" : ""}`} d={line(c.pts)} style={{ strokeWidth: (c.kind === "trace" ? 1.2 : 1.6) / v.s }} />
                          {c.leadIn.length > 1 && <path className="cut-in" d={line(c.leadIn)} style={{ strokeWidth: 1.6 / v.s }} />}
                          {c.leadOut.length > 1 && <path className="cut-out" d={line(c.leadOut)} style={{ strokeWidth: 1.6 / v.s }} />}
                          {viewPrefs.cutArrows && arrowsAlong(c.pts, 220 / v.s, 30 / v.s).map(([p, d], j) => (
                            <path key={`a${j}`} className={`cut-${c.kind}${c.common ? " cut-common" : ""} cut-arrow`} d={arrowHead(p, d, 4.5 / v.s)} style={{ strokeWidth: 0.9 / v.s }} />
                          ))}
                          {/* where it pierces (green) and, with no lead-out, where it ends (red) */}
                          {end && <circle className="cut-end" cx={end[0]} cy={end[1]} r={1.8 / v.s} />}
                          {pierce && <circle className="cut-pierce" cx={pierce[0]} cy={pierce[1]} r={1.8 / v.s} />}
                        </g>
                      );
                    })}
                    {cut?.sim && (() => {
                      // the head: a crosshair
                      const [hx, hy] = cut.sim.head, r = 9 / v.s, g = 5 / v.s, e = 15 / v.s;
                      return (
                        <g className="sim-head" style={{ strokeWidth: 1.6 / v.s }}>
                          <circle cx={hx} cy={hy} r={r} />
                          <circle className="sim-head-dot" cx={hx} cy={hy} r={2.6 / v.s} />
                          <path d={`M${hx - e} ${hy}H${hx - g}M${hx + g} ${hy}H${hx + e}M${hx} ${hy - e}V${hy - g}M${hx} ${hy + g}V${hy + e}`} />
                        </g>
                      );
                    })()}
                    {cut?.picked.map((i, k) => {
                      const g = geo[i];
                      if (!g) return null;
                      return <text key={`n${i}`} className="cut-no" x={(g.box.x0 + g.box.x1) / 2} y={(g.box.y0 + g.box.y1) / 2} style={{ fontSize: 16 / v.s, strokeWidth: 3 / v.s }}>{k + 1}</text>;
                    })}
                  </g>
                );
              })()}
              <RemnantOverlay sheet={shownSheet} s={v.s} />
              <circle cx={right ? sheet.lengthMm : 0} cy={bottom ? sheet.widthMm : 0} r={6 / v.s} className="mn-origin" />
            </g>
            {box && (
              <rect className={`sel-box${box.x1 < box.x0 ? " is-crossing" : ""}`}
                x={Math.min(box.x0, box.x1)} y={Math.min(box.y0, box.y1)} width={Math.abs(box.x1 - box.x0)} height={Math.abs(box.y1 - box.y0)} />
            )}
          </svg>
          {working && <div className="mn-busy" aria-hidden="true"><span /></div>}
          {menu && (() => {
            const anyFree = menu.ids.some((i) => items[i] && !items[i].lock);
            const anyLocked = menu.ids.some((i) => items[i]?.lock !== undefined);
            const n = menu.ids.length;
            const what = n === 1 ? "part" : `${n} parts`;
            return (
              <div className="mn-ctx" role="menu" style={{ left: menu.x, top: menu.y }} onContextMenu={(e) => e.preventDefault()}
                onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                <button type="button" role="menuitem" disabled={!anyFree} onClick={() => { setMenu(null); lockParts(menu.ids); }}
                  title="Pinned where it is, at its angle: dragging, arrow keys, turning, slides, mirroring, Align edge and Arrange leave it">Lock {what}</button>
                <button type="button" role="menuitem" disabled={!anyLocked} onClick={() => { setMenu(null); unlockParts(menu.ids); }}
                  title="Free again; parts locked together with it come free too">Unlock {what}</button>
              </div>
            );
          })()}
          {note && <div className={`mn-note${working ? " is-working" : ""}`} role="status">{note}</div>}
          {bad.size > 0 && (() => {
            const close = [...bad].filter((i) => !outside.has(i)).length;
            const msg = [
              outside.size ? `${outside.size} ${outside.size === 1 ? "part reaches" : "parts reach"} past the trims or the edge` : "",
              close ? `${close} ${close === 1 ? "part overlaps or is" : "parts overlap or are"} too close` : "",
            ].filter(Boolean).join(" · ");
            return <div className="mn-warn">{msg} (red){outside.size ? " — zoom out to see parts outside the sheet" : ""}</div>;
          })()}
        </div>
        <button type="button" className="mn-fit" onClick={() => fit(size.w, size.h)} title="Fit: the whole sheet" aria-label="Fit the whole sheet">
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
            <path d="M2 7V2h5M13 2h5v5M18 13v5h-5M7 18H2v-5" fill="none" stroke="currentColor" strokeWidth="2" />
            <rect x="6" y="6" width="8" height="8" rx="1" fill="currentColor" />
          </svg>
        </button>
        <Ruler axis="x" view={v} size={size} />
      </div>

      {cut ? cut.panel : <PartsPanel jobParts={jobParts} sheet={sheet} counts={counts} edit={edit} />}
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
      <div className={`mn-tiles cols-${loadManualView().tileColumns}`}>
        {!list.length && <p className="mn-none">{all ? "No parts in the job." : `No parts of ${sheet.material} ${sheet.thicknessMm} mm. The menu shows all parts.`}</p>}
        {list.map((jp) => {
          const n = counts[jp.part.id] ?? 0;
          // green from Qty req up to Qty max; red below and above (as in the work parts list)
          const limit = Math.max(jp.qty, jp.qtyMax ?? 0);
          const noQty = !jp.qty;   // Qty req not set yet (Work parts)
          const full = noQty || n + (sheet.cutNumber ?? 1) > limit;
          const lp = partLoops(jp.part.path);
          const xs = lp[0]?.map((p) => p[0]) ?? [0], ys = lp[0]?.map((p) => p[1]) ?? [0];
          const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0 || 1, h = Math.max(...ys) - y0 || 1;
          const c = partColor(jp.no);
          return (
            <div key={jp.part.id} className={`mn-tile${jp.qty > 0 && n >= jp.qty && n <= limit ? " is-done" : ""}${n > limit ? " is-over" : ""}${full ? " is-full" : ""}${edit ? "" : " is-off"}`}
              draggable={edit && !full}
              title={n > limit ? `${jp.part.name}\n${n} nested: ${n - limit} more than ${jp.qtyMax && jp.qtyMax > jp.qty ? "Qty max" : "required"} (${limit})`
                : noQty ? `${jp.part.name}\nSet its Qty req in Work parts first`
                : full ? `${jp.part.name}\nAll ${limit} nested${jp.qtyMax && jp.qtyMax > jp.qty ? " (Qty max)" : ""}: no more to add`
                : `${jp.part.name}\nDrag onto the sheet (Ctrl on a part: next to it)`}
              onDragStart={(e) => {
                e.dataTransfer.setData("text/gnezdo-part", jp.part.id);
                e.dataTransfer.effectAllowed = "copy";
                // only the part's picture under the pointer, not the whole tile
                const pic = e.currentTarget.querySelector("svg");
                if (pic) { const r = pic.getBoundingClientRect(); e.dataTransfer.setDragImage(pic, r.width / 2, r.height / 2); }
              }}>
              <svg viewBox={`${x0 - w * 0.08} ${y0 - h * 0.08} ${w * 1.16} ${h * 1.16}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
                <path d={jp.part.path} fillRule="evenodd" style={{ fill: c.fill, stroke: c.stroke }} vectorEffect="non-scaling-stroke" />
              </svg>
              <span className="mn-tile-name">{jp.part.name}</span>
              <span className="mn-tile-qty">{n} / {jp.qty}{limit > jp.qty ? ` (max ${limit})` : ""}</span>
              <span className="mn-tile-size">{Math.round(jp.part.w)} × {Math.round(jp.part.h)}</span>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
