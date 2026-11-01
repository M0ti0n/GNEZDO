import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ImportToolStrip, IMPORT_TOOLS } from "../import/ImportTools";
import { ROTATIONS, lineColour, type Rotation } from "../import/rules";
import { FILLER_TIP } from "../import/filler";
import { ColourLinesDialog, applyColours } from "../import/ColourLinesDialog";
import { angleOf, diameterOf, dimensionOf, pickEntity, radiusOf, type Measure, type Pick } from "../import/measure";
import { alignAt, diagnoseEnds, eraseAt, extendAt, trimAt, type EditResult, type EndIssue } from "../import/edit";
import type { BatchProperties } from "../import/batch";
import {
  endsOf,
  boxOf, checkGeometry, keepMarkRules, markRulesText, pathOf, pointsAlong, roleOf, union,
  type Box, type CheckId, type Drawing, type Entity, type Pt, type Role,
} from "../import/geometry";

type NestRules = { rotations: Rotation[]; mirror: boolean; filler: boolean };

/** Screen = (x * s + tx, -y * s + ty): s pixels per mm, y flipped (CAD y points up). */
interface View { s: number; tx: number; ty: number }

const PANEL_W = 350;   // geometry check panel, kept clear when fitting
const MARGIN = 48;

/** Tools that mark lines by clicking them, and the role they give. */
const MARKING: Record<string, { role: Role; hint: string }> = {
  trace: { role: "trace", hint: "Tracing is engraved, not cut through. Click a line, or drag a window, to mark it; again to unmark. Right drag moves the drawing." },
  openCut: { role: "openCut", hint: "Open cut: cut inside the part with no lead-in or lead-out; piercing exactly at one end (chosen by the cut order on the sheet). Click a line, or drag a window, to mark it; again to unmark." },
};

/** Tools that change lines by clicking them (AutoCAD quick mode); Shift swaps trim and extend. */
/** Pixels within which a point snaps to the end of a line. */
const SNAP_PX = 12;
const HOLE_HINT = "Click a closed cutting contour, or drag a window, to mark it as a hole: cut at slower speed by machines that can (e.g. plasma). Again to unmark.";
const SWEEP_HINT = "Highlighted: lines on top of other lines (within 0.1 mm), lines outside the part outline and loose points. Click a line to keep it; Delete removes the rest.";
const LINE_HINT = "Click the start point, then the end point; the line goes on from there. Ends of lines snap (green square). Esc or right click finishes.";

const EDITING: Record<string, { hint: string }> = {
  trim: { hint: "Click the piece of a line to cut off (all lines are cutting edges). Shift+click extends. Ctrl+Z undoes." },
  extend: { hint: "Click a line near the end to lengthen it to the next line. Shift+click trims. Ctrl+Z undoes." },
  erase: { hint: "Click a line, arc or circle to erase it. Ctrl+Z undoes." },
  alignH: { hint: "Click a straight line: the whole part turns counter-clockwise until that line is horizontal." },
  alignV: { hint: "Click a straight line: the whole part turns counter-clockwise until that line is vertical." },
};

/** Measuring tools: they only read the drawing; what they show goes away when the tool is switched off. */
const MEASURING: Record<string, { hint: string }> = {
  diameter: { hint: "Click an arc or a circle to show its diameter." },
  radius: { hint: "Click an arc or a circle to show its radius." },
  angle: { hint: "Click the first line, then the second. Click near the ends that form the angle you want." },
  dimension: { hint: "Click two things: end points (green square), lines, or arcs and circles (their center). Esc starts again." },
};

interface Props {
  drawing: Drawing;
  processed: boolean;
  properties?: BatchProperties;
  /** Rotations, mirror and filler this part gets (or got, when processed). */
  nestRules?: NestRules;
  /** A change to the lines, recorded in the tab's history under this name. Clears "processed". */
  onEdit: (drawing: Drawing, label: string) => void;
  /** Set after Undo / Redo: what was undone or redone (a new object each time). */
  undone?: { text: string } | null;
  /** Opened from the database (EDIT): its own properties and rules are shown and saved back over it. */
  fromDatabase?: boolean;
  /** Process tool on a part without problems: opens the save pop-up. */
  onProcess: () => void;
  /** Properties tool: opens the part's properties. */
  onProperties: () => void;
  /** Nesting rules changed here: they are the list's Properties. */
  onNestRules?: (r: NestRules) => void;
  /** Mirror is not allowed for this part (open cut lines and the rule says so). */
  mirrorBlocked?: boolean;
}

export function ImportPage({ drawing, processed, properties, nestRules, onEdit, undone, onProcess, onProperties, onNestRules, mirrorBlocked = false, fromDatabase = false }: Props) {
  const report = useMemo(() => checkGeometry(drawing.entities), [drawing]);
  const [tool, setTool] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; bad?: boolean } | null>(null);
  const [selected, setSelected] = useState<CheckId | null>(null);

  const host = useRef<HTMLDivElement>(null);

  // Every change to the lines is one step in the tab's history (Undo / Redo in the green bar).
  const commit = (next: Drawing, label: string) => onEdit(next, label);

  // After an undo or redo: drop the hover preview and say what happened.
  const undoneAtMount = useRef(undone);   // an older undo from before this tab was shown again: not news
  useEffect(() => {
    if (!undone || undone === undoneAtMount.current) return;
    setPreview(null);
    setMessage({ text: undone.text });
  }, [undone]);

  // Line tool: start point, then each next point; points snap to the ends of lines.
  const [lineStart, setLineStart] = useState<Pt | null>(null);
  const [cursor, setCursor] = useState<{ p: Pt; snapped: boolean } | null>(null);
  const lineSeq = useRef(0);
  const ends = useMemo(() => drawing.entities.flatMap((e) => {
    const en = endsOf(e);
    return en ? [en[0], en[1]] : [];
  }), [drawing]);
  const snapAt = (clientX: number, clientY: number, v: View): { p: Pt; snapped: boolean } => {
    const p = toModel(clientX, clientY, v);
    let best: Pt | null = null, bestD = SNAP_PX / v.s;
    for (const q of ends) { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d <= bestD) { best = q; bestD = d; } }
    return best ? { p: { ...best }, snapped: true } : { p, snapped: false };
  };
  // Measuring: the first pick of Angle / Dimension, and what has been measured while the tool is on.
  const [firstPick, setFirstPick] = useState<Pick | null>(null);
  const [measures, setMeasures] = useState<Measure[]>([]);
  useEffect(() => { setMeasures([]); setFirstPick(null); }, [drawing]);
  /** What a click picks: with Dimension an end point snaps first; otherwise the line, arc or circle under the pointer. */
  const pickAt = (clientX: number, clientY: number, v: View, points: boolean): Pick | null => {
    if (points) { const s = snapAt(clientX, clientY, v); if (s.snapped) return { kind: "point", p: s.p }; }
    const id = lineUnder(clientX, clientY);
    const e = id ? drawing.entities.find((x) => x.id === id) : undefined;
    return e ? pickEntity(e, toModel(clientX, clientY, v)) : null;
  };
  const measureClick = (clientX: number, clientY: number, v: View) => {
    const pk = pickAt(clientX, clientY, v, tool === "dimension");
    const done = (res: ReturnType<typeof radiusOf>) => {
      setFirstPick(null);
      if (!res.ok) { setMessage({ text: res.message, bad: true }); return; }
      setMeasures((list) => [...list, res.m]);
      setMessage({ text: measureText(res.m) });
    };
    if (tool === "radius") return done(radiusOf(pk));
    if (tool === "diameter") return done(diameterOf(pk));
    if (!pk) { setMessage({ text: tool === "angle" ? "Click a straight line" : "Click an end point, a line, an arc or a circle", bad: true }); return; }
    if (tool === "angle" && pk.kind !== "line") { setMessage({ text: "Angle needs straight lines", bad: true }); return; }
    if (!firstPick) {
      setFirstPick(pk);
      setMessage({ text: tool === "angle" ? "Now click the second line" : "Now click the second end point, line, arc or circle" });
      return;
    }
    done(tool === "angle" ? angleOf(firstPick, pk) : dimensionOf(firstPick, pk));
  };

  const finishLine = () => {
    if (lineStart) setMessage({ text: "Line finished" });
    setLineStart(null);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !tool) return;
      // a pop-up on top gets the Esc, not the tool under it
      if (document.querySelector(".dlg-backdrop")) return;
      // Esc steps back: a line being drawn is finished, a half-done measurement starts again,
      // and otherwise the tool is put away (as clicking its button again)
      if (tool === "line" && lineStart) { finishLine(); return; }
      if (firstPick) { setFirstPick(null); setMessage({ text: "Started again: click the first one" }); return; }
      onTool(tool);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Trim / Extend: what a click would do, shown while hovering.
  const [preview, setPreview] = useState<(EditResult & { ok: true }) | null>(null);
  const editAt = (id: string, p: Pt, shift: boolean): EditResult => {
    if (tool === "erase") return eraseAt(drawing.entities, id);
    if (tool === "alignH" || tool === "alignV") return alignAt(drawing.entities, id, tool === "alignH" ? "h" : "v", drawing.points);
    const extend = (tool === "extend") !== shift;   // Shift swaps trim and extend
    return extend ? extendAt(drawing.entities, id, p) : trimAt(drawing.entities, id, p);
  };
  const lineUnder = (clientX: number, clientY: number) =>
    (document.elementsFromPoint(clientX, clientY).find((el) => el instanceof SVGElement && el.dataset.id) as SVGElement | undefined)?.dataset.id;
  const toModel = (clientX: number, clientY: number, v: View): Pt => {
    const r = host.current!.getBoundingClientRect();
    return { x: (clientX - r.left - v.tx) / v.s, y: -(clientY - r.top - v.ty) / v.s };
  };
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useCallback((b: Box) => {
    if (!size.w) return;
    const w = Math.max(size.w - PANEL_W - 2 * MARGIN, 80), h = Math.max(size.h - 2 * MARGIN, 80);
    const bw = Math.max(b.maxX - b.minX, 1), bh = Math.max(b.maxY - b.minY, 1);
    const s = Math.min(w / bw, h / bh);
    setView({
      s,
      tx: MARGIN + (w - bw * s) / 2 - b.minX * s,
      ty: MARGIN + (h - bh * s) / 2 + b.maxY * s,
    });
  }, [size.w, size.h]);

  // loose points count for "show everything", so stray points far away are not missed
  const fitAll = useCallback(() => fit((drawing.points ?? []).reduce((b, { p }) => union(b, { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y }), report.box)),
    [fit, report.box, drawing.points]);
  useEffect(() => { if (!view) fitAll(); }, [view, fitAll]);

  // Wheel zooms around the cursor (non-passive so the page does not scroll).
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // over the Geometry check panel the wheel scrolls the panel, not the drawing
      if ((e.target as Element | null)?.closest?.(".gcheck, .canvas-ui")) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const k = Math.pow(1.0015, -e.deltaY);
      setView((v) => v && { s: v.s * k, tx: mx - (mx - v.tx) * k, ty: my - (my - v.ty) * k });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Right and middle buttons always pan; the left button pans too unless a marking tool is on.
  // With Trace / Open cut the left button clicks a line or drags a selection box:
  //   left to right = window (lines fully inside), right to left = crossing (lines touched).
  const drag = useRef<{ x: number; y: number } | null>(null);
  const press = useRef<{ x: number; y: number; button: number } | null>(null);
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const local = (e: React.PointerEvent) => {
    const r = host.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
    if ((e.target as Element).closest(".gcheck, .canvas-ui")) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    if (e.button === 0 && tool && (MARKING[tool] || tool === "hole")) {
      const p = local(e);
      setBox({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      return;
    }
    drag.current = { x: e.clientX, y: e.clientY };
    press.current = { x: e.clientX, y: e.clientY, button: e.button };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (box) { const p = local(e); setBox((b) => b && { ...b, x1: p.x, y1: p.y }); return; }
    const d = drag.current;
    if (!d) {
      if ((tool === "line" || tool === "dimension") && view) { setCursor(snapAt(e.clientX, e.clientY, view)); return; }
      // hover with Trim / Extend: preview the result
      if (tool && EDITING[tool] && view) {
        const id = lineUnder(e.clientX, e.clientY);
        const r = id ? editAt(id, toModel(e.clientX, e.clientY, view), e.shiftKey) : null;
        setPreview(r && r.ok ? r : null);
        if (r && !r.ok) setMessage({ text: r.message, bad: true }); else if (message?.bad) setMessage(null);
      }
      return;
    }
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    drag.current = { x: e.clientX, y: e.clientY };
    setView((v) => v && { ...v, tx: v.tx + dx, ty: v.ty + dy });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    drag.current = null;
    const pr = press.current;
    press.current = null;
    const isClick = !!pr && Math.hypot(e.clientX - pr.x, e.clientY - pr.y) <= 4;
    if (isClick && tool === "line" && view) {
      if (pr!.button === 2) { finishLine(); return; }        // right click ends the line
      if (pr!.button !== 0) return;
      const at = snapAt(e.clientX, e.clientY, view);
      if (!lineStart) { setLineStart(at.p); setMessage({ text: "Now click the end point" }); return; }
      if (Math.hypot(at.p.x - lineStart.x, at.p.y - lineStart.y) < 1e-6) return;
      const line: Entity = { id: `ln${Date.now().toString(36)}${++lineSeq.current}`, kind: "line", a: lineStart, b: at.p, role: "cut" };
      commit({ ...drawing, entities: [...drawing.entities, line] }, "Line");
      setSelected(null);
      setLineStart(at.p);                                    // go on from the end, like AutoCAD
      setMessage({ text: `Line ${fmtMm(Math.hypot(at.p.x - lineStart.x, at.p.y - lineStart.y))} added. Next point, or Esc to finish` });
      return;
    }
    if (pr && pr.button === 0 && tool === "sweep" && isClick) {
      const id = lineUnder(e.clientX, e.clientY);
      if (id && sweptIds.has(id)) {
        const next = new Set(keep);
        if (next.has(id)) next.delete(id); else next.add(id);
        setKeep(next);
        setMessage({ text: next.has(id) ? "Kept: this line stays" : "This line will be swept" });
      }
      return;
    }
    if (pr && pr.button === 0 && tool && MEASURING[tool] && view && isClick) {
      measureClick(e.clientX, e.clientY, view);
      return;
    }
    if (pr && pr.button === 0 && tool && EDITING[tool] && view && isClick) {
      const id = lineUnder(e.clientX, e.clientY);
      if (!id) return;
      const r = editAt(id, toModel(e.clientX, e.clientY, view), e.shiftKey);
      if (r.ok) {
        commit({ ...drawing, entities: r.entities, points: r.points ?? drawing.points }, IMPORT_TOOLS.find((t) => t.id === tool)?.label ?? "Edit");
        setSelected(null);
        setPreview(null);
        if (tool === "alignH" || tool === "alignV") setView(null);   // the part turned: fit it again
      }
      setMessage({ text: r.message, bad: !r.ok });
      return;
    }
    const b = box;
    setBox(null);
    if (tool === "hole" && b && view) {
      if (Math.hypot(b.x1 - b.x0, b.y1 - b.y0) > 4) { holeBox(b, view); return; }
      const id = lineUnder(e.clientX, e.clientY);
      if (id) holeAt(id);
      return;
    }
    const mark = tool ? MARKING[tool] : undefined;
    if (!b || !mark || !view) return;
    if (Math.hypot(b.x1 - b.x0, b.y1 - b.y0) > 4) { markBox(b, mark.role, view); return; }
    // a click: the line under the pointer
    const hit = document.elementsFromPoint(e.clientX, e.clientY).find((el) => el instanceof SVGElement && el.dataset.id);
    const id = (hit as SVGElement | undefined)?.dataset.id;
    if (id) markLine(id, mark.role);
  };

  // Hole: a closed cutting contour cut slowly. Marked contour by contour; again unmarks.
  const closedContours = useMemo(() => report.contours.filter((c) => c.closed), [report]);
  const toggleHoles = (contours: { entityIds: string[] }[]) => {
    const ids = new Set(contours.flatMap((c) => c.entityIds));
    const all = drawing.entities.filter((e) => ids.has(e.id)).every((e) => e.slow);
    const g = keepMarkRules(drawing.entities, drawing.entities.map((e) => (ids.has(e.id) ? { ...e, slow: all ? undefined : true } : e)));
    const why = g.outer ? "the outer contour can't be a hole, it is always plain cut" : "";
    if (!g.changed) { setMessage({ text: why ? `Not marked: ${why}` : "Nothing to change", bad: !!why }); return; }
    commit({ ...drawing, entities: g.entities }, all ? "Unmark hole" : "Mark hole");
    setSelected(null);
    // count contours that really changed (the outer one may have been held back)
    const changedIds = new Set(g.entities.filter((e, i) => e !== drawing.entities[i]).map((e) => e.id));
    const n = contours.filter((c) => c.entityIds.some((id) => changedIds.has(id))).length;
    const text = all ? `${n} ${n === 1 ? "hole" : "holes"} unmarked` : `${n} ${n === 1 ? "contour" : "contours"} → hole (cut slowly)`;
    setMessage({ text: why ? `${text}; ${why}` : text, bad: !!why });
  };
  const holeAt = (id: string) => {
    const e = drawing.entities.find((x) => x.id === id);
    if (!e) return;
    if (roleOf(e) !== "cut") { setMessage({ text: "Only cutting contours can be holes (this line is tracing or open cut)", bad: true }); return; }
    const c = closedContours.find((x) => x.entityIds.includes(id));
    if (!c) { setMessage({ text: "This contour is not closed: close it first (see Geometry check)", bad: true }); return; }
    toggleHoles([c]);
  };
  const holeBox = (b: { x0: number; y0: number; x1: number; y1: number }, v: View) => {
    const toMm = (x: number, y: number): Pt => ({ x: (x - v.tx) / v.s, y: -(y - v.ty) / v.s });
    const a = toMm(Math.min(b.x0, b.x1), Math.max(b.y0, b.y1)), c = toMm(Math.max(b.x0, b.x1), Math.min(b.y0, b.y1));
    const rect = { minX: a.x, minY: a.y, maxX: c.x, maxY: c.y };
    const crossing = b.x1 < b.x0;
    const byId = new Map(drawing.entities.map((e) => [e.id, e]));
    const hit = closedContours.filter((ct) => {
      const pts = ct.entityIds.flatMap((id) => pointsAlong(byId.get(id)!));
      return crossing ? touchesRect(pts, rect) : pts.every((p) => inRect(p, rect));
    });
    if (!hit.length) { setMessage({ text: crossing ? "No closed contour touches the box" : "No closed contour is fully inside the box" }); return; }
    toggleHoles(hit);
  };

  // Color lines: a pop-up with every color in the part and the operation its lines get
  const [colouring, setColouring] = useState(false);

  // Lines in a selection box get the role; when they all have it already, they go back to cutting.
  const markBox = (b: { x0: number; y0: number; x1: number; y1: number }, role: Role, v: View) => {
    const toMm = (x: number, y: number): Pt => ({ x: (x - v.tx) / v.s, y: -(y - v.ty) / v.s });
    const a = toMm(Math.min(b.x0, b.x1), Math.max(b.y0, b.y1)), c = toMm(Math.max(b.x0, b.x1), Math.min(b.y0, b.y1));
    const rect = { minX: a.x, minY: a.y, maxX: c.x, maxY: c.y };
    const crossing = b.x1 < b.x0;
    const ids = new Set(drawing.entities.filter((e) => {
      const pts = pointsAlong(e);
      return crossing ? touchesRect(pts, rect) : pts.every((p) => inRect(p, rect));
    }).map((e) => e.id));
    if (!ids.size) { setMessage({ text: crossing ? "No line touches the box" : "No line is fully inside the box" }); return; }
    const all = drawing.entities.filter((e) => ids.has(e.id)).every((e) => roleOf(e) === role);
    const next = all ? "cut" : role;
    const g = keepMarkRules(drawing.entities, drawing.entities.map((e) => (ids.has(e.id) ? { ...e, role: next } : e)));
    const why = markRulesText(g.outer, g.closed);
    if (!g.changed) { setMessage({ text: why ? `Not marked: ${why}` : `Already ${ROLE_LABEL[next].toLowerCase()}`, bad: !!why }); return; }
    commit({ ...drawing, entities: g.entities }, `${next === "cut" ? "Unmark" : "Mark"} ${role === "trace" ? "tracing" : "open cut"}`);
    setSelected(null);
    const text = `${g.changed} ${g.changed === 1 ? "line" : "lines"} → ${ROLE_LABEL[next].toLowerCase()}`;
    setMessage({ text: why ? `${text}; ${why}` : text, bad: !!why });
  };

  // Marks the clicked line; clicking a marked line again makes it a cutting line again.
  const markLine = (id: string, role: Role) => {
    const line = drawing.entities.find((e) => e.id === id);
    if (!line) return;
    const next = roleOf(line) === role ? "cut" : role;
    const g = keepMarkRules(drawing.entities, drawing.entities.map((e) => (e.id === id ? { ...e, role: next } : e)));
    if (!g.changed) { setMessage({ text: `Not marked: ${g.outer ? "the outer contour is always plain cut" : "a closed contour can't be open cut"}`, bad: true }); return; }
    commit({ ...drawing, entities: g.entities }, `${next === "cut" ? "Unmark" : "Mark"} ${role === "trace" ? "tracing" : "open cut"}`);
    setSelected(null);
    setMessage({ text: next === "cut" ? "1 line unmarked (cutting)" : `1 line → ${ROLE_LABEL[next].toLowerCase()}` });
  };

  // Sweep: lines on top of other lines (0.1 mm), lines outside the part outline and loose points,
  // highlighted together; click a line to keep it, Delete removes the rest in one step.
  const swept = useMemo(() => {
    const ids = (c: CheckId) => report.checks.find((x) => x.id === c)?.entityIds ?? [];
    return { doubles: ids("doubles"), outside: ids("separate"), points: (drawing.points ?? []).map((x) => x.id) };
  }, [report, drawing.points]);
  const sweptIds = useMemo(() => new Set([...swept.doubles, ...swept.outside]), [swept]);
  const [keep, setKeep] = useState<Set<string>>(new Set());
  const sweepCount = sweptIds.size - [...keep].filter((id) => sweptIds.has(id)).length + swept.points.length;
  const sweepNow = () => {
    const drop = new Set([...sweptIds].filter((id) => !keep.has(id)));
    const n = drop.size + swept.points.length;
    commit({ ...drawing, entities: drawing.entities.filter((e) => !drop.has(e.id)), points: [] }, "Sweep");
    setTool(null);
    setKeep(new Set());
    setSelected(null);
    setMessage({ text: `Swept: ${n} ${n === 1 ? "item" : "items"} removed` });
  };

  const onTool = (id: string) => {
    if (id === "sweep" && tool !== "sweep" && sweptIds.size + swept.points.length === 0) {
      setTool(null);
      setMessage({ text: "Nothing to sweep: no lines on top of other lines, no lines outside the part, no loose points" });
      return;
    }
    if (id === "properties") { setTool(null); setMessage(null); onProperties(); return; }
    if (id === "colourLines") { setTool(null); setMessage(null); setColouring(true); return; }
    // Check lines = the Geometry check panel: shows or hides it, with the result in the hint
    if (id === "checkLines") {
      setTool(null);
      const open = !checkOpen;
      setCheckOpen(open);
      setMessage(open ? { text: problems ? `${problems} ${problems === 1 ? "problem" : "problems"} to fix: see Geometry check` : "All contours are closed: ready to process", bad: !!problems } : null);
      return;
    }
    if (id === "process") {
      setTool(null);
      if (problems) setMessage({ text: "Fix the red problems before processing", bad: true });
      else { setMessage(null); onProcess(); }
      return;
    }
    setMessage(null);
    setPreview(null);
    setLineStart(null);
    setCursor(null);
    setFirstPick(null);
    setMeasures([]);
    setKeep(new Set());
    setTool((t) => (t === id ? null : id));
  };

  const check = report.checks.find((c) => c.id === selected) ?? null;
  const flagged = useMemo(() => new Set(report.checks.flatMap((c) => c.entityIds)), [report]);
  const highlighted = useMemo(() => new Set(check?.entityIds ?? []), [check]);

  const choose = (id: CheckId) => {
    const c = report.checks.find((x) => x.id === id)!;
    if (c.count === 0 || selected === id) { setSelected(null); fitAll(); return; }
    setSelected(id);
    // zoom to what the check found
    const b = drawing.entities.filter((e) => c.entityIds.includes(e.id)).map(boxOf).reduce(union);
    const pad = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.35 + 5;
    fit({ minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad });
  };

  const toScreen = (p: Pt, v: View) => ({ x: p.x * v.s + v.tx, y: -p.y * v.s + v.ty });
  // Open contours block processing; splines only warn (they will be converted).
  const problems = report.checks.filter((c) => c.count > 0 && c.id !== "splines").length;

  // Loose ends of open contours, sorted into "line past a corner", "gap" and "loose end", with fixes.
  const issues = useMemo(() => diagnoseEnds(drawing.entities,
    report.checks.filter((c) => c.id === "insideOpen" || c.id === "outsideOpen").flatMap((c) => c.points)), [drawing, report]);
  const [hoverIssue, setHoverIssue] = useState<number | null>(null);
  const [checkOpen, setCheckOpen] = useState(true);
  const fixIssue = (i: EndIssue) => {
    const r = i.fix?.(drawing.entities);
    if (!r) return;
    const label = i.kind === "overshoot" ? "Trim past corner" : i.kind === "gap" ? "Close gap" : i.kind === "stray" ? "Erase stray line"
      : i.kind === "looseLine" ? "Erase loose line" : "Fix loose end";
    if (r.ok) { commit({ ...drawing, entities: r.entities }, label); setSelected(null); }
    setMessage({ text: r.message, bad: !r.ok });
  };
  // Double / tiny lines and lines outside the outline: removed in one step (Undo brings them back)
  const removeCheck = (id: CheckId, ids: string[]) => {
    const drop = new Set(ids);
    commit({ ...drawing, entities: drawing.entities.filter((e) => !drop.has(e.id)) }, id === "doubles" ? "Remove double lines" : "Remove lines outside");
    setSelected(null);
    setMessage({ text: `${ids.length} ${ids.length === 1 ? "line" : "lines"} removed` });
  };
  const makeCut = (ids: string[]) => {
    const set = new Set(ids);
    commit({ ...drawing, entities: drawing.entities.map((e) => (set.has(e.id) ? { ...e, role: "cut" as Role, slow: undefined } : e)) }, "Make cut");
    setSelected(null);
    setMessage({ text: `${ids.length} ${ids.length === 1 ? "line" : "lines"} → cutting` });
  };
  const SMALL_MM = 1;
  const small = issues.filter((i) => i.fix && i.size <= SMALL_MM);
  // fixes one at a time, re-checking in between, so each fix sees the result of the one before
  const fixSmall = () => {
    let ents = drawing.entities;
    let n = 0;
    for (let round = 0; round < 50; round++) {
      const r = checkGeometry(ents);
      const next = diagnoseEnds(ents, r.checks.filter((c) => c.id === "insideOpen" || c.id === "outsideOpen").flatMap((c) => c.points))
        .find((i) => i.fix && i.size <= SMALL_MM);
      if (!next) break;
      const res = next.fix!(ents);
      if (!res.ok) break;
      ents = res.entities;
      n++;
    }
    if (n) { commit({ ...drawing, entities: ents }, "Fix all under 1 mm"); setSelected(null); }
    setMessage({ text: n ? `Fixed ${n} ${n === 1 ? "end" : "ends"} under ${SMALL_MM} mm` : "Nothing small to fix" });
  };
  const toolLabel = IMPORT_TOOLS.find((t) => t.id === tool)?.label;
  const hint = message?.text ?? (tool ? MARKING[tool]?.hint ?? EDITING[tool]?.hint ?? MEASURING[tool]?.hint ?? (tool === "line" ? LINE_HINT : tool === "sweep" ? SWEEP_HINT : tool === "hole" ? HOLE_HINT : "not built yet") : null);
  const bw = report.box.maxX - report.box.minX, bh = report.box.maxY - report.box.minY;

  // Grid follows the drawing: 10 mm dots, 100 mm when zoomed far out.
  const grid = view ? (view.s * 10 >= 8 ? view.s * 10 : view.s * 100) : 20;

  return (
    <div className="import">
      <ImportToolStrip active={tool} onTool={onTool} lit={{ checkLines: checkOpen }}
        blocked={problems ? { process: "fix the geometry problems first (Geometry check)" } : undefined} />
      <div
        ref={host}
        className={`canvas${tool && (MARKING[tool] || EDITING[tool] || MEASURING[tool] || tool === "line" || tool === "sweep" || tool === "hole") ? " is-marking" : ""}`}
        onPointerLeave={() => { setPreview(null); setCursor(null); }}
        style={view ? { backgroundSize: `${grid}px ${grid}px`, backgroundPosition: `${view.tx % grid}px ${view.ty % grid}px` } : undefined}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
        onDoubleClick={(e) => { if (!(e.target as Element).closest(".gcheck, .canvas-ui")) { setSelected(null); fitAll(); } }}
      >
        {view && (
          <svg className={`drawing${processed ? " is-processed" : ""}`} width={size.w} height={size.h} aria-label={`Drawing ${drawing.fileName}`}>
            <g transform={`matrix(${view.s} 0 0 ${-view.s} ${view.tx} ${view.ty})`}>
              {/* lines with a problem: a red glow underneath, so the line keeps its own color on top */}
              {drawing.entities.filter((e) => flagged.has(e.id)).map((e) => (
                <path key={`glow-${e.id}`} d={pathOf(e)} vectorEffect="non-scaling-stroke" className="ent-glow" />
              ))}
              {/* each line in its own DXF color, as in CAD; after processing, the role colors */}
              {drawing.entities.map((e) => (
                <path key={e.id} d={pathOf(e)} vectorEffect="non-scaling-stroke"
                  style={!processed && lineColour(e) ? { stroke: lineColour(e)! } : undefined}
                  className={`ent role-${roleOf(e)}${e.slow ? " is-slow" : ""}${flagged.has(e.id) ? " is-flagged" : ""}${highlighted.has(e.id) ? " is-hl" : ""}${e.kind === "spline" ? " is-spline" : ""}`} />
              ))}
              {/* wide invisible strokes so thin lines are easy to click */}
              {preview?.removed.map((e) => <path key={`rm-${e.id}`} d={pathOf(e)} vectorEffect="non-scaling-stroke" className="pv-remove" />)}
              {preview?.added.map((e) => <path key={`ad-${e.id}`} d={pathOf(e)} vectorEffect="non-scaling-stroke" className="pv-add" />)}
              {firstPick && firstPick.kind !== "point" && (() => {
                const e = drawing.entities.find((x) => x.id === firstPick.id);
                return e ? <path d={pathOf(e)} vectorEffect="non-scaling-stroke" className="meas-pick" /> : null;
              })()}
              {tool === "sweep" && drawing.entities.filter((e) => sweptIds.has(e.id)).map((e) => (
                <path key={`sw-${e.id}`} d={pathOf(e)} vectorEffect="non-scaling-stroke" className={keep.has(e.id) ? "sweep-keep" : "sweep-hl"} />
              ))}
              {tool && (MARKING[tool] || EDITING[tool] || MEASURING[tool] || tool === "sweep" || tool === "hole") && drawing.entities.map((e) => (
                <path key={`hit-${e.id}`} data-id={e.id} d={pathOf(e)} vectorEffect="non-scaling-stroke" className="ent-hit" />
              ))}
            </g>
            {issues.map((iss, i) => {
              // a gap is marked at both its ends, joined by a dashed line; everything else where it is
              const spots = (iss.ends ?? [iss.at]).map((p) => toScreen(p, view));
              const hover = hoverIssue === i;
              return (
                <g key={`iss-${i}`} className={`end-mark is-${iss.kind}${hover ? " is-hover" : ""}${tool ? " is-passive" : ""}`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => fixIssue(iss)}
                  onMouseEnter={() => setHoverIssue(i)} onMouseLeave={() => setHoverIssue(null)}>
                  <title>{`${iss.label}${iss.size ? ` · ${fmtMm(iss.size)}` : ""}${iss.fix ? " · click to fix" : ""}`}</title>
                  {spots.length === 2 && <line x1={spots[0].x} y1={spots[0].y} x2={spots[1].x} y2={spots[1].y} className="end-gap" />}
                  {spots.map((sp, k) => (
                    <g key={k}>
                      <circle cx={sp.x} cy={sp.y} r={hover ? 11 : 8} />
                      <text x={sp.x} y={sp.y + 4} textAnchor="middle">{ISSUE_ICON[iss.kind]}</text>
                    </g>
                  ))}
                </g>
              );
            })}
            {(drawing.points ?? []).map(({ id, p }) => {
              const q = toScreen(p, view), k = tool === "sweep" ? 6 : 4;
              return (
                <g key={id} className={`pt-mark${tool === "sweep" ? " is-swept" : ""}`} pointerEvents="none">
                  {tool === "sweep" && <circle cx={q.x} cy={q.y} r={9} />}
                  <path d={`M${q.x - k} ${q.y - k}L${q.x + k} ${q.y + k}M${q.x - k} ${q.y + k}L${q.x + k} ${q.y - k}`} />
                </g>
              );
            })}
            {tool === "line" && cursor && (() => {
              const c = toScreen(cursor.p, view);
              const s0 = lineStart && toScreen(lineStart, view);
              const len = lineStart ? Math.hypot(cursor.p.x - lineStart.x, cursor.p.y - lineStart.y) : 0;
              return (
                <g className="line-draw" pointerEvents="none">
                  {s0 && <line x1={s0.x} y1={s0.y} x2={c.x} y2={c.y} className="line-rubber" />}
                  {s0 && <circle cx={s0.x} cy={s0.y} r={3.5} className="line-start" />}
                  {cursor.snapped
                    ? <rect x={c.x - 7} y={c.y - 7} width={14} height={14} className="snap-mark" />
                    : <path d={`M${c.x - 8} ${c.y}H${c.x + 8}M${c.x} ${c.y - 8}V${c.y + 8}`} className="line-cross" />}
                  {s0 && len > 0 && <text x={c.x + 12} y={c.y - 10} className="line-len">{fmtMm(len)}</text>}
                </g>
              );
            })()}
            {tool && MEASURING[tool] && (
              <MeasureLayer measures={measures} toScreen={(p) => toScreen(p, view)}
                first={firstPick?.kind === "point" ? toScreen(firstPick.p, view) : firstPick?.kind === "round" ? toScreen(firstPick.c, view) : null}
                snap={tool === "dimension" && cursor?.snapped ? toScreen(cursor.p, view) : null} />
            )}
            {box && (
              <rect className={`sel-box${box.x1 < box.x0 ? " is-crossing" : ""}`}
                x={Math.min(box.x0, box.x1)} y={Math.min(box.y0, box.y1)}
                width={Math.abs(box.x1 - box.x0)} height={Math.abs(box.y1 - box.y0)} />
            )}
          </svg>
        )}

        <aside className={`gcheck${checkOpen ? "" : " is-closed"}`} aria-label="Geometry check">
          <header className="gc-head">
            <span className="gc-head-icon" aria-hidden="true">{IMPORT_TOOLS.find((t) => t.id === "checkLines")?.icon}</span>
            <h2>Geometry check</h2>
            <span className={`gc-pill ${problems ? "is-bad" : "is-ok"}`}>
              {problems ? `${problems} to fix` : processed ? "Processed" : "Ready"}
            </span>
            <button type="button" className="gc-toggle" onClick={() => setCheckOpen((o) => !o)}
              aria-expanded={checkOpen} title={checkOpen ? "Collapse" : "Expand"}>
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </header>
          {checkOpen && <div className="gc-body">
          <ul className="gc-checks">
            {report.checks.map((c) => (
              <li key={c.id}>
                <button className={`gc-row ${!c.count ? "is-ok" : c.id === "splines" ? "is-warn" : "is-bad"}${selected === c.id ? " is-on" : ""}`}
                  onClick={() => choose(c.id)} disabled={c.count === 0}
                  title={!c.count ? "No problems" : c.id === "splines" ? "Splines will be converted to lines and arcs. Show on the drawing" : "Show on the drawing"}>
                  <span className="gc-mark" aria-hidden="true">{c.count ? "!" : "✓"}</span>
                  <span className="gc-label">{c.label}</span>
                  {c.count > 0 && <span className="gc-count">{c.count}</span>}
                </button>
                {c.count > 0 && (c.id === "outerNotCut" || c.id === "closedOpenCut") && (
                  <button type="button" className="gc-fix" onClick={() => makeCut(c.entityIds)}
                    title={c.id === "outerNotCut" ? "The outer contour is always plain cutting: make these lines cut" : "A closed contour is never open cut: make these lines cut"}>
                    Make cut
                  </button>
                )}
                {c.count > 0 && (c.id === "doubles" || c.id === "separate") && (
                  <button type="button" className="gc-fix gc-remove" onClick={() => removeCheck(c.id, c.entityIds)}
                    title={c.id === "doubles" ? "Remove the double and tiny lines (one of each double stays)" : "Remove everything outside the part outline"}>
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
          {issues.length > 0 && (
            <div className="gc-ends">
              <h3 className="gc-sec">Loose ends</h3>
              <ul>
                {issues.map((iss, i) => (
                  <li key={i} className={`gc-end is-${iss.kind}${hoverIssue === i ? " is-hover" : ""}`}
                    onMouseEnter={() => setHoverIssue(i)} onMouseLeave={() => setHoverIssue(null)}>
                    <span className="gc-end-icon" aria-hidden="true">{ISSUE_ICON[iss.kind]}</span>
                    <span className="gc-end-label">{iss.label}{iss.size > 0 && <small> {fmtMm(iss.size)}</small>}</span>
                    {iss.fix
                      ? <button type="button" className="gc-fix" onClick={() => fixIssue(iss)}
                          title={iss.kind === "overshoot" ? "Trim the piece past the corner" : iss.kind === "stray" ? "Erase the line sticking out"
                            : iss.kind === "looseLine" ? "Erase this line (or mark it as tracing / open cut instead)" : "Close the gap"}>
                          {iss.kind === "overshoot" ? "Trim" : iss.kind === "stray" || iss.kind === "looseLine" ? "Erase" : "Close"}</button>
                      : <small className="gc-end-note">check by hand</small>}
                  </li>
                ))}
              </ul>
              {small.length > 0 && (
                <button type="button" className="btn gc-fix-all" onClick={fixSmall}>Fix all under {SMALL_MM} mm ({small.length})</button>
              )}
            </div>
          )}
          <p className={`gc-sum ${problems ? "is-bad" : "is-ok"}`}>
            {problems ? `Fix ${problems === 1 ? "this" : "these"} before processing.`
              : processed ? "Processed." : "All contours are closed: ready to process."}
          </p>
          <h3 className="gc-sec">Lines</h3>
          <ul className="legend" aria-label="Line colors">
            <li><i className="sw sw-cut" />Cutting</li>
            <li title="Engraved, not cut through"><i className="sw sw-trace" />Tracing</li>
            <li title="Cut with no lead-in or lead-out, from one end"><i className="sw sw-open" />Open cut</li>
            <li title="Cutting contour cut at slower speed (Hole tool)"><i className="sw sw-hole" />Hole</li>
            <li title="A line with a problem keeps its color and gets a red glow"><i className="sw sw-bad" />Problem</li>
          </ul>
          <h3 className="gc-sec">Part</h3>
          <dl className="gc-facts">
            <dt>Material</dt><dd>{properties?.material ? `${properties.material}${properties.thicknessMm ? ` ${properties.thicknessMm} mm` : ""}` : "–"}</dd>
            <dt>Size</dt><dd>{fmt(bw)} × {fmt(bh)} mm</dd>
          </dl>
          {nestRules && onNestRules && (
            <>
              <h3 className="gc-sec">Nesting rules</h3>
              <div className="proc-chips gc-chips" role="group" aria-label="Nesting rules">
                {ROTATIONS.map((r) => (
                  <label key={r} className="chk chk-box">
                    <input type="checkbox" checked={nestRules.rotations.includes(r)}
                      onChange={(e) => onNestRules({
                        ...nestRules,
                        rotations: e.target.checked ? ROTATIONS.filter((x) => x === r || nestRules.rotations.includes(x)) : nestRules.rotations.filter((x) => x !== r),
                      })} />
                    {r}°
                  </label>
                ))}
                <label className={`chk chk-box${mirrorBlocked ? " is-blocked" : ""}`}
                  title={mirrorBlocked ? "Parts with open cut lines are not mirrored (Rules → Import rules)" : undefined}>
                  <input type="checkbox" checked={nestRules.mirror && !mirrorBlocked} disabled={mirrorBlocked}
                    onChange={(e) => onNestRules({ ...nestRules, mirror: e.target.checked })} />
                  Mirror
                </label>
                <label className="chk chk-box chk-filler" title={FILLER_TIP}>
                  <input type="checkbox" checked={nestRules.filler} onChange={(e) => onNestRules({ ...nestRules, filler: e.target.checked })} />
                  Filler
                </label>
              </div>
              <p className="gc-note">{mirrorBlocked ? "No mirror: this part has open cut lines. " : ""}{fromDatabase ? "This part's own rules (opened from the database); Process saves them back with it." : "Same as Properties: applies to every part in the list."}</p>
            </>
          )}
          </div>}
        </aside>

        <div className="canvas-ui">
          {hint && (
            <span className={`tool-hint${message?.bad ? " is-bad" : ""}`}>
              {!message && toolLabel && <b>{toolLabel} · </b>}{hint}
            </span>
          )}
          {tool === "sweep" && (
            <span className="sweep-bar">
              <span>
                {[swept.doubles.length && `${swept.doubles.length} on top of other lines`,
                  swept.outside.length && `${swept.outside.length} outside the part`,
                  swept.points.length && `${swept.points.length} loose ${swept.points.length === 1 ? "point" : "points"}`,
                  keep.size && `${keep.size} kept`].filter(Boolean).join(" · ")}
              </span>
              <button type="button" className="btn btn-plain" onClick={() => onTool("sweep")}>Cancel</button>
              <button type="button" className="btn btn-replace" onClick={sweepNow} disabled={sweepCount === 0}>Delete {sweepCount}</button>
            </span>
          )}
          <button className="btn btn-fit" onClick={() => { setSelected(null); fitAll(); }} title="Show the whole part (double-click)">Fit</button>
        </div>
      </div>
      {colouring && (
        <ColourLinesDialog entities={drawing.entities} onCancel={() => setColouring(false)}
          onApply={(byColour) => {
            setColouring(false);
            if (!byColour.size) return;
            const g = keepMarkRules(drawing.entities, applyColours(drawing.entities, byColour));
            const why = markRulesText(g.outer, g.closed);
            if (!g.changed) { setMessage({ text: why ? `Nothing changed: ${why}` : "Nothing changed", bad: !!why }); return; }
            commit({ ...drawing, entities: g.entities }, "Color lines");
            setSelected(null);
            const text = `${byColour.size} ${byColour.size === 1 ? "color" : "colors"} applied`;
            setMessage({ text: why ? `${text}; ${why}` : text, bad: !!why });
          }} />
      )}
    </div>
  );
}

type Rect = { minX: number; minY: number; maxX: number; maxY: number };
const inRect = (p: Pt, r: Rect) => p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY;

/** Does a polyline touch the rectangle: a point inside, or a segment crossing one of its edges? */
function touchesRect(pts: Pt[], r: Rect): boolean {
  if (pts.some((p) => inRect(p, r))) return true;
  const edges: [Pt, Pt][] = [
    [{ x: r.minX, y: r.minY }, { x: r.maxX, y: r.minY }], [{ x: r.maxX, y: r.minY }, { x: r.maxX, y: r.maxY }],
    [{ x: r.maxX, y: r.maxY }, { x: r.minX, y: r.maxY }], [{ x: r.minX, y: r.maxY }, { x: r.minX, y: r.minY }],
  ];
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const meet = (p1: Pt, p2: Pt, q1: Pt, q2: Pt) =>
    cross(p1, p2, q1) * cross(p1, p2, q2) <= 0 && cross(q1, q2, p1) * cross(q1, q2, p2) <= 0;
  return pts.slice(1).some((p, i) => edges.some(([a, b]) => meet(pts[i], p, a, b)));
}

const ROLE_LABEL: Record<Role, string> = { cut: "Cutting", trace: "Tracing", openCut: "Open cut" };

const fmtMm = (n: number) => `${n < 10 ? n.toFixed(2) : n.toFixed(1)} mm`;

const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString("en-GB");

/** Measured value as text: up to 2 decimals. */
const num = (v: number) => (Math.round(v * 100) / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 });
const measureLabel = (m: Measure) =>
  m.kind === "distance" ? `${num(m.value)} mm` : m.kind === "radius" ? `R ${num(m.r)}` : m.kind === "diameter" ? `Ø ${num(m.d)}` : `${num(m.deg)}°`;
const measureText = (m: Measure) =>
  m.kind === "distance" ? `Dimension ${num(m.value)} mm (${m.note})` : m.kind === "radius" ? `Radius ${num(m.r)} mm`
    : m.kind === "diameter" ? `Diameter ${num(m.d)} mm` : `Angle ${num(m.deg)}°`;

/** Dimensions drawn over the part, in screen pixels (y down). */
function MeasureLayer({ measures, toScreen, first, snap }: {
  measures: Measure[]; toScreen: (p: Pt) => { x: number; y: number };
  first: { x: number; y: number } | null; snap: { x: number; y: number } | null;
}) {
  // text along a line, never upside down, a little above it; moved along the line when another label is there
  const used: { x: number; y: number }[] = [];
  const along = (a: { x: number; y: number }, b: { x: number; y: number }, text: string, key: string) => {
    let deg = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
    if (deg > 90) deg -= 180; if (deg < -90) deg += 180;
    const at = (t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    const free = [0.5, 0.3, 0.7, 0.2, 0.8].map(at).find((q) => used.every((u) => Math.hypot(u.x - q.x, u.y - q.y) > 46)) ?? at(0.5);
    used.push(free);
    const mx = free.x, my = free.y;
    return <text key={key} className="meas-text" transform={`translate(${mx} ${my}) rotate(${deg}) translate(0 -7)`} textAnchor="middle">{text}</text>;
  };
  const dashed = (ext: [Pt, Pt][], key: string) => ext.map(([p, q], i) => {
    const a = toScreen(p), b = toScreen(q);
    return <line key={`${key}-x${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="meas-ext" />;
  });
  return (
    <g className="meas" pointerEvents="none">
      <defs>
        <marker id="meas-arrow" viewBox="0 0 10 10" refX="9.5" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
          <path d="M0 1.5 10 5 0 8.5z" className="meas-head" />
        </marker>
      </defs>
      {measures.map((m, i) => {
        const k = `m${i}`;
        if (m.kind === "distance" || m.kind === "diameter") {
          const a = toScreen(m.kind === "distance" ? m.from : m.a), b = toScreen(m.kind === "distance" ? m.to : m.b);
          return (
            <g key={k}>
              {m.kind === "distance" && dashed(m.ext, k)}
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="meas-line" markerStart="url(#meas-arrow)" markerEnd="url(#meas-arrow)" />
              {along(a, b, measureLabel(m), `${k}t`)}
            </g>
          );
        }
        if (m.kind === "radius") {
          const c = toScreen(m.c), b = toScreen(m.to);
          return (
            <g key={k}>
              <path d={`M${c.x - 5} ${c.y}H${c.x + 5}M${c.x} ${c.y - 5}V${c.y + 5}`} className="meas-ext" />
              <line x1={c.x} y1={c.y} x2={b.x} y2={b.y} className="meas-line" markerEnd="url(#meas-arrow)" />
              {along(c, b, measureLabel(m), `${k}t`)}
            </g>
          );
        }
        // angle: arc at the crossing between the two arms (screen y is down, so flip y)
        const at = toScreen(m.at), R = 42;
        const p1 = { x: at.x + m.u1.x * R, y: at.y - m.u1.y * R }, p2 = { x: at.x + m.u2.x * R, y: at.y - m.u2.y * R };
        const sweep = m.u1.x * m.u2.y - m.u1.y * m.u2.x > 0 ? 0 : 1;   // counter-clockwise in the drawing = 0 on screen
        const bis = { x: m.u1.x + m.u2.x, y: m.u1.y + m.u2.y };
        const bl = Math.hypot(bis.x, bis.y) || 1;
        const tx = at.x + (bis.x / bl) * (R + 16), ty = at.y - (bis.y / bl) * (R + 16) + 4;
        return (
          <g key={k}>
            {dashed(m.ext, k)}
            <line x1={at.x} y1={at.y} x2={at.x + m.u1.x * (R + 8)} y2={at.y - m.u1.y * (R + 8)} className="meas-ext" />
            <line x1={at.x} y1={at.y} x2={at.x + m.u2.x * (R + 8)} y2={at.y - m.u2.y * (R + 8)} className="meas-ext" />
            <path d={`M${p1.x} ${p1.y}A${R} ${R} 0 0 ${sweep} ${p2.x} ${p2.y}`} className="meas-line" fill="none"
              markerStart="url(#meas-arrow)" markerEnd="url(#meas-arrow)" />
            <text x={tx} y={ty} className="meas-text" textAnchor="middle">{measureLabel(m)}</text>
          </g>
        );
      })}
      {first && <circle cx={first.x} cy={first.y} r={4.5} className="meas-first" />}
      {snap && <rect x={snap.x - 7} y={snap.y - 7} width={14} height={14} className="snap-mark" />}
    </g>
  );
}

const ISSUE_ICON: Record<EndIssue["kind"], string> = { overshoot: "✂", gap: "↔", stray: "✕", looseLine: "✕", loose: "?" };
