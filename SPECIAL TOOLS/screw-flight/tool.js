// Screw flight: a fitting of the HVAC Fittings workbench as a GNEZDO special tool.
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
  var seg = (a, b, m) => m ? { a, b, m } : { a, b };
  function circleThrough(a, b, c) {
    const [ax, ay] = a, [bx, by] = b, [cx, cy] = c;
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(d) < 1e-12) return null;
    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
    return { c: [ux, uy], r: Math.hypot(ax - ux, ay - uy) };
  }
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
  function screwProblems(v) {
    const e = [];
    if (!(v.id > 0)) e.push("ID must be greater than 0");
    if (!(v.od > v.id)) e.push("OD must be larger than ID");
    if (!(v.p > 0)) e.push("P must be greater than 0");
    if (!(v.l > 0)) e.push("L must be greater than 0");
    if (!(v.gap >= 0)) e.push("The gap cannot be negative");
    if (!e.length) {
      const r = screwResult(v);
      if (v.gap >= 2 * r.ri) e.push(`The gap is larger than the blank's inside (${(2 * r.ri).toFixed(1)} mm)`);
    }
    return e;
  }
  function screwResult(v) {
    const li = Math.hypot(Math.PI * v.id, v.p), lo = Math.hypot(Math.PI * v.od, v.p);
    const h = (v.od - v.id) / 2, ri = h * li / (lo - li), ro = ri + h;
    const calc = li / ri * 180 / Math.PI;
    let gapAngle = 2 * Math.asin(Math.min(1, v.gap / 2 / ri)) * 180 / Math.PI, blank = 360 - gapAngle, warning;
    if (blank < calc) {
      warning = `The calculated blank (${calc.toFixed(2)}°) is more than 360° less the gap: it is not extended and the gap is smaller`;
      blank = calc;
      gapAngle = 360 - calc;
    }
    const turns = v.l / v.p;
    return { li, lo, h, ri, ro, calc, gapAngle, blank, gapOuter: 2 * ro * Math.sin(gapAngle * Math.PI / 180 / 2), pieces: Math.max(1, Math.ceil(turns - 1e-9)), turns, warning };
  }
  function screwPieces(v) {
    const r = screwResult(v);
    const P = (rad, deg) => [rad * Math.cos(deg * Math.PI / 180), rad * Math.sin(deg * Math.PI / 180)];
    const a0 = 270 + r.gapAngle / 2, a1 = a0 + r.blank, k = Math.max(1, Math.ceil(r.blank / 90)), span = r.blank;
    const outer = [], inner = [];
    for (let i = 0; i < k; i++) {
      outer.push(seg(P(r.ro, a0 + span * i / k), P(r.ro, a0 + span * (i + 1) / k), P(r.ro, a0 + span * (i + 0.5) / k)));
      inner.push(seg(P(r.ri, a1 - span * i / k), P(r.ri, a1 - span * (i + 1) / k), P(r.ri, a1 - span * (i + 0.5) / k)));
    }
    const L = new Lines().segs([...outer, seg(P(r.ro, a1), P(r.ri, a1)), ...inner, seg(P(r.ri, a0), P(r.ro, a0))]);
    return [{ key: "F", label: "flight", qty: r.pieces, lines: L }];
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
  var tool = {
    manifest: {
      id: "screw-flight",
      name: "Screw flight",
      countLabel: "Screws",
      description: "The blank of one pitch of a screw flight (an annular ring with a gap); L / P of them for the screw. From the HVAC Fittings workbench.",
      fields: [
        { key: "od", type: "number", label: "OD", title: "OD: outer diameter of the flight", unit: "mm", default: 315, min: 0, at: [14, 22], color: "blue" },
        { key: "id", type: "number", label: "ID", title: "ID: inner diameter of the flight (the shaft)", unit: "mm", default: 101.6, min: 0, at: [50, 50], color: "purple" },
        { key: "p", type: "number", label: "P", title: "P: pitch", unit: "mm", default: 300, min: 0, at: [15, 83], color: "green" },
        { key: "l", type: "number", label: "L", title: "L: screw length", unit: "mm", default: 1e3, min: 0, at: [32, 93], color: "brown" },
        { key: "gap", type: "number", label: "Gap", title: "Gap between the cut ends at the inner edge", unit: "mm", default: 6, min: 0, at: [76, 8], color: "orange" }
      ],
      note: "The blank is extended past the calculated angle until the cut ends are Gap apart at the inner edge. The part's label gives the blank's angle and radii; pieces = L / P, up."
    },
    problems: screwProblems,
    title: (v) => `SF OD${g(v.od)} ID${g(v.id)} P${g(v.p)}`,
    parts: (v, gz) => {
      const r = screwResult(v);
      return toParts(screwPieces(v), gz, (p) => `${p.label}, ${r.blank.toFixed(1)}°${r.warning ? " (not extended)" : ""}, Ri ${g(r.ri)}, Ro ${g(r.ro)}`);
    }
  };
  return __toCommonJS(stdin_exports);
})();

function problems(v) { return FIT.T.problems(v); }
function title(v) { return FIT.T.title(v); }
function parts(v, gz) { return FIT.T.parts(v, gz); }
