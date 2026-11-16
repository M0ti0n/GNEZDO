// Mounting plate: the example tool of SPECIAL TOOLS/README.md.
// v holds the values of tool.json's fields by key: v.w, v.h, v.r, v.d, v.e, v.holes, v.center, v.dc, v.cross, v.crossLen

function problems(v) {
  const p = [];
  if (v.r > Math.min(v.w, v.h) / 2) p.push("R must be at most half of W and of H");
  if (v.holes > 0 && v.e - v.d / 2 < 1) p.push("E must be more than D / 2 (the holes would break the edge)");
  if (v.holes > 0 && 2 * v.e + v.d > Math.min(v.w, v.h)) p.push("The holes overlap: W and H must be at least 2 × E + D");
  if (v.center && v.dc >= Math.min(v.w, v.h) - 2) p.push("The center hole is as big as the plate");
  return p;
}

function title(v) {
  return `PLATE ${gz.round(v.w, 1)}x${gz.round(v.h, 1)}`;
}

function parts(v, gz) {
  const p = gz.part("plate");            // one part per plate
  p.rect(0, 0, v.w, v.h, v.r);           // the outline (lower left at 0, 0)

  const r = v.d / 2;
  if (v.holes >= 4) {
    p.circle(v.e, v.e, r);
    p.circle(v.w - v.e, v.e, r);
    p.circle(v.w - v.e, v.h - v.e, r);
    p.circle(v.e, v.h - v.e, r);
  }
  if (v.holes === 6) {
    p.circle(v.w / 2, v.e, r);
    p.circle(v.w / 2, v.h - v.e, r);
  }
  if (v.center) p.circle(v.w / 2, v.h / 2, v.dc / 2);

  if (v.cross) {                          // tracing lines (role "trace"), not cut
    const c = v.crossLen / 2;
    p.mark(v.w / 2 - c, v.h / 2, v.w / 2 + c, v.h / 2);
    p.mark(v.w / 2, v.h / 2 - c, v.w / 2, v.h / 2 + c);
  }
  return [p];
}
