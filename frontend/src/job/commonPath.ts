// Common cut in the cut path (Process -> Auto cut): parts nested a kerf apart along their marked
// common cut lines (job/commonCut.ts) make a block. A block is cut as: every member's tracing, open
// cuts and holes, then each shared line once along the middle of the kerf gap (no kerf compensation,
// pierced outside the block where the line reaches its edge), then one outline around the whole
// block. Scrap the members close in (a ring of parts) is cut before the shared lines, as a hole.

import { sharedLines, type CommonEdge } from "./commonCut";
import type { CommonLead } from "./leads";
import { pointIn, type Box, type Pt } from "./manualGeom";

export interface CommonBlock {
  /** the parts' indexes (sheet.parts) */
  members: number[];
  /** the shared lines, sheet frame, merged where they continue each other */
  lines: [Pt, Pt][];
  /** the block's outline(s), sheet frame, in the members' outline sense */
  outer: Pt[][];
  /** scrap the members close in (holes of the block), the other sense */
  inner: Pt[][];
}

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const mul = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k];
const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1];
const len = (a: Pt) => Math.hypot(a[0], a[1]);
const area2 = (lp: Pt[]) => lp.reduce((s, p, i) => { const q = lp[(i + 1) % lp.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0);

function distSeg(p: Pt, a: Pt, b: Pt): number {
  const d = sub(b, a), L2 = dot(d, d);
  const t = L2 ? Math.max(0, Math.min(1, dot(sub(p, a), d) / L2)) : 0;
  return len(sub(p, add(a, mul(d, t))));
}
const distLine = (p: Pt, a: Pt, b: Pt) => { const d = sub(b, a), L = len(d) || 1; return Math.abs((p[0] - a[0]) * d[1] - (p[1] - a[1]) * d[0]) / L; };

/** Shared lines that continue each other (a row or grid of parts) become one line. */
function mergeLines(lines: [Pt, Pt][], kerf: number): [Pt, Pt][] {
  const out = lines.map((l) => [l[0], l[1]] as [Pt, Pt]);
  let again = true;
  while (again) {
    again = false;
    for (let i = 0; i < out.length && !again; i++) for (let j = i + 1; j < out.length && !again; j++) {
      const [a, b] = out[i], [c, d] = out[j];
      const u = sub(b, a), L = len(u);
      if (L < 1e-6) continue;
      const e: Pt = [u[0] / L, u[1] / L];
      const v = sub(d, c), Lv = len(v) || 1;
      if (Math.abs(e[0] * v[1] - e[1] * v[0]) / Lv > 1e-3) continue;        // not parallel
      if (distLine(c, a, b) > 0.2 || distLine(d, a, b) > 0.2) continue;       // not on one line
      const ts = [0, L, dot(sub(c, a), e), dot(sub(d, a), e)];
      const lo1 = 0, hi1 = L, lo2 = Math.min(ts[2], ts[3]), hi2 = Math.max(ts[2], ts[3]);
      if (lo2 > hi1 + kerf + 0.5 || lo1 > hi2 + kerf + 0.5) continue;        // apart
      const lo = Math.min(...ts), hi = Math.max(...ts);
      out[i] = [add(a, mul(e, lo)), add(a, mul(e, hi))];
      out.splice(j, 1);
      again = true;
    }
  }
  return out;
}

/** A member's outline without what lies on the shared lines: the pieces left, in outline order. */
function piecesOf(loop: Pt[], lines: [Pt, Pt][], half: number): Pt[][] | null {
  const tol = half + 0.3;
  // split the outline where a shared line starts or ends along an edge lying on it
  const pts: Pt[] = [];
  const n = loop.length;
  for (let k = 0; k < n; k++) {
    const a = loop[k], b = loop[(k + 1) % n];
    pts.push(a);
    const d = sub(b, a), L = len(d);
    if (L < 1e-6) continue;
    const ts: number[] = [];
    for (const [p, q] of lines) {
      if (distLine(a, p, q) > tol || distLine(b, p, q) > tol) continue;
      for (const e of [p, q]) { const t = dot(sub(e, a), d) / (L * L); if (t > 1e-4 && t < 1 - 1e-4) ts.push(t); }
    }
    ts.sort((x, y) => x - y).forEach((t) => pts.push(add(a, mul(d, t))));
  }
  const m = pts.length;
  const shared = pts.map((a, k) => {
    const b = pts[(k + 1) % m];
    const mid = mul(add(a, b), 0.5);
    return lines.some(([p, q]) => distLine(a, p, q) <= tol && distLine(b, p, q) <= tol && distSeg(mid, p, q) <= tol);
  });
  if (!shared.some((s) => s)) return null;
  // start after a shared edge: every piece runs between two shared edges
  const s0 = shared.findIndex((s, k) => s && !shared[(k + 1) % m]);
  if (s0 < 0) return [];   // the whole outline is shared
  const out: Pt[][] = [];
  let cur: Pt[] | null = null;
  for (let c = 1; c <= m; c++) {
    const k = (s0 + c) % m;
    if (shared[k]) { if (cur) { cur.push(pts[k]); out.push(cur); cur = null; } continue; }
    if (!cur) cur = [pts[k]];
    else cur.push(pts[k]);
  }
  if (cur) { cur.push(pts[(s0 + 1) % m]); out.push(cur); }
  return out;
}

/** The pieces joined across the kerf gaps into closed loops (null: they do not close). */
function joinPieces(pieces: Pt[][], kerf: number): Pt[][] | null {
  const left = pieces.filter((p) => p.length > 1).slice();
  const loops: Pt[][] = [];
  const reach = kerf + 0.8;
  while (left.length) {
    let loop = left.shift()!.slice();
    for (let guard = 0; guard < 10000; guard++) {
      const end = loop[loop.length - 1];
      if (len(sub(end, loop[0])) <= reach && loop.length > 2) break;   // closed
      let k = -1, best = Infinity;
      left.forEach((p, j) => { const d = len(sub(p[0], end)); if (d < best) { best = d; k = j; } });
      if (k < 0 || best > reach) return null;
      loop = loop.concat(left.splice(k, 1)[0]);
    }
    if (len(sub(loop[loop.length - 1], loop[0])) < 1e-6) loop.pop();
    loops.push(loop);
  }
  return loops;
}

/**
 * The blocks of the sheet: parts (outline, sheet frame, all in one sense) whose common cut lines lie
 * a kerf apart. Parts in no block are left out; a block whose outline does not close is left out too
 * (its parts are then cut one by one).
 */
export function commonBlocks(parts: { i: number; outer: Pt[]; box: Box; edges: CommonEdge[] }[], kerf: number): CommonBlock[] {
  const withEdges = parts.filter((p) => p.edges.length && p.outer.length > 2);
  const parent = new Map<number, number>(withEdges.map((p) => [p.i, p.i]));
  const find = (x: number): number => { let r = x; while (parent.get(r) !== r) r = parent.get(r)!; return r; };
  const pairLines = new Map<string, [Pt, Pt][]>();
  for (let a = 0; a < withEdges.length; a++) for (let b = a + 1; b < withEdges.length; b++) {
    const A = withEdges[a], B = withEdges[b];
    const s = sharedLines([{ edges: A.edges, box: A.box }, { edges: B.edges, box: B.box }], kerf);
    if (!s.lines.length) continue;
    pairLines.set(`${A.i}|${B.i}`, s.lines);
    parent.set(find(A.i), find(B.i));
  }
  const groups = new Map<number, number[]>();
  for (const p of withEdges) { const r = find(p.i); groups.set(r, [...(groups.get(r) ?? []), p.i]); }
  const by = new Map(withEdges.map((p) => [p.i, p]));
  const out: CommonBlock[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const set = new Set(members);
    const raw: [Pt, Pt][] = [];
    for (const [k, ls] of pairLines) { const [x, y] = k.split("|").map(Number); if (set.has(x) && set.has(y)) raw.push(...ls); }
    const pieces: Pt[][] = [];
    let ok = true;
    for (const i of members) {
      const pc = piecesOf(by.get(i)!.outer, raw, kerf / 2);
      if (!pc) { ok = false; break; }
      pieces.push(...pc);
    }
    const loops = ok ? joinPieces(pieces, kerf) : null;
    if (!loops || !loops.length) continue;
    const sense = Math.sign(area2(by.get(members[0])!.outer));
    out.push({
      members,
      lines: mergeLines(raw, kerf),
      outer: loops.filter((lp) => Math.sign(area2(lp)) === sense),
      inner: loops.filter((lp) => Math.sign(area2(lp)) !== sense),
    });
  }
  return out;
}

/**
 * A shared line as it is cut: from the end that reaches the block's edge, out past the other end when
 * that one reaches the edge too. Leads (`type`): in line or at an angle (`angIn` / `angOut` degrees
 * from the line), pierced outside the block `ext` mm away; "none": pierced on the line's end.
 * `inside(p)`: p is in a member (not scrap). The end nearer `near` first when both reach the edge.
 */
export function sharedLineCut(l: [Pt, Pt], inside: (p: Pt) => boolean, near: Pt, ext: number, extOut: number, kerf: number,
  type: CommonLead = "inline", angIn = 45, angOut = 45): { pts: Pt[]; leadIn: Pt[]; leadOut: Pt[] } {
  const [a, b] = l;
  const d = sub(b, a), L = len(d) || 1, e: Pt = [d[0] / L, d[1] / L];
  const beyond = kerf / 2 + 0.6;
  const openA = !inside(add(a, mul(e, -beyond))), openB = !inside(add(b, mul(e, beyond)));
  let s = a, t = b, u = e, so = openA, to = openB;
  if ((openB && !openA) || (openA === openB && len(sub(b, near)) < len(sub(a, near)))) { s = b; t = a; u = mul(e, -1); so = openB; to = openA; }
  if (type === "none") return { pts: [s, t], leadIn: [], leadOut: [] };
  // at an angle: to the side where the pierce is not in a part (left of the line when both are free)
  const n: Pt = [-u[1], u[0]];
  const ai = (Math.min(85, Math.max(5, angIn)) * Math.PI) / 180, ao = (Math.min(85, Math.max(5, angOut)) * Math.PI) / 180;
  const dirIn = (side: number): Pt => type === "angled" ? add(mul(u, -Math.cos(ai)), mul(n, side * Math.sin(ai))) : mul(u, -1);
  const dirOut = (side: number): Pt => type === "angled" ? add(mul(u, Math.cos(ao)), mul(n, side * Math.sin(ao))) : u;
  const sideIn = !inside(add(s, mul(dirIn(1), ext))) ? 1 : -1, sideOut = !inside(add(t, mul(dirOut(1), extOut))) ? 1 : -1;
  return {
    pts: [s, t],
    leadIn: so && ext > 0 ? [add(s, mul(dirIn(sideIn), ext)), s] : [],
    leadOut: to && extOut > 0 ? [t, add(t, mul(dirOut(sideOut), extOut))] : [],
  };
}

export { pointIn };
