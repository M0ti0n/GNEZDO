// STEP (ISO 10303-21) reader for sheet-metal parts: the solid's faces as GNEZDO's unfolder needs them.
// Only what bent sheet-metal parts are made of: flat faces (PLANE) and bends (CYLINDRICAL_SURFACE);
// other surfaces (B-splines, cones, ...) are kept as "other" (side faces, reliefs: not unfolded).
// Edges: LINE, CIRCLE, ELLIPSE, B-spline curves (sampled), SURFACE_CURVE / SEAM_CURVE (their 3D curve).

export type V3 = [number, number, number];

export const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add3 = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul3 = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len3 = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const unit3 = (a: V3): V3 => { const l = len3(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// ------------------------------------------------------------------ the file

type Val = string | number | null | Ref | Enum | Val[] | Typed;
interface Ref { ref: number }
interface Enum { enum: string }
interface Typed { type: string; args: Val[] }
interface Entity { type: string; args: Val[]; parts?: Typed[] }

const isRef = (v: Val): v is Ref => !!v && typeof v === "object" && "ref" in v;

/** The DATA section's entities by number. */
export function parseStep(text: string): Map<number, Entity> {
  const at = text.indexOf("DATA;");
  if (at < 0 || !/ISO-10303-21/.test(text.slice(0, 200))) throw new Error("This is not a STEP file");
  const s = text;
  let i = at + 5;
  const n = s.length;
  const ws = () => { while (i < n) { const c = s[i]; if (c === " " || c === "\n" || c === "\r" || c === "\t") i++; else if (c === "/" && s[i + 1] === "*") { const e = s.indexOf("*/", i + 2); i = e < 0 ? n : e + 2; } else break; } };
  const word = () => { const b = i; while (i < n && /[A-Za-z0-9_]/.test(s[i])) i++; return s.slice(b, i); };
  const value = (): Val => {
    ws();
    const c = s[i];
    if (c === "'") {
      let out = ""; i++;
      while (i < n) { if (s[i] === "'") { if (s[i + 1] === "'") { out += "'"; i += 2; continue; } i++; break; } out += s[i++]; }
      return out;
    }
    if (c === "#") { i++; const b = i; while (/[0-9]/.test(s[i])) i++; return { ref: Number(s.slice(b, i)) }; }
    if (c === "$" || c === "*") { i++; return null; }
    if (c === ".") { i++; const b = i; while (i < n && s[i] !== ".") i++; const e = s.slice(b, i); i++; return { enum: e }; }
    if (c === "(") { i++; return list(); }
    if (/[-+0-9.]/.test(c)) { const b = i; while (i < n && /[-+0-9.Ee]/.test(s[i])) i++; return Number(s.slice(b, i)); }
    if (/[A-Za-z]/.test(c)) { const t = word(); ws(); if (s[i] === "(") { i++; return { type: t, args: list() }; } return t; }
    throw new Error(`STEP: unexpected "${c}"`);
  };
  const list = (): Val[] => {
    const out: Val[] = [];
    ws();
    if (s[i] === ")") { i++; return out; }
    for (;;) {
      out.push(value());
      ws();
      if (s[i] === ",") { i++; continue; }
      if (s[i] === ")") { i++; return out; }
      throw new Error("STEP: a list is not closed");
    }
  };
  const ents = new Map<number, Entity>();
  for (;;) {
    ws();
    if (i >= n || s.startsWith("ENDSEC", i)) break;
    if (s[i] !== "#") { i++; continue; }
    i++;
    const b = i; while (/[0-9]/.test(s[i])) i++;
    const id = Number(s.slice(b, i));
    ws(); if (s[i] === "=") i++; ws();
    if (s[i] === "(") {
      // a complex entity: ( A(...) B(...) ... )
      i++;
      const parts: Typed[] = [];
      for (;;) { ws(); if (s[i] === ")") { i++; break; } const t = word(); ws(); i++; parts.push({ type: t, args: list() }); }
      ents.set(id, { type: "COMPLEX", args: [], parts });
    } else {
      const t = word(); ws(); i++;
      ents.set(id, { type: t, args: list() });
    }
    ws(); if (s[i] === ";") i++;
  }
  return ents;
}

// ------------------------------------------------------------------ the solid

export type Surf =
  | { kind: "plane"; o: V3; n: V3; x: V3 }
  | { kind: "cyl"; a: V3; d: V3; x: V3; r: number }
  | { kind: "other"; type: string };

export interface Edge {
  /** the EDGE_CURVE's number: two faces share it */
  id: number;
  /** points along it, in the loop's direction */
  pts: V3[];
  /** a circle arc (for a clean flat pattern: arcs stay arcs) */
  arc?: { c: V3; z: V3; r: number };
  line?: boolean;
}

export interface Face {
  id: number;
  surf: Surf;
  /** its normal points out of the material (the face's sense applied) */
  sense: boolean;
  loops: { outer: boolean; edges: Edge[] }[];
}

export interface Solid { faces: Face[]; unitMm: number; name: string; problems: string[] }

const SEG = 0.4;   // max mm between sampled points along a curve

export function readSolid(text: string): Solid {
  const E = parseStep(text);
  const get = (r: Val | undefined): Entity => {
    if (!r || !isRef(r)) throw new Error("STEP: a reference is missing");
    const e = E.get(r.ref);
    if (!e) throw new Error(`STEP: #${r.ref} is not in the file`);
    return e;
  };
  const part = (e: Entity, t: string) => (e.type === t ? e : e.parts?.find((p) => p.type === t));
  // units: millimetres unless the file says inches (or metres)
  let unitMm = 1;
  for (const e of E.values()) {
    const lu = e.parts?.find((p) => p.type === "LENGTH_UNIT");
    if (!lu) continue;
    const si = e.parts!.find((p) => p.type === "SI_UNIT");
    const conv = e.parts!.find((p) => p.type === "CONVERSION_BASED_UNIT");
    if (si) { const pre = si.args[0] as Enum | null; unitMm = pre?.enum === "MILLI" ? 1 : pre?.enum === "CENTI" ? 10 : !pre ? 1000 : 1; }
    else if (conv && /INCH/i.test(String(conv.args[0]))) unitMm = 25.4;
    break;
  }
  const P = (r: Val): V3 => { const e = get(r); const c = e.args[1] as number[]; return [c[0] * unitMm, c[1] * unitMm, (c[2] ?? 0) * unitMm]; };
  const D = (r: Val): V3 => { const e = get(r); const c = e.args[1] as number[]; return unit3([c[0], c[1], c[2] ?? 0]); };
  const axis2 = (r: Val) => {
    const e = get(r);
    const o = P(e.args[1]);
    const z = e.args[2] ? D(e.args[2]) : [0, 0, 1] as V3;
    let x = e.args[3] ? D(e.args[3]) : (Math.abs(z[0]) < 0.9 ? [1, 0, 0] as V3 : [0, 1, 0] as V3);
    x = unit3(sub3(x, mul3(z, dot3(x, z))));
    return { o, z, x, y: cross3(z, x) };
  };

  // a curve between two points, in its own direction or against it
  const curvePts = (cr: Val, p0: V3, p1: V3, same: boolean): { pts: V3[]; arc?: Edge["arc"]; line?: boolean } => {
    let c = get(cr);
    if (c.type === "SURFACE_CURVE" || c.type === "SEAM_CURVE") c = get(c.args[1]);
    if (c.type === "TRIMMED_CURVE") c = get(c.args[1]);
    if (c.type === "LINE") return { pts: [p0, p1], line: true };
    if (c.type === "CIRCLE" || c.type === "ELLIPSE") {
      const ax = axis2(c.args[1]);
      const ra = (c.args[2] as number) * unitMm, rb = c.type === "ELLIPSE" ? (c.args[3] as number) * unitMm : ra;
      const ang = (p: V3) => { const v = sub3(p, ax.o); return Math.atan2(dot3(v, ax.y) / rb, dot3(v, ax.x) / ra); };
      const t0 = ang(p0), t1 = ang(p1);
      const full = len3(sub3(p0, p1)) < 1e-6;
      let dt = full ? 2 * Math.PI : t1 - t0;
      if (!full) { if (same) { while (dt <= 0) dt += 2 * Math.PI; } else { while (dt >= 0) dt -= 2 * Math.PI; } }
      else if (!same) dt = -dt;
      const m = Math.max(4, Math.min(720, Math.ceil((Math.abs(dt) * Math.max(ra, rb)) / SEG)));
      const pts: V3[] = [];
      for (let k = 0; k <= m; k++) { const t = t0 + (dt * k) / m; pts.push(add3(ax.o, add3(mul3(ax.x, ra * Math.cos(t)), mul3(ax.y, rb * Math.sin(t))))); }
      pts[0] = p0; pts[m] = p1;
      return { pts, ...(c.type === "CIRCLE" ? { arc: { c: ax.o, z: same ? ax.z : mul3(ax.z, -1), r: ra } } : {}) };
    }
    const bs = part(c, "B_SPLINE_CURVE_WITH_KNOTS") ?? part(c, "B_SPLINE_CURVE");
    if (bs) {
      const base = part(c, "B_SPLINE_CURVE") ?? bs;
      const kn = part(c, "B_SPLINE_CURVE_WITH_KNOTS")!;
      const off = base === bs ? 1 : 0;   // the simple entity has a name first
      const deg = base.args[off] as number;
      const ctrl = (base.args[off + 1] as Val[]).map(P);
      const ka = kn === base ? kn.args.slice(off + 5) : kn.args;
      const mults = ka[0] as number[], knotsV = ka[1] as number[];
      const knots: number[] = [];
      mults.forEach((m, k) => { for (let j = 0; j < m; j++) knots.push(knotsV[k]); });
      const rat = part(c, "RATIONAL_B_SPLINE_CURVE");
      const w = rat ? (rat.args[0] as number[]) : ctrl.map(() => 1);
      const at = (u: number): V3 => {
        // de Boor with weights
        let k = deg;
        while (k < knots.length - deg - 2 && u >= knots[k + 1]) k++;
        const d: [V3, number][] = [];
        for (let j = 0; j <= deg; j++) { const q = ctrl[k - deg + j], ww = w[k - deg + j]; d.push([mul3(q, ww), ww]); }
        for (let r = 1; r <= deg; r++) for (let j = deg; j >= r; j--) {
          const i0 = k - deg + j;
          const den = knots[i0 + deg - r + 1] - knots[i0];
          const a = den === 0 ? 0 : (u - knots[i0]) / den;
          d[j] = [add3(mul3(d[j - 1][0], 1 - a), mul3(d[j][0], a)), d[j - 1][1] * (1 - a) + d[j][1] * a];
        }
        return mul3(d[deg][0], 1 / d[deg][1]);
      };
      const u0 = knots[deg], u1 = knots[knots.length - deg - 1];
      const N = 400;
      const samp: V3[] = [];
      for (let k = 0; k <= N; k++) samp.push(at(u0 + ((u1 - u0) * k) / N));
      const near = (p: V3) => samp.reduce((b, q, k) => (len3(sub3(q, p)) < len3(sub3(samp[b], p)) ? k : b), 0);
      let a = near(p0), b = near(p1);
      if (a === b && len3(sub3(p0, p1)) < 1e-6) { a = 0; b = N; }
      let pts: V3[];
      if (same) pts = a <= b ? samp.slice(a, b + 1) : [...samp.slice(a), ...samp.slice(1, b + 1)];
      else pts = a >= b ? samp.slice(b, a + 1).reverse() : [...samp.slice(0, a + 1).reverse(), ...samp.slice(b).reverse().slice(1)];
      if (pts.length < 2) pts = [p0, p1];
      pts[0] = p0; pts[pts.length - 1] = p1;
      return { pts };
    }
    return { pts: [p0, p1] };
  };

  const problems: string[] = [];
  // the solid: the first MANIFOLD_SOLID_BREP (or BREP_WITH_VOIDS), its outer shell
  let shell: Entity | null = null, name = "";
  for (const e of E.values()) {
    if (e.type === "MANIFOLD_SOLID_BREP" || e.type === "BREP_WITH_VOIDS") { shell = get(e.args[1]); break; }
  }
  if (!shell) for (const e of E.values()) if (e.type === "CLOSED_SHELL" || e.type === "OPEN_SHELL") { shell = e; break; }
  if (!shell) throw new Error("No solid in this STEP file");
  for (const e of E.values()) if (e.type === "PRODUCT") { name = String(e.args[0] || e.args[1] || ""); break; }
  let solids = 0;
  for (const e of E.values()) if (e.type === "MANIFOLD_SOLID_BREP" || e.type === "BREP_WITH_VOIDS") solids++;
  if (solids > 1) problems.push(`${solids} solids in the file: the first is used`);

  const faces: Face[] = [];
  for (const fr of shell.args[1] as Val[]) {
    if (!isRef(fr)) continue;
    const f = get(fr);
    if (f.type !== "ADVANCED_FACE" && f.type !== "FACE_SURFACE") continue;
    const se = get(f.args[2]);
    let surf: Surf;
    if (se.type === "PLANE") { const ax = axis2(se.args[1]); surf = { kind: "plane", o: ax.o, n: ax.z, x: ax.x }; }
    else if (se.type === "CYLINDRICAL_SURFACE") { const ax = axis2(se.args[1]); surf = { kind: "cyl", a: ax.o, d: ax.z, x: ax.x, r: (se.args[2] as number) * unitMm }; }
    else surf = { kind: "other", type: se.type === "COMPLEX" ? (se.parts?.map((p) => p.type).join("+") ?? "COMPLEX") : se.type };
    const sense = (f.args[3] as Enum)?.enum !== "F";
    const loops: Face["loops"] = [];
    for (const br of f.args[1] as Val[]) {
      const b = get(br);
      const loop = get(b.args[1]);
      if (loop.type !== "EDGE_LOOP") continue;
      const bsense = (b.args[2] as Enum)?.enum !== "F";
      let edges: Edge[] = [];
      for (const oer of loop.args[1] as Val[]) {
        const oe = get(oer);
        const ec = get(oe.args[3]);
        const ori = (oe.args[4] as Enum)?.enum !== "F";
        const v0 = P(get(ec.args[1]).args[1]), v1 = P(get(ec.args[2]).args[1]);
        const same = (ec.args[4] as Enum)?.enum !== "F";
        const cp = curvePts(ec.args[3], v0, v1, same);
        let pts = cp.pts;
        let arc = cp.arc;
        if (!ori) { pts = pts.slice().reverse(); if (arc) arc = { ...arc, z: mul3(arc.z, -1) }; }
        edges.push({ id: (oe.args[3] as Ref).ref, pts, ...(arc ? { arc } : {}), ...(cp.line ? { line: true } : {}) });
      }
      if (!bsense) edges = edges.reverse().map((e) => ({ ...e, pts: e.pts.slice().reverse(), ...(e.arc ? { arc: { ...e.arc, z: mul3(e.arc.z, -1) } } : {}) }));
      loops.push({ outer: b.type === "FACE_OUTER_BOUND", edges });
    }
    faces.push({ id: (fr as Ref).ref, surf, sense, loops });
  }
  // no FACE_OUTER_BOUND: the biggest loop is the outer one (decided by the unfolder for planes)
  return { faces, unitMm, name, problems };
}

/** The face's outward normal at a point on it (null: a surface not handled). */
export function normalAt(f: Face, p: V3): V3 | null {
  const s = f.surf;
  const k = f.sense ? 1 : -1;
  if (s.kind === "plane") return mul3(s.n, k);
  if (s.kind === "cyl") { const v = sub3(p, s.a); return mul3(unit3(sub3(v, mul3(s.d, dot3(v, s.d)))), k); }
  return null;
}
