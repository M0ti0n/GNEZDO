// GNEZDO postprocessor: HACO KOMPAKT plasma (ISO, incremental), the output of HACO's own
// postprocessor (mpp macros) rewritten for GNEZDO.
//
//   %1 "<name>"
//   N2 G00 G40 G90 G23 F<speed> X<x> Y<y>            first rapid: absolute, to the first pierce point
//   N4 G91 G41 D02 F<feed> G01 X.. Y.. M07 M50      lead-in, torch on (D01 outline, D02 holes), then G91
//   N6 G01 X.. Y.. / G02|G03 X.. Y.. I.. J..        contour, incremental; I J = center - start
//   N8 M09                                          torch off (after an arc: on the arc's block)
//   N10 G00 G40 X.. Y..                             rapid to the next pierce point (one block per point
//                                                    of Process → Movement first, if the rapid has any)
//   ...
//   Nn G00 G40 X.. Y..                              back to 0,0
//   Nn M30
//   *
//
// Feed: outline = cutting speed; a hole whose (width + height) / 2 is up to "small hole up to" (or
// the contour says so: c.small, e.g. marked as a hole in the importer) = small-hole speed. F is written at every lead-in (after a rapid).
// Restart (after a micro joint, an inline cut's stretch, a common pierce's hole): pierced again as any
// contour (M07 M50): HACO's own macros have no quick pierce and no start without one.
// Numbers: 3 decimals, whole numbers without them (X17, X-1.300). A full circle is one block (X0 Y0).
// Stops (from the imported table, if set): S25 stop at the lead-out [s], S31 stop at a corner [s]
// sharper than S92 [°].
// Restart help: postprocess also returns, for every contour, the block (N) of its rapid to the pierce
// point and the pierce point from 0,0 (the program is incremental: a restart there needs the
// control's own block restart that finds the position).

function postprocess(p, nc) {
  const lines = [];
  let n = 0;
  const N = (s) => { n += 2; lines.push(`N${n} ${s}`); };
  const num = (v) => {
    let r = Math.round(v * 1000) / 1000;
    if (Object.is(r, -0) || Math.abs(r) < 0.0005) r = 0;
    return Number.isInteger(r) ? String(r) : r.toFixed(3);
  };
  const t = p.tech || {};
  const extra = t.extra || {};
  const speed = Math.round(t.speed || 0);
  const stopOut = extra.S25 || 0, stopCorner = extra.S31 || 0, stopAngle = extra.S92 || 0;

  // F is written at every lead-in (after every rapid), as HACO's own postprocessor does; the small-hole
  // speed is for holes only (inner contours), as in its feed macro: an open cut, a remnant cut or a
  // common cut line is cut at the cutting speed
  const feedOf = (c) => {
    // the contour's own choice (a hole marked in the importer, or changed by hand) wins over the size rule
    const hole = c.kind === "inner";
    const small = hole && (c.small ?? (t.smallHoleMm > 0 && (c.widthMm + c.heightMm) <= 2 * t.smallHoleMm));
    return Math.round(small && t.smallHoleSpeed ? t.smallHoleSpeed : t.speed);
  };

  lines.push(`%1 "${p.name}"`);
  let pos = { x: 0, y: 0 };
  let first = true;
  const counters = p.contours.map(() => null);
  p.contours.forEach((c, ci) => {
    if (!c.segs.length) return;
    counters[ci] = { block: n + 2, at: { x: c.start.x, y: c.start.y } };
    const feed = feedOf(c);
    // rapid to the pierce point (through Movement's points first, if it has any); the first rapid is
    // absolute (G90 until the lead-in's G91)
    [...(c.via || []), c.start].forEach((q, j, all) => {
      if (first) N(j === 0 ? `G00 G40 G90 G23 F${speed} X${num(q.x)} Y${num(q.y)}` : `G00 X${num(q.x)} Y${num(q.y)}`);
      else N(`G00 G40 X${num(q.x - pos.x)} Y${num(q.y - pos.y)}`);
      if (j < all.length - 1) pos = q;
    });
    pos = c.start;
    // open cuts (and remnant cuts) without kerf compensation
    // an inline cut's stretch cut against its contour's direction: compensation right (G42)
    const comp = c.kind === "open" ? "" : `${c.rev ? "G42" : "G41"} ${c.kind === "inner" ? "D02" : "D01"} `;
    let head = `${first ? "G91 " : ""}${comp}F${feed} `;
    let lastArc = false;
    first = false;
    let prevDir = null;
    const emit = (txt) => {
      if (head !== null) { N(`${head}${txt} M07 M50`); head = null; }
      else N(txt);
    };
    c.segs.forEach((s, i) => {
      if (s.k === "line") {
        const dx = s.to.x - pos.x, dy = s.to.y - pos.y;
        if (Math.hypot(Math.round(dx * 1000) / 1000, Math.round(dy * 1000) / 1000) < 0.01) return;
        // a stop at a sharp corner (between two cutting lines)
        const dir = Math.atan2(dy, dx) * 180 / Math.PI;
        if (stopCorner && prevDir !== null && i > 1) {
          let turn = Math.abs(dir - prevDir) % 360; if (turn > 180) turn = 360 - turn;
          if (180 - turn < stopAngle) lines.push(` G04 Q${Math.round(stopCorner * 100)}`);
        }
        prevDir = dir;
        emit(`G01 X${num(dx)} Y${num(dy)}`);
        lastArc = false;
      } else {
        // arc (a full circle in one block: X0 Y0)
        prevDir = null;
        emit(`${s.cw ? "G02" : "G03"} X${num(s.to.x - pos.x)} Y${num(s.to.y - pos.y)} I${num(s.c.x - pos.x)} J${num(s.c.y - pos.y)}`);
        lastArc = true;
      }
      pos = s.to;
    });
    // torch off: on the last arc's block, or a block of its own after a line
    if (stopOut) lines.push(`G04 Q ${Math.round(stopOut * 100)} M09`);
    else if (lastArc) lines[lines.length - 1] += " M09";
    else N("M09");
  });
  N(`G00 G40 X${num(-pos.x)} Y${num(-pos.y)} `);
  N("M30");
  lines.push("*");
  return { text: lines.join("\r\n") + "\r\n", counters };
}
