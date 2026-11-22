// Rect. → round: a fitting of the HVAC Fittings workbench as a GNEZDO special tool.
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
  function transitionProblems(v) {
    const e = [];
    if (!(v.d > 0)) e.push("D must be greater than 0");
    if (!(v.h > 0)) e.push("H must be greater than 0");
    for (const [k, l] of [["a", "A"], ["b", "B"], ["e", "E"], ["f", "F"]])
      if (!(v[k] > 0)) e.push(`${l} must be greater than 0 (the round's center inside the rectangle, seen from above)`);
    if (!(v.n >= 1) || !Number.isInteger(v.n)) e.push("N must be a whole number, 1 or more");
    if (!v.combined && !v.short && !v.long) e.push("Pick at least one: Combined, Short side, Long side");
    return e;
  }
  var SB = 0;
  var SE = 1;
  var SA = 2;
  var SF = 3;
  var NAME = ["B", "E", "A", "F"];
  var SUB = 128;
  var d3 = (u, w) => Math.hypot(u[0] - w[0], u[1] - w[1], u[2] - w[2]);
  var cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  function third(P, Q, dP, dQ, orient) {
    const dx = Q[0] - P[0], dy = Q[1] - P[1], d = Math.hypot(dx, dy);
    const a = (dP * dP - dQ * dQ + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(dP * dP - a * a, 0));
    const bx = P[0] + a * dx / d, by = P[1] + a * dy / d;
    const c1 = [bx - h * dy / d, by + h * dx / d], c2 = [bx + h * dy / d, by - h * dx / d];
    return orient(c1) >= orient(c2) ? c1 : c2;
  }
  var Strip = class {
    constructor(b3, t3) {
      __publicField(this, "b3", b3);
      __publicField(this, "t3", t3);
      __publicField(this, "b2", [0, 0]);
      __publicField(this, "t2");
      __publicField(this, "bottom");
      __publicField(this, "top");
      this.t2 = [0, d3(b3, t3)];
      this.bottom = [this.b2];
      this.top = [this.t2];
    }
    place(n3) {
      const b2 = this.b2, t2 = this.t2;
      return third(b2, t2, d3(this.b3, n3), d3(this.t3, n3), (X) => cross(b2, X, t2));
    }
    addBottom(n3) {
      this.b2 = this.place(n3);
      this.b3 = n3;
      this.bottom.push(this.b2);
    }
    addTop(n3) {
      this.t2 = this.place(n3);
      this.t3 = n3;
      this.top.push(this.t2);
    }
  };
  function transitionPieces(v) {
    const N = v.n, sub = Math.max(1, Math.ceil(SUB / N)), steps = N * sub;
    const R = v.d / 2;
    const corner = (s) => s === SB ? [v.b, v.e, 0] : s === SE ? [-v.a, v.e, 0] : s === SA ? [-v.a, -v.f, 0] : [v.b, -v.f, 0];
    const round = (th) => [R * Math.cos(th), R * Math.sin(th), v.h];
    const longerAB = v.a + v.b >= v.e + v.f;
    const marks = (L, folds) => {
      if (v.folds) for (const [a, b] of folds) L.marks(marksOnLine(a, b, v.markLen, v.markGap, "end"));
    };
    const finish = (st, fans, folds, turn) => {
      let c = [];
      for (let j = 0; j + 1 < st.bottom.length; j++) c.push(seg(st.bottom[j], st.bottom[j + 1]));
      c.push(seg(st.bottom[st.bottom.length - 1], st.top[st.top.length - 1]));
      const roundSegs = fans.flatMap(([i0, i1]) => fitPoints(st.top.slice(i0, i1 + 1)));
      c.push(...[...roundSegs].reverse().map(rev));
      c.push(seg(st.top[0], st.bottom[0]));
      let fl = folds;
      if (turn) {
        const [x0, y0] = st.bottom[0], [x1, y1] = st.bottom[st.bottom.length - 1];
        const ang = -Math.atan2(y1 - y0, x1 - x0), co = Math.cos(ang), sn = Math.sin(ang);
        const tr = (q) => {
          const x = q[0] - x0, y = q[1] - y0;
          return [x * co - y * sn, x * sn + y * co];
        };
        c = c.map((s) => mapSeg(s, tr));
        fl = folds.map(([a, b]) => [tr(a), tr(b)]);
      }
      const L = new Lines().segs(c);
      marks(L, fl);
      return L;
    };
    const out = [];
    if (v.combined) {
      const seam = longerAB ? v.e >= v.f ? SE : SF : v.b >= v.a ? SB : SA;
      const th0 = seam * Math.PI / 2;
      const foot = seam === SB ? [v.b, 0, 0] : seam === SE ? [0, v.e, 0] : seam === SA ? [-v.a, 0, 0] : [0, -v.f, 0];
      const st = new Strip(foot, round(th0));
      const folds = [], fans = [];
      for (let j = 0; j < 4; j++) {
        const side = (seam + j) % 4;
        st.addBottom(corner(side));
        const start = st.top.length - 1;
        folds.push([st.b2, st.t2]);
        for (let k = 1; k <= steps; k++) {
          st.addTop(round(th0 + (j * steps + k) * (Math.PI / 2) / steps));
          if (k % sub === 0) folds.push([st.b2, st.t2]);
        }
        fans.push([start, st.top.length - 1]);
      }
      st.addBottom(foot);
      out.push({ key: "C", label: "combined", qty: 1, lines: finish(st, fans, folds, false) });
    }
    const shortSides = longerAB ? [SA, SB] : [SE, SF], longSides = longerAB ? [SE, SF] : [SA, SB];
    const same = (s) => s.includes(SA) ? Math.abs(v.a - v.b) < 1e-9 : Math.abs(v.e - v.f) < 1e-9;
    if (v.short) {
      const make = (side) => {
        const th = side * Math.PI / 2;
        const st = new Strip(corner((side + 3) % 4), round(th - Math.PI / 2));
        const folds = [], fans = [];
        for (let k = 1; k <= steps; k++) {
          st.addTop(round(th - Math.PI / 2 + k * (Math.PI / 2) / steps));
          if (k % sub === 0) folds.push([st.b2, st.t2]);
        }
        fans.push([0, st.top.length - 1]);
        st.addBottom(corner(side));
        folds.push([st.b2, st.t2]);
        const start = st.top.length - 1;
        for (let k = 1; k <= steps; k++) {
          st.addTop(round(th + k * (Math.PI / 2) / steps));
          if (k % sub === 0 && k < steps) folds.push([st.b2, st.t2]);
        }
        fans.push([start, st.top.length - 1]);
        return finish(st, fans, folds, true);
      };
      if (same(shortSides)) out.push({ key: "S", label: "short side", qty: 2, lines: make(shortSides[0]) });
      else shortSides.forEach((s, i) => out.push({ key: `S${i + 1}`, label: `short side ${NAME[s]}`, qty: 1, lines: make(s) }));
    }
    if (v.long) {
      const make = (side) => {
        const st = new Strip(corner((side + 3) % 4), round(side * Math.PI / 2));
        st.addBottom(corner(side));
        return finish(st, [], [], true);
      };
      if (same(longSides)) out.push({ key: "L", label: "long side", qty: 2, lines: make(longSides[0]) });
      else longSides.forEach((s, i) => out.push({ key: `L${i + 1}`, label: `long side ${NAME[s]}`, qty: 1, lines: make(s) }));
    }
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
  var values = (v) => ({ ...v, markGap: 2 });
  var tool = {
    manifest: {
      id: "rect-round-transition",
      name: "Rect. → round",
      countLabel: "Fittings",
      description: "A transition from a rectangle to a round, the round anywhere over the rectangle (A, B, E, F from its center). From the HVAC Fittings workbench.",
      fields: [
        { key: "a", type: "number", label: "A", title: "A: rectangle edge left of the round's center", unit: "mm", default: 300, min: 0, at: [22, 74], color: "blue" },
        { key: "b", type: "number", label: "B", title: "B: rectangle edge right of the round's center", unit: "mm", default: 200, min: 0, at: [48, 86], color: "green" },
        { key: "e", type: "number", label: "E", title: "E: rectangle edge above the round's center", unit: "mm", default: 150, min: 0, at: [70, 27], color: "purple" },
        { key: "f", type: "number", label: "F", title: "F: rectangle edge below the round's center", unit: "mm", default: 250, min: 0, at: [70, 56], color: "brown" },
        { key: "d", type: "number", label: "D", title: "D: diameter of the round end", unit: "mm", default: 400, min: 0, at: [37, 43], color: "red" },
        { key: "h", type: "number", label: "H", title: "H: height", unit: "mm", default: 300, min: 0, at: [88, 84], color: "dark" },
        { key: "combined", type: "check", label: "Combined", title: "The whole transition in one piece", group: "Pieces", default: true },
        { key: "short", type: "check", label: "Short side", title: "Short side: its triangle and the two corner fans (half the round)", group: "Pieces", default: false },
        { key: "long", type: "check", label: "Long side", title: "Long side: the flat triangle", group: "Pieces", default: false },
        {
          key: "n",
          type: "int",
          label: "Sections per quarter of the round",
          group: "Pieces",
          default: 4,
          min: 1,
          note: "Seam on the longer side, straight down from the round. Short side: its triangle and the two corner fans (half the round); long side: the flat triangle."
        },
        { key: "folds", type: "check", label: "Fold marks at the round edge", title: "Fold marks: tracing lines", group: "Fold marks", default: true },
        { key: "markLen", type: "number", label: "Mark length", unit: "mm", group: "Fold marks", default: 15, min: 0.5 }
      ]
    },
    problems: (v) => transitionProblems(values(v)),
    title: (v) => `TR ${g(v.a + v.b)}x${g(v.e + v.f)}-D${g(v.d)}`,
    parts: (v, gz) => toParts(transitionPieces(values(v)), gz)
  };
  return __toCommonJS(stdin_exports);
})();

function problems(v) { return FIT.T.problems(v); }
function title(v) { return FIT.T.title(v); }
function parts(v, gz) { return FIT.T.parts(v, gz); }
