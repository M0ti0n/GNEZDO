// FITTINGS -> Flange and Threaded flange (from the HVAC Fittings workbench): a flat ring, A inside,
// E wide (outside D = A + 2E), N holes on the B circle, the first one at the top.
//   Flange: arc slots M wide, their end holes 25 mm apart.
//   Threaded flange: only the ring is cut; every hole gets an X mark (45° to the radius) to drill and
//   tap after cutting (the tap drill is shown).
// Divided (A over 100, N 3 or more): three 120° sections, the first cut midway between the top hole and
// the next one. N divisible by 3: one section x3; otherwise Section A x2 (mirror images) and B x1.

import { Lines, seg, type P2, type Seg } from "./arcs";

const SLOT_LENGTH = 25, MIN_WEB = 1, MIN_DIVIDE_A = 100, START = 90;

// A, B, E (both tables), then slot width M, N, T (flange) and thread, N, T (threaded flange)
const ROWS: [number, number, number, number, number, number, string, number, number][] = [
  [80, 111, 25, 9, 4, 5, "M6", 4, 8], [100, 131, 25, 9, 4, 5, "M6", 4, 8], [120, 151, 25, 9, 6, 5, "M6", 6, 8],
  [140, 170, 25, 9, 6, 5, "M6", 6, 8], [150, 180, 25, 9, 6, 5, "M6", 6, 8], [160, 190, 25, 9, 6, 5, "M6", 6, 8],
  [170, 200, 25, 9, 6, 5, "M6", 6, 8], [180, 210, 25, 9, 6, 5, "M6", 6, 8], [200, 230, 25, 9, 6, 5, "M6", 6, 8],
  [210, 240, 30, 9, 6, 5, "M6", 6, 8], [220, 255, 30, 9, 6, 5, "M6", 6, 8], [240, 275, 30, 9, 6, 5, "M6", 6, 8],
  [250, 285, 30, 9, 6, 5, "M6", 6, 8], [260, 295, 30, 9, 6, 5, "M6", 6, 8], [270, 305, 30, 9, 6, 5, "M6", 6, 8],
  [280, 315, 30, 9, 6, 5, "M6", 6, 8], [300, 335, 30, 9, 6, 5, "M6", 6, 8], [320, 355, 30, 9, 8, 5, "M6", 8, 8],
  [330, 365, 30, 9, 8, 5, "M6", 8, 8], [340, 375, 30, 9, 8, 5, "M6", 8, 8], [360, 395, 30, 9, 8, 5, "M6", 8, 8],
  [370, 405, 30, 9, 8, 5, "M6", 8, 8], [380, 415, 30, 9, 8, 5, "M6", 8, 8], [400, 435, 30, 11, 10, 8, "M8", 10, 10],
  [420, 455, 30, 11, 10, 8, "M8", 10, 10], [440, 475, 30, 11, 10, 8, "M8", 10, 10], [450, 485, 30, 11, 10, 8, "M8", 10, 10],
  [470, 505, 30, 11, 10, 8, "M8", 10, 10], [480, 515, 30, 11, 10, 8, "M8", 10, 10], [500, 535, 30, 11, 10, 8, "M8", 10, 10],
  [520, 555, 30, 11, 10, 8, "M8", 10, 10], [530, 565, 30, 11, 12, 8, "M8", 12, 10], [540, 575, 30, 11, 12, 8, "M8", 12, 10],
  [550, 585, 30, 11, 12, 8, "M8", 12, 10], [570, 605, 30, 11, 12, 8, "M8", 12, 10], [600, 635, 30, 11, 12, 8, "M8", 12, 10],
  [620, 655, 30, 11, 12, 8, "M8", 12, 10], [650, 685, 30, 11, 15, 8, "M8", 12, 10], [670, 705, 30, 11, 15, 8, "M8", 12, 10],
  [720, 755, 30, 11, 15, 8, "M8", 12, 10], [750, 795, 40, 11, 16, 8, "M10", 16, 15], [780, 825, 40, 11, 16, 8, "M10", 16, 15],
  [800, 845, 40, 11, 16, 8, "M10", 16, 15], [820, 865, 40, 11, 16, 8, "M10", 16, 15],
];

/** The standard sizes (A). */
export const FLANGE_SIZES = ROWS.map((r) => r[0]);

/** ISO metric coarse threads: nominal diameter and tap drill. */
export const THREADS: Record<string, [number, number]> = {
  M3: [3, 2.5], M4: [4, 3.3], M5: [5, 4.2], M6: [6, 5], M8: [8, 6.8], M10: [10, 8.5], M12: [12, 10.2], M16: [16, 14],
};

export interface FlangeValues { a: number; b: number; m: number; n: number; e: number; t: number; whole: boolean; divided: boolean }
export interface ThreadFlangeValues { a: number; b: number; m: string; n: number; e: number; t: number; mark: number; whole: boolean; divided: boolean }

/** The row for size A, or the nearest smaller size as template (same M, N, E, T and B - A). */
function rowFor(a: number) {
  const exact = ROWS.find((r) => Math.abs(r[0] - a) < 1e-9);
  const r = exact ?? [...ROWS].reverse().find((q) => q[0] < a) ?? ROWS[0];
  return { r, b: exact ? r[1] : a + (r[1] - r[0]), exact: !!exact };
}

export function flangeFor(a: number, keep?: Pick<FlangeValues, "whole" | "divided">): FlangeValues {
  const { r, b } = rowFor(a);
  return { a, b, e: r[2], m: r[3], n: r[4], t: r[5], whole: keep?.whole ?? true, divided: keep?.divided ?? false };
}

export function threadFlangeFor(a: number, keep?: Pick<ThreadFlangeValues, "whole" | "divided" | "mark">): ThreadFlangeValues {
  const { r, b } = rowFor(a);
  return { a, b, e: r[2], m: r[6], n: r[7], t: r[8], mark: keep?.mark ?? 10, whole: keep?.whole ?? true, divided: keep?.divided ?? false };
}

export const FLANGE_DEFAULTS = flangeFor(400);
export const THREAD_FLANGE_DEFAULTS = threadFlangeFor(400);

export const isStandard = (v: { a: number; b: number; e: number }) => { const q = rowFor(v.a); return q.exact && Math.abs(q.b - v.b) < 1e-9 && Math.abs(q.r[2] - v.e) < 1e-9; };
export const canDivide = (a: number, n: number) => a > MIN_DIVIDE_A + 1e-9 && n >= 3;

export function threadSize(m: string): { d: number; drill: number } | null {
  const k = m.trim().toUpperCase();
  if (THREADS[k]) return { d: THREADS[k][0], drill: THREADS[k][1] };
  const d = Number(k.replace(/^M/, "").replace(",", "."));
  return d > 0 ? { d, drill: Math.round(d * 0.84 * 10) / 10 } : null;
}

const slotHalf = (b: number) => Math.asin(Math.min(1, SLOT_LENGTH / 2 / (b / 2)));

function common(v: { a: number; e: number; n: number; whole: boolean; divided: boolean }) {
  const e: string[] = [];
  if (!(v.a > 0)) e.push("A must be greater than 0");
  if (!(v.e > 0)) e.push("E must be greater than 0");
  if (!(v.n >= 1) || !Number.isInteger(v.n)) e.push("N: a whole number, 1 or more");
  if (!v.whole && !v.divided) e.push("Pick at least one: Whole, Divided");
  if (v.divided && v.a > 0 && v.n >= 1 && !canDivide(v.a, v.n)) e.push("Only flanges over A 100 with 3 holes or more are divided");
  return e;
}

export function flangeProblems(v: FlangeValues): string[] {
  const e = common(v);
  if (!(v.m > 0)) e.push("M must be greater than 0");
  if (!(v.b > SLOT_LENGTH)) e.push(`B is too small for a ${SLOT_LENGTH} mm slot`);
  if (e.length) return e;
  const rb = v.b / 2, w = v.m / 2;
  if (rb - w < v.a / 2 + MIN_WEB) e.push("The slots cut into the inner edge: B - M must be larger than A");
  if (rb + w > v.a / 2 + v.e - MIN_WEB) e.push("The slots cut into the outer edge: B + M must be smaller than D = A + 2E");
  const half = slotHalf(v.b) + Math.asin(Math.min(1, w / (rb - w)));
  if (v.n > 1 && 2 * half + MIN_WEB / rb >= (2 * Math.PI) / v.n) e.push(`${v.n} slots do not fit on the B circle: use fewer`);
  if (v.divided && clearance(v.n, v.b, (SLOT_LENGTH / 2) + w) < 0) e.push("A cut runs through a slot: change N");
  return e;
}

export function threadFlangeProblems(v: ThreadFlangeValues): string[] {
  const e = common(v);
  if (!(v.mark > 0)) e.push("The X mark size must be greater than 0");
  const ts = threadSize(v.m);
  if (!ts) e.push(`Unknown thread ${v.m}: use M6, M8, M10, ...`);
  if (e.length || !ts) return e;
  const rb = v.b / 2, r = ts.d / 2;
  if (rb - r < v.a / 2 + MIN_WEB) e.push(`The ${v.m} holes cut into the inner edge: B - ${ts.d} must be larger than A`);
  if (rb + r > v.a / 2 + v.e - MIN_WEB) e.push(`The ${v.m} holes cut into the outer edge: B + ${ts.d} must be smaller than D = A + 2E`);
  if (v.n > 1 && 2 * rb * Math.sin(Math.PI / v.n) < ts.d + MIN_WEB) e.push(`${v.n} ${v.m} holes do not fit on the B circle: use fewer`);
  if (v.divided && clearance(v.n, v.b, v.mark / 2) < 0) e.push("A cut runs through an X mark: change N");
  return e;
}

// ---- the three sections

const firstCut = (n: number) => START + 180 / n;
const holesBetween = (n: number, a0: number, a1: number) => {
  const out: number[] = [];
  for (let k = 0; k < n; k++) { const rel = ((((START + (360 / n) * k - a0) % 360) + 360) % 360); if (rel > 1e-9 && rel < a1 - a0 - 1e-9) out.push(k); }
  return out;
};
function plan(n: number) {
  const c0 = firstCut(n);
  if (n % 3 === 0) return [{ key: "S", label: "section", qty: 3, a0: c0, a1: c0 + 120, holes: holesBetween(n, c0, c0 + 120) }];
  return [
    { key: "SA", label: "section A", qty: 2, a0: c0, a1: c0 + 120, holes: holesBetween(n, c0, c0 + 120) },
    { key: "SB", label: "section B", qty: 1, a0: c0 + 120, a1: c0 + 240, holes: holesBetween(n, c0 + 120, c0 + 240) },
  ];
}
/** The smallest distance along the B circle from a cut to a slot / mark (negative: it cuts through). */
function clearance(n: number, b: number, halfExtent: number) {
  const c0 = firstCut(n);
  let worst = Infinity;
  for (const c of [c0, c0 + 120, c0 + 240]) for (let k = 0; k < n; k++) {
    const d = Math.abs(((((c - (START + (360 / n) * k) + 180) % 360) + 360) % 360) - 180);
    worst = Math.min(worst, ((d * Math.PI) / 180) * (b / 2) - halfExtent);
  }
  return worst;
}

const P = (r: number, deg: number): P2 => [r * Math.cos((deg * Math.PI) / 180), r * Math.sin((deg * Math.PI) / 180)];
const arcRun = (r: number, a0: number, a1: number): Seg[] => {
  const k = Math.max(1, Math.ceil(Math.abs(a1 - a0) / 90));
  return Array.from({ length: k }, (_, i) => seg(P(r, a0 + ((a1 - a0) * i) / k), P(r, a0 + ((a1 - a0) * (i + 1)) / k), P(r, a0 + ((a1 - a0) * (i + 0.5)) / k)));
};
const sector = (rIn: number, rOut: number, a0: number, a1: number): Seg[] =>
  [...arcRun(rOut, a0, a1), seg(P(rOut, a1), P(rIn, a1)), ...arcRun(rIn, a1, a0), seg(P(rIn, a0), P(rOut, a0))];

/** An arc slot centered on the B circle at `deg`, its end holes SLOT_LENGTH apart. */
function slot(b: number, m: number, deg: number): Seg[] {
  const rb = b / 2, w = m / 2, h = (slotHalf(b) * 180) / Math.PI, a0 = deg - h, a1 = deg + h;
  const cap = (aEnd: number, out: number): Seg => {
    const [ex, ey] = P(rb, aEnd), r = (aEnd * Math.PI) / 180, rx = Math.cos(r), ry = Math.sin(r), tx = -ry * out, ty = rx * out;
    return seg([ex + rx * w, ey + ry * w], [ex - rx * w, ey - ry * w], [ex + tx * w, ey + ty * w]);
  };
  const c0 = cap(a0, -1);
  return [seg(P(rb + w, a0), P(rb + w, a1), P(rb + w, deg)), cap(a1, 1), seg(P(rb - w, a1), P(rb - w, a0), P(rb - w, deg)), seg(c0.b, c0.a, c0.m)];
}

/** The X mark of a threaded hole at `deg`. */
function xMark(b: number, size: number, deg: number): [P2, P2][] {
  const [hx, hy] = P(b / 2, deg), arm = size / 2, phi = (deg * Math.PI) / 180;
  return [Math.PI / 4, -Math.PI / 4].map((d) => { const ux = Math.cos(phi + d), uy = Math.sin(phi + d); return [[hx - ux * arm, hy - uy * arm], [hx + ux * arm, hy + uy * arm]] as [P2, P2]; });
}

interface Piece { key: string; label: string; qty: number; lines: Lines }

function ring(v: { a: number; e: number; n: number; whole: boolean; divided: boolean }, hole: (L: Lines, deg: number, rot: (p: P2) => P2) => void): Piece[] {
  const rIn = v.a / 2, rOut = v.a / 2 + v.e, out: Piece[] = [];
  const hDeg = (k: number) => START + (360 / v.n) * k;
  if (v.whole) {
    const L = new Lines().circle([0, 0], rOut).circle([0, 0], rIn);
    for (let k = 0; k < v.n; k++) hole(L, hDeg(k), (p) => p);
    out.push({ key: "W", label: "whole", qty: 1, lines: L });
  }
  if (v.divided && canDivide(v.a, v.n)) for (const s of plan(v.n)) {
    // turned so its middle points up
    const rot = ((90 - (s.a0 + s.a1) / 2) * Math.PI) / 180, co = Math.cos(rot), sn = Math.sin(rot);
    const tr = ([x, y]: P2): P2 => [x * co - y * sn, x * sn + y * co];
    const L = new Lines().segs(sector(rIn, rOut, s.a0, s.a1).map((q) => seg(tr(q.a), tr(q.b), q.m && tr(q.m))));
    for (const k of s.holes) hole(L, hDeg(k), tr);
    out.push({ key: s.key, label: s.label, qty: s.qty, lines: L });
  }
  return out;
}

export function flangePieces(v: FlangeValues): Piece[] {
  return ring(v, (L, deg, tr) => L.segs(slot(v.b, v.m, deg).map((q) => seg(tr(q.a), tr(q.b), q.m && tr(q.m)))));
}

export function threadFlangePieces(v: ThreadFlangeValues): Piece[] {
  return ring(v, (L, deg, tr) => L.marks(xMark(v.b, v.mark, deg).map(([a, b]) => [tr(a), tr(b)] as [P2, P2])));
}
