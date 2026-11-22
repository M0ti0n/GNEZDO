// Flange: a fitting of the HVAC Fittings workbench as a GNEZDO special tool.
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
      const P2 = (p) => ({ x: p[0] + dx, y: p[1] + dy });
      const out = [];
      let n = 0;
      const id = () => `${prefix}${++n}`;
      const norm = (x) => (x % 360 + 360) % 360;
      for (const it of this.items) {
        const role = it.role;
        if (it.c) {
          out.push({ id: id(), kind: "circle", c: P2(it.c[0]), r: it.c[1], role });
          continue;
        }
        const s = it.s;
        const a = P2(s.a), b2 = P2(s.b);
        const ci = s.m && circleThrough(s.a, s.m, s.b);
        if (!s.m || !ci) {
          if (Math.hypot(b2.x - a.x, b2.y - a.y) > 1e-9) out.push({ id: id(), kind: "line", a, b: b2, role });
          continue;
        }
        const deg = (p) => Math.atan2(p[1] - ci.c[1], p[0] - ci.c[0]) * 180 / Math.PI;
        const left = (s.m[0] - s.a[0]) * (s.b[1] - s.m[1]) - (s.m[1] - s.a[1]) * (s.b[0] - s.m[0]) > 0;
        out.push({ id: id(), kind: "arc", c: P2(ci.c), r: ci.r, start: norm(deg(left ? s.a : s.b)), end: norm(deg(left ? s.b : s.a)), role });
      }
      return { entities: out, w: b.x1 - b.x0, h: b.y1 - b.y0 };
    }
  };
  var SLOT_LENGTH = 25;
  var MIN_WEB = 1;
  var MIN_DIVIDE_A = 100;
  var START = 90;
  var ROWS = [
    [80, 111, 25, 9, 4, 5, "M6", 4, 8],
    [100, 131, 25, 9, 4, 5, "M6", 4, 8],
    [120, 151, 25, 9, 6, 5, "M6", 6, 8],
    [140, 170, 25, 9, 6, 5, "M6", 6, 8],
    [150, 180, 25, 9, 6, 5, "M6", 6, 8],
    [160, 190, 25, 9, 6, 5, "M6", 6, 8],
    [170, 200, 25, 9, 6, 5, "M6", 6, 8],
    [180, 210, 25, 9, 6, 5, "M6", 6, 8],
    [200, 230, 25, 9, 6, 5, "M6", 6, 8],
    [210, 240, 30, 9, 6, 5, "M6", 6, 8],
    [220, 255, 30, 9, 6, 5, "M6", 6, 8],
    [240, 275, 30, 9, 6, 5, "M6", 6, 8],
    [250, 285, 30, 9, 6, 5, "M6", 6, 8],
    [260, 295, 30, 9, 6, 5, "M6", 6, 8],
    [270, 305, 30, 9, 6, 5, "M6", 6, 8],
    [280, 315, 30, 9, 6, 5, "M6", 6, 8],
    [300, 335, 30, 9, 6, 5, "M6", 6, 8],
    [320, 355, 30, 9, 8, 5, "M6", 8, 8],
    [330, 365, 30, 9, 8, 5, "M6", 8, 8],
    [340, 375, 30, 9, 8, 5, "M6", 8, 8],
    [360, 395, 30, 9, 8, 5, "M6", 8, 8],
    [370, 405, 30, 9, 8, 5, "M6", 8, 8],
    [380, 415, 30, 9, 8, 5, "M6", 8, 8],
    [400, 435, 30, 11, 10, 8, "M8", 10, 10],
    [420, 455, 30, 11, 10, 8, "M8", 10, 10],
    [440, 475, 30, 11, 10, 8, "M8", 10, 10],
    [450, 485, 30, 11, 10, 8, "M8", 10, 10],
    [470, 505, 30, 11, 10, 8, "M8", 10, 10],
    [480, 515, 30, 11, 10, 8, "M8", 10, 10],
    [500, 535, 30, 11, 10, 8, "M8", 10, 10],
    [520, 555, 30, 11, 10, 8, "M8", 10, 10],
    [530, 565, 30, 11, 12, 8, "M8", 12, 10],
    [540, 575, 30, 11, 12, 8, "M8", 12, 10],
    [550, 585, 30, 11, 12, 8, "M8", 12, 10],
    [570, 605, 30, 11, 12, 8, "M8", 12, 10],
    [600, 635, 30, 11, 12, 8, "M8", 12, 10],
    [620, 655, 30, 11, 12, 8, "M8", 12, 10],
    [650, 685, 30, 11, 15, 8, "M8", 12, 10],
    [670, 705, 30, 11, 15, 8, "M8", 12, 10],
    [720, 755, 30, 11, 15, 8, "M8", 12, 10],
    [750, 795, 40, 11, 16, 8, "M10", 16, 15],
    [780, 825, 40, 11, 16, 8, "M10", 16, 15],
    [800, 845, 40, 11, 16, 8, "M10", 16, 15],
    [820, 865, 40, 11, 16, 8, "M10", 16, 15]
  ];
  var FLANGE_SIZES = ROWS.map((r) => r[0]);
  function rowFor(a) {
    const exact = ROWS.find((r2) => Math.abs(r2[0] - a) < 1e-9);
    const r = exact ?? [...ROWS].reverse().find((q) => q[0] < a) ?? ROWS[0];
    return { r, b: exact ? r[1] : a + (r[1] - r[0]), exact: !!exact };
  }
  function flangeFor(a, keep) {
    const { r, b } = rowFor(a);
    return { a, b, e: r[2], m: r[3], n: r[4], t: r[5], whole: keep?.whole ?? true, divided: keep?.divided ?? false };
  }
  function threadFlangeFor(a, keep) {
    const { r, b } = rowFor(a);
    return { a, b, e: r[2], m: r[6], n: r[7], t: r[8], mark: keep?.mark ?? 10, whole: keep?.whole ?? true, divided: keep?.divided ?? false };
  }
  var FLANGE_DEFAULTS = flangeFor(400);
  var THREAD_FLANGE_DEFAULTS = threadFlangeFor(400);
  var canDivide = (a, n) => a > MIN_DIVIDE_A + 1e-9 && n >= 3;
  var slotHalf = (b) => Math.asin(Math.min(1, SLOT_LENGTH / 2 / (b / 2)));
  function common(v) {
    const e = [];
    if (!(v.a > 0)) e.push("A must be greater than 0");
    if (!(v.e > 0)) e.push("E must be greater than 0");
    if (!(v.n >= 1) || !Number.isInteger(v.n)) e.push("N: a whole number, 1 or more");
    if (!v.whole && !v.divided) e.push("Pick at least one: Whole, Divided");
    if (v.divided && v.a > 0 && v.n >= 1 && !canDivide(v.a, v.n)) e.push("Only flanges over A 100 with 3 holes or more are divided");
    return e;
  }
  function flangeProblems(v) {
    const e = common(v);
    if (!(v.m > 0)) e.push("M must be greater than 0");
    if (!(v.b > SLOT_LENGTH)) e.push(`B is too small for a ${SLOT_LENGTH} mm slot`);
    if (e.length) return e;
    const rb = v.b / 2, w = v.m / 2;
    if (rb - w < v.a / 2 + MIN_WEB) e.push("The slots cut into the inner edge: B - M must be larger than A");
    if (rb + w > v.a / 2 + v.e - MIN_WEB) e.push("The slots cut into the outer edge: B + M must be smaller than D = A + 2E");
    const half = slotHalf(v.b) + Math.asin(Math.min(1, w / (rb - w)));
    if (v.n > 1 && 2 * half + MIN_WEB / rb >= 2 * Math.PI / v.n) e.push(`${v.n} slots do not fit on the B circle: use fewer`);
    if (v.divided && clearance(v.n, v.b, SLOT_LENGTH / 2 + w) < 0) e.push("A cut runs through a slot: change N");
    return e;
  }
  var firstCut = (n) => START + 180 / n;
  var holesBetween = (n, a0, a1) => {
    const out = [];
    for (let k = 0; k < n; k++) {
      const rel = ((START + 360 / n * k - a0) % 360 + 360) % 360;
      if (rel > 1e-9 && rel < a1 - a0 - 1e-9) out.push(k);
    }
    return out;
  };
  function plan(n) {
    const c0 = firstCut(n);
    if (n % 3 === 0) return [{ key: "S", label: "section", qty: 3, a0: c0, a1: c0 + 120, holes: holesBetween(n, c0, c0 + 120) }];
    return [
      { key: "SA", label: "section A", qty: 2, a0: c0, a1: c0 + 120, holes: holesBetween(n, c0, c0 + 120) },
      { key: "SB", label: "section B", qty: 1, a0: c0 + 120, a1: c0 + 240, holes: holesBetween(n, c0 + 120, c0 + 240) }
    ];
  }
  function clearance(n, b, halfExtent) {
    const c0 = firstCut(n);
    let worst = Infinity;
    for (const c of [c0, c0 + 120, c0 + 240]) for (let k = 0; k < n; k++) {
      const d = Math.abs(((c - (START + 360 / n * k) + 180) % 360 + 360) % 360 - 180);
      worst = Math.min(worst, d * Math.PI / 180 * (b / 2) - halfExtent);
    }
    return worst;
  }
  var P = (r, deg) => [r * Math.cos(deg * Math.PI / 180), r * Math.sin(deg * Math.PI / 180)];
  var arcRun = (r, a0, a1) => {
    const k = Math.max(1, Math.ceil(Math.abs(a1 - a0) / 90));
    return Array.from({ length: k }, (_, i) => seg(P(r, a0 + (a1 - a0) * i / k), P(r, a0 + (a1 - a0) * (i + 1) / k), P(r, a0 + (a1 - a0) * (i + 0.5) / k)));
  };
  var sector = (rIn, rOut, a0, a1) => [...arcRun(rOut, a0, a1), seg(P(rOut, a1), P(rIn, a1)), ...arcRun(rIn, a1, a0), seg(P(rIn, a0), P(rOut, a0))];
  function slot(b, m, deg) {
    const rb = b / 2, w = m / 2, h = slotHalf(b) * 180 / Math.PI, a0 = deg - h, a1 = deg + h;
    const cap = (aEnd, out) => {
      const [ex, ey] = P(rb, aEnd), r = aEnd * Math.PI / 180, rx = Math.cos(r), ry = Math.sin(r), tx = -ry * out, ty = rx * out;
      return seg([ex + rx * w, ey + ry * w], [ex - rx * w, ey - ry * w], [ex + tx * w, ey + ty * w]);
    };
    const c0 = cap(a0, -1);
    return [seg(P(rb + w, a0), P(rb + w, a1), P(rb + w, deg)), cap(a1, 1), seg(P(rb - w, a1), P(rb - w, a0), P(rb - w, deg)), seg(c0.b, c0.a, c0.m)];
  }
  function ring(v, hole) {
    const rIn = v.a / 2, rOut = v.a / 2 + v.e, out = [];
    const hDeg = (k) => START + 360 / v.n * k;
    if (v.whole) {
      const L = new Lines().circle([0, 0], rOut).circle([0, 0], rIn);
      for (let k = 0; k < v.n; k++) hole(L, hDeg(k), (p) => p);
      out.push({ key: "W", label: "whole", qty: 1, lines: L });
    }
    if (v.divided && canDivide(v.a, v.n)) for (const s of plan(v.n)) {
      const rot = (90 - (s.a0 + s.a1) / 2) * Math.PI / 180, co = Math.cos(rot), sn = Math.sin(rot);
      const tr = ([x, y]) => [x * co - y * sn, x * sn + y * co];
      const L = new Lines().segs(sector(rIn, rOut, s.a0, s.a1).map((q) => seg(tr(q.a), tr(q.b), q.m && tr(q.m))));
      for (const k of s.holes) hole(L, hDeg(k), tr);
      out.push({ key: s.key, label: s.label, qty: s.qty, lines: L });
    }
    return out;
  }
  function flangePieces(v) {
    return ring(v, (L, deg, tr) => L.segs(slot(v.b, v.m, deg).map((q) => seg(tr(q.a), tr(q.b), q.m && tr(q.m)))));
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
  var values = (v) => {
    const std = flangeFor(v.a, v);
    return v.table ? std : { ...std, b: v.b, m: v.m, e: v.e, n: v.n };
  };
  var sizeNote = "From the table: B, E, N (and the slot width or thread) for A from the standard sizes, A80 … A820 (an A between two sizes: as the smaller one). Untick to enter them.";
  var pieceFields = (what) => [
    { key: "whole", type: "check", label: "Combined", title: "The whole ring in one piece", group: "Pieces", default: true },
    {
      key: "divided",
      type: "check",
      label: "Divided (3 × 120°)",
      title: `Three 120° sections, the first cut midway between the top ${what} and the next`,
      group: "Pieces",
      default: false,
      note: `Only flanges over A 100 with 3 ${what}s or more are divided.`
    }
  ];
  var tool = {
    manifest: {
      id: "flange",
      name: "Flange",
      countLabel: "Flanges",
      description: "A flat ring with N arc slots (25 mm) on the B circle, sizes from the standard table; whole or in three 120° sections. From the HVAC Fittings workbench.",
      fields: [
        { key: "table", type: "check", label: "Sizes from the table", group: "Size", default: true, note: sizeNote },
        { key: "a", type: "number", label: "A", title: "A: inner (nominal) diameter", unit: "mm", default: 400, min: 0, at: [37, 58], color: "blue" },
        { key: "b", type: "number", label: "B", title: "B: diameter the slots lie on (not from the table)", unit: "mm", default: 435, min: 0, at: [64, 22], color: "green" },
        { key: "m", type: "number", label: "M", title: "M: slot width (not from the table)", unit: "mm", default: 11, min: 0, at: [37, 9], color: "purple" },
        { key: "e", type: "number", label: "E", title: "E: ring width (not from the table)", unit: "mm", default: 30, min: 0, at: [84, 51], color: "brown" },
        { key: "n", type: "int", label: "N", title: "N: number of slots (not from the table)", unit: "slots", default: 10, min: 0, at: [84, 70], color: "dark" },
        ...pieceFields("slot")
      ],
      note: "D = A + 2E. The parts' label says the thickness the table recommends."
    },
    problems: (v) => flangeProblems(values(v)),
    title: (v) => `FL A${g(v.a)}`,
    parts: (v, gz) => {
      const f = values(v);
      return toParts(flangePieces(f), gz, (p) => `${p.label}, D ${g(f.a + 2 * f.e)}, T ${g(f.t)} recommended`);
    }
  };
  return __toCommonJS(stdin_exports);
})();

function problems(v) { return FIT.T.problems(v); }
function title(v) { return FIT.T.title(v); }
function parts(v, gz) { return FIT.T.parts(v, gz); }
