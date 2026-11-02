// Manual nest tools on the selected parts: Mirror V / H, Stack V / H / grid and Arrange (a small,
// quick nest of the selected parts into the free space of the sheet).
import { api } from "../api/api";
import type { Origin } from "./machine";
import type { PlacedPart } from "./nest";
import {
  clearOf, partLoops, placed, slideDistance, transform, unionBox,
  type Box, type Dir, type Placed, type Pt,
} from "./manualGeom";

/** A part's nesting rules (part settings): rotation steps and whether it may be mirrored. */
export interface PartRules { rotations: number[]; mirror: boolean }
const rulesCache = new Map<string, Promise<PartRules>>();
export function partRules(id: string): Promise<PartRules> {
  let r = rulesCache.get(id);
  if (!r) {
    r = api.part(id).then((d) => ({ rotations: d.rotations ?? [], mirror: !!d.mirror })).catch(() => ({ rotations: [90], mirror: false }));
    rulesCache.set(id, r);
  }
  return r;
}

const norm = (a: number) => ((Math.round(a * 1e6) / 1e6 % 360) + 360) % 360;

/**
 * Mirror V: flipped left-right about the middle of the selection's box; Mirror H: top-bottom. The
 * box stays where it is.
 */
export function mirrorGroup(list: PlacedPart[], ids: number[], box: Box, axis: "v" | "h"): PlacedPart[] {
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  const next = list.slice();
  for (const i of ids) {
    const p = list[i];
    // a flip across x = cx: angle -> -angle; across y = cy: angle -> 180 - angle; and mirrored
    next[i] = axis === "v"
      ? { ...p, x: 2 * cx - p.x, angle: norm(-p.angle), mirror: !p.mirror }
      : { ...p, y: 2 * cy - p.y, angle: norm(180 - p.angle), mirror: !p.mirror };
  }
  return next;
}

/** Directions away from the machine's 0,0 (the way stacks grow), in the sheet frame (y down). */
const away = (origin: Origin) => ({ sx: origin.endsWith("right") ? -1 : 1, sy: origin.startsWith("bottom") ? -1 : 1 });

const BIG: Box = { x0: -1e9, y0: -1e9, x1: 1e9, y1: 1e9 };

/** The shortest step between copies of a group along x or y that keeps the gap (copies nest along their outlines). */
function pitch(group: Placed[], refs: PlacedPart[], pathOf: (id: string) => string | undefined, gap: number, axis: "x" | "y", sign: number): number {
  const g = unionBox(group.map((q) => q.box));
  const ext = axis === "x" ? g.x1 - g.x0 : g.y1 - g.y0;
  const far = ext + gap + 4;
  const copy = shifted(refs, pathOf, axis === "x" ? sign * far : 0, axis === "y" ? sign * far : 0);
  const back: Dir = axis === "x" ? (sign > 0 ? "left" : "right") : (sign > 0 ? "up" : "down");
  const t = slideDistance(copy, group, BIG, gap, back);
  return Math.max(far - t, 1);
}

function shifted(refs: PlacedPart[], pathOf: (id: string) => string | undefined, dx: number, dy: number): Placed[] {
  return refs.flatMap((p) => { const path = pathOf(p.partId); return path ? [placed(path, { ...p, x: p.x + dx, y: p.y + dy })] : []; });
}

/**
 * Stack: copies of the selection, one next to the other away from the machine's 0,0 (V: along Y,
 * H: along X, grid: rows and columns), each as close as the gap allows, until the next copy would
 * reach the edge of the sheet or another part. Returns the new list and how many copies were added.
 */
export function stack(list: PlacedPart[], ids: number[], kind: "v" | "h" | "grid", pathOf: (id: string) => string | undefined,
  usable: Box, gap: number, origin: Origin, outline?: Pt[][]): { list: PlacedPart[]; added: number } {
  const refs = ids.map((i) => list[i]);
  const group = shifted(refs, pathOf, 0, 0);
  if (!group.length) return { list, added: 0 };
  const { sx, sy } = away(origin);
  const px = kind !== "v" ? pitch(group, refs, pathOf, gap, "x", sx) : 0;
  const py = kind !== "h" ? pitch(group, refs, pathOf, gap, "y", sy) : 0;
  const all: Placed[] = list.flatMap((p) => { const path = pathOf(p.partId); return path ? [placed(path, p)] : []; });
  const out = list.slice();
  let added = 0;
  const tryAt = (i: number, j: number) => {
    const dx = i * px * sx, dy = j * py * sy;
    const copy = shifted(refs, pathOf, dx, dy);
    if (!clearOf(copy, all, usable, gap, outline)) return false;
    for (const p of refs) out.push({ ...p, x: p.x + dx, y: p.y + dy });
    all.push(...copy);
    added++;
    return true;
  };
  const LIMIT = 2000;
  if (kind === "v") for (let j = 1; j < LIMIT && tryAt(0, j); j++);
  else if (kind === "h") for (let i = 1; i < LIMIT && tryAt(i, 0); i++);
  else {
    for (let j = 0; j < LIMIT; j++) {
      let row = 0;
      for (let i = j === 0 ? 1 : 0; i < LIMIT && tryAt(i, j); i++) row++;
      if (j > 0 && row === 0) break;
    }
  }
  return { list: out, added };
}

// ---------------------------------------------------------------------------------------------
// Arrange: the selected parts nested again into the free space of the sheet (the other parts stay),
// as compactly as possible, in about a second and a half.
//
// The sheet is a grid of cells (about 1-2 mm). Cells are taken by the other parts grown by the gap,
// by the trims and the sheet's outline. Each selected part, in each allowed rotation (and mirrored
// when it may be), is a mask of every cell its material touches; a part goes where its mask meets
// no taken cell, so the gap is always kept (a little more, up to two cells). Parts are placed one by
// one, the biggest first, each where it ends nearest the machine's 0,0 (along one axis, then the
// other); a band limits how far the group may spread along the second axis. Several orders, bands
// and both axes are tried while there is time; the layout whose box has the smallest area wins.
// Last, each part is slid towards 0,0 on its exact outline to take up the cells' slack.
// ---------------------------------------------------------------------------------------------

interface Mask {
  na: number; nb: number;          // cells along a, b
  runs: Int32Array[];              // per row (a): pairs b0, b1 of the taken cells
  dil: Uint8Array;                 // the mask grown by k cells: (na + 2k) x (nb + 2k)
  offA: number; offB: number;      // the outline's lowest a, b [mm] at translation 0
  extA: number; extB: number;      // its size [mm]
  angle: number; mirror: boolean;
  area: number;
}

/** Cells (rows along a, each nb cells) touched by the material of the loops (even-odd), OR'ed into out. */
function raster(loops: Pt[][], c: number, na: number, nb: number, out: Uint8Array) {
  if (!loops.length) return;
  let a0 = Infinity, a1 = -Infinity;
  for (const lp of loops) for (const p of lp) { a0 = Math.min(a0, p[0]); a1 = Math.max(a1, p[0]); }
  const r0 = Math.max(0, Math.floor(a0 / c) - 1), r1 = Math.min(na - 1, Math.ceil(a1 / c) + 1);
  const xs: number[] = [];
  for (let r = r0; r <= r1; r++) {
    const a = (r + 0.5) * c;
    xs.length = 0;
    for (const lp of loops) for (let i = 0; i < lp.length; i++) {
      const p = lp[i], q = lp[(i + 1) % lp.length];
      if ((p[0] <= a) !== (q[0] <= a)) xs.push(p[1] + ((a - p[0]) * (q[1] - p[1])) / (q[0] - p[0]));
    }
    xs.sort((x, y) => x - y);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const b0 = Math.max(0, Math.ceil(xs[k] / c - 0.5)), b1 = Math.min(nb - 1, Math.floor(xs[k + 1] / c - 0.5));
      for (let b = b0; b <= b1; b++) out[r * nb + b] = 1;
    }
  }
  // and every cell an edge passes through (thin parts, edges between cell centres)
  const st = c / 3;
  for (const lp of loops) for (let i = 0; i < lp.length; i++) {
    const p = lp[i], q = lp[(i + 1) % lp.length];
    const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / st));
    for (let j = 0; j <= n; j++) {
      const ia = Math.floor((p[0] + ((q[0] - p[0]) * j) / n) / c), ib = Math.floor((p[1] + ((q[1] - p[1]) * j) / n) / c);
      if (ia >= 0 && ia < na && ib >= 0 && ib < nb) out[ia * nb + ib] = 1;
    }
  }
}

/**
 * Growth by the gap: every cell that comes nearer than `gap` to a taken cell (cell to cell, the
 * closest points of the two). Round, so a part along a slanted edge keeps the gap and no more.
 */
function grow(m: Uint8Array, na: number, nb: number, gap: number, c: number): Uint8Array {
  if (gap <= 0) return m.slice();
  const K = Math.ceil(gap / c) + 1;
  // per row offset: how far along the row (cells of the growth)
  const half: number[] = [];
  for (let d = -K; d <= K; d++) {
    const ey = Math.max(0, Math.abs(d) - 1) * c;
    let w = -1;
    for (let x = 0; x <= K; x++) { const ex = Math.max(0, x - 1) * c; if (ex * ex + ey * ey < gap * gap - 1e-9) w = x; }
    half.push(w);
  }
  const out = new Uint8Array(na * nb);
  for (let r = 0; r < na; r++) {
    // the taken runs of this row
    const runs: number[] = [];
    for (let q = 0; q < nb; q++) if (m[r * nb + q]) { let e = q; while (e + 1 < nb && m[r * nb + e + 1]) e++; runs.push(q, e); q = e; }
    if (!runs.length) continue;
    for (let d = -K; d <= K; d++) {
      const w = half[d + K], rr = r + d;
      if (w < 0 || rr < 0 || rr >= na) continue;
      const base = rr * nb;
      for (let j = 0; j < runs.length; j += 2) {
        const s0 = Math.max(0, runs[j] - w), e0 = Math.min(nb - 1, runs[j + 1] + w);
        out.fill(1, base + s0, base + e0 + 1);
      }
    }
  }
  return out;
}

/** Per cell: the last taken cell at or before it in its row (-1: none). */
function lastTaken(occ: Uint8Array, na: number, nb: number, out: Int32Array) {
  for (let r = 0; r < na; r++) { let l = -1; for (let b = 0; b < nb; b++) { if (occ[r * nb + b]) l = b; out[r * nb + b] = l; } }
}

export interface ArrangeInput {
  list: PlacedPart[]; ids: number[];
  pathOf: (id: string) => string | undefined;
  rules: Map<string, PartRules>;
  lengthMm: number; widthMm: number; usable: Box; outline?: Pt[][]; edgeGap: number; gap: number; origin: Origin;
  budgetMs?: number;
}

export function arrange(inp: ArrangeInput): PlacedPart[] | null {
  const { list, ids, pathOf, rules, lengthMm: L, widthMm: W, usable, outline, edgeGap, gap, origin } = inp;
  const t0 = performance.now(), budget = inp.budgetMs ?? 1500;
  const right = origin.endsWith("right"), bottom = origin.startsWith("bottom");
  // u, v: from the machine's 0,0 inwards
  const toUV = ([x, y]: Pt): Pt => [right ? L - x : x, bottom ? W - y : y];
  const c = Math.max(0.5, Math.sqrt((L * W) / 1.2e6));
  const k = Math.ceil(gap / c) + 1;   // how far the growth reaches [cells]
  const sel = new Set(ids);
  const others = list.filter((_, i) => !sel.has(i));
  const parts = ids.map((i) => list[i]).filter((p) => pathOf(p.partId));
  if (!parts.length) return null;

  // the allowed poses of each part: its rotations (and mirrored when allowed), and the pose it has now
  const poses = (p: PlacedPart): { angle: number; mirror: boolean }[] => {
    const r = rules.get(p.partId) ?? { rotations: [90], mirror: false };
    const angles = new Set<number>([0, norm(p.angle)]);
    for (const s of r.rotations) if (s > 0) for (let a = 0; a < 360 - 1e-6; a += s) angles.add(norm(a));
    const out: { angle: number; mirror: boolean }[] = [];
    for (const m of r.mirror ? [false, true] : [false]) for (const a of angles) out.push({ angle: a, mirror: m });
    if (p.mirror && !r.mirror) for (const a of angles) out.push({ angle: a, mirror: true });
    return out;
  };

  type Axis = "u" | "v";
  const ab = (axis: Axis, p: Pt): Pt => (axis === "u" ? p : [p[1], p[0]]);
  const bases = new Map<Axis, { na: number; nb: number; occ: Uint8Array; last: Int32Array }>();
  const base = (axis: Axis) => {
    let b = bases.get(axis);
    if (b) return b;
    const [la, lb] = ab(axis, [L, W]);
    const na = Math.ceil(la / c), nb = Math.ceil(lb / c);
    const occ = new Uint8Array(na * nb);
    // outside the usable area (a cell must lie wholly inside)
    const [u0, v0] = toUV([right ? usable.x1 : usable.x0, bottom ? usable.y1 : usable.y0]);
    const [u1, v1] = toUV([right ? usable.x0 : usable.x1, bottom ? usable.y0 : usable.y1]);
    const [a0, b0] = ab(axis, [u0, v0]), [a1, b1] = ab(axis, [u1, v1]);
    for (let r = 0; r < na; r++) for (let q = 0; q < nb; q++)
      if (r * c < a0 - 1e-9 || (r + 1) * c > a1 + 1e-9 || q * c < b0 - 1e-9 || (q + 1) * c > b1 + 1e-9) occ[r * nb + q] = 1;
    if (outline?.length) {
      const m = new Uint8Array(na * nb);
      const lps = outline.map((lp) => lp.map((p) => ab(axis, toUV(p))));
      raster(lps, c, na, nb, m);                 // the material and its edges; free: in it, off the edges
      const edges = new Uint8Array(na * nb);
      for (const lp of lps) for (let i = 0; i < lp.length; i++) {
        const p = lp[i], q = lp[(i + 1) % lp.length];
        const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / (c / 3)));
        for (let j = 0; j <= n; j++) {
          const ia = Math.floor((p[0] + ((q[0] - p[0]) * j) / n) / c), ib = Math.floor((p[1] + ((q[1] - p[1]) * j) / n) / c);
          if (ia >= 0 && ia < na && ib >= 0 && ib < nb) edges[ia * nb + ib] = 1;
        }
      }
      const off = new Uint8Array(na * nb);
      for (let i = 0; i < off.length; i++) off[i] = !m[i] || edges[i] ? 1 : 0;
      const g = grow(off, na, nb, edgeGap, c);
      for (let i = 0; i < occ.length; i++) occ[i] |= g[i];
    }
    if (others.length) {
      const m = new Uint8Array(na * nb);
      for (const p of others) {
        const path = pathOf(p.partId);
        if (!path) continue;
        const f = transform(p);
        raster(partLoops(path).map((lp) => lp.map((q) => ab(axis, toUV(f(q))))), c, na, nb, m);
      }
      const g = grow(m, na, nb, gap, c);
      for (let i = 0; i < occ.length; i++) occ[i] |= g[i];
    }
    const last = new Int32Array(na * nb);
    lastTaken(occ, na, nb, last);
    b = { na, nb, occ, last };
    bases.set(axis, b);
    return b;
  };

  const masks = new Map<string, Mask>();
  const maskOf = (axis: Axis, id: string, angle: number, mirror: boolean): Mask => {
    const key = `${axis}|${id}|${angle}|${mirror}`;
    let m = masks.get(key);
    if (m) return m;
    const f = transform({ x: 0, y: 0, angle, mirror });
    const loops = partLoops(pathOf(id)!).map((lp) => lp.map((q) => ab(axis, toUV(f(q)))));
    let a0 = Infinity, b0 = Infinity, a1 = -Infinity, b1 = -Infinity;
    for (const [a, b] of loops[0] ?? []) { a0 = Math.min(a0, a); b0 = Math.min(b0, b); a1 = Math.max(a1, a); b1 = Math.max(b1, b); }
    const sh = loops.map((lp) => lp.map(([a, b]): Pt => [a - a0, b - b0]));
    const na = Math.floor((a1 - a0) / c) + 1, nb = Math.floor((b1 - b0) / c) + 1;
    const cells = new Uint8Array(na * nb);
    raster(sh, c, na, nb, cells);
    const runs: Int32Array[] = [];
    let area = 0;
    for (let r = 0; r < na; r++) {
      const rr: number[] = [];
      for (let q = 0; q < nb; q++) if (cells[r * nb + q]) {
        let e = q;
        while (e + 1 < nb && cells[r * nb + e + 1]) e++;
        rr.push(q, e);
        area += e - q + 1;
        q = e;
      }
      runs.push(Int32Array.from(rr));
    }
    const DA = na + 2 * k, DB = nb + 2 * k;
    const pad = new Uint8Array(DA * DB);
    for (let r = 0; r < na; r++) for (let q = 0; q < nb; q++) pad[(r + k) * DB + q + k] = cells[r * nb + q];
    m = { na, nb, runs, dil: grow(pad, DA, DB, gap, c), offA: a0, offB: b0, extA: a1 - a0, extB: b1 - b0, angle, mirror, area };
    masks.set(key, m);
    return m;
  };

  /** The lowest a (then b) where the mask meets no taken cell and stays within the band [0, bLim). */
  const find = (m: Mask, occN: { na: number; nb: number; last: Int32Array }, bLim: number): [number, number] | null => {
    const { na, nb, last } = occN;
    const lim = Math.min(bLim, nb);
    for (let ia = 0; ia + m.na <= na; ia++) {
      let ib = 0;
      while (ib + m.nb <= lim) {
        let jump = -1;
        for (let r = 0; r < m.na && jump < 0; r++) {
          const rr = m.runs[r], row = (ia + r) * nb + ib;
          for (let j = 0; j < rr.length; j += 2) {
            const t = last[row + rr[j + 1]];
            if (t >= ib + rr[j]) { jump = t - rr[j] + 1; break; }
          }
        }
        if (jump < 0) return [ia, ib];
        ib = jump;
      }
    }
    return null;
  };

  const put = (m: Mask, ia: number, ib: number, st: { na: number; nb: number; occ: Uint8Array; last: Int32Array }) => {
    const { na, nb, occ, last } = st;
    const DA = m.na + 2 * k, DB = m.nb + 2 * k;
    const ra = ia - k, rb = ib - k;
    for (let r = 0; r < DA; r++) {
      const row = ra + r;
      if (row < 0 || row >= na) continue;
      let lo = nb, hi = -1;
      for (let q = 0; q < DB; q++) if (m.dil[r * DB + q]) {
        const col = rb + q;
        if (col < 0 || col >= nb) continue;
        occ[row * nb + col] = 1;
        lo = Math.min(lo, col); hi = Math.max(hi, col);
      }
      if (hi < 0) continue;
      let l = lo > 0 ? last[row * nb + lo - 1] : -1;
      for (let col = lo; col < nb; col++) {
        if (occ[row * nb + col]) l = col;
        if (col > hi && last[row * nb + col] === l) break;
        last[row * nb + col] = l;
      }
    }
  };

  // what is tried: both axes, a few orders and bands
  const sizes = parts.map((p) => {
    const path = pathOf(p.partId)!;
    const lp = partLoops(path)[0] ?? [];
    const xs = lp.map((q) => q[0]), ys = lp.map((q) => q[1]);
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    return { w, h, area: (w + gap) * (h + gap) };
  });
  const total = sizes.reduce((s, z) => s + z.area, 0);
  const longest = Math.max(...sizes.map((z) => Math.max(z.w, z.h))) + 2 * c;
  const idx = parts.map((_, i) => i);
  const orders: number[][] = [
    idx.slice().sort((a, b) => sizes[b].area - sizes[a].area),
    idx.slice().sort((a, b) => Math.max(sizes[b].w, sizes[b].h) - Math.max(sizes[a].w, sizes[a].h)),
    idx.slice().sort((a, b) => Math.min(sizes[b].w, sizes[b].h) - Math.min(sizes[a].w, sizes[a].h)),
  ];
  const side = Math.sqrt(total);
  const bands = [Infinity, side * 0.75, side, side * 1.3, side * 1.8, side * 2.6, longest].filter((b) => b >= longest || b === longest);
  type Try = { axis: Axis; order: number[]; band: number; rule: "near" | "box" };
  const tries: Try[] = [];
  for (const rule of ["box", "near"] as const) for (const order of orders) for (const band of bands) for (const axis of ["u", "v"] as Axis[]) tries.push({ axis, order, band, rule });

  let best: { score: number; far: number; axis: Axis; at: { m: Mask; ia: number; ib: number }[] } | null = null;
  const run = (t: Try) => {
    const b = base(t.axis);
    const st = { na: b.na, nb: b.nb, occ: b.occ.slice(), last: b.last.slice() };
    const bLim = isFinite(t.band) ? Math.ceil(t.band / c) : b.nb;
    const at: { m: Mask; ia: number; ib: number }[] = new Array(parts.length);
    let A0 = Infinity, A1 = -Infinity, B0 = Infinity, B1 = -Infinity;
    for (const i of t.order) {
      const p = parts[i];
      let pick: { m: Mask; ia: number; ib: number; key: number; key2: number } | null = null;
      for (const ps of poses(p)) {
        const m = maskOf(t.axis, p.partId, ps.angle, ps.mirror);
        const f = find(m, st, bLim);
        if (!f) continue;
        // near: the pose that ends nearest 0,0 along a (then b); box: the one that grows the group's box least
        let key = f[0] + m.na, key2 = f[1] + m.nb;
        if (t.rule === "box" && isFinite(A0)) {
          const a0 = Math.min(A0, f[0] * c), a1 = Math.max(A1, f[0] * c + m.extA), b0 = Math.min(B0, f[1] * c), b1 = Math.max(B1, f[1] * c + m.extB);
          key2 = key;
          key = Math.round((a1 - a0) * (b1 - b0));
        }
        if (!pick || key < pick.key || (key === pick.key && key2 < pick.key2)) pick = { m, ia: f[0], ib: f[1], key, key2 };
      }
      if (!pick) return;                       // does not fit within this band
      put(pick.m, pick.ia, pick.ib, st);
      at[i] = pick;
      A0 = Math.min(A0, pick.ia * c); A1 = Math.max(A1, pick.ia * c + pick.m.extA);
      B0 = Math.min(B0, pick.ib * c); B1 = Math.max(B1, pick.ib * c + pick.m.extB);
    }
    const score = Math.round((A1 - A0) * (B1 - B0) / 100), far = t.axis === "u" ? A1 : B1;
    if (!best || score < best.score || (score === best.score && far < best.far)) best = { score, far, axis: t.axis, at };
  };
  for (const t of tries) { run(t); if (performance.now() - t0 > budget) break; }
  // with time left: shuffled orders
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  while (best && performance.now() - t0 < budget) {
    const order = orders[0].slice();
    for (let s = 0; s < Math.max(1, order.length / 3); s++) {
      const a = Math.floor(rnd() * order.length), b2 = Math.min(order.length - 1, a + 1 + Math.floor(rnd() * 3));
      [order[a], order[b2]] = [order[b2], order[a]];
    }
    run({ axis: rnd() < 0.5 ? "u" : "v", order, band: bands[Math.floor(rnd() * bands.length)], rule: rnd() < 0.5 ? "box" : "near" });
  }
  const win = best as { axis: Axis; at: { m: Mask; ia: number; ib: number }[] } | null;
  if (!win) return null;

  // back to the sheet: the outline's lowest a, b goes to the cell
  const out = list.slice();
  const placedIdx: number[] = [];
  ids.forEach((li, j) => {
    const a = win.at[j];
    if (!a) return;
    const da = a.ia * c - a.m.offA, db = a.ib * c - a.m.offB;
    const [du, dv] = win.axis === "u" ? [da, db] : [db, da];
    out[li] = { ...list[li], angle: a.m.angle, mirror: a.m.mirror, x: right ? -du : du, y: bottom ? -dv : dv };
    placedIdx.push(li);
  });

  // the cells' slack: each part slid towards 0,0 on its outline (across the band first, then along)
  const geoOf = (i: number) => { const path = pathOf(out[i].partId); return path ? placed(path, out[i]) : null; };
  const geos = out.map((_, i) => geoOf(i));
  const toA: Dir = right ? "right" : "left", toB: Dir = bottom ? "down" : "up";
  const dirs: Dir[] = win.axis === "u" ? [toB, toA] : [toA, toB];
  const order = placedIdx.slice().sort((p, q) => {
    const gp = geos[p]!.box, gq = geos[q]!.box;
    return (right ? -gp.x1 : gp.x0) + (bottom ? -gp.y1 : gp.y0) - ((right ? -gq.x1 : gq.x0) + (bottom ? -gq.y1 : gq.y0));
  });
  for (let round = 0; round < 2; round++) for (const i of order) for (const d of dirs) {
    const me = geos[i];
    if (!me) continue;
    const rest = geos.filter((g, j): g is Placed => j !== i && !!g);
    const t = slideDistance([me], rest, usable, gap, d, outline, edgeGap);
    if (t < 0.3) continue;
    const [dx, dy] = d === "up" ? [0, -t] : d === "down" ? [0, t] : d === "left" ? [-t, 0] : [t, 0];
    out[i] = { ...out[i], x: out[i].x + dx, y: out[i].y + dy };
    geos[i] = geoOf(i);
  }
  return out;
}
