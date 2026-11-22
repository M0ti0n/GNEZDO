// Branch reducer: a fitting of the HVAC Fittings workbench as a GNEZDO special tool.
// Made by SPECIAL TOOLS/fittings-src/build.mjs from the fitting's source there: change it there, not here.

var FIT = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // <stdin>
  var stdin_exports = {};
  __export(stdin_exports, {
    T: () => tool
  });
  var TOL = 0.01;
  var seg = (a, b, m) => m ? { a, b, m } : { a, b };
  var rev = (s) => seg(s.b, s.a, s.m);
  function circleThrough(a, b, c) {
    const [ax, ay] = a, [bx, by] = b, [cx, cy] = c;
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(d) < 1e-12) return null;
    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
    return { c: [ux, uy], r: Math.hypot(ax - ux, ay - uy) };
  }
  var lineDev = (a, b, p) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
    return L === 0 ? Math.hypot(p[0] - a[0], p[1] - a[1]) : Math.abs(dx * (p[1] - a[1]) - dy * (p[0] - a[0])) / L;
  };
  function sweepOf(s, c) {
    const ang = (p) => Math.atan2(p[1] - c[1], p[0] - c[0]);
    const a0 = ang(s.a), am = ang(s.m), a1 = ang(s.b);
    const TAU = 2 * Math.PI, md = (x) => (x % TAU + TAU) % TAU;
    const ccw = md(a1 - a0);
    return md(am - a0) <= ccw ? ccw : -md(a0 - a1);
  }
  function sample(s, n = 16) {
    if (!s.m) return [s.a, s.b];
    const ci = circleThrough(s.a, s.m, s.b);
    if (!ci) return [s.a, s.b];
    const a0 = Math.atan2(s.a[1] - ci.c[1], s.a[0] - ci.c[0]), sw = sweepOf(s, ci.c);
    return Array.from({ length: n + 1 }, (_, i) => [ci.c[0] + ci.r * Math.cos(a0 + sw * i / n), ci.c[1] + ci.r * Math.sin(a0 + sw * i / n)]);
  }
  function fitPoints(pts, tol = TOL) {
    const out = [];
    const devLine = (i, j) => {
      let w = 0;
      for (let k = i + 1; k < j; k++) w = Math.max(w, lineDev(pts[i], pts[j], pts[k]));
      return w;
    };
    const rec = (i, j) => {
      if (j - i < 2 || devLine(i, j) <= tol) {
        out.push(seg(pts[i], pts[j]));
        return;
      }
      const m = i + j >> 1;
      const ci = circleThrough(pts[i], pts[m], pts[j]);
      if (ci && ci.r < 1e3 * Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1])) {
        let w = 0;
        for (let k = i + 1; k < j; k++) w = Math.max(w, Math.abs(Math.hypot(pts[k][0] - ci.c[0], pts[k][1] - ci.c[1]) - ci.r));
        if (w <= tol) {
          out.push(seg(pts[i], pts[j], pts[m]));
          return;
        }
      }
      if (j - i === 2) {
        out.push(seg(pts[i], pts[m]), seg(pts[m], pts[j]));
        return;
      }
      rec(i, m);
      rec(m, j);
    };
    rec(0, pts.length - 1);
    return out;
  }
  function marksOnLine(p0, p1, length = 15, gap = 2, ends = "both") {
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1], L = Math.hypot(dx, dy);
    if (L <= 2 * gap + 0.5) return [];
    const at = (t) => [p0[0] + dx / L * t, p0[1] + dy / L * t];
    if (ends === "end") return [[at(Math.max(gap, L - gap - length)), at(L - gap)]];
    if (2 * (gap + length) >= L) return [[at(gap), at(L - gap)]];
    return [[at(gap), at(gap + length)], [at(L - gap - length), at(L - gap)]];
  }
  var Lines = class {
    constructor() {
      __publicField(this, "items", []);
    }
    segs(list, role = "cut") {
      for (const s of list) this.items.push({ s, role });
      return this;
    }
    circle(c, r, role = "cut") {
      this.items.push({ c: [c, r], role });
      return this;
    }
    marks(list, role = "trace") {
      return this.segs(list.map(([a, b]) => seg(a, b)), role);
    }
    /** Its size (arcs and circles included). */
    box() {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const take = (x, y) => {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      };
      for (const it of this.items) {
        if (it.c) {
          const [[cx, cy], r] = it.c;
          take(cx - r, cy - r);
          take(cx + r, cy + r);
        } else for (const [x, y] of sample(it.s, 12)) take(x, y);
      }
      return { x0, y0, x1, y1 };
    }
    build(prefix) {
      const b = this.box(), dx = -b.x0, dy = -b.y0;
      const P = (p) => ({ x: p[0] + dx, y: p[1] + dy });
      const out = [];
      let n = 0;
      const id = () => `${prefix}${++n}`;
      const norm = (x) => (x % 360 + 360) % 360;
      for (const it of this.items) {
        const role = it.role;
        if (it.c) {
          out.push({ id: id(), kind: "circle", c: P(it.c[0]), r: it.c[1], role });
          continue;
        }
        const s = it.s;
        const a = P(s.a), b2 = P(s.b);
        const ci = s.m && circleThrough(s.a, s.m, s.b);
        if (!s.m || !ci) {
          if (Math.hypot(b2.x - a.x, b2.y - a.y) > 1e-9) out.push({ id: id(), kind: "line", a, b: b2, role });
          continue;
        }
        const deg = (p) => Math.atan2(p[1] - ci.c[1], p[0] - ci.c[0]) * 180 / Math.PI;
        const left = (s.m[0] - s.a[0]) * (s.b[1] - s.m[1]) - (s.m[1] - s.a[1]) * (s.b[0] - s.m[0]) > 0;
        out.push({ id: id(), kind: "arc", c: P(ci.c), r: ci.r, start: norm(deg(left ? s.a : s.b)), end: norm(deg(left ? s.b : s.a)), role });
      }
      return { entities: out, w: b.x1 - b.x0, h: b.y1 - b.y0 };
    }
  };
  function branchProblems(v) {
    const e = [];
    for (const [k, l] of [["d1", "D1"], ["d2", "D2"], ["h1", "H1"], ["d3", "D3"], ["l", "L"]]) if (!(v[k] > 0)) e.push(`${l} must be greater than 0`);
    if (!(v.h2 > 0 && v.h2 < v.h1)) e.push("H2 must lie between 0 and H1");
    if (!(v.a > -89 && v.a < 90)) e.push("A must be between -89° and 90°");
    if (!(v.folds >= 0) || !Number.isInteger(v.folds)) e.push("Fold lines: a whole number, 0 or more");
    return e;
  }
  var SAMPLES = 360;
  var Model = class {
    constructor(v) {
      __publicField(this, "v", v);
      __publicField(this, "R2");
      __publicField(this, "R1");
      __publicField(this, "k");
      __publicField(this, "r3");
      __publicField(this, "u");
      __publicField(this, "n");
      __publicField(this, "w", [0, 1, 0]);
      __publicField(this, "P");
      this.R2 = v.d2 / 2;
      this.R1 = v.d1 / 2;
      this.k = (this.R1 - this.R2) / v.h1;
      this.r3 = v.d3 / 2;
      const a = v.a * Math.PI / 180;
      this.u = [-Math.cos(a), 0, Math.sin(a)];
      this.n = [Math.sin(a), 0, Math.cos(a)];
      this.P = [-this.R(v.h2), 0, v.h2];
    }
    R(z) {
      return this.R2 + this.k * z;
    }
    point(beta, t) {
      const c = Math.cos(beta), s = Math.sin(beta), { P, u, n, w, r3 } = this;
      return [0, 1, 2].map((i) => P[i] + t * u[i] + r3 * (c * n[i] + s * w[i]));
    }
    f(beta, t) {
      const [x, y, z] = this.point(beta, t);
      return Math.hypot(x, y) - this.R(z);
    }
    /** Where the branch line at beta meets the reducer (its outer crossing), along the axis. */
    meet(beta) {
      const v = this.v, step = (this.R2 + this.r3) / 400;
      if (this.f(beta, v.l) <= 0) throw new Error("The branch end lies inside the reducer: make L longer");
      const tMin = -2 * (Math.max(this.R1, this.R2) + this.r3 + v.l);
      for (let t = v.l; t > tMin; t -= step) {
        const lo = t - step;
        if (this.f(beta, lo) < 0) {
          let a2 = lo, b2 = t;
          for (let i = 0; i < 80; i++) {
            const m = (a2 + b2) / 2;
            if (this.f(beta, m) < 0) a2 = m;
            else b2 = m;
          }
          return (a2 + b2) / 2;
        }
      }
      let best = v.l, bf = Infinity;
      for (let t = v.l; t > tMin; t -= step) {
        const f = this.f(beta, t);
        if (f < bf) {
          bf = f;
          best = t;
        }
      }
      let a = best - step, b = best + step;
      const g2 = (Math.sqrt(5) - 1) / 2;
      for (let i = 0; i < 100; i++) {
        const c = b - g2 * (b - a), d = a + g2 * (b - a);
        if (this.f(beta, c) < this.f(beta, d)) b = d;
        else a = c;
      }
      const tt = (a + b) / 2;
      if (Math.abs(this.f(beta, tt)) < 1e-4 * (this.R2 + this.r3)) return tt;
      throw new Error("The branch does not meet the reducer");
    }
  };
  var Cone = class {
    constructor(m) {
      __publicField(this, "m", m);
      __publicField(this, "q");
      __publicField(this, "cyl");
      __publicField(this, "zApex", 0);
      __publicField(this, "theta", 0);
      this.q = Math.sqrt(1 + m.k * m.k);
      this.cyl = Math.abs(m.k) < 1e-12;
      if (!this.cyl) {
        this.zApex = -m.R2 / m.k;
        this.theta = 2 * Math.PI * Math.abs(m.k) / this.q;
      }
    }
    xy(phi, z) {
      if (this.cyl) return [this.m.R2 * phi, z];
      const ang = Math.PI / 2 + this.theta / 2 - phi * Math.abs(this.m.k) / this.q, r = this.q * Math.abs(z - this.zApex);
      return [r * Math.cos(ang), r * Math.sin(ang)];
    }
    arc(z, p0, p1) {
      if (this.cyl) return [seg(this.xy(p0, z), this.xy(p1, z))];
      const n = Math.max(1, Math.ceil(Math.abs(p1 - p0) * Math.abs(this.m.k) / this.q / (Math.PI / 2)));
      return Array.from({ length: n }, (_, i) => {
        const a = p0 + (p1 - p0) * i / n, b = p0 + (p1 - p0) * (i + 1) / n;
        return seg(this.xy(a, z), this.xy(b, z), this.xy((a + b) / 2, z));
      });
    }
  };
  var phiS = (x, y) => {
    const T = 2 * Math.PI;
    return ((Math.atan2(y, x) - Math.PI) % T + T) % T;
  };
  var inPoly = ([x, y], poly) => {
    let inside = false;
    for (let i = 0; i + 1 < poly.length; i++) {
      const [x0, y0] = poly[i], [x1, y1] = poly[i + 1];
      if (y0 > y !== y1 > y && x0 + (y - y0) * (x1 - x0) / (y1 - y0) > x) inside = !inside;
    }
    return inside;
  };
  function branchPieces(v) {
    const m = new Model(v);
    const betas = Array.from({ length: SAMPLES + 1 }, (_, i) => 2 * Math.PI * i / SAMPLES);
    const ts = betas.map((b) => m.meet(b));
    const pts3 = betas.map((b, i) => m.point(b, ts[i]));
    const zs = pts3.map((q) => q[2]);
    const zLo = Math.min(...zs), zHi = Math.max(...zs);
    if (zLo < 1 || zHi > v.h1 - 1) throw new Error(`The branch hole runs past the reducer's top or bottom (from ${zLo.toFixed(1)} to ${zHi.toFixed(1)} mm): change H2, D3 or A`);
    const cone = new Cone(m), half = SAMPLES / 2, T = 2 * Math.PI;
    const right = [], left = [];
    for (let i = half; i >= 0; i--) {
      const [x, y, z] = pts3[i];
      right.push(cone.xy(i === 0 || i === half ? T : phiS(x, y), z));
    }
    for (let i = SAMPLES; i >= half; i--) {
      const [x, y, z] = pts3[i];
      left.push(cone.xy(i === SAMPLES || i === half ? 0 : phiS(x, y), z));
    }
    const c = [
      ...cone.arc(0, 0, T),
      seg(cone.xy(T, 0), right[0]),
      ...fitPoints(right),
      seg(right[right.length - 1], cone.xy(T, v.h1)),
      ...cone.arc(v.h1, T, 0),
      seg(cone.xy(0, v.h1), left[0]),
      ...fitPoints(left),
      seg(left[left.length - 1], cone.xy(0, 0))
    ];
    const red = new Lines().segs(c);
    if (v.folds > 0) for (let i = 0; i < v.folds; i++) {
      const ph = T * (i + 0.5) / v.folds;
      for (const mk of marksOnLine(cone.xy(ph, 0), cone.xy(ph, v.h1), v.markLen, v.markGap))
        if (![right, left].some((poly) => inPoly(mk[0], [...poly, poly[0]]) || inPoly(mk[1], [...poly, poly[0]]))) red.marks([mk]);
    }
    const n = SAMPLES, lengths = ts.slice(0, -1).map((t) => v.l - t);
    let iSeam = 0;
    for (let i = 1; i < n; i++) if (lengths[i] < lengths[iSeam]) iSeam = i;
    const width = Math.PI * v.d3;
    const lengthAt = (bs) => v.l - m.meet((betas[iSeam] + bs) % T);
    const edge = Array.from({ length: n + 1 }, (_, j) => {
      const bs = T * j / n;
      return [m.r3 * bs, lengthAt(bs)];
    });
    const sLen = edge[0][1];
    const br = new Lines().segs([seg([0, 0], [width, 0]), seg([width, 0], [width, sLen]), ...fitPoints(edge).reverse().map(rev), seg([0, sLen], [0, 0])]);
    if (v.folds > 0) for (let i = 0; i < v.folds; i++) {
      const bs = T * (i + 0.5) / v.folds;
      br.marks(marksOnLine([m.r3 * bs, 0], [m.r3 * bs, lengthAt(bs)], v.markLen, v.markGap));
    }
    return [{ key: "R", label: "reducer", qty: 1, lines: red }, { key: "B", label: "branch", qty: 1, lines: br }];
  }
  var SUFFIX = { C: "", W: "", R: "", F: "", SA: "A", SB: "B" };
  function toParts(pieces, gz, label = (p) => p.label) {
    return pieces.map((p) => {
      const part = gz.part(label(p), p.qty, p.key);
      part.suffix = SUFFIX[p.key] ?? p.key;
      for (const e of p.lines.build(`${p.key}-`).entities) {
        const role = e.role ?? "cut";
        if (e.kind === "line") part.line(e.a.x, e.a.y, e.b.x, e.b.y, role);
        else if (e.kind === "arc") part.arc(e.c.x, e.c.y, e.r, e.start, e.end, role);
        else if (e.kind === "circle") part.circle(e.c.x, e.c.y, e.r, role);
        else throw new Error(`A ${e.kind} in ${p.label}: not drawn`);
      }
      return part;
    });
  }
  var g = (x) => String(Math.round(x * 100) / 100);
  var foldFields = () => [
    { key: "foldsOn", type: "check", label: "Fold marks", title: "Fold marks: tracing lines on the fold lines", group: "Fold marks", default: true },
    { key: "folds", type: "int", label: "Around", title: "How many fold lines around", unit: "lines", group: "Fold marks", default: 24, min: 1 },
    { key: "markLen", type: "number", label: "Mark length", unit: "mm", group: "Fold marks", default: 15, min: 0.5 },
    { key: "markGap", type: "number", label: "In from the edge", unit: "mm", group: "Fold marks", default: 2, min: 0 }
  ];
  var values = (v) => ({ d1: v.d1, d2: v.d2, h1: v.h1, h2: v.h2, d3: v.d3, l: v.l, a: v.a, folds: v.foldsOn ? v.folds : 0, markLen: v.markLen, markGap: v.markGap });
  var tool = {
    manifest: {
      id: "branch-reducer",
      name: "Branch reducer",
      countLabel: "Fittings",
      description: "A round reducer with a round branch at an angle; D1 = D2 makes a tee or a lateral. From the HVAC Fittings workbench.",
      fields: [
        { key: "d1", type: "number", label: "D1", title: "D1: reducer diameter at the top", unit: "mm", default: 200, min: 0, at: [43, 6], color: "blue" },
        { key: "d2", type: "number", label: "D2", title: "D2: reducer diameter at the bottom", unit: "mm", default: 400, min: 0, at: [43, 82], color: "green" },
        { key: "h1", type: "number", label: "H1", title: "H1: reducer height", unit: "mm", default: 400, min: 0, at: [15, 50], color: "purple" },
        { key: "h2", type: "number", label: "H2", title: "H2: height where the branch axis meets the reducer's side", unit: "mm", default: 200, min: 0, at: [43, 62], color: "brown" },
        { key: "d3", type: "number", label: "D3", title: "D3: branch diameter", unit: "mm", default: 160, min: 0, at: [86, 14], color: "blue" },
        { key: "l", type: "number", label: "L", title: "L: along the branch axis to its end", unit: "mm", default: 250, min: 0, at: [82, 50], color: "green" },
        { key: "a", type: "number", label: "A", title: "A: branch angle above the horizontal (negative: down)", unit: "°", default: 30, min: -89, at: [82, 66], color: "red" },
        ...foldFields()
      ],
      note: "Seams: the reducer's straight through the middle of the branch hole (two half holes), the branch's on its shortest line. D1 = D2: a straight pipe (tee or lateral); a negative angle points the branch down."
    },
    problems: (v) => branchProblems(values(v)),
    title: (v) => `RB D${g(v.d1)}-${g(v.d2)} D${g(v.d3)}`,
    parts: (v, gz) => toParts(branchPieces(values(v)), gz)
  };
  return __toCommonJS(stdin_exports);
})();

function problems(v) { return FIT.T.problems(v); }
function title(v) { return FIT.T.title(v); }
function parts(v, gz) { return FIT.T.parts(v, gz); }
