// Segmented elbow: a fitting of the HVAC Fittings workbench as a GNEZDO special tool.
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
  var MIN_SPAN = 1e-3;
  var seg = (a, b, m) => m ? { a, b, m } : { a, b };
  var rev = (s) => seg(s.b, s.a, s.m);
  var mapSeg = (s, f) => seg(f(s.a), f(s.b), s.m && f(s.m));
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
  function fit(f, x0, x1, tol = TOL, checks = 8) {
    const out = [];
    const rec = (a, b, depth) => {
      const pa = [a, f(a)], pb = [b, f(b)];
      const m = 0.5 * (a + b), pm = [m, f(m)];
      const probes = [];
      for (let k = 1; k <= checks; k++) {
        const x = a + (b - a) * k / (checks + 1);
        probes.push([x, f(x)]);
      }
      if (Math.max(...[...probes, pm].map((p) => lineDev(pa, pb, p))) <= tol) {
        out.push(seg(pa, pb));
        return;
      }
      let ci = circleThrough(pa, pm, pb);
      if (ci && ci.r > 1e3 * Math.hypot(pb[0] - pa[0], pb[1] - pa[1])) ci = null;
      if (ci) {
        const s = seg(pa, pb, pm);
        if (Math.max(...sample(s, checks * 2).map(([x, y]) => Math.abs(y - f(x)))) <= tol) {
          out.push(s);
          return;
        }
      }
      if (b - a < MIN_SPAN || depth > 40) {
        out.push(ci ? seg(pa, pb, pm) : seg(pa, pb));
        return;
      }
      rec(a, m, depth + 1);
      rec(m, b, depth + 1);
    };
    rec(x0, x1, 0);
    return out;
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
  function elbowProblems(v) {
    const e = [];
    if (!(v.d > 0)) e.push("D must be greater than 0");
    if (!(v.a > 0 && v.a < 180)) e.push("A must be between 0 and 180°");
    if (!(v.n >= 0) || !Number.isInteger(v.n)) e.push("N must be a whole number, 0 or more");
    if (!(v.r >= v.d / 2)) e.push("R must be at least D / 2 (or the throat folds over itself)");
    if (!(v.markLen > 0) || !(v.markGap >= 0)) e.push("Fold marks: length above 0, gap 0 or more");
    if (!(v.folds >= 0) || !Number.isInteger(v.folds)) e.push("Fold lines: a whole number, 0 or more");
    return e;
  }
  function elbowBasics(v) {
    const theta = v.a / (v.n + 1);
    const t = Math.tan(theta * Math.PI / 180 / 2);
    return { theta, t, width: Math.PI * v.d };
  }
  function foldMarks(x, y0, y1, v) {
    const g2 = v.markGap, L = v.markLen;
    if (y0 + g2 + L >= y1 - g2 - L) return y1 - y0 <= 2 * g2 + 0.5 ? [] : [[[x, y0 + g2], [x, y1 - g2]]];
    return [[[x, y0 + g2], [x, y0 + g2 + L]], [[x, y1 - g2 - L], [x, y1 - g2]]];
  }
  function elbowPieces(v) {
    const { t, width } = elbowBasics(v);
    const rr = v.d / 2;
    const h = (x) => (v.r + rr * Math.cos(Math.PI / 2 + x / rr)) * t;
    const hTurned = (x) => (v.r - rr * Math.cos(Math.PI / 2 + x / rr)) * t;
    const foldXs = v.folds > 0 ? Array.from({ length: v.folds }, (_, i) => width / v.folds * (i + 0.5)) : [];
    const top = fit(h, 0, width);
    const t0 = top[0].a, t1 = top[top.length - 1].b;
    const down = (s) => mapSeg(s, ([x, y]) => [x, -y]);
    if (v.stacked) {
      const Rt = v.r * t, H = 2 * Rt * (v.n + 1);
      const L = new Lines();
      L.segs([seg([0, 0], [width, 0]), seg([width, 0], [width, H]), seg([width, H], [0, H]), seg([0, H], [0, 0])]);
      const cutAt = (k) => (x) => 2 * Rt * k + (k % 2 === 0 ? h(x) : hTurned(x));
      const cuts = Array.from({ length: v.n + 1 }, (_, k) => cutAt(k));
      for (const c of cuts) L.segs(fit(c, 0, width), "openCut");
      const edges = [() => 0, ...cuts, () => H];
      for (let s = 0; s + 1 < edges.length; s++) for (const x of foldXs) L.marks(foldMarks(x, edges[s](x), edges[s + 1](x), v));
      return [{ key: "S", label: "stacked", qty: 1, lines: L }];
    }
    const mid = new Lines();
    mid.segs([...top, seg(t1, [t1[0], -t1[1]]), ...top.map(down).reverse().map(rev), seg([t0[0], -t0[1]], t0)]);
    for (const x of foldXs) mid.marks(foldMarks(x, -h(x), h(x), v));
    const end = new Lines();
    end.segs([seg([0, 0], [width, 0]), seg([width, 0], t1), ...[...top].reverse().map(rev), seg(t0, [0, 0])]);
    for (const x of foldXs) end.marks(foldMarks(x, 0, h(x), v));
    const out = [];
    if (v.n > 0) out.push({ key: "M", label: "middle", qty: v.n, lines: mid });
    out.push({ key: "E", label: "end", qty: 2, lines: end });
    return out;
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
  var values = (v) => ({ d: v.d, r: v.r, a: v.a, n: v.n, folds: v.foldsOn ? v.folds : 0, markLen: v.markLen, markGap: v.markGap, stacked: v.pieces === "stacked" });
  var tool = {
    manifest: {
      id: "segmented-elbow",
      name: "Segmented elbow",
      countLabel: "Elbows",
      description: "A round elbow of N middle sections and two end sections (half as wide), seam at the side. From the HVAC Fittings workbench.",
      fields: [
        { key: "d", type: "number", label: "D", title: "D: diameter (neutral)", unit: "mm", default: 300, min: 0, at: [59, 95], color: "blue" },
        { key: "r", type: "number", label: "R", title: "R: centerline radius", unit: "mm", default: 450, min: 0, at: [36, 72], color: "green" },
        { key: "a", type: "number", label: "A", title: "A: elbow angle", unit: "°", default: 90, min: 0, at: [13, 92], color: "purple" },
        { key: "n", type: "int", label: "N", title: "N: middle sections", unit: "middle", default: 3, min: 0, at: [76, 38], color: "brown" },
        {
          key: "pieces",
          type: "choice",
          label: "Pieces",
          group: "Pieces",
          default: "separate",
          options: [{ value: "separate", label: "Separate sections" }, { value: "stacked", label: "Stacked in one rectangle" }],
          note: "Seam always at the side, so the sections fit together; stacked, open cuts separate them (every other section turned round)."
        },
        ...foldFields()
      ]
    },
    problems: (v) => elbowProblems(values(v)),
    title: (v) => `ELBOW D${g(v.d)} A${g(v.a)}`,
    parts: (v, gz) => toParts(elbowPieces(values(v)), gz)
  };
  return __toCommonJS(stdin_exports);
})();

function problems(v) { return FIT.T.problems(v); }
function title(v) { return FIT.T.title(v); }
function parts(v, gz) { return FIT.T.parts(v, gz); }
