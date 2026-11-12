# Changes by test build

Newest first. Each build is the `test-build` release; earlier builds (up to 7 Nov 2026) were made on every change to main.

## Next build

Nothing yet.

## Build 12 Nov 2026, second (`78ceca3`)

**New**
- Settings → Machines → Technology: **Remnant cut** columns per thickness: Gap in / Gap out (where a remnant cut starts and ends from the sheet edge it runs to: + inside the sheet, an uncut bridge; − beyond the edge), To parts (distance from the parts; empty = Settings → Stock → Remnants), Lead-in / Lead-out. Leads & cutting: the Remnant cut lead type (in line, 90°, at an angle; from the scrap side). Post process writes the remnant cuts with them
- POST PROCESSOR → HACO KOMPAKT plasma zip: hole lead-in 10 mm (12 mm sheet) and 13 mm (15 mm sheet), outline lead-in 13 mm (15 mm sheet); Remnant cut · To parts = outline lead-in + 3 mm (2–15 mm), + 5 mm (20–35 mm); Remnant cut gap in / out 4 mm inside the sheet; Remnant cut lead 90°. Import the zip again to get them
- Process → Remnant → **DELETE CUT**: a click on the remnant's own cut (red) or outline deletes the whole remnant (asks first); a click on an open cut (magenta) still deletes only that cut

## Build 12 Nov 2026 (`7ac0cbc`)

**New**
- Process → **Process del**: panel with DELETE REMNANT, DELETE CUT PATH and DELETE PROCESS (both) for the open sheet or the sheet selected among all sheets; asks first, UNDO DELETE brings it back
- Process → **Post process**: POST PROCESS SELECTED SHEET and POST PROCESS ALL SHEETS, one NC file per sheet named JOBNAME_# with the machine's postprocessor, written to the machine's NC folder (or downloaded). An unsaved job is saved first; for the selected sheet it asks before replacing a file of the same name, all sheets replace without asking. Spinner while it runs, "POST PROCESS successful" in the panel. A sheet needs its cut path (Auto cut); the remnant's cuts come last
- Settings → **Personal**: preferred job name prefix; a new job gets the next number after the newest run of three consecutive numbers (JOHN230 … JOHN233 → JOHN234)
- **Remnants** on the left rail: Remnant search (job name, material, thickness, project, created, modified, size X / Y; a turned remnant matches too) and the saved remnants as cards: name, EDIT (name, material, thickness, pieces), DELETE, its outline, size, material and thickness. A saved remnant keeps the projects of its sheet's parts and when it was saved and changed
- Remnant search panel: **Import remnant** (a remnant drawn in DXF or SVG; DWG: save as DXF first) with name, material, thickness, pieces and a note; click a remnant card to see its details there (size, weight, created and modified with how long ago, by whom, where it came from, projects) and its **note** (protective foil on top, badly scratched …), also in EDIT
- Home: IMPORT and NEW JOB on the toolbar (Import left the side rail; its badge counts the files waiting); no empty tool bar on screens without tools
- Process → **Remnant**: REMNANT panel (icon beside the title). Remnant mode: TRIM (a rough outline of the parts, straight edges, 90° to 270°, 45° corners where clear, no edge shorter than the minimum), RECTANGULAR (a cut across the whole sheet, a second up to it; along X or Y), SKELET (round the parts at the minimum distance, channels narrower than the smallest edge left out; windows in parts count). Remnant tools: CUT V / CUT H (an open cut through the remnant where you click, edge to edge), DELETE CUT. The list names every remnant REM_<job>_S<sheet>_<n> (1 = the biggest); SAVE keeps the ticked ones in the remnant store (save icon), DISCARD marks them as scrap (✗); doing neither is fine. Remnant areas hatched, their cuts red, open cuts magenta, also in the sheet pictures. Settings → Stock → Remnants: minimum distance to parts, smallest edge, smallest remnant (% of the sheet), RECTANGULAR first cut along X or Y
- Remnant: SKELET keeps sharp corners (the parts' outlines offset with sharp corners, rounded part corners under the smallest arc radius count as sharp, narrow channels left out with a square); it follows a part's arc from that radius up (Settings → Stock → Remnants, 20 mm). Stronger hatch; mode and tool buttons without a white background
- Process → **Auto cut**: the sheet with the AUTO CUT panel. Select mode: Multi sheet (every sheet; saves a new job first), Selected sheet, Selected parts (SELECT, click parts in cut order; drag or ▲▼ in the list to change it; trace box per part), Trace, Cut internal. PROCESS works out the cut path: tracing, holes, then the outline; parts in another part's hole first; big parts last within their box; then the path generation rule (bottom to top, left to right, right to left, top to bottom, shortest distance, smallest to biggest). Leads from Leads & cutting and the Technology table. Picked parts are faded with a glow; processed parts show only their cut and trace lines, with lead-ins (green), lead-outs (red) and travel (dashed). The cut path is saved with the job
- Processed sheets show their cut path in the sheet view of Automatic nest and in EDIT / VIEW too (Job search keeps the plain view). AUTO CUT panel in the app's style; Selected parts list: cut order numbers (they stay put when parts are dragged), part names, trace boxes; ten rows to start, growing, then scrolling; Up / Down below it. PROCESS shows two gears
- One sheet / all sheets: from Work parts or Report, Automatic nest, Manual nest and Process open on all sheets; EDIT / VIEW opens one; Automatic nest (like BACK) goes back to all sheets; Manual nest and Process keep the view as it is. The AUTO CUT panel is as wide as the panel beside the sheets (all sheets) or as Manual nest's (one sheet); parts are picked in the one-sheet view
- AUTO CUT panel: the tool icon (half size) beside the AUTO CUT title; Select mode and PROCESS under it at full width
- Settings → Machines → Machine → **Folders**: per machine, the NC folder (required; or tick to download NC programs in the browser instead) and the job folder with "Also write every saved job as a file" (off: jobs only in the database). The server writes there; Check tests a folder. NC output → Try it: Save to the NC folder

**Fixed**
- Post process: with the machine's 0,0 at the top left (or bottom right) the pierce was on the short lead-out and the program left by the lead-in; Auto cut now makes the path in the machine's own direction (outlines clockwise, holes counter-clockwise as the machine sees them, as in the plasma's old programs), so the screen, the leads and the NC program agree. A cut path made before a change of the 0,0 corner asks for Auto cut again
- Post process: a sheet whose material and thickness have no Technology row is not written (it had no speeds); the message names the missing row
- Process del: UNDO DELETE in the panel brings back what was deleted (Ctrl+Z did not)
- Import remnant: a remnant of the same name as a saved one no longer replaces it silently
- Job name suggestion: worked out from the newest made jobs (with many jobs it could miss the latest numbers)

**Changed**
- The Windows server package is now called `gnezdo-server-windows.zip` (was `gnezdo-windows.zip`)
- Machine → Cut order: holes first and parts inside other parts first are always applied (no longer checkboxes); only Big parts last stays, and it outranks the order picked under Auto cut. The directions (bottom to top, left to right, shortest travel) move to Auto cut
- Big parts last holds only for the parts in the big part's bounding box; parts elsewhere are cut in the Auto cut order

## Build 11 Nov 2026 (`ba40568`)

**New**
- Settings → Machines, four tabs per machine:
  - **Machine**: what it cuts (common cut, open cut, tracing, holes), cut order rules (bottom to top / left to right / shortest travel, holes first, parts inside other parts first, big parts last), Export / Import machine as a `.zip`
  - **Technology**: cutting tables per thickness (kerf, speeds, small holes, pierce time, leads, gaps, angles); import from a `.DBF` material table, pick which technologies, export CSV; new thickness = a copy of the next thicker row
  - **Leads & cutting**: six lead-in / lead-out pair types with drawings; which one the automatic cut uses on sharp corners and elsewhere, for outlines and holes
  - **NC output**: the machine's postprocessor (a JavaScript file it carries), file extension, try it on a sample plate; a generic ISO postprocessor to start from
- Reports (toolbar → Report):
  - **Nest report**: A4 page per sheet with machine, job, sheet data, estimated times, weights, the sheet drawn to scale with part numbers and rulers, and the parts table; print all, only changed pages or chosen pages
  - **Cost report**: price per part from weight and cutting time, per project, prices per material, fixed cost, sum
- Importer: **Scale** tool (type a size with a unit, e.g. `200mm`, or a scale factor, e.g. `2`; the input box opens at the picked line)
- Job search: sheet preview 2 × 2 or one per row; send a sheet's parts to a job open in a tab; Machine column and filter; materials, thicknesses and projects as small bubbles
- Process section: Break cut, Micro joint, Lead in / out, Movement and Remnant tools (icons only, they do nothing yet)
- Settings and Rules: Close under the categories (back to Home)

**Changed**
- Importer: Properties button in the standard size, 8 px between tools (room for one more tool on a 1080p screen)
- Nest report: part numbers 50 % bigger, placed on the part's material
- Result lists: scroll bars always shown
- README brought up to date with the roadmap; neutral sample names in the demo data

## Build 9 Nov 2026 (`06279ac`)

**New**
- Common cut: importer tool and color list, a nesting rule per part; Custom nest joins copies along their common cut lines into blocks; Manual nest snaps marked lines together and Arrange makes blocks
- Manual nest: Ctrl selects several parts
- Importer: line colors from your own lists (exact HEX / AutoCAD colors, any shade, grays) for cut contour, trace and open cut; lines shown in the color of their operation
- Process section: Auto cut and Manual cut tools (icons only)

**Changed**
- Importer: Folder import and File import are buttons; panel buttons light green on hover
- Work parts: removing a nested part asks first and takes its pieces off the sheets
- A DXF / DWG dropped anywhere goes to the importer (the browser no longer opens dropped files)
- Job toolbar: section tiles 140 px, the same whether a section is open or not (everything fits a 1080p screen, also at 125 %)

**Fixed**
- Common cut trials: placed parts counted first, the best trial kept when stopped

## Build 8 Nov 2026, 23:19 (`ddf91c7`)

**Fixed**
- Desktop: GNEZDO no longer stops when Firefox drops the window's connection (it stops 30 s after the window closes)

## Build 8 Nov 2026, 22:22 (`0bfa12c`)

**Fixed**
- A remnant / DXF sheet from Add sheet is never merged into identical stock
- Qty req not set: the tile cannot be dragged and says why
- Failed solutions no longer lock a part's material

## Build 8 Nov 2026, 21:53 (`48d6f16`)

**New**
- Manual nest → Add sheet: ADD FROM REMNANT and ADD FROM DXF (size and shape from the file)
- Manual nest: tiles green from Qty req to Qty max, red below and above; no dragging beyond Qty max

**Changed**
- Import: the file list is the drop area; Add files… / Add folder… next to Clear list

**Fixed**
- DXF remnants with a repeated point in the outline broke nesting
- AUTOMATIC NEST from Work parts no longer opens Manual nest
- Desktop packages: the program starts as the desktop build wherever it is started from

## Build 8 Nov 2026, 19:48 (`7f385de`)

**New**
- Test builds only when asked, not on every change
- Settings → Data: the desktop's data folder (open, back up); the server's database (admin can change it); the server's first start asks for the database in the browser

**Changed**
- Work parts: material and thickness locked while the part is on the sheets of any solution
- Arrange: a second copy turned 180° is tried lined up with the first (trapezoids, L shapes interlock)
- Sheet properties: a sheet can be turned through a position outside the cutting area

**Fixed**
- Job search: the selected job's saved nest is drawn (was an empty placeholder); material / thickness buttons pick the sheets too
