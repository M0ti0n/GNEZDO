# SPECIAL TOOLS

Special tools make parts from values: the fittings come built in, and more can be added as **plug-in tools**, without a new GNEZDO build. A tool only says what values it asks for and how its parts are drawn. GNEZDO shows its form, its parts and the preview, and sends the parts to Import 2D like the fittings' parts.

| Here | What |
|---|---|
| `mounting-plate/` | The example tool: a plate with rounded corners, bolt holes and an optional center hole. Start a new tool from a copy of it. |
| `mounting-plate.gnezdo-tool.zip` | The same, ready to add. |

## Adding a tool

- **Settings → Special tools → Add tool…** and pick a `.gnezdo-tool.zip`. The tool is kept in GNEZDO's database, so on the server everyone has it and backups carry it. On the server only an admin can add, remove or switch tools.
- **Desktop:** a tool can also be a folder (or a zip) in the **tools folder**, `%LOCALAPPDATA%\GNEZDO\tools` (Settings → Special tools → Open tools folder). After changing its files, click **Reload**. This is the quick way to write a tool. Folders starting with `_` or `.` are skipped. A tools-folder tool wins over an added one with the same id.
- **On** switches a tool out of the Special tools strip without removing it. **Export** saves any tool as a `.gnezdo-tool.zip`, to pass on.
- The same id again replaces the tool (a newer version).

## The files

```
my-tool/
  tool.json     what it is and what it asks for
  tool.js       the math
  icon.svg      optional: its button in the strip (48 × 48)
  diagram.svg   optional: the picture its value boxes sit on (300 × 220)
```

A tool's files together may be at most 512 KB. In the `.gnezdo-tool.zip` the files sit at the top, or in one folder.

## tool.json

```json
{
  "format": "gnezdo-tool",
  "version": 1,
  "id": "mounting-plate",
  "name": "Mounting plate",
  "toolVersion": "1.0",
  "description": "One line for Settings → Special tools.",
  "countLabel": "Plates",
  "icon": "icon.svg",
  "diagram": "diagram.svg",
  "fields": [
    { "key": "w", "type": "number", "label": "W", "title": "W: width", "unit": "mm", "default": 300, "min": 1, "at": [50, 7], "color": "blue" },
    { "key": "holes", "type": "choice", "label": "Bolt holes", "group": "Holes", "default": 4,
      "options": [ { "value": 0, "label": "None" }, { "value": 4, "label": "4 corners" } ] },
    { "key": "center", "type": "check", "label": "Center hole", "group": "Holes", "default": false }
  ],
  "note": "A note under the form."
}
```

| Key | |
|---|---|
| `format`, `version` | Always `"gnezdo-tool"` and `1`. A GNEZDO that is too old for a tool says so. |
| `id` | Lowercase letters, digits and dashes. It is the tool's identity: the same id again replaces it. |
| `name` | Its name on the button and the panel. |
| `toolVersion`, `author`, `description` | Shown in Settings → Special tools. |
| `countLabel` | What the "how many" field is called (default "Pieces"). |
| `script` | The script's file name (default `tool.js`). |
| `icon`, `diagram` | Optional SVG files (shown as pictures: they cannot run anything). |
| `fields` | The values it asks for, in order. |
| `note` | A note at the end of the form. |

A field:

| Key | |
|---|---|
| `key` | The name the script reads it by (`v.w`). Letters, digits and `_`. |
| `type` | `number`, `int` (whole number), `check` (true / false), `choice` (buttons, from `options`), `text`. |
| `label` | Short: on the value box ("W") or before the input ("Bolt holes"). |
| `title` | The longer explanation, shown on hover ("W: width"). |
| `unit` | After the value ("mm", "°"). |
| `default` | The starting value (and what Clear goes back to). |
| `min`, `max` | Limits of a `number` / `int`. |
| `at` | On the diagram: `[x %, y %]`, the center of the value box (only `number` and `int`, and only with a diagram). |
| `color` | The value box's color: `blue`, `green`, `purple`, `brown`, `red`, `dark`, `orange` (match the dimension line in the diagram). |
| `group` | Fields not on the diagram are listed under this heading. |
| `options` | For `choice`: `[{ "value": 4, "label": "4 corners" }, …]`. |
| `note` | A line of help under the field. |

## tool.js

```js
function parts(v, gz) {            // required: the parts for the values v
  const p = gz.part("plate");      // a part: its label, (how many per set: 1)
  p.rect(0, 0, v.w, v.h, v.r);     // drawn in mm, y up, anywhere (it is moved to 0, 0)
  p.circle(v.e, v.e, v.d / 2);
  return [p];                      // a list of parts, or just p
}

function problems(v) {             // optional: what is wrong with the values (nothing is drawn then)
  return v.d >= v.w ? ["D must be less than W"] : [];
}

function title(v) {                // optional: the parts' name ("PLATE 300x200"); default: the tool's name
  return `PLATE ${v.w}x${v.h}`;
}
```

`v` holds the fields' values by key. `gz` holds the helpers below. Plain JavaScript and `Math` work as usual.

**A part:** `gz.part(label, qty = 1, key)`. `qty` is how many of it one set needs (0: left out). `key` is optional; it is the end of the part's name when the tool makes more than one part (default A, B, C, …): "PLATE 300x200-A". Set `p.suffix = ""` to leave it off, or another text.

Drawing on a part (each returns the part, so calls can be chained):

| | |
|---|---|
| `p.line(x1, y1, x2, y2, role)` | A line. |
| `p.polyline([[x, y], …], closed, role)` | Straight lines through points (closed: back to the first). |
| `p.rect(x, y, w, h, r, role)` | A rectangle from its lower left corner, corners rounded `r`. |
| `p.circle(cx, cy, r, role)` | A circle. |
| `p.arc(cx, cy, r, start, end, role)` | An arc, counterclockwise from `start` to `end` (degrees, 0 = along +x). |
| `p.arc3([x, y], [x, y], [x, y], role)` | An arc from the first point through the second to the third. |
| `p.slot(x1, y1, x2, y2, width, role)` | An oblong hole between two centers. |
| `p.curve(f, x0, x1, role)` | The curve y = f(x) from x0 to x1, made of arcs within 0.01 mm: unfolded edges. |
| `p.through([[x, y], …], role)` | A smooth curve through many points, made of arcs within 0.01 mm. |
| `p.mark(x1, y1, x2, y2)` | A tracing (marking) line. |
| `p.foldMarks(x1, y1, x2, y2, length, gap)` | Fold marks on a fold line: `length` long, `gap` in from both ends. |

`role` is `"cut"` (default), `"trace"` (marking, may be open) or `"openCut"` (a cut that is open on purpose, a slit). The machines cut lines and arcs, so curves become arcs. A part's cutting lines must close, as for any drawing. Import 2D checks and processes the parts as usual.

Other helpers: `gz.sind(d)`, `gz.cosd(d)`, `gz.tand(d)`, `gz.asind(x)`, `gz.acosd(x)`, `gz.atan2d(y, x)` (degrees), `gz.rad(d)`, `gz.deg(r)`, `gz.PI`, `gz.round(x, digits = 2)`.

## The sandbox

A tool's script runs in the browser, in a background worker of its own, never on the server. Before its code runs, everything that reaches outside is taken away: the network, storage, the page, other workers, timers, and making code from text (`eval`, `Function`). The word `import` may not appear in a script. A run that takes more than 4 seconds is stopped (a loop that never ends cannot hang GNEZDO). At most 60 parts and 50,000 lines.

So a tool cannot see or change GNEZDO's data. It can only take its values and hand back lines.

## Writing one

1. Copy `mounting-plate/` into the tools folder, rename the folder, and change `id` and `name` in tool.json.
2. Open Special tools; the tool is there (after Settings → Special tools → Reload).
3. Change tool.js, click Reload, look at the preview. A mistake shows as "The tool failed: …" in the panel.
4. When it is done: Settings → Special tools → Export, and add the zip wherever it is needed.

Drawing the diagram: 300 × 220 units, the same look as the fittings (dark outline `#1b2a30`, light blue fill `#e7f1f8`, dimension lines in the field's color: blue `#1e8db5`, green `#4c9a2a`, purple `#8a4fb3`, brown `#a8683a`, red `#c2412d`, orange `#e98a15`). Then place each value box with `at`.
