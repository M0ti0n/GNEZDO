import type { Drawing, Entity } from "./geometry";

// Hand-made sample drawing until DXF reading (the import worker) exists.
// A 400 x 250 mm plate with three deliberate faults so every check shows something:
//   - the outside contour has a 0.4 mm gap at the bottom-left corner,
//   - the slot is not closed (its left arc stops short),
//   - the cut-out on the right is drawn with a spline.
let n = 0;
const id = () => `e${++n}`;
const line = (x1: number, y1: number, x2: number, y2: number): Entity => ({ id: id(), kind: "line", a: { x: x1, y: y1 }, b: { x: x2, y: y2 } });
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
  ],
};
