// GNEZDO postprocessor: LVD laser (Axel 3015-S), written in the form of the laser's own programs
// (absolute mm, the machine's macros do the cutting cycle).
//
// Main program :0100 sets the sheet and the technology, then places the parts:
//   N50 M98P<tech>(TECH-MM)                      the Technology row's "Tech program" (e.g. 6050)
//   N101 G980 S101 X5 Y5 R0 T1 D2                part's subprogram S at X Y (T2: its marking)
// Each part is a subprogram (:0101, :0102, ...; parts cut the same way share one), coordinates from
// the part's corner (its box, lower X and Y). A part with marking gets two: its marking (T2) and its
// cutting (T1); all marking is placed before the first cut (a T2 subprogram with cuts in it does not
// run with pre-pierce on).
//   N10 G0 X.. Y..            rapid to the pierce point (G0 G40 from the second contour on); Process →
//                             Movement's points first, one G0 each (the part then has a subprogram
//                             of its own: the moves between parts are the machine's, made at G980)
//   M98P8036                  pierce (after a micro joint: M98P8037 quick pierce when the row's MJ
//                             restart says quick or none)
//   IF[#516GT0]GOTO19         pre-pierce pass (#516 = the row's "Pre-pierce"): pierce only
//   G41                       kerf compensation (outlines and holes; not on open cuts)
//   G1 X.. Y.. E001           the first move (the lead-in) with the contour's size class:
//                             E001 big, E002 middle, E003 little (the row's "Middle up to" /
//                             "Little up to", the contour's longer side), E004 marking
//   N15 G1 / G2 / G3 ...      the contour (arcs: I J from the arc's start), then the lead-out
//   N19 G65P8041H#513         end of the contour
// Marking: IF[#516GT0]GOTO<next contour>, M98P8033, the moves with E004, no pierce, no G41.
// Numbers: up to 3 decimals, whole numbers without them (X535 Y0.5). Lines end in CR LF.

function postprocess(p) {
  const t = p.tech || {};
  const num = (v) => {
    let r = Math.round(v * 1000) / 1000;
    if (Math.abs(r) < 0.0005) r = 0;
    return String(r);
  };
  const text = (s) => String(s == null ? "" : s).replace(/[()%:;]/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
  const tech = Math.round(t.techProgram || 0);
  if (!tech) throw new Error(`no Tech program in the Technology row for ${p.sheet.material} ${p.sheet.thicknessMm} mm (Settings → Machines → Technology → Laser)`);

  // the contour's size class (its longer side, without leads)
  const eOf = (c) => {
    if (c.kind === "trace") return 4;
    if (c.kind === "open") return 1;
    const size = Math.max(c.widthMm, c.heightMm);
    if (t.littleSizeMm > 0 && size <= t.littleSizeMm + 0.01) return 3;
    if (t.midSizeMm > 0 && size <= t.midSizeMm + 0.01) return 2;
    return 1;
  };

  // parts: contours of one part (or one common cut block, or the remnant cuts) in a row are one unit
  const box = new Map((p.parts || []).map((q) => [q.no, q.box]));
  const units = [];
  for (const c of p.contours) {
    if (!c.segs.length) continue;
    const key = c.partNo !== undefined ? `p${c.partNo}` : c.partNos ? `b${c.partNos.join(",")}` : "rest";
    const last = units[units.length - 1];
    if (last && last.key === key && last.contours.length < 999) last.contours.push(c);
    else units.push({ key, contours: [c], name: c.partNo !== undefined ? c.part : c.partNos ? "COMMON CUT" : c.part || "CUT" });
  }

  // the unit's corner: the part's box, else the lowest X and Y of its contours
  for (const u of units) {
    const b = u.key[0] === "p" ? box.get(u.contours[0].partNo) : undefined;
    let ox, oy;
    if (b) { ox = b.minX; oy = b.minY; }
    else {
      ox = Infinity; oy = Infinity;
      for (const c of u.contours) {
        // the contour itself: from where the lead-in ends to where the lead-out starts
        const pts = [c.leadIn ? c.segs[c.leadIn - 1].to : c.start, ...c.segs.slice(c.leadIn, c.segs.length - c.leadOut).map((s) => s.to)];
        for (const q of pts) { ox = Math.min(ox, q.x); oy = Math.min(oy, q.y); }
      }
    }
    u.ox = Math.round(ox * 1000) / 1000; u.oy = Math.round(oy * 1000) / 1000;
  }

  // A part's marking and its cutting are two subprograms: marking only (T2) and cutting only (T1),
  // every marking placed before the first cut. A T2 subprogram with pierced cuts in it does not
  // run with pre-pierce on (#516=1).
  const subs = new Map();   // body text -> { no, marking, name, body }
  const placed = [];
  let nextSub = 101;
  const place = (u, contours, marking) => {
    if (!contours.length) return;
    const X = (v) => num(v - u.ox), Y = (v) => num(v - u.oy);
    const body = [];
    contours.forEach((c, i) => {
      const n = (i + 1) * 10;
      const e = eOf(c);
      // the rapid to the pierce point, through Movement's points first (the first block carries N:
      // a restart at this contour goes the same way)
      const to = [...(c.via || []), c.start];
      to.forEach((q, j) => body.push(j ? `G0 X${X(q.x)} Y${Y(q.y)}` : `N${n} G0 ${i ? "G40 " : ""}X${X(q.x)} Y${Y(q.y)}`));
      if (marking) body.push(`IF[#516GT0]GOTO${n + 10}`, "M98P8033");
      else {
        // after a micro joint (no lead-in): the row's MJ restart; quick pierce (M98P8037) also stands
        // for "no pierce" until the controller's own way of starting without one is known
        body.push(c.restart === "quick" || c.restart === "none" ? "M98P8037" : "M98P8036", `IF[#516GT0]GOTO${n + 9}`);
        if (c.kind !== "open") body.push("G41");
      }
      // N?5 marks the first move of the contour itself (after the lead-in)
      const at5 = marking ? -1 : Math.max(c.leadIn, 1);
      let pos = c.start;
      c.segs.forEach((s, k) => {
        let line = s.k === "line"
          ? `G1 X${X(s.to.x)} Y${Y(s.to.y)}`
          : `${s.cw ? "G2" : "G3"} X${X(s.to.x)} Y${Y(s.to.y)} I${num(s.c.x - pos.x)} J${num(s.c.y - pos.y)}`;
        if (k === 0) line += ` E00${e}`;
        if (k === at5) line = `N${n + 5} ${line}`;
        body.push(line);
        pos = s.to;
      });
      body.push(`N${n + 9} G65P8041H#513`);
    });
    // the last marking jumps past the end: the end gets its number
    body.push(marking ? `N${contours.length * 10 + 10} M98P8045` : "M98P8045");

    const k = body.join("\n");
    let sub = subs.get(k);
    if (!sub) {
      if (nextSub > 5999) throw new Error("more than 5899 different subprograms on one sheet");
      sub = { no: nextSub++, marking, name: text(u.name) || "PART", body };
      subs.set(k, sub);
    }
    placed.push({ sub, x: u.ox, y: u.oy });
  };
  for (const u of units) place(u, u.contours.filter((c) => c.kind === "trace"), true);
  for (const u of units) place(u, u.contours.filter((c) => c.kind !== "trace"), false);
  if (placed.length > 8998) throw new Error("more than 8998 parts on one sheet");

  const L = p.sheet.lengthMm, W = p.sheet.widthMm, th = p.sheet.thicknessMm;
  const marking = [...subs.values()].some((s) => s.marking);
  const out = [
    "%",
    `:0100(${text(p.name) || "GNEZDO"})`,
    "G0 G40",
    "M98P8080",
    `(MAT = ${text(p.sheet.material)} * ${num(th)} MM)`,
    `(LAMIERA = X${num(L)} * Y${num(W)})`,
    "(GNEZDO LVD LASER POSTPROCESSOR 1)",
    "#521=0(SHEET MEASUREMENT)",
    "#519=0(SHIFTING X)",
    "#520=0(SHIFTING Y)",
    `#515=${num(L)}(X-SHEET MEASUREMENT)`,
    `#708=${num(L)}(X)`,
    `#709=${num(W)}(Y)`,
    `#710=${num(th)}(THICKNESS)`,
    "#512=1(MACH-MM)",
    `#128=${marking ? 1 : 0}(TRACING CYCLE)`,
    "#129=0(FILM)",
    "#514=30(Z AFTER CONTOUR)",
    "#633=20(FAST Z-HEIGHT)",
    `#516=${t.prePierce ? 1 : 0}(PRE-CUTTING HOLES)`,
    "#916=#516",
    "#517=1(SHEET MEASUREMENT Z-POS.)",
    "#526=0(MAX G0-DIST. Z-DOWN)",
    `N50 M98P${tech}(TECH-MM)`,
    "M98P8010",
    "G920X0 Y0 A#708B#709R0",
    "N100 GOTO[#530+100]",
  ];
  placed.forEach((q, i) => out.push(`N${101 + i} G980 S${q.sub.no} X${num(q.x)} Y${num(q.y)} R0 T${q.sub.marking ? 2 : 1} D2`));
  out.push("N9100 M98P8047", "M98P8048", "IF[#516EQ-1]GOTO100", "M98P8050", "M30");
  for (const s of subs.values()) {
    out.push(`:${String(s.no).padStart(4, "0")}(${s.name})`, "(V7-17-3)", "#513=30", "G65P8060", "GOTO[#529*10]", ...s.body, "N9999 M99");
  }
  out.push("%");
  return out.join("\r\n");
}
