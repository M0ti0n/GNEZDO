import type { Drawing, Entity, Role } from "./geometry";

// Hand-made sample drawings until DXF reading (the import worker) exists.
// A 400 x 250 mm plate with three deliberate faults so every check shows something:
//   - the outside contour has a 0.4 mm gap at the bottom-left corner,
//   - the slot is not closed (its left arc stops short),
//   - the cut-out on the right is drawn with a spline.
let n = 0;
const id = () => `e${++n}`;
const line = (x1: number, y1: number, x2: number, y2: number, role?: Role): Entity =>
  ({ id: id(), kind: "line", a: { x: x1, y: y1 }, b: { x: x2, y: y2 }, role });
/** Tracing (engraving) polyline through the given points. */
const trace = (...p: number[]): Entity[] =>
  Array.from({ length: p.length / 2 - 1 }, (_, i) => line(p[2 * i], p[2 * i + 1], p[2 * i + 2], p[2 * i + 3], "trace"));
const arc = (cx: number, cy: number, r: number, start: number, end: number): Entity => ({ id: id(), kind: "arc", c: { x: cx, y: cy }, r, start, end });
const circle = (cx: number, cy: number, r: number): Entity => ({ id: id(), kind: "circle", c: { x: cx, y: cy }, r });

export const sampleDrawing: Drawing = {
  id: "sample-1625-25-01_P1",
  fileName: "1625-25-01_P1_3kos",
  entities: [
    // outside, corner radius 20
    line(20, 0, 380, 0),
    arc(380, 20, 20, 270, 360),
    line(400, 20, 400, 230),
    arc(380, 230, 20, 0, 90),
    line(380, 250, 20, 250),
    arc(20, 230, 20, 90, 180),
    line(0, 230, 0, 20.4),            // stops 0.4 mm short of the corner arc
    arc(20, 20, 20, 180, 270),
    // fixing holes
    circle(40, 40, 9), circle(360, 40, 9), circle(40, 210, 9), circle(360, 210, 9),
    // centre hole
    circle(130, 125, 45),
    // slot 80 x 20, left end open
    line(250, 70, 330, 70),
    arc(330, 80, 10, 270, 90),
    line(330, 90, 250, 90),
    arc(250, 80, 10, 90, 255),
    // cut-out closed by a spline
    line(230, 160, 340, 160),
    { id: id(), kind: "spline", fit: [
      { x: 340, y: 160 }, { x: 325, y: 200 }, { x: 295, y: 188 }, { x: 262, y: 212 }, { x: 238, y: 192 }, { x: 230, y: 160 },
    ] },
    // marking "P1" (tracing)
    ...trace(170, 30, 170, 60, 184, 60, 188, 55, 188, 49, 184, 45, 170, 45),
    ...trace(196, 55, 203, 60, 203, 30),
    // relief slit from the right edge (open cut)
    line(400, 125, 372, 125, "openCut"),
  ],
};

// A clean part (all checks pass) so Process can be tried: 300 x 180 mm plate
// with two holes, a tracing mark and two open cut slits.
export const cleanDrawing: Drawing = {
  id: "sample-1625-25-01_P2",
  fileName: "1625-25-01_P2_5kos",
  entities: [
    line(0, 0, 300, 0), line(300, 0, 300, 180), line(300, 180, 0, 180), line(0, 180, 0, 0),
    circle(60, 90, 22), circle(240, 90, 22),
    line(150, 0, 150, 40, "openCut"), line(150, 180, 150, 140, "openCut"),
    ...trace(120, 80, 120, 100, 132, 100, 135, 96, 135, 92, 132, 88, 120, 88),
    ...trace(141, 97, 145, 100, 152, 100, 155, 97, 155, 94, 141, 80, 155, 80),
    ...trace(162, 90, 178, 90), ...trace(170, 82, 170, 98),
  ],
};

export const sampleDrawings = [sampleDrawing, cleanDrawing];
